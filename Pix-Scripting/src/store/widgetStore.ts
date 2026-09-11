import { Device, Widget } from "scripting"
import { downloadBinary } from "../api/client"
import { session } from "../api/session"
import {
  ranking,
  recommendations,
  followingFeed,
  pixivisionHome,
  nextPixivision,
  nextIllustrations,
  addBookmark,
  removeBookmark,
} from "../api/pixiv"
import { getWidgetSourceForFamily, loadSettings } from "./settings"
import { pixivWidgetPath } from "./dataDirectory"
import { writeDataSafely, writeTextSafely, recoverFile } from "./safeFile"
import { cacheIllust, getCachedIllust } from "./illustCache"
import { cacheFilePath, recordPixivisionCoverUrl } from "../image/imageLoader"
import { isPixivisionBookmarked, togglePixivisionBookmark } from "./pixivisionBookmarks"
import {
  getCachedIllustBookmark,
  recordIllustBookmark,
  notifyIllustBookmarkChanged,
} from "./bookmarkSync"
import type { PixivIllustration, PixivisionArticle } from "../types"

export interface WidgetArtwork {
  id: number
  title: string
  userId: number
  userName: string
  localImagePath: string
  remoteImageUrl?: string
  width: number
  height: number
  aspectRatio: number
  sourceType: string
  route?: string
  updatedAt: number
  bookmarked?: boolean
}

export interface WidgetPoolState {
  revision: number
  currentIndex: number
  currentArtworkId?: number
  artworks: WidgetArtwork[]
  lastFetchTime: number
  lastFetchStartedAt?: number
  lastRotatedAt?: number
  parameter: string
  nextURL?: string | null
  updatedAt: number
}

const IMAGES_DIR_NAME = "images"
const DEFAULT_POOL_CAPACITY = 30
const MIN_PREFETCH_COUNT = 15 // 提前 15 张深水位线后台预拉取，消除切图断档
const POOL_STALE_TTL_MS = 4 * 60 * 60 * 1000 // 4小时数据过期自愈，重新拉取最新数据
const DOWNLOAD_CONCURRENCY = 3 // 3路并发下载大图，兼顾吞吐与小组件内存限制
const GLOBAL_INTENT_FILE = "intent_state.json"
const ADVANCE_COOLDOWN_MS = 3000 // 3 秒防连跳步进冷却
const BROADCAST_GRACE_PERIOD_MS = 6000 // 6 秒手动全局广播保护期，防止殃及其他小组件

function globalIntentStatePath(): string {
  return `${ensureWidgetDir()}/${GLOBAL_INTENT_FILE}`
}

export function recordGlobalWidgetIntent(): void {
  try {
    const path = globalIntentStatePath()
    writeTextSafely(path, JSON.stringify({ lastIntentAt: Date.now() }))
  } catch {}
}

export function getLastGlobalWidgetIntent(): number {
  try {
    const path = globalIntentStatePath()
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      const parsed = JSON.parse(raw)
      if (typeof parsed?.lastIntentAt === "number") {
        return parsed.lastIntentAt
      }
    }
  } catch {}
  return 0
}

function getPoolCapacity(): number {
  try {
    const settings = loadSettings()
    if (typeof settings.widgetPoolCapacity === "number" && Number.isFinite(settings.widgetPoolCapacity)) {
      return Math.max(10, Math.min(30, Math.round(settings.widgetPoolCapacity)))
    }
  } catch {}
  return DEFAULT_POOL_CAPACITY
}

function ensureWidgetDir(subDir = ""): string {
  const dir = subDir ? pixivWidgetPath(subDir) : pixivWidgetPath()
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
  return dir
}

function poolFilePath(param = "default"): string {
  const safeParam = param.replace(/[^a-zA-Z0-9_-]/g, "_") || "default"
  return `${ensureWidgetDir()}/pool_${safeParam}.json`
}

function imagesDir(): string {
  return ensureWidgetDir(IMAGES_DIR_NAME)
}

function normalizeParameter(param?: string | null, family?: string): string {
  if (param && typeof param === "string") {
    const trimmed = param.trim()
    if (trimmed.startsWith("__family:")) {
      const extractedFamily = trimmed.replace("__family:", "").trim()
      return getWidgetSourceForFamily(extractedFamily)
    }

    const lower = trimmed.toLowerCase()
    if (lower && lower !== "default" && lower !== "默认") {
      if (lower.includes("follow") || lower.includes("关注") || lower.includes("追更") || lower.includes("动态")) {
        return "follow"
      }
      if (lower.includes("recommend") || lower.includes("推荐")) {
        return "recommend"
      }
      if (lower.includes("pixivision") || lower.includes("vision") || lower.includes("专辑") || lower.includes("特辑") || lower.includes("专栏")) {
        return "pixivision"
      }
      if (lower.includes("month") || lower.includes("月榜") || lower.includes("每月")) {
        return "ranking_month"
      }
      if (lower.includes("week") || lower.includes("周榜") || lower.includes("每周")) {
        return "ranking_week"
      }
      if (lower.includes("day") || lower.includes("日榜") || lower.includes("每日")) {
        return "ranking_day"
      }
    }
  }

  return getWidgetSourceForFamily(family)
}

// 严格过滤：R18/R18G 永远严禁进入小组件池子；AI 作品根据用户设置严格判定
function isSafeForWidget(item: PixivIllustration, showAI: boolean): boolean {
  if (!item) return false
  // 1. R18 / R18G 永不入池
  if (item.x_restrict !== 0) return false

  const tags = (item.tags ?? []).map((t) => (typeof t === "string" ? t : t.name).toLowerCase())
  const hasR18Tag = tags.some((t) =>
    t.includes("r-18") ||
    t.includes("r18") ||
    t.includes("r-18g") ||
    t.includes("r18g") ||
    t.includes("18+")
  )
  if (hasR18Tag) return false

  // 2. AI 作品判定
  if (!showAI) {
    if (item.illust_ai_type === 2) return false
    const hasAITag = tags.some((t) =>
      t.includes("ai生成") ||
      t.includes("aiイラスト") ||
      t.includes("novelai") ||
      t === "ai"
    )
    if (hasAITag) return false
  }

  // 3. 排除动态图 ugoira（桌面小组件不支持动态逐帧播放）
  if (item.type === "ugoira") return false

  return true
}

export function loadWidgetPool(param?: string, family?: string): WidgetPoolState {
  const normalized = normalizeParameter(param, family)
  const path = poolFilePath(normalized)
  recoverFile(path)
  if (FileManager.existsSync(path)) {
    try {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.artworks)) {
        const validArtworks = parsed.artworks.filter(
          (a: WidgetArtwork) =>
            a &&
            a.localImagePath &&
            FileManager.existsSync(a.localImagePath) &&
            (normalized !== "pixivision" || (a.route && a.route.startsWith("pixivision:")))
        )
        const parsedIndex = typeof parsed.currentIndex === "number" ? parsed.currentIndex : 0
        const currentArtId = typeof parsed.currentArtworkId === "number" ? parsed.currentArtworkId : undefined

        // 优先根据 currentArtworkId 寻找准确下标，防止下标错位
        let targetIndex = parsedIndex
        if (currentArtId !== undefined) {
          const foundIdx = validArtworks.findIndex((a: WidgetArtwork) => a.id === currentArtId)
          if (foundIdx >= 0) {
            targetIndex = foundIdx
          }
        }
        const safeIndex =
          validArtworks.length > 0 ? Math.max(0, Math.min(validArtworks.length - 1, targetIndex)) : 0

        return {
          revision: typeof parsed.revision === "number" ? parsed.revision : 0,
          currentIndex: safeIndex,
          currentArtworkId: validArtworks[safeIndex]?.id,
          artworks: validArtworks,
          lastFetchTime: typeof parsed.lastFetchTime === "number" ? parsed.lastFetchTime : 0,
          lastFetchStartedAt: typeof parsed.lastFetchStartedAt === "number" ? parsed.lastFetchStartedAt : 0,
          lastRotatedAt: typeof parsed.lastRotatedAt === "number" ? parsed.lastRotatedAt : 0,
          parameter: normalized,
          nextURL: typeof parsed.nextURL === "string" ? parsed.nextURL : null,
          updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
        }
      }
    } catch {
      // 容错回退
    }
  }
  return {
    revision: 0,
    currentIndex: 0,
    currentArtworkId: undefined,
    artworks: [],
    lastFetchTime: 0,
    lastFetchStartedAt: 0,
    lastRotatedAt: 0,
    parameter: normalized,
    nextURL: null,
    updatedAt: 0,
  }
}

/**
 * 跨进程智能合并小组件池数据
 * 权威原则：磁盘的游标与正在展示的插画永远最高优先，后台慢任务只负责纯追加新大图，绝不回退游标
 */
function mergeWidgetPools(base: WidgetPoolState, incoming: WidgetPoolState): WidgetPoolState {
  const mergedArtworksMap = new Map<number, WidgetArtwork>()

  // 1. 放入 base 的所有作品
  for (const art of base.artworks) {
    if (art && art.id) mergedArtworksMap.set(art.id, art)
  }

  // 2. 用 incoming 的作品覆盖或追加（保留最新的 localImagePath 与 bookmarked 变化）
  for (const art of incoming.artworks) {
    if (!art || !art.id) continue
    const existing = mergedArtworksMap.get(art.id)
    if (existing) {
      mergedArtworksMap.set(art.id, {
        ...existing,
        ...art,
        bookmarked: art.bookmarked !== undefined ? art.bookmarked : existing.bookmarked,
        updatedAt: Math.max(existing.updatedAt || 0, art.updatedAt || 0),
      })
    } else {
      mergedArtworksMap.set(art.id, art)
    }
  }

  const mergedArtworks = Array.from(mergedArtworksMap.values())

  // 3. 游标对齐：严格以 base（磁盘权威）的 currentArtworkId 或 currentIndex 为准
  let safeIndex = 0
  if (mergedArtworks.length > 0) {
    if (base.currentArtworkId) {
      const foundIdx = mergedArtworks.findIndex((a) => a.id === base.currentArtworkId)
      if (foundIdx >= 0) {
        safeIndex = foundIdx
      } else {
        safeIndex = Math.max(0, Math.min(mergedArtworks.length - 1, base.currentIndex))
      }
    } else {
      safeIndex = Math.max(0, Math.min(mergedArtworks.length - 1, base.currentIndex))
    }
  }

  return {
    revision: Math.max(base.revision || 0, incoming.revision || 0) + 1,
    currentIndex: safeIndex,
    currentArtworkId: mergedArtworks[safeIndex]?.id,
    artworks: mergedArtworks,
    lastFetchTime: Math.max(base.lastFetchTime || 0, incoming.lastFetchTime || 0),
    lastFetchStartedAt: Math.max(base.lastFetchStartedAt || 0, incoming.lastFetchStartedAt || 0),
    lastRotatedAt: Math.max(base.lastRotatedAt || 0, incoming.lastRotatedAt || 0),
    parameter: base.parameter || incoming.parameter,
    nextURL: incoming.nextURL !== undefined ? incoming.nextURL : base.nextURL,
    updatedAt: Date.now(),
  }
}

export function saveWidgetPool(state: WidgetPoolState, param?: string, family?: string): void {
  const normalized = normalizeParameter(param || state.parameter, family)
  const path = poolFilePath(normalized)

  // 保证 currentArtworkId 始终与当前 currentIndex 对齐
  if (state.artworks.length > 0 && state.currentIndex >= 0 && state.currentIndex < state.artworks.length) {
    state.currentArtworkId = state.artworks[state.currentIndex].id
  }

  let finalState: WidgetPoolState = state
  try {
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      const diskParsed = JSON.parse(raw)
      if (diskParsed && Array.isArray(diskParsed.artworks)) {
        const diskRevision = typeof diskParsed.revision === "number" ? diskParsed.revision : 0
        const memoryRevision = typeof state.revision === "number" ? state.revision : 0
        if (diskRevision > memoryRevision) {
          // 磁盘已被其他进程更新过，执行跨进程安全增量合并
          const validDiskArtworks = diskParsed.artworks.filter(
            (a: any) => a && a.localImagePath && FileManager.existsSync(a.localImagePath)
          )
          const diskIndex = typeof diskParsed.currentIndex === "number" ? diskParsed.currentIndex : 0
          const diskState: WidgetPoolState = {
            revision: diskRevision,
            currentIndex: diskIndex,
            currentArtworkId: typeof diskParsed.currentArtworkId === "number" ? diskParsed.currentArtworkId : validDiskArtworks[diskIndex]?.id,
            artworks: validDiskArtworks,
            lastFetchTime: typeof diskParsed.lastFetchTime === "number" ? diskParsed.lastFetchTime : 0,
            lastFetchStartedAt: typeof diskParsed.lastFetchStartedAt === "number" ? diskParsed.lastFetchStartedAt : 0,
            lastRotatedAt: typeof diskParsed.lastRotatedAt === "number" ? diskParsed.lastRotatedAt : 0,
            parameter: normalized,
            nextURL: typeof diskParsed.nextURL === "string" ? diskParsed.nextURL : null,
            updatedAt: typeof diskParsed.updatedAt === "number" ? diskParsed.updatedAt : 0,
          }
          finalState = mergeWidgetPools(diskState, state)
        }
      }
    }
  } catch {}

  finalState.revision = (finalState.revision || 0) + 1
  finalState.updatedAt = Date.now()

  // 同步回原引用对象
  state.revision = finalState.revision
  state.currentIndex = finalState.currentIndex
  state.currentArtworkId = finalState.currentArtworkId
  state.artworks = finalState.artworks
  state.nextURL = finalState.nextURL
  state.lastFetchTime = finalState.lastFetchTime
  state.lastFetchStartedAt = finalState.lastFetchStartedAt
  state.lastRotatedAt = finalState.lastRotatedAt
  state.updatedAt = finalState.updatedAt

  try {
    writeTextSafely(path, JSON.stringify(finalState, null, 2), (raw) => {
      const parsed = JSON.parse(raw)
      if (!parsed || !Array.isArray(parsed.artworks)) throw new Error("小组件池数据格式错误")
    })
  } catch (error: any) {
    console.log("saveWidgetPool error:", error?.message ?? error)
  }
}

async function fetchArtworksForSourceWithPage(
  param: string,
  nextURL?: string | null
): Promise<{ items: PixivIllustration[]; nextURL: string | null }> {
  const settings = loadSettings()
  const showAI = settings.showAI
  let token: string | null = null
  try {
    token = await session.getValidToken()
  } catch {
    token = null
  }

  let result: { items: PixivIllustration[]; nextURL: string | null } = {
    items: [],
    nextURL: null,
  }

  try {
    if (nextURL) {
      result = await nextIllustrations(nextURL, token ?? "")
    } else if (param === "follow" && token) {
      result = await followingFeed("all", token)
    } else if (param === "recommend" && token) {
      result = await recommendations("illustration", token)
    } else if (param === "ranking_month") {
      result = await ranking("month", null, token ?? "")
    } else if (param === "ranking_week") {
      result = await ranking("week", null, token ?? "")
    } else {
      result = await ranking("day", null, token ?? "")
    }
  } catch (error: any) {
    console.log("fetchArtworksForSource error:", error?.message ?? error)
  }

  // 严格安全与类型过滤
  const filtered = result.items.filter((item) => isSafeForWidget(item, showAI))
  return { items: filtered, nextURL: result.nextURL }
}

async function fetchPixivisionWithPage(
  nextURL?: string | null
): Promise<{ items: PixivisionArticle[]; nextURL: string | null }> {
  try {
    if (nextURL) {
      return await nextPixivision(nextURL)
    }
    return await pixivisionHome()
  } catch (error: any) {
    console.log("fetchPixivisionWithPage error:", error?.message ?? error)
    return { items: [], nextURL: null }
  }
}

function syncToAppImageCache(url: string, sourcePath: string): void {
  if (!url || !sourcePath || !FileManager.existsSync(sourcePath)) return
  try {
    const appCachePath = cacheFilePath(url)
    if (!FileManager.existsSync(appCachePath)) {
      FileManager.copyFileSync(sourcePath, appCachePath)
    }
  } catch {}
}

async function downloadDirectImage(url: string, prefix: string, id: number): Promise<string | null> {
  if (!url) return null

  const targetDir = imagesDir()
  const fileName = `${prefix}_${id}.jpg`
  const destPath = `${targetDir}/${fileName}`

  // 若已存在且大小正常，直接复用并同步到主 App 缓存
  if (FileManager.existsSync(destPath)) {
    try {
      const stat = FileManager.statSync(destPath)
      if (stat && stat.size > 0) {
        syncToAppImageCache(url, destPath)
        return destPath
      }
    } catch {}
  }

  const data = await downloadBinary(url)
  if (data) {
    try {
      writeDataSafely(destPath, data)
      syncToAppImageCache(url, destPath)
      return destPath
    } catch {
      return null
    }
  }
  return null
}

async function downloadArtworkImage(item: PixivIllustration): Promise<string | null> {
  // 坚守 large 高清原图品质
  const url = item.image_urls.large || item.image_urls.medium || item.image_urls.square_medium
  if (!url) return null
  return downloadDirectImage(url, "widget", item.id)
}

function cleanupOrphanImages(): void {
  try {
    const dir = imagesDir()
    if (!FileManager.existsSync(dir)) return
    const allEntries = FileManager.readDirectorySync(dir)
    if (!allEntries || allEntries.length === 0) return

    const poolDir = pixivWidgetPath()
    const activePaths = new Set<string>()
    const poolFiles = FileManager.readDirectorySync(poolDir).filter(
      (f) => f.startsWith("pool_") && f.endsWith(".json")
    )
    for (const pf of poolFiles) {
      try {
        const raw = FileManager.readAsStringSync(`${poolDir}/${pf}`)
        const data = JSON.parse(raw) as WidgetPoolState
        if (Array.isArray(data?.artworks)) {
          for (const item of data.artworks) {
            if (item?.localImagePath) {
              activePaths.add(item.localImagePath)
            }
          }
        }
      } catch {}
    }

    for (const fileName of allEntries) {
      const fullPath = `${dir}/${fileName}`
      if (!activePaths.has(fullPath)) {
        try {
          FileManager.removeSync(fullPath)
        } catch {}
      }
    }
  } catch {}
}

const activePopulateTasks = new Map<string, Promise<WidgetPoolState>>()
const firstReadyEmitters = new Map<string, Set<(art: WidgetArtwork) => void>>()

function emitFirstReady(key: string, art: WidgetArtwork): void {
  const set = firstReadyEmitters.get(key)
  if (set) {
    for (const fn of set) {
      try {
        fn(art)
      } catch {}
    }
  }
}

function waitForFirstArtwork(key: string, timeoutMs = 8000): Promise<WidgetArtwork | null> {
  return new Promise((resolve) => {
    let timer: number | null = null
    const handler = (art: WidgetArtwork) => {
      if (timer != null) clearTimeout(timer)
      cleanup()
      resolve(art)
    }
    const cleanup = () => {
      const set = firstReadyEmitters.get(key)
      if (set) {
        set.delete(handler)
        if (set.size === 0) firstReadyEmitters.delete(key)
      }
    }

    let set = firstReadyEmitters.get(key)
    if (!set) {
      set = new Set()
      firstReadyEmitters.set(key, set)
    }
    set.add(handler)

    timer = setTimeout(() => {
      cleanup()
      resolve(null)
    }, timeoutMs)
  })
}

export async function populateWidgetPool(
  param?: string,
  family?: string,
  options?: { forceNextPage?: boolean }
): Promise<WidgetPoolState> {
  const normalized = normalizeParameter(param, family)
  const taskKey = `${normalized}_${options?.forceNextPage ? "next" : "normal"}`
  if (activePopulateTasks.has(taskKey)) {
    return activePopulateTasks.get(taskKey)!
  }

  const task = (async () => {
    try {
      const pool = loadWidgetPool(normalized, family)
      const maxCapacity = getPoolCapacity()
      const isPoolFull = pool.artworks.length >= maxCapacity
      const isStale = Date.now() - (pool.lastFetchTime || 0) > POOL_STALE_TTL_MS

      // 如果池子已满且未请求拉取下一页、未过期且剩余未看充裕，直接返回
      if (
        isPoolFull &&
        !options?.forceNextPage &&
        !isStale &&
        pool.artworks.length - pool.currentIndex >= MIN_PREFETCH_COUNT
      ) {
        return pool
      }

      // 标记本次拉取开始时间并存盘加锁
      pool.lastFetchStartedAt = Date.now()
      saveWidgetPool(pool, normalized, family)

      // 确定拉取的 nextURL 与是否需要循环洗牌
      const isCycleReset = !pool.nextURL && (Boolean(options?.forceNextPage) || isStale || pool.currentIndex + 1 >= pool.artworks.length)
      let requestNextURL: string | null = null
      if (!isCycleReset && options?.forceNextPage) {
        requestNextURL = pool.nextURL || null
      } else if (!isCycleReset && !isStale) {
        requestNextURL = pool.nextURL || null
      }

      // 当进行循环洗牌时，仅保护当前正在展示的插画 ID，其余旧图 ID 不参与拦截，确保新图顺利入池
      const currentArtId = pool.currentArtworkId || pool.artworks[pool.currentIndex]?.id
      const existingIds = new Set(
        isCycleReset
          ? (currentArtId ? [currentArtId] : [])
          : pool.artworks.map((a) => a.id)
      )
      const newArtworks: WidgetArtwork[] = isCycleReset
        ? (currentArtId ? pool.artworks.filter((a) => a.id === currentArtId) : [])
        : [...pool.artworks]
      let firstSaved = newArtworks.length > 0
      let latestNextURL = pool.nextURL || null

      if (normalized === "pixivision") {
        const res = await fetchPixivisionWithPage(requestNextURL)
        latestNextURL = res.nextURL
        const candidateArticles = res.items.filter((article) => !existingIds.has(article.id) && article.imageURL)

        // 3 路受限并发管道下载大图
        let candidateIdx = 0
        async function pixivisionWorker() {
          while (candidateIdx < candidateArticles.length) {
            const article = candidateArticles[candidateIdx++]
            const localPath = await downloadDirectImage(
              article.imageURL,
              "widget_pixivision",
              article.id
            )
            if (localPath) {
              const art: WidgetArtwork = {
                id: article.id,
                title: article.title,
                userId: 0,
                userName: "pixivision",
                localImagePath: localPath,
                remoteImageUrl: article.imageURL,
                width: 1200,
                height: 630,
                aspectRatio: 1200 / 630,
                sourceType: "pixivision",
                route: `pixivision:${article.id}`,
                updatedAt: Date.now(),
                bookmarked: isPixivisionBookmarked(article.id),
              }
              newArtworks.push(art)
              existingIds.add(article.id)

              // 流式增量落盘：每下载完成 1 张大图立即更新写盘
              pool.artworks = [...newArtworks]
              pool.lastFetchTime = Date.now()
              saveWidgetPool(pool, normalized, family)

              if (!firstSaved) {
                firstSaved = true
                emitFirstReady(normalized, art)
              }
            }
          }
        }

        const workers = Array.from(
          { length: Math.min(DOWNLOAD_CONCURRENCY, candidateArticles.length) },
          () => pixivisionWorker()
        )
        await Promise.all(workers)
      } else {
        const res = await fetchArtworksForSourceWithPage(normalized, requestNextURL)
        latestNextURL = res.nextURL
        const candidateItems = res.items.filter((item) => !existingIds.has(item.id))

        // 3 路受限并发管道下载高清大图
        let candidateIdx = 0
        async function illustWorker() {
          while (candidateIdx < candidateItems.length) {
            const item = candidateItems[candidateIdx++]
            const localPath = await downloadArtworkImage(item)
            if (localPath) {
              const width = item.width || 1200
              const height = item.height || 1200
              const remoteUrl =
                item.image_urls.large ||
                item.image_urls.medium ||
                item.image_urls.square_medium ||
                ""
              const art: WidgetArtwork = {
                id: item.id,
                title: item.title,
                userId: item.user.id,
                userName: item.user.name,
                localImagePath: localPath,
                remoteImageUrl: remoteUrl,
                width,
                height,
                aspectRatio: width > 0 && height > 0 ? width / height : 1,
                sourceType: normalized,
                route: `illust:${item.id}`,
                updatedAt: Date.now(),
                bookmarked: Boolean(item.is_bookmarked),
              }
              newArtworks.push(art)
              existingIds.add(item.id)

              // 流式增量落盘：每下载完成 1 张大图立即更新写盘
              pool.artworks = [...newArtworks]
              pool.lastFetchTime = Date.now()
              saveWidgetPool(pool, normalized, family)

              if (!firstSaved) {
                firstSaved = true
                emitFirstReady(normalized, art)
              }
            }
          }
        }

        const workers = Array.from(
          { length: Math.min(DOWNLOAD_CONCURRENCY, candidateItems.length) },
          () => illustWorker()
        )
        await Promise.all(workers)
      }

      // 安全容量修剪：超过最大容量时淘汰已看过的旧图，受保护作品（当前正在展示的）永不剔除
      if (newArtworks.length > maxCapacity) {
        const protectArtId = pool.currentArtworkId || pool.artworks[pool.currentIndex]?.id
        const overflow = newArtworks.length - maxCapacity

        let dropped = 0
        const trimmedArtworks: WidgetArtwork[] = []
        for (let i = 0; i < newArtworks.length; i++) {
          const art = newArtworks[i]
          if (dropped < overflow && i < pool.currentIndex && art.id !== protectArtId) {
            dropped++
            continue
          }
          trimmedArtworks.push(art)
        }

        if (dropped < overflow) {
          const secondPass: WidgetArtwork[] = []
          for (let i = 0; i < trimmedArtworks.length; i++) {
            const art = trimmedArtworks[i]
            if (dropped < overflow && art.id !== protectArtId) {
              dropped++
              continue
            }
            secondPass.push(art)
          }
          pool.artworks = secondPass
        } else {
          pool.artworks = trimmedArtworks
        }

        if (protectArtId) {
          const reanchoredIdx = pool.artworks.findIndex((a) => a.id === protectArtId)
          if (reanchoredIdx >= 0) {
            pool.currentIndex = reanchoredIdx
          } else {
            pool.currentIndex = Math.max(0, Math.min(pool.artworks.length - 1, pool.currentIndex - dropped))
          }
        } else {
          pool.currentIndex = Math.max(0, Math.min(pool.artworks.length - 1, pool.currentIndex - dropped))
        }
      } else {
        pool.artworks = newArtworks
      }

      pool.nextURL = latestNextURL
      pool.lastFetchTime = Date.now()
      saveWidgetPool(pool, normalized, family)

      // 异步清理不再被任何池子引用的旧本地大图
      cleanupOrphanImages()

      return pool
    } finally {
      activePopulateTasks.delete(taskKey)
    }
  })()

  activePopulateTasks.set(taskKey, task)
  return task
}

export async function getCurrentWidgetArtwork(param?: string, family?: string): Promise<WidgetArtwork | null> {
  const normalized = normalizeParameter(param, family)
  let pool = loadWidgetPool(normalized, family)

  // 若当前池子为空或已有图片被系统清理，则触发异步拉取，并等待首批大图就绪
  if (pool.artworks.length === 0) {
    const firstPromise = waitForFirstArtwork(normalized, 8000)
    void populateWidgetPool(normalized, family)
    const firstArt = await firstPromise
    if (firstArt) {
      return firstArt
    }
    pool = loadWidgetPool(normalized, family)
  }

  if (pool.artworks.length === 0) {
    return null
  }

  // 保证 currentIndex 在合法范围内
  if (pool.currentIndex >= pool.artworks.length || pool.currentIndex < 0) {
    pool.currentIndex = 0
    pool.currentArtworkId = pool.artworks[0]?.id
    saveWidgetPool(pool, normalized, family)
  }

  // 时间驱动的自动轮播机制：检测是否超过设置的轮播间隔
  const intervalMinutes = loadSettings().widgetReloadIntervalMinutes ?? 60
  const intervalMs = intervalMinutes * 60 * 1000
  const now = Date.now()
  const lastRotated = pool.lastRotatedAt || 0
  const lastIntentAt = getLastGlobalWidgetIntent()
  const isDuringBroadcastGrace = now - lastIntentAt < BROADCAST_GRACE_PERIOD_MS
  const isCoolingDown = now - lastRotated < ADVANCE_COOLDOWN_MS

  if (lastRotated === 0) {
    // 首次初始化时间锚点
    pool.lastRotatedAt = now
    saveWidgetPool(pool, normalized, family)
  } else if (
    now - lastRotated >= intervalMs &&
    !isDuringBroadcastGrace &&
    !isCoolingDown &&
    pool.artworks.length > 1
  ) {
    // 达到自动轮播间隔，且非广播殃及唤醒、非冷却期，自动推进下一张
    pool.currentIndex = (pool.currentIndex + 1) % pool.artworks.length
    pool.currentArtworkId = pool.artworks[pool.currentIndex]?.id
    pool.lastRotatedAt = now
    saveWidgetPool(pool, normalized, family)
  }

  const current = pool.artworks[pool.currentIndex]

  // 若当前图片不存在，自动前移到下一个有效图片
  if (!current || !FileManager.existsSync(current.localImagePath)) {
    return advanceWidgetArtwork(normalized, family)
  }

  // 若数据已过期（4小时），或剩余未看数量较少，后台静默补充
  const isStale = Date.now() - (pool.lastFetchTime || 0) > POOL_STALE_TTL_MS
  if (isStale || pool.artworks.length - pool.currentIndex < MIN_PREFETCH_COUNT) {
    populateWidgetPool(normalized, family).catch(() => {})
  }

  return current
}

export async function advanceWidgetArtwork(param?: string, family?: string): Promise<WidgetArtwork | null> {
  // 记录手动交互全局时间戳，向其他可能被广播唤醒的小组件提供保护期
  recordGlobalWidgetIntent()

  const normalized = normalizeParameter(param, family)
  let pool = loadWidgetPool(normalized, family)

  if (pool.artworks.length === 0) {
    pool = await populateWidgetPool(normalized, family)
    if (pool.artworks.length === 0) return null
  }

  // 1. 边界检查：在推进指针前先判定是否到达池底或接近池底
  const currentIndex = pool.currentIndex
  const isAtEnd = currentIndex + 1 >= pool.artworks.length
  const isLow = pool.artworks.length - currentIndex <= MIN_PREFETCH_COUNT

  if (isAtEnd) {
    // 池底见底：必须请求新内容！启动强制翻页并等待下一页首图就绪（限时 3 秒，避免用户看到旧图循环）
    const waitNextPromise = waitForFirstArtwork(normalized, 3000)
    const populatePromise = populateWidgetPool(normalized, family, { forceNextPage: true })

    const nextArt = await waitNextPromise
    if (!nextArt) {
      await populatePromise.catch(() => {})
    }
    pool = loadWidgetPool(normalized, family)
  } else if (isLow) {
    // 剩余未看插画较少时（提前 15 张），纯后台非阻塞启动下一页拉取
    populateWidgetPool(normalized, family, { forceNextPage: true }).catch(() => {})
  }

  // 2. 推进指针到下一张并存盘
  if (pool.artworks.length > 0) {
    pool.currentIndex = (pool.currentIndex + 1) % pool.artworks.length
    pool.currentArtworkId = pool.artworks[pool.currentIndex]?.id
    pool.lastRotatedAt = Date.now()
    saveWidgetPool(pool, normalized, family)
  }

  const current = pool.artworks[pool.currentIndex]
  if (current && FileManager.existsSync(current.localImagePath)) {
    return current
  }

  // 若该项失效，寻找下一个有效项
  const validIndex = pool.artworks.findIndex(
    (a) => a && a.localImagePath && FileManager.existsSync(a.localImagePath)
  )
  if (validIndex >= 0) {
    pool.currentIndex = validIndex
    pool.currentArtworkId = pool.artworks[validIndex]?.id
    saveWidgetPool(pool, normalized, family)
    return pool.artworks[validIndex]
  }

  return null
}

/**
 * 立即刷新所有活跃的桌面小组件（方案A：即时切图推进 + 广播更新）：
 * 1. 扫描当前设置中各尺寸启用的数据源以及沙盒中所有已有池子；
 * 2. 对每个池子并发调用 advanceWidgetArtwork 推进到下一张有效图片，更新轮播时间戳；
 * 3. 广播通知 WidgetKit 重新渲染所有桌面小组件。
 */
export async function refreshAllWidgets(): Promise<void> {
  const settings = loadSettings()
  const sources = new Set<string>()

  if (Device.isiPad) {
    if (settings.widgetSourceSmallIpad) sources.add(settings.widgetSourceSmallIpad)
    if (settings.widgetSourceMediumIpad) sources.add(settings.widgetSourceMediumIpad)
    if (settings.widgetSourceLargeIpad) sources.add(settings.widgetSourceLargeIpad)
    if (settings.widgetSourceExtraLargeIpad) sources.add(settings.widgetSourceExtraLargeIpad)
  } else {
    if (settings.widgetSourceSmallIos) sources.add(settings.widgetSourceSmallIos)
    if (settings.widgetSourceMediumIos) sources.add(settings.widgetSourceMediumIos)
    if (settings.widgetSourceLargeIos) sources.add(settings.widgetSourceLargeIos)
  }

  const dir = pixivWidgetPath()
  if (FileManager.existsSync(dir)) {
    try {
      const files = FileManager.readDirectorySync(dir)
      for (const file of files) {
        if (file.startsWith("pool_") && file.endsWith(".json")) {
          const sourceName = file.replace(/^pool_/, "").replace(/\.json$/, "")
          if (sourceName && sourceName !== "default") {
            sources.add(sourceName)
          }
        }
      }
    } catch {}
  }

  if (sources.size === 0) {
    sources.add("ranking_day")
  }

  await Promise.all(
    Array.from(sources).map(async (src) => {
      try {
        await advanceWidgetArtwork(src)
      } catch (e: any) {
        console.log("refreshAllWidgets advance error for", src, e?.message ?? e)
      }
    })
  )

  try {
    Widget.reloadAll()
  } catch {}
}

/**
 * 在所有小组件池子中查找指定 ID 的插画信息
 */
export function findArtworkInAllPools(id: number): WidgetArtwork | null {
  if (!id || typeof id !== "number") return null
  const dir = pixivWidgetPath()
  if (!FileManager.existsSync(dir)) return null
  try {
    const entries = FileManager.readDirectorySync(dir)
    for (const name of entries) {
      if (name.startsWith("pool_") && name.endsWith(".json")) {
        const fullPath = `${dir}/${name}`
        const content = FileManager.readAsStringSync(fullPath)
        if (content) {
          const parsed = JSON.parse(content) as WidgetPoolState
          if (Array.isArray(parsed?.artworks)) {
            const found = parsed.artworks.find((item) => item && item.id === id)
            if (found) return found
          }
        }
      }
    }
  } catch {}
  return null
}

/**
 * 从小组件池子预热专辑/特辑封面图到主 App 图片缓存，确保点击专辑小组件秒开
 */
export function seedPixivisionFromWidgetPool(id: number): void {
  if (!id || typeof id !== "number") return
  const found = findArtworkInAllPools(id)
  if (!found) return

  const remoteUrl = found.remoteImageUrl || ""
  if (remoteUrl) {
    recordPixivisionCoverUrl(id, remoteUrl)
  }
  if (remoteUrl && found.localImagePath && FileManager.existsSync(found.localImagePath)) {
    try {
      const appCachePath = cacheFilePath(remoteUrl)
      if (!FileManager.existsSync(appCachePath)) {
        FileManager.copyFileSync(found.localImagePath, appCachePath)
      }
    } catch {}
  }
}

/**
 * 从小组件池子预热数据到插画内存缓存，确保从小组件冷启动点进详情页时秒开、不闪白、沉浸式背景立即可用
 */
export function seedIllustFromWidgetPool(id: number): void {
  if (!id || typeof id !== "number") return
  if (getCachedIllust(id)) return
  const found = findArtworkInAllPools(id)
  if (!found) return

  const remoteUrl = found.remoteImageUrl || ""
  if (remoteUrl && found.localImagePath && FileManager.existsSync(found.localImagePath)) {
    try {
      const appCachePath = cacheFilePath(remoteUrl)
      if (!FileManager.existsSync(appCachePath)) {
        FileManager.copyFileSync(found.localImagePath, appCachePath)
      }
    } catch {}
  }

  cacheIllust({
    id: found.id,
    title: found.title,
    type: "illust",
    image_urls: {
      square_medium: remoteUrl,
      medium: remoteUrl,
      large: remoteUrl,
    },
    caption: "",
    user: {
      id: found.userId,
      name: found.userName,
      account: "",
      profile_image_urls: {
        medium: "",
      },
      is_followed: false,
    },
    tags: [],
    create_date: new Date(found.updatedAt || Date.now()).toISOString(),
    page_count: 1,
    width: found.width,
    height: found.height,
    x_restrict: 0,
    series: null,
    meta_single_page: {
      original_image_url: remoteUrl,
    },
    meta_pages: [],
    total_view: 0,
    total_bookmarks: 0,
    is_bookmarked: false,
    is_muted: false,
    total_comments: 0,
    illust_ai_type: 1,
    comment_access_control: 0,
  })
}

/**
 * 判断小组件当前展示的作品/特辑是否已被收藏
 */
export function isWidgetArtworkBookmarked(artwork: WidgetArtwork | null): boolean {
  if (!artwork || !artwork.id) return false
  if (artwork.sourceType === "pixivision") {
    return isPixivisionBookmarked(artwork.id)
  }
  const cached = getCachedIllustBookmark(artwork.id)
  if (cached !== undefined) return cached
  return Boolean(artwork.bookmarked)
}

/**
 * 原地切换小组件中当前作品/特辑的收藏状态并静默持久化与同步
 */
export async function toggleWidgetArtworkBookmark(
  param?: string,
  artworkId?: number,
  family?: string
): Promise<boolean> {
  // 记录手动交互全局时间戳，避免收藏后广播 reloadAll 误触发自动轮播
  recordGlobalWidgetIntent()

  const normalized = normalizeParameter(param, family)
  const pool = loadWidgetPool(normalized, family)
  let target = artworkId
    ? pool.artworks.find((a) => a.id === artworkId)
    : pool.artworks[pool.currentIndex]

  if (!target && pool.artworks.length > 0) {
    target = pool.artworks[0]
  }
  if (!target || !target.id) return false

  const isPixivision = target.sourceType === "pixivision"
  if (isPixivision) {
    const nextBookmarked = togglePixivisionBookmark({
      id: target.id,
      title: target.title,
      thumbnailURL: target.remoteImageUrl,
      category: "特辑",
      publishedAt: new Date().toISOString().slice(0, 10),
      bookmarkedAt: Date.now(),
    })
    target.bookmarked = nextBookmarked
    saveWidgetPool(pool, normalized, family)
    return nextBookmarked
  } else {
    const currentlyBookmarked = isWidgetArtworkBookmarked(target)
    const nextBookmarked = !currentlyBookmarked
    target.bookmarked = nextBookmarked
    recordIllustBookmark(target.id, nextBookmarked)
    notifyIllustBookmarkChanged(target.id, nextBookmarked, "public")
    saveWidgetPool(pool, normalized, family)

    try {
      if (nextBookmarked) {
        await session.call((token) => addBookmark(target.id, "public", [], token))
      } else {
        await session.call((token) => removeBookmark(target.id, token))
      }
      return nextBookmarked
    } catch (e: any) {
      console.log("toggleWidgetArtworkBookmark API error, rolling back state:", e?.message ?? e)
      // 远端失败时严格回滚内存、缓存与小组件池状态并重新通知
      target.bookmarked = currentlyBookmarked
      recordIllustBookmark(target.id, currentlyBookmarked)
      notifyIllustBookmarkChanged(target.id, currentlyBookmarked, "public")
      saveWidgetPool(pool, normalized, family)
      return currentlyBookmarked
    }
  }
}
