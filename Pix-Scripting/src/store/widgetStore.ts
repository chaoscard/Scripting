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
  currentIndex: number
  artworks: WidgetArtwork[]
  lastFetchTime: number
  parameter: string
  nextURL?: string | null
}

const IMAGES_DIR_NAME = "images"
const DEFAULT_POOL_CAPACITY = 30
const MIN_PREFETCH_COUNT = 5
const POOL_STALE_TTL_MS = 4 * 60 * 60 * 1000 // 4小时数据过期自愈，重新拉取最新数据

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
      if (lower.includes("discovery") || lower.includes("recommend") || lower.includes("推荐") || lower.includes("探索")) {
        return "discovery"
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
        return {
          currentIndex: typeof parsed.currentIndex === "number" ? parsed.currentIndex : 0,
          artworks: parsed.artworks.filter(
            (a: WidgetArtwork) =>
              a &&
              a.localImagePath &&
              FileManager.existsSync(a.localImagePath) &&
              (normalized !== "pixivision" || (a.route && a.route.startsWith("pixivision:")))
          ),
          lastFetchTime: typeof parsed.lastFetchTime === "number" ? parsed.lastFetchTime : 0,
          parameter: normalized,
          nextURL: typeof parsed.nextURL === "string" ? parsed.nextURL : null,
        }
      }
    } catch {
      // 容错回退
    }
  }
  return {
    currentIndex: 0,
    artworks: [],
    lastFetchTime: 0,
    parameter: normalized,
    nextURL: null,
  }
}

export function saveWidgetPool(state: WidgetPoolState, param?: string, family?: string): void {
  const normalized = normalizeParameter(param || state.parameter, family)
  const path = poolFilePath(normalized)
  try {
    writeTextSafely(path, JSON.stringify(state, null, 2), (raw) => {
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
    } else if (param === "discovery" && token) {
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

      // 确定拉取的 nextURL：如果需要下一页则用 pool.nextURL；如果过期且未要求下一页则重头拉取
      let requestNextURL: string | null = null
      if (options?.forceNextPage) {
        requestNextURL = pool.nextURL || null
      } else if (!isStale) {
        requestNextURL = pool.nextURL || null
      }

      const existingIds = new Set(pool.artworks.map((a) => a.id))
      const newArtworks: WidgetArtwork[] = [...pool.artworks]
      let firstSaved = pool.artworks.length > 0
      let latestNextURL = pool.nextURL || null

      if (normalized === "pixivision") {
        const res = await fetchPixivisionWithPage(requestNextURL)
        latestNextURL = res.nextURL
        for (const article of res.items) {
          if (existingIds.has(article.id)) continue
          if (!article.imageURL) continue

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

            if (!firstSaved) {
              firstSaved = true
              pool.artworks = [...newArtworks]
              pool.lastFetchTime = Date.now()
              saveWidgetPool(pool, normalized, family)
              emitFirstReady(normalized, art)
            }
          }
        }
      } else {
        const res = await fetchArtworksForSourceWithPage(normalized, requestNextURL)
        latestNextURL = res.nextURL
        for (const item of res.items) {
          if (existingIds.has(item.id)) continue

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

            if (!firstSaved) {
              firstSaved = true
              pool.artworks = [...newArtworks]
              pool.lastFetchTime = Date.now()
              saveWidgetPool(pool, normalized, family)
              emitFirstReady(normalized, art)
            }
          }
        }
      }

      // 滑动窗口修剪：如果追加了新数据导致总数超过最大容量
      if (newArtworks.length > maxCapacity) {
        const overflow = newArtworks.length - maxCapacity
        // 优先淘汰头部已经看过的旧图片
        if (pool.currentIndex > 0) {
          const dropCount = Math.min(overflow, pool.currentIndex)
          newArtworks.splice(0, dropCount)
          pool.currentIndex = Math.max(0, pool.currentIndex - dropCount)
        }
        // 如果依然超出（比如一次性拉取了较多新图），截取最新的容量上限
        if (newArtworks.length > maxCapacity) {
          const extra = newArtworks.length - maxCapacity
          newArtworks.splice(0, extra)
          pool.currentIndex = Math.max(0, pool.currentIndex - extra)
        }
      }

      pool.artworks = newArtworks
      pool.nextURL = latestNextURL
      pool.lastFetchTime = Date.now()
      saveWidgetPool(pool, normalized, family)

      // 异步清理不再被任何池子引用的旧本地图片
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

  // 若当前池子为空或已有图片被系统清理，则触发异步拉取，并等待首图就绪
  if (pool.artworks.length === 0) {
    const firstPromise = waitForFirstArtwork(normalized)
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
  if (pool.currentIndex >= pool.artworks.length) {
    pool.currentIndex = 0
    saveWidgetPool(pool, normalized, family)
  }

  const current = pool.artworks[pool.currentIndex]

  // 若当前图片不存在，自动前移到下一个有效图片
  if (!current || !FileManager.existsSync(current.localImagePath)) {
    return advanceWidgetArtwork(normalized, family)
  }

  // 若数据已过期（4小时），或剩余未看数量较少，触发异步补齐新数据
  const isStale = Date.now() - (pool.lastFetchTime || 0) > POOL_STALE_TTL_MS
  if (isStale || pool.artworks.length - pool.currentIndex < MIN_PREFETCH_COUNT) {
    populateWidgetPool(normalized, family).catch(() => {})
  }

  return current
}

export async function advanceWidgetArtwork(param?: string, family?: string): Promise<WidgetArtwork | null> {
  const normalized = normalizeParameter(param, family)
  let pool = loadWidgetPool(normalized, family)

  if (pool.artworks.length === 0) {
    pool = await populateWidgetPool(normalized, family)
  }

  if (pool.artworks.length === 0) {
    return null
  }

  // 1. 如果已刷到最后一张（刷完了），或者池子快用尽，立即拉取下一页新数据
  const isAtEnd = pool.currentIndex + 1 >= pool.artworks.length
  if (isAtEnd) {
    pool = await populateWidgetPool(normalized, family, { forceNextPage: true })
  }

  // 2. 推进 currentIndex 指针
  if (pool.artworks.length > 0) {
    pool.currentIndex = (pool.currentIndex + 1) % pool.artworks.length
    saveWidgetPool(pool, normalized, family)
  }

  // 3. 异步预拉取：若剩余未看的插画数量较少，触发下一页预热
  if (pool.artworks.length - pool.currentIndex < MIN_PREFETCH_COUNT) {
    populateWidgetPool(normalized, family, { forceNextPage: true }).catch(() => {})
  }

  const current = pool.artworks[pool.currentIndex]
  if (current && FileManager.existsSync(current.localImagePath)) {
    return current
  }

  // 若该项失效，递归找下一个有效项
  const validIndex = pool.artworks.findIndex(
    (a) => a && a.localImagePath && FileManager.existsSync(a.localImagePath)
  )
  if (validIndex >= 0) {
    pool.currentIndex = validIndex
    saveWidgetPool(pool, normalized, family)
    return pool.artworks[validIndex]
  }

  return null
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
    } catch (e: any) {
      console.log("toggleWidgetArtworkBookmark API error:", e?.message ?? e)
    }
    return nextBookmarked
  }
}


