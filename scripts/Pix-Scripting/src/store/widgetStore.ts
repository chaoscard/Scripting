import { downloadBinary } from "../api/client"
import { session } from "../api/session"
import { ranking, recommendations, followingFeed, pixivisionHome, pixivisionDetail } from "../api/pixiv"
import { getWidgetSourceForFamily, loadSettings } from "./settings"
import { pixivWidgetPath } from "./dataDirectory"
import { writeDataSafely, writeTextSafely, recoverFile } from "./safeFile"
import { cacheIllust, getCachedIllust } from "./illustCache"
import { cacheFilePath } from "../image/imageLoader"
import type { PixivIllustration } from "../types"

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
  updatedAt: number
}

export interface WidgetPoolState {
  currentIndex: number
  artworks: WidgetArtwork[]
  lastFetchTime: number
  parameter: string
}

const IMAGES_DIR_NAME = "images"
const DEFAULT_POOL_CAPACITY = 20
const MIN_PREFETCH_COUNT = 5

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
            (a: WidgetArtwork) => a && a.localImagePath && FileManager.existsSync(a.localImagePath)
          ),
          lastFetchTime: typeof parsed.lastFetchTime === "number" ? parsed.lastFetchTime : 0,
          parameter: normalized,
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

async function fetchArtworksForSource(param: string): Promise<PixivIllustration[]> {
  const settings = loadSettings()
  const showAI = settings.showAI
  let items: PixivIllustration[] = []

  let token: string | null = null
  try {
    token = await session.getValidToken()
  } catch {
    token = null
  }

  try {
    if (param === "follow" && token) {
      // 关注画师最新作品
      const res = await followingFeed("all", token)
      items = res.items
    } else if (param === "discovery" && token) {
      // 首页推荐作品
      const res = await recommendations("illustration", token)
      items = res.items
    } else if (param === "pixivision") {
      // pixivision 专栏特辑
      const homePage = await pixivisionHome()
      const articles = homePage.items || []
      const collected: PixivIllustration[] = []
      for (const article of articles.slice(0, 3)) {
        try {
          const detail = await pixivisionDetail(article.id)
          if (detail?.artworks) {
            for (const aw of detail.artworks) {
              collected.push({
                id: aw.id,
                title: aw.title || article.title,
                type: "illust",
                image_urls: {
                  large: aw.imageURL,
                  medium: aw.imageURL,
                  square_medium: aw.imageURL,
                },
                caption: "",
                user: {
                  id: 0,
                  name: "pixivision",
                  account: "pixivision",
                },
                width: 1200,
                height: 800,
                page_count: 1,
                x_restrict: 0,
                total_view: 0,
                total_bookmarks: 0,
                is_bookmarked: false,
                is_muted: false,
                total_comments: 0,
                comment_access_control: 0,
                illust_ai_type: 1,
                tags: [],
                create_date: article.date,
                meta_pages: [],
              })
            }
          }
        } catch {
        }
      }
      items = collected
    } else if (param === "ranking_month") {
      const res = await ranking("month", null, token ?? "")
      items = res.items
    } else if (param === "ranking_week") {
      const res = await ranking("week", null, token ?? "")
      items = res.items
    } else if (param === "discovery" && token) {
      const res = await recommendations("illustration", token)
      items = res.items
    } else {
      // 默认插画日榜 (ranking_day)
      const res = await ranking("day", null, token ?? "")
      items = res.items
    }
  } catch (error: any) {
    console.log("fetchArtworksForSource error:", error?.message ?? error)
  }

  // 严格安全与类型过滤
  return items.filter((item) => isSafeForWidget(item, showAI))
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

async function downloadArtworkImage(item: PixivIllustration): Promise<string | null> {
  const url = item.image_urls.large || item.image_urls.medium || item.image_urls.square_medium
  if (!url) return null

  const targetDir = imagesDir()
  const fileName = `widget_${item.id}.jpg`
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

export async function populateWidgetPool(param?: string, family?: string): Promise<WidgetPoolState> {
  const normalized = normalizeParameter(param, family)
  const taskKey = normalized
  if (activePopulateTasks.has(taskKey)) {
    return activePopulateTasks.get(taskKey)!
  }

  const task = (async () => {
    try {
      const pool = loadWidgetPool(normalized, family)
      const candidateItems = await fetchArtworksForSource(normalized)
      if (candidateItems.length === 0) {
        return pool
      }

      const existingIds = new Set(pool.artworks.map((a) => a.id))
      const newArtworks: WidgetArtwork[] = [...pool.artworks]
      const maxCapacity = getPoolCapacity()
      let firstSaved = pool.artworks.length > 0

      for (const item of candidateItems) {
        if (newArtworks.length >= maxCapacity) break
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
            updatedAt: Date.now(),
          }
          newArtworks.push(art)
          existingIds.add(item.id)

          // 核心优化：若池子原本为空，下载好第 1 张图后立即保存一次，让首图即刻上屏
          if (!firstSaved) {
            firstSaved = true
            pool.artworks = [...newArtworks]
            pool.lastFetchTime = Date.now()
            saveWidgetPool(pool, normalized, family)
            emitFirstReady(taskKey, art)
          }
        }
      }

      pool.artworks = newArtworks
      pool.lastFetchTime = Date.now()
      saveWidgetPool(pool, normalized, family)
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

  // 若剩余未看的插画数量较少，触发异步补齐
  if (pool.artworks.length - pool.currentIndex < MIN_PREFETCH_COUNT) {
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

  pool.currentIndex = (pool.currentIndex + 1) % pool.artworks.length
  saveWidgetPool(pool, normalized, family)

  // 异步补齐
  if (pool.artworks.length - pool.currentIndex < MIN_PREFETCH_COUNT) {
    populateWidgetPool(normalized, family).catch(() => {})
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
    saveWidgetPool(pool, normalized)
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

