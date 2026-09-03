import { downloadBinary } from "../api/client"
import { getDetailImageQuality, getFeedImageQuality, getHeroImageQuality, loadSettings } from "../store/settings"
import { getCachedIllust } from "../store/illustCache"
import { pixivDataPath } from "../store/dataDirectory"
import { recoverFile, writeDataSafely, writeTextSafely } from "../store/safeFile"
import { enforceUgoiraCacheLimit } from "../ugoira/ugoira"
import type { PixivImageUrls } from "../types"

// 图片磁盘缓存：Referer 下载 + LRU 淘汰

const CACHE_DIR_NAME = "ImageCache"
const META_FILE = "cache_meta.json"

interface CacheMeta {
  [key: string]: { url: string; size: number; lastAccess: number }
}

let cacheDir: string | null = null
let cacheGeneration = 0
let cacheRevision = 0
let cachedMeta: CacheMeta | null = null
let metaSaveTimer: number | null = null
const META_IDLE_SAVE_MS = 3000
const cacheChangeListeners = new Set<() => void>()

export function onImageCacheChanged(listener: () => void): () => void {
  cacheChangeListeners.add(listener)
  return () => cacheChangeListeners.delete(listener)
}

export function imageCacheRevision(): number {
  return cacheRevision
}

function notifyImageCacheChanged(): void {
  for (const listener of cacheChangeListeners) {
    try {
      listener()
    } catch {
    }
  }
}

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
  // 缓存命中和下载完成会密集更新 lastAccess；最多每 3 秒合并提交一次，
  // 降低同步 JSON 与 LRU 扫描频率，同时保证持续滚动时元数据仍会定期落盘。
  if (metaSaveTimer != null) return
  metaSaveTimer = setTimeout(() => {
    metaSaveTimer = null
    if (cachedMeta) {
      saveMeta(cachedMeta)
      enforceCacheLimit()
    }
  }, META_IDLE_SAVE_MS)
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

// 按 LRU 清理超出上限的缓存（静态图片分配总预算的 90%）
export function enforceCacheLimit(): void {
  try {
    enforceUgoiraCacheLimit()
  } catch {}
  const settings = loadSettings()
  if (settings.cacheLimitMB == null) return
  const limitBytes = Math.round(settings.cacheLimitMB * 1024 * 1024 * 0.9)
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

// 图片下载并发控制：同一 URL 在途去重。
// 最大下载并发数与预取 Worker 数根据设置“图片并发数”结合“下载并发比例 / 预取并发比例”动态计算。
// 引入优先级调度：前台视图根据卡片在信息流中的自然次序传入 priority（值越小越优先），
// 保证自顶向下优先加载最上方的卡片，消除左右列分发造成的挂载先后偏差。
// 预取可在出队前取消；可见卡片随后请求同一 URL 时会提升为前台任务。
interface PrefetchState {
  cancelled: boolean
}

export const DEFAULT_IMAGE_PRIORITY = 999999

interface DownloadTask {
  generation: number
  promise: Promise<string | null>
  started: boolean
  foregroundRequested: boolean
  prefetchOwners: Set<PrefetchState>
  priority: number
  queue: "foreground" | "prefetch" | null
  activeLane: "foreground" | "prefetch" | null
  run: () => void
}

const inflightDownloads = new Map<string, DownloadTask>()
let activeDownloads = 0
let activePrefetchDownloads = 0
const foregroundQueue: DownloadTask[] = []
const prefetchQueue: DownloadTask[] = []

export function maxConcurrentDownloads(): number {
  const settings = loadSettings()
  const concurrency = settings.imageBatchConcurrency ?? 30
  const ratio = (settings.imageDownloadConcurrencyRatio ?? 100) / 100
  return Math.max(1, Math.round(concurrency * ratio))
}

export function maxPrefetchWorkers(): number {
  const settings = loadSettings()
  const concurrency = settings.imageBatchConcurrency ?? 30
  const ratio = (settings.imagePrefetchConcurrencyRatio ?? 100) / 100
  return Math.max(1, Math.round(concurrency * ratio))
}

export function maxPrefetchUrls(): number {
  const settings = loadSettings()
  const concurrency = settings.imageBatchConcurrency ?? 30
  const ratio = (settings.imagePrefetchConcurrencyRatio ?? 100) / 100
  return Math.max(1, Math.round(concurrency * ratio))
}

function pumpDownloads(): void {
  const maxDownloads = maxConcurrentDownloads()
  const maxPrefetch = maxPrefetchWorkers()
  while (activeDownloads < maxDownloads) {
    let task = foregroundQueue.shift()
    let lane: "foreground" | "prefetch" = "foreground"
    if (!task) {
      if (activePrefetchDownloads >= maxPrefetch) return
      task = prefetchQueue.shift()
      lane = "prefetch"
    }
    if (!task) return
    task.queue = null
    task.activeLane = lane
    activeDownloads++
    if (lane === "prefetch") activePrefetchDownloads++
    task.run()
  }
}

function releaseDownloadSlot(task: DownloadTask): void {
  activeDownloads--
  if (task.activeLane === "prefetch") activePrefetchDownloads--
  task.activeLane = null
  pumpDownloads()
}

function insertForegroundTask(task: DownloadTask): void {
  task.queue = "foreground"
  // 保持按 priority 升序（priority 小的优先；相同 priority 保持先进先出）
  const index = foregroundQueue.findIndex((t) => t.priority > task.priority)
  if (index === -1) {
    foregroundQueue.push(task)
  } else {
    foregroundQueue.splice(index, 0, task)
  }
}

function updateTaskPriority(task: DownloadTask, newPriority: number): void {
  if (newPriority < task.priority) {
    task.priority = newPriority
    if (task.queue === "foreground") {
      const idx = foregroundQueue.indexOf(task)
      if (idx >= 0) {
        foregroundQueue.splice(idx, 1)
        insertForegroundTask(task)
      }
    }
  }
}

function queueDownload(task: DownloadTask, queueType: "foreground" | "prefetch"): void {
  if (queueType === "foreground") {
    insertForegroundTask(task)
  } else {
    task.queue = "prefetch"
    prefetchQueue.push(task)
  }
  pumpDownloads()
}

function promoteQueuedDownload(task: DownloadTask): void {
  if (task.started || task.queue !== "prefetch") return
  const index = prefetchQueue.indexOf(task)
  if (index >= 0) prefetchQueue.splice(index, 1)
  insertForegroundTask(task)
  pumpDownloads()
}

// 下载图片到缓存（带 Referer），返回本地路径；失败返回 null。
// 可见图片会将同 URL 的排队预取提升为不可取消的前台任务，并以指定优先级排队。
export async function loadImage(
  url: string,
  priority = DEFAULT_IMAGE_PRIORITY
): Promise<string | null> {
  return requestImage(url, undefined, priority)
}

function requestImage(
  url: string,
  prefetchOwner?: PrefetchState,
  priority = DEFAULT_IMAGE_PRIORITY
): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  const requestGeneration = cacheGeneration
  const existing = cachedFilePath(url)
  if (existing) {
    touchCachedFile(url)
    return Promise.resolve(existing)
  }
  const running = inflightDownloads.get(url)
  if (running && running.generation === requestGeneration) {
    if (prefetchOwner) {
      running.prefetchOwners.add(prefetchOwner)
    } else {
      running.foregroundRequested = true
      updateTaskPriority(running, priority)
      promoteQueuedDownload(running)
    }
    return running.promise
  }

  const record: DownloadTask = {
    generation: requestGeneration,
    promise: Promise.resolve(null),
    started: false,
    foregroundRequested: !prefetchOwner,
    prefetchOwners: new Set(prefetchOwner ? [prefetchOwner] : []),
    priority: prefetchOwner ? DEFAULT_IMAGE_PRIORITY : priority,
    queue: null,
    activeLane: null,
    run: () => {},
  }
  record.promise = new Promise<string | null>((resolve, reject) => {
    record.run = () => {
      record.started = true
      if (record.generation !== cacheGeneration) {
        resolve(null)
        releaseDownloadSlot(record)
        return
      }
      if (
        !record.foregroundRequested &&
        [...record.prefetchOwners].every((owner) => owner.cancelled)
      ) {
        if (inflightDownloads.get(url) === record) {
          inflightDownloads.delete(url)
        }
        resolve(null)
        releaseDownloadSlot(record)
        return
      }
      const generation = record.generation
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
        saveMetaDeferred(meta)
        // 当前下载项有效即可交给 Image.filePath 显示
        return isUsableCacheFile(path) ? path : null
      })()
        .then(resolve, reject)
        .finally(() => {
          releaseDownloadSlot(record)
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
  const prefetchLimit = maxPrefetchUrls()
  const prefetchWorkersLimit = maxPrefetchWorkers()
  const unique = [...new Set(urls.filter((u): u is string => !!u))]
    .slice(0, prefetchLimit)
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
  for (let i = 0; i < Math.min(prefetchWorkersLimit, unique.length); i++) {
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
  cacheRevision += 1
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
  notifyImageCacheChanged()
}

// 从基准 URL 推导 Pixiv 等比例中等缩略图（540x540_70，保留与原图 100% 一致的物理纵横比）：
export function derivePixivThumbUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (!url.includes("pximg.net")) return url
  // 若已经是 540x540 或 240x240 等等比例缩略图直接复用
  if (url.includes("/c/540x540") || url.includes("/c/240x240")) return url
  // 替换已有的 /c/... 裁剪/缩放前缀
  if (/\/c\/[^\/]+\/img-master\//.test(url)) {
    return url.replace(/\/c\/[^\/]+\/img-master\//, "/c/540x540_70/img-master/")
  }
  // 无 /c/ 前缀的 master 图
  if (url.includes("/img-master/")) {
    return url.replace("/img-master/", "/c/540x540_70/img-master/")
  }
  // 替换已有的 /c/... 裁剪/缩放前缀（针对 imgaz 图）
  if (/\/c\/[^\/]+\/imgaz\//.test(url)) {
    return url.replace(/\/c\/[^\/]+\/imgaz\//, "/c/540x540_70/imgaz/")
  }
  // 无 /c/ 前缀的 imgaz 图（如专栏封面、文章配图）
  if (url.includes("/imgaz/")) {
    return url.replace("/imgaz/", "/c/540x540_70/imgaz/")
  }
  return url
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
    width?: number
    height?: number
    image_urls?: PixivImageUrls
    meta_pages?: { image_urls: PixivImageUrls }[]
    meta_single_page?: { original_image_url?: string }
  },
  pageIndex: number,
  quality: "medium" | "large" | "original"
): string | null {
  if (!i) return null
  const ratio = i.width && i.height ? i.width / i.height : 1
  // 详情页兜底：宽高比达到 1:3（极窄长图）启用原图画质
  const effectiveQuality: "medium" | "large" | "original" =
    ratio < 1 / 3 ? "original" : quality

  // 多页：优先 meta_pages 对应页
  if (i.meta_pages && i.meta_pages.length > 0) {
    const page = i.meta_pages[pageIndex]
    if (page) {
      const urls = page.image_urls
      if (effectiveQuality === "original") {
        // 多页作品的原图在 meta_pages[i].image_urls.original
        return urls?.original ?? urls?.large ?? null
      }
      if (effectiveQuality === "medium") {
        return urls?.medium ?? urls?.large ?? null
      }
      return urls?.large ?? urls?.medium ?? null
    }
    // meta_pages 长度不足（API 异常）：用第一页 URL 推导
    const first = i.meta_pages[0]?.image_urls
    const base =
      effectiveQuality === "original"
        ? (first?.original ?? first?.large)
        : effectiveQuality === "medium"
          ? (first?.medium ?? first?.large)
          : (first?.large ?? first?.medium)
    return derivePageURL(base, pageIndex)
  }
  // 单页 / API 未返回多页：从第一页 URL 推导（覆盖漫画只返回 meta_single_page 的情况）
  let base: string | null | undefined
  if (effectiveQuality === "original") {
    base =
      i.meta_single_page?.original_image_url ??
      i.image_urls?.original ??
      i.image_urls?.large ??
      i.image_urls?.medium ??
      null
  } else if (effectiveQuality === "medium") {
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
// 依据设置的 feedImageQuality（中等/大图）选择分辨率。在“中等”模式下，极窄竖图仍优先 large 保持清晰度。
export function cardThumbUrlOf(
  i: {
    width?: number
    height?: number
    image_urls?: PixivImageUrls | { square_medium?: string; medium?: string; large?: string; original?: string }
    meta_pages?: { image_urls: PixivImageUrls }[]
    meta_single_page?: { original_image_url?: string }
  },
  quality?: "medium" | "large" | "original" | unknown
): string | null {
  if (!i) return null
  const selectedQuality =
    quality === "medium" || quality === "large" || quality === "original"
      ? quality
      : getFeedImageQuality()
  if (selectedQuality === "original") {
    const originalUrl =
      i.meta_single_page?.original_image_url ||
      (i.meta_pages && i.meta_pages.length > 0 ? i.meta_pages[0]?.image_urls?.original : undefined) ||
      imageUrlOf(i, 0, "original")
    return (
      originalUrl ??
      i.image_urls?.large ??
      i.image_urls?.medium ??
      i.image_urls?.square_medium ??
      null
    )
  }
  if (selectedQuality === "large") {
    return i.image_urls?.large ?? i.image_urls?.medium ?? i.image_urls?.square_medium ?? null
  }
  if (quality === "medium") {
    return i.image_urls?.medium ?? i.image_urls?.large ?? i.image_urls?.square_medium ?? null
  }
  const ratio = i.width && i.height ? i.width / i.height : 1
  const preferLarge = ratio < 1 / 2
  return preferLarge
    ? (i.image_urls?.large ?? i.image_urls?.medium ?? i.image_urls?.square_medium ?? null)
    : (i.image_urls?.medium ?? i.image_urls?.large ?? i.image_urls?.square_medium ?? null)
}

// Hero 全宽卡片图片 URL：画质从当前瀑布流画质自动升一档（medium -> large，large -> original）。若无 original 则自动回退 large。
export function heroCardThumbUrlOf(
  i: {
    width?: number
    height?: number
    image_urls?: PixivImageUrls | { square_medium?: string; medium?: string; large?: string; original?: string }
    meta_pages?: { image_urls: PixivImageUrls }[]
    meta_single_page?: { original_image_url?: string }
  }
): string | null {
  if (!i) return null
  const heroQuality = getHeroImageQuality()
  const targetUrl = cardThumbUrlOf(i, heroQuality)
  // 若目标为 original 但未获取到有效地址，显式兜底回退至 large
  return (
    targetUrl ??
    i.image_urls?.large ??
    i.image_urls?.medium ??
    i.image_urls?.square_medium ??
    null
  )
}

// 多页插画与漫画的中等缩略图获取与推导函数（等比例缩放，严禁使用方形裁剪的 square_medium 以免消融时发生比例跳变）：
// 1. 第 0 页：优先复用中等比例的 cardThumbUrlOf / medium / large。
// 2. 第 1 页及后续页：优先从 meta_pages[pageIndex] 取保持原图纵横比的 medium 缩略图；若无则回退 large。
// 3. 若 meta_pages 缺失或长度不足：通过第一页中等缩略图的 URL 规则算法推导 _p${pageIndex} 对应页的中图。
export function pageThumbUrlOf(
  i: {
    width?: number
    height?: number
    image_urls?: PixivImageUrls | { square_medium?: string; medium?: string; large?: string; original?: string }
    meta_pages?: { image_urls: PixivImageUrls }[]
    meta_single_page?: { original_image_url?: string }
  },
  pageIndex: number
): string | null {
  if (!i) return null
  if (pageIndex === 0) {
    return (
      cardThumbUrlOf(i) ||
      i.image_urls?.medium ||
      i.image_urls?.large ||
      i.image_urls?.square_medium ||
      null
    )
  }
  // 多页作品：优先使用 meta_pages 中该页保持原始比例的中等缩略图（medium），避免方形裁切导致的比例跳变
  if (i.meta_pages && i.meta_pages.length > pageIndex) {
    const page = i.meta_pages[pageIndex]
    if (page?.image_urls) {
      return (
        page.image_urls.medium ??
        page.image_urls.large ??
        page.image_urls.square_medium ??
        null
      )
    }
  }
  // 若 meta_pages 未返回（如单页数据进入多页长图模式）：以第一页的保持比例中图推导
  const baseThumb =
    i.image_urls?.medium ??
    i.image_urls?.large ??
    i.image_urls?.square_medium ??
    null
  return derivePageURL(baseThumb, pageIndex)
}

/**
 * 将 Pixiv 封面/插画缩略图 URL 升档为高清大图（master1200 / original）
 * 针对小说封面、系列封面与插画背景横幅：
 * 1. novel-cover-master: 去除 /c/<size>/ 裁剪缩放路径，并将 _square1200. / _custom1200. 替换为 _master1200.
 * 2. img-master: 去除 /c/<size>/ 裁剪缩放路径，并将 _square1200. / _custom1200. 替换为 _master1200.
 */
export function upgradeHighQualityCoverUrl(
  url: string | null | undefined
): string | null {
  if (!url || typeof url !== "string") return null
  if (!url.includes("pximg.net")) return url

  let upgraded = url
  if (upgraded.includes("novel-cover-master")) {
    upgraded = upgraded.replace(/\/c\/[^/]+\//, "/")
    upgraded = upgraded.replace(/_(?:square|custom)1200\./, "_master1200.")
    return upgraded
  }

  if (upgraded.includes("img-master")) {
    upgraded = upgraded.replace(/\/c\/[^/]+\//, "/")
    upgraded = upgraded.replace(/_(?:square|custom)1200\./, "_master1200.")
    return upgraded
  }

  return upgraded
}

/**
 * 跨页面同规格大图复用与缓存穿透机制：
 * 当从特辑等外部信息流进入详情页且要求“大图画质”时，检查本地是否已存在该作品的大图级别缓存（如特辑大图）。
 * 若已存在，将其直接链接/复用给详情页目标大图 URL，避免同规格图片因 URL 细微差异产生二次网络下载与闪屏。
 */
export function seedIllustDetailFromCache(
  i: {
    id: number
    image_urls?: PixivImageUrls | { square_medium?: string; medium?: string; large?: string; original?: string }
    extra_preview_url?: string
    meta_pages?: { image_urls: PixivImageUrls }[]
  } | null | undefined,
  quality: "large" | "original"
): void {
  if (!i || quality !== "large") return
  const targetUrl = imageUrlOf(i as any, 0, "large")
  if (!targetUrl) return

  const targetPath = cacheFilePath(targetUrl)
  if (FileManager.existsSync(targetPath)) return

  // 寻找候选大图来源（特辑大图 > 去前缀大图 > medium）
  const candidateUrls = [
    i.extra_preview_url,
    upgradeHighQualityCoverUrl(i.image_urls?.large),
    i.image_urls?.large,
    upgradeHighQualityCoverUrl(i.image_urls?.medium),
  ].filter((u): u is string => Boolean(u && u !== targetUrl))

  for (const candUrl of candidateUrls) {
    const candPath = cachedFilePath(candUrl)
    if (candPath) {
      try {
        FileManager.copyFileSync(candPath, targetPath)
        const meta = loadMeta()
        const stat = FileManager.statSync(targetPath)
        touch(meta, cacheKey(targetUrl), targetUrl, stat.size)
        saveMetaDeferred(meta)
        break
      } catch {}
    }
  }
}

/**
 * 从本地已有缓存（如特辑大图、其它规格大图）向主站标准大图同步预热缓存：
 * 在进入 illust 详情页路由时同步调用，确保详情页挂载首帧即命中磁盘大图，
 * 彻底消除进页后的重复下载、URL突变与排版闪动。
 */
export function seedIllustFromPixivCache(illustID: number): void {
  if (!illustID || typeof illustID !== "number") return
  const illust = getCachedIllust(illustID)
  if (!illust) return

  const detailQuality = getDetailImageQuality()
  seedIllustDetailFromCache(illust, detailQuality)
}

/**
 * 智能解析当前作品最佳可用垫底图 URL：
 * 优先返回本地已命中磁盘缓存的最高规格图片（特辑大图 > master1200大图 > 缩略图），
 * 确保详情页在首帧挂载时无论大图或原图下载与否，均能立刻获得清晰底图垫底，杜绝空白与闪屏。
 */
export function resolveIllustUnderlayUrl(
  i: {
    image_urls?: PixivImageUrls | { square_medium?: string; medium?: string; large?: string; original?: string }
    extra_preview_url?: string
    meta_pages?: { image_urls: PixivImageUrls }[]
    meta_single_page?: { original_image_url?: string }
  } | null | undefined,
  pageIndex = 0
): string | null {
  if (!i) return null

  // 1. 若本地已缓存了该作品的特辑高清大图，优先使用特辑大图垫底
  if (pageIndex === 0 && i.extra_preview_url && cachedFilePath(i.extra_preview_url)) {
    return i.extra_preview_url
  }

  // 2. 若本地已缓存了对应页的大图，优先使用大图垫底
  const largeUrl = imageUrlOf(i as any, pageIndex, "large")
  if (largeUrl && cachedFilePath(largeUrl)) {
    return largeUrl
  }

  // 3. 检查是否有保持原比例的中等缩略图已缓存
  const thumbUrl = pageThumbUrlOf(i, pageIndex)
  if (thumbUrl && cachedFilePath(thumbUrl)) {
    return thumbUrl
  }

  // 4. 未命中本地缓存时回退候选
  return i.extra_preview_url || thumbUrl || null
}

const pixivisionCoverMap = new Map<number, string>()

export function recordPixivisionCoverUrl(articleId: number, url: string): void {
  if (articleId > 0 && url) {
    pixivisionCoverMap.set(articleId, url)
  }
}

export function getPixivisionCoverUrl(articleId: number): string | null {
  return pixivisionCoverMap.get(articleId) ?? null
}


