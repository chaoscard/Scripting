import { downloadBinary } from "../api/client"
import { loadSettings } from "../store/settings"
import { pixivDataPath } from "../store/dataDirectory"
import { recoverFile, writeDataSafely, writeTextSafely } from "../store/safeFile"
import type { PixivImageUrls } from "../types"

// 图片磁盘缓存：Referer 下载 + LRU 淘汰

const CACHE_DIR_NAME = "ImageCache"
const META_FILE = "cache_meta.json"

interface CacheMeta {
  [key: string]: { url: string; size: number; lastAccess: number }
}

let cacheDir: string | null = null
let cacheGeneration = 0
let cachedMeta: CacheMeta | null = null
let metaSaveTimer: number | null = null

function joinPath(...parts: string[]): string {
  return parts.join("/")
}

function ensureCacheDir(): string {
  const dir = cacheDir ?? pixivDataPath(CACHE_DIR_NAME)
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
  cacheDir = dir
  return dir
}

function metaPath(): string {
  return joinPath(ensureCacheDir(), META_FILE)
}

function loadMeta(): CacheMeta {
  if (cachedMeta) return cachedMeta
  const path = metaPath()
  recoverFile(path)
  if (!FileManager.existsSync(path)) {
    cachedMeta = {}
    return cachedMeta
  }
  try {
    const raw = FileManager.readAsStringSync(path, "utf-8")
    cachedMeta = JSON.parse(raw) as CacheMeta
  } catch {
    cachedMeta = {}
  }
  return cachedMeta
}

function saveMeta(meta: CacheMeta): void {
  if (metaSaveTimer != null) {
    clearTimeout(metaSaveTimer)
    metaSaveTimer = null
  }
  cachedMeta = meta
  try {
    writeTextSafely(metaPath(), JSON.stringify(meta), (raw) => {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("缓存元数据格式错误")
      }
    })
  } catch {
    // 图片缓存可重建；元数据提交失败不影响本次图片显示。
  }
}

function saveMetaDeferred(meta: CacheMeta): void {
  cachedMeta = meta
  if (metaSaveTimer != null) return
  metaSaveTimer = setTimeout(() => {
    metaSaveTimer = null
    if (cachedMeta) saveMeta(cachedMeta)
  }, 1000)
}

export function cacheKey(url: string): string {
  return Crypto.md5(Data.fromRawString(url)!).toHexString()
}

// 从 URL 推断扩展名（Image 组件需要扩展名识别图片类型）
function extensionOf(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase()
    const match = path.match(/\.(jpe?g|png|webp|gif|avif|zip|mp4)$/)
    if (match) {
      if (match[1] === "jpeg") return "jpg"
      return match[1]
    }
  } catch {
    // ignore
  }
  return "jpg"
}

export function cacheFilePath(url: string): string {
  return joinPath(ensureCacheDir(), `${cacheKey(url)}.${extensionOf(url)}`)
}

function isUsableCacheFile(path: string): boolean {
  if (!FileManager.existsSync(path)) return false
  try {
    const stat = FileManager.statSync(path)
    return stat.size > 0
  } catch {
    return false
  }
}

export function cachedFileExists(url: string): boolean {
  return isUsableCacheFile(cacheFilePath(url))
}

export function cachedFilePath(url: string): string | null {
  const path = cacheFilePath(url)
  return isUsableCacheFile(path) ? path : null
}

function touch(meta: CacheMeta, key: string, url: string, size: number): void {
  meta[key] = { url, size, lastAccess: Date.now() }
}

// 按 LRU 清理超出上限的缓存
function enforceLimit(): void {
  const settings = loadSettings()
  const limitBytes = settings.cacheLimitMB * 1024 * 1024
  const meta = loadMeta()
  const entries = Object.entries(meta)
  let total = entries.reduce((sum, [, v]) => sum + (v.size || 0), 0)
  if (total <= limitBytes) return
  const sorted = entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess)
  for (const [key, v] of sorted) {
    if (total <= limitBytes) break
    const file = cacheFilePath(v.url)
    try {
      if (FileManager.existsSync(file)) {
        FileManager.removeSync(file)
      }
    } catch {
      // ignore
    }
    delete meta[key]
    total -= v.size || 0
  }
  saveMeta(meta)
}

// 图片下载并发控制：同一 URL 在途去重 + 全局最多 4 个并发。
// 预取可在出队前取消；可见卡片随后请求同一 URL 时会提升为前台任务。
interface PrefetchState {
  cancelled: boolean
}

interface DownloadTask {
  promise: Promise<string | null>
  started: boolean
  foregroundRequested: boolean
  prefetchOwners: Set<PrefetchState>
  queue: "foreground" | "prefetch" | null
  run: () => void
}

const inflightDownloads = new Map<string, DownloadTask>()
const MAX_CONCURRENT_DOWNLOADS = 4
const MAX_PREFETCH_WORKERS = 2
let activeDownloads = 0
const foregroundQueue: DownloadTask[] = []
const prefetchQueue: DownloadTask[] = []

function pumpDownloads(): void {
  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
    const task = foregroundQueue.shift() ?? prefetchQueue.shift()
    if (!task) return
    task.queue = null
    activeDownloads++
    task.run()
  }
}

function queueDownload(task: DownloadTask, priority: "foreground" | "prefetch"): void {
  task.queue = priority
  ;(priority === "foreground" ? foregroundQueue : prefetchQueue).push(task)
  pumpDownloads()
}

function promoteQueuedDownload(task: DownloadTask): void {
  if (task.started || task.queue !== "prefetch") return
  const index = prefetchQueue.indexOf(task)
  if (index >= 0) prefetchQueue.splice(index, 1)
  task.queue = "foreground"
  foregroundQueue.push(task)
  pumpDownloads()
}

// 下载图片到缓存（带 Referer），返回本地路径；失败返回 null。
// 可见图片会将同 URL 的排队预取提升为不可取消的前台任务。
export async function loadImage(url: string): Promise<string | null> {
  return requestImage(url)
}

function requestImage(
  url: string,
  prefetchOwner?: PrefetchState
): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  const existing = cachedFilePath(url)
  if (existing) {
    touchCachedFile(url)
    return Promise.resolve(existing)
  }
  const running = inflightDownloads.get(url)
  if (running) {
    if (prefetchOwner) {
      running.prefetchOwners.add(prefetchOwner)
    } else {
      running.foregroundRequested = true
      promoteQueuedDownload(running)
    }
    return running.promise
  }

  const record: DownloadTask = {
    promise: Promise.resolve(null),
    started: false,
    foregroundRequested: !prefetchOwner,
    prefetchOwners: new Set(prefetchOwner ? [prefetchOwner] : []),
    queue: null,
    run: () => {},
  }
  record.promise = new Promise<string | null>((resolve, reject) => {
    record.run = () => {
      record.started = true
      if (
        !record.foregroundRequested &&
        [...record.prefetchOwners].every((owner) => owner.cancelled)
      ) {
        resolve(null)
        activeDownloads--
        pumpDownloads()
        return
      }
      const generation = cacheGeneration
      ;(async (): Promise<string | null> => {
        let data: Data | null = null
        try {
          data = await downloadBinary(url)
        } catch (err: any) {
          console.log("loadImage error:", url.slice(0, 80), err?.message)
          return null
        }
        if (!data || generation !== cacheGeneration) return null
        const path = cacheFilePath(url)
        try {
          writeDataSafely(path, data)
        } catch (err: any) {
          console.log("cache write error:", err?.message)
          return null
        }
        if (generation !== cacheGeneration) {
          try {
            if (FileManager.existsSync(path)) FileManager.removeSync(path)
          } catch {
            // ignore
          }
          return null
        }
        const meta = loadMeta()
        touch(meta, cacheKey(url), url, data.size)
        saveMeta(meta)
        enforceLimit()
        // 当前下载项也可能因单文件超配额被 LRU 立即淘汰；不能把失效路径
        // 交给 Image.filePath，否则会表现为下载成功后仍加载失败。
        return isUsableCacheFile(path) ? path : null
      })()
        .then(resolve, reject)
        .finally(() => {
          activeDownloads--
          pumpDownloads()
        })
    }
  })
  queueDownload(record, prefetchOwner ? "prefetch" : "foreground")
  inflightDownloads.set(url, record)
  void record.promise.finally(() => {
    if (inflightDownloads.get(url) === record) {
      inflightDownloads.delete(url)
    }
  })
  return record.promise
}

function touchCachedFile(url: string): void {
  const meta = loadMeta()
  const key = cacheKey(url)
  if (meta[key]) {
    meta[key].lastAccess = Date.now()
    saveMetaDeferred(meta)
  }
}

export interface PrefetchHandle {
  cancel: () => void
}

const NOOP_PREFETCH_HANDLE: PrefetchHandle = { cancel: () => {} }

// 预取一组图片（不阻塞）。取消不会中断已经开始的共享下载，
// 但会阻止当前批次继续向下载队列提交后续 URL。
export function prefetch(urls: (string | null | undefined)[]): PrefetchHandle {
  if (!loadSettings().prefetchEnabled) return NOOP_PREFETCH_HANDLE
  const unique = [...new Set(urls.filter((u): u is string => !!u))]
  const state: PrefetchState = { cancelled: false }
  let index = 0
  const worker = async () => {
    while (!state.cancelled && index < unique.length) {
      const url = unique[index++]
      try {
        await requestImage(url, state)
      } catch {
        // 预取失败静默
      }
    }
  }
  for (let i = 0; i < Math.min(MAX_PREFETCH_WORKERS, unique.length); i++) {
    void worker()
  }
  return {
    cancel: () => {
      state.cancelled = true
    },
  }
}

// 计算缓存占用（字节）
export function cacheUsageBytes(): number {
  const meta = loadMeta()
  return Object.values(meta).reduce((sum, v) => sum + (v.size || 0), 0)
}

// 清空缓存
export function clearCache(): void {
  cacheGeneration += 1
  if (metaSaveTimer != null) {
    clearTimeout(metaSaveTimer)
    metaSaveTimer = null
  }
  cachedMeta = null
  const dir = ensureCacheDir()
  try {
    if (FileManager.existsSync(dir)) {
      FileManager.removeSync(dir)
    }
    FileManager.createDirectorySync(dir, true)
  } catch {
    // ignore
  }
  cacheDir = null
}

// 从基准 URL 推导指定页的 URL（Pixiv 文件名页号格式 _p0/_p1/...）。
// 覆盖 app API 的 detail 对部分漫画不返回 meta_pages（只有第一页 URL）的情况：
// 用第一页 URL 替换页号即可得到其余页。
function derivePageURL(
  baseURL: string | null | undefined,
  pageIndex: number
): string | null {
  if (!baseURL) return null
  if (/_p\d+/.test(baseURL)) {
    return baseURL.replace(/_p\d+/, `_p${pageIndex}`)
  }
  // URL 无页号模式（罕见）：仅第一页可直接使用
  return pageIndex === 0 ? baseURL : null
}

export function imageUrlOf(
  i: {
    image_urls?: PixivImageUrls
    meta_pages?: { image_urls: PixivImageUrls }[]
    meta_single_page?: { original_image_url?: string }
  },
  pageIndex: number,
  quality: "medium" | "large" | "original"
): string | null {
  if (!i) return null
  // 多页：优先 meta_pages 对应页
  if (i.meta_pages && i.meta_pages.length > 0) {
    const page = i.meta_pages[pageIndex]
    if (page) {
      const urls = page.image_urls
      if (quality === "original") {
        // 多页作品的原图在 meta_pages[i].image_urls.original
        return urls?.original ?? urls?.large ?? null
      }
      if (quality === "medium") {
        return urls?.medium ?? urls?.large ?? null
      }
      return urls?.large ?? urls?.medium ?? null
    }
    // meta_pages 长度不足（API 异常）：用第一页 URL 推导
    const first = i.meta_pages[0]?.image_urls
    const base =
      quality === "original"
        ? (first?.original ?? first?.large)
        : quality === "medium"
          ? (first?.medium ?? first?.large)
          : (first?.large ?? first?.medium)
    return derivePageURL(base, pageIndex)
  }
  // 单页 / API 未返回多页：从第一页 URL 推导（覆盖漫画只返回 meta_single_page 的情况）
  let base: string | null | undefined
  if (quality === "original") {
    base =
      i.meta_single_page?.original_image_url ??
      i.image_urls?.original ??
      i.image_urls?.large ??
      i.image_urls?.medium ??
      null
  } else if (quality === "medium") {
    base = i.image_urls?.medium ?? i.image_urls?.large ?? i.image_urls?.square_medium ?? null
  } else {
    base = i.image_urls?.large ?? i.image_urls?.medium ?? i.image_urls?.square_medium ?? null
  }
  return derivePageURL(base, pageIndex)
}

// 小尺寸缩略图：优先 Pixiv CDN 的 square_medium，适用于通知、用户预览等无需自定义焦点的场景。
export function thumbUrlOf(i: {
  image_urls?: { square_medium?: string; medium?: string; large?: string }
}): string | null {
  return (
    i.image_urls?.square_medium ??
    i.image_urls?.medium ??
    i.image_urls?.large ??
    null
  )
}

export function novelThumbUrlOf(i: {
  image_urls?: { medium?: string; large?: string; square_medium?: string } | null
  cover?: { urls?: { "240mw"?: string; "480mw"?: string } } | null
}): string | null {
  return (
    i.image_urls?.medium ??
    i.image_urls?.large ??
    i.image_urls?.square_medium ??
    i.cover?.urls?.["240mw"] ??
    i.cover?.urls?.["480mw"] ??
    null
  )
}

// 标准 IllustCard 裁切源：必须优先完整比例图片。
// square_medium 可能已被 Pixiv 服务端从顶部预裁切，无法在本地恢复画面中央。
// 极窄竖图的 medium 宽度会因 Pixiv 的长边限制而过低，改用 large 保持双列流清晰度。
export function cardThumbUrlOf(i: {
  width?: number
  height?: number
  image_urls?: { square_medium?: string; medium?: string; large?: string }
}): string | null {
  const ratio = i.width && i.height ? i.width / i.height : 1
  const preferLarge = ratio < 1 / 2
  return preferLarge
    ? (i.image_urls?.large ?? i.image_urls?.medium ?? i.image_urls?.square_medium ?? null)
    : (i.image_urls?.medium ?? i.image_urls?.large ?? i.image_urls?.square_medium ?? null)
}
