import { session } from "../api/session"
import {
  illustrationSeries,
  nextIllustrationSeries,
  nextNovelSeries,
  novelSeries,
} from "../api/pixiv"
import { pixivSeriesCacheDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import type {
  PixivIllustrationSeriesItem,
  PixivNovel,
} from "../types"

export interface SeriesNavItem {
  id: number
  title: string
  episodeNumber: number
}

export interface WorkSeriesRef {
  seriesID: number
  seriesTitle: string
  episodeNumber?: number
}

export interface SeriesNavData {
  seriesID: number
  kind: "manga" | "novel"
  title: string
  items: SeriesNavItem[] // 严格按第 1..N 话自然正序排列
  totalCount: number
  updatedAt?: number
}

const MAX_SERIES_CACHE = 200
const MAX_WORK_ASSOCIATIONS = 2000
const SERIES_CACHE_FILE_NAME = "series_cache.json"
const DEBOUNCE_DELAY_MS = 1500

const mangaSeriesNavCache = new Map<number, SeriesNavData>()
const novelSeriesNavCache = new Map<number, SeriesNavData>()
const workToSeriesCache = new Map<string, WorkSeriesRef>()
const inflightNavRequests = new Map<string, Promise<SeriesNavData | null>>()

let isLoaded = false
let isDirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

function workKey(workID: number, kind: "manga" | "novel"): string {
  return `${kind}:${workID}`
}

function seriesCacheFilePath(userId?: string | number | null): string {
  return `${pixivSeriesCacheDirectory(userId ?? session.userID)}/${SERIES_CACHE_FILE_NAME}`
}

function ensureLoadedSync(): void {
  if (isLoaded) return
  isLoaded = true
  const path = seriesCacheFilePath()
  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      if (raw && raw.trim().length > 0) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") {
          if (parsed.mangaSeries && typeof parsed.mangaSeries === "object") {
            for (const [k, v] of Object.entries(parsed.mangaSeries)) {
              const numId = Number(k)
              if (numId > 0 && v && typeof v === "object") {
                mangaSeriesNavCache.set(numId, v as SeriesNavData)
              }
            }
          }
          if (parsed.novelSeries && typeof parsed.novelSeries === "object") {
            for (const [k, v] of Object.entries(parsed.novelSeries)) {
              const numId = Number(k)
              if (numId > 0 && v && typeof v === "object") {
                novelSeriesNavCache.set(numId, v as SeriesNavData)
              }
            }
          }
          if (parsed.workToSeries && typeof parsed.workToSeries === "object") {
            for (const [k, v] of Object.entries(parsed.workToSeries)) {
              if (typeof k === "string" && v && typeof v === "object") {
                workToSeriesCache.set(k, v as WorkSeriesRef)
              }
            }
          }
        }
      }
    }
  } catch (e: any) {
    console.log("ensureLoadedSync seriesCache error:", e?.message ?? e)
  }
}

export function flushSeriesCache(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!isDirty) return
  isDirty = false
  try {
    const path = seriesCacheFilePath()
    const payload = {
      version: 1,
      updatedAt: Date.now(),
      mangaSeries: Object.fromEntries(mangaSeriesNavCache.entries()),
      novelSeries: Object.fromEntries(novelSeriesNavCache.entries()),
      workToSeries: Object.fromEntries(workToSeriesCache.entries()),
    }
    writeTextSafely(path, JSON.stringify(payload, null, 2))
  } catch (e: any) {
    console.log("flushSeriesCache error:", e?.message ?? e)
  }
}

function scheduleSave(): void {
  isDirty = true
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushSeriesCache()
  }, DEBOUNCE_DELAY_MS)
}

export function clearSeriesMemoryCache(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  isDirty = false
  isLoaded = false
  mangaSeriesNavCache.clear()
  novelSeriesNavCache.clear()
  workToSeriesCache.clear()
  inflightNavRequests.clear()
}

export async function prepareSeriesCacheStorage(userId?: string | number | null): Promise<void> {
  const path = seriesCacheFilePath(userId)
  const dir = path.substring(0, path.lastIndexOf("/"))
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
}

export function recordWorkSeriesAssociation(
  workID: number | null | undefined,
  kind: "manga" | "novel",
  seriesID: number | null | undefined,
  seriesTitle?: string | null,
  episodeNumber?: number | null
): void {
  if (!workID || !seriesID) return
  ensureLoadedSync()
  const key = workKey(workID, kind)
  const normalizedTitle = seriesTitle?.trim() || (kind === "novel" ? "小说系列" : "漫画系列")
  const normalizedEp = episodeNumber ?? undefined

  const existing = workToSeriesCache.get(key)
  if (
    existing &&
    existing.seriesID === seriesID &&
    existing.seriesTitle === normalizedTitle &&
    existing.episodeNumber === normalizedEp
  ) {
    return
  }

  if (workToSeriesCache.has(key)) {
    workToSeriesCache.delete(key)
  } else if (workToSeriesCache.size >= MAX_WORK_ASSOCIATIONS) {
    const firstKey = workToSeriesCache.keys().next().value
    if (firstKey !== undefined) {
      workToSeriesCache.delete(firstKey)
    }
  }
  workToSeriesCache.set(key, {
    seriesID,
    seriesTitle: normalizedTitle,
    episodeNumber: normalizedEp,
  })
  scheduleSave()
}

export function getSeriesByWorkID(
  workID: number | null | undefined,
  kind: "manga" | "novel"
): WorkSeriesRef | null {
  if (!workID) return null
  ensureLoadedSync()
  const key = workKey(workID, kind)
  const cached = workToSeriesCache.get(key)
  if (!cached) return null
  // Refresh LRU order
  workToSeriesCache.delete(key)
  workToSeriesCache.set(key, cached)
  return cached
}

export function getCachedSeriesNav(
  seriesID: number | null | undefined,
  kind: "manga" | "novel"
): SeriesNavData | null {
  if (!seriesID) return null
  ensureLoadedSync()
  const cache = kind === "novel" ? novelSeriesNavCache : mangaSeriesNavCache
  return cache.get(seriesID) ?? null
}

export function cacheSeriesNav(
  seriesID: number,
  kind: "manga" | "novel",
  title: string,
  items: { id: number; title: string; episodeNumber?: number }[]
): SeriesNavData {
  ensureLoadedSync()
  const cache = kind === "novel" ? novelSeriesNavCache : mangaSeriesNavCache
  if (cache.size >= MAX_SERIES_CACHE) {
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) {
      cache.delete(firstKey)
    }
  }

  const navItems: SeriesNavItem[] = items.map((it, idx) => {
    const epNum = it.episodeNumber ?? idx + 1
    const itemID = Number(it.id)
    const itemTitle = it.title || `第${idx + 1}话`
    const key = workKey(itemID, kind)
    workToSeriesCache.set(key, {
      seriesID,
      seriesTitle: title.trim() || (kind === "novel" ? "小说系列" : "漫画系列"),
      episodeNumber: epNum,
    })
    return {
      id: itemID,
      title: itemTitle,
      episodeNumber: epNum,
    }
  })

  const data: SeriesNavData = {
    seriesID,
    kind,
    title: title.trim() || (kind === "novel" ? "小说系列" : "漫画系列"),
    items: navItems,
    totalCount: navItems.length,
    updatedAt: Date.now(),
  }
  cache.set(seriesID, data)
  scheduleSave()
  return data
}

export async function fetchSeriesNav(
  seriesID: number,
  kind: "manga" | "novel",
  targetWorkID?: number | null
): Promise<SeriesNavData | null> {
  if (!seriesID) return null
  ensureLoadedSync()
  const cache = kind === "novel" ? novelSeriesNavCache : mangaSeriesNavCache
  const cached = cache.get(seriesID)
  // 若已缓存且命中 targetWorkID（或无需 targetWorkID），直接秒开返回
  if (cached) {
    if (!targetWorkID || cached.items.some((it) => it.id === targetWorkID)) {
      return cached
    }
  }

  const requestKey = `${kind}:${seriesID}:${targetWorkID ?? "all"}`
  const existing = inflightNavRequests.get(requestKey)
  if (existing) return existing

  const task = (async () => {
    try {
      if (kind === "manga") {
        // 请求第 1 页
        const result = await session.call((token) => illustrationSeries(seriesID, token))
        const allRawIllusts: PixivIllustrationSeriesItem[] = Array.isArray(result.illusts)
          ? [...result.illusts]
          : []
        let currentNextURL = result.next_url ?? null
        const visitedUrls = new Set<string>()

        // 检查第 1 页是否已经命中 targetWorkID
        let foundTarget = targetWorkID ? allRawIllusts.some((it) => it.id === targetWorkID) : false
        let pageCount = 1
        const MAX_PAGES = 5 // 限制安全翻页上限

        while (!foundTarget && currentNextURL && !visitedUrls.has(currentNextURL) && pageCount < MAX_PAGES) {
          visitedUrls.add(currentNextURL)
          pageCount++
          try {
            const nextResult = await session.call((token) => nextIllustrationSeries(currentNextURL!, token))
            if (Array.isArray(nextResult.illusts) && nextResult.illusts.length > 0) {
              allRawIllusts.push(...nextResult.illusts)
              currentNextURL = nextResult.next_url ?? null
              if (targetWorkID && nextResult.illusts.some((it) => it.id === targetWorkID)) {
                foundTarget = true
                break
              }
            } else {
              break
            }
          } catch {
            break
          }
        }

        // Pixiv 漫画系列 API 返回按最新降序，反转为 1..N 正序
        const rawAscending = [...allRawIllusts].reverse()
        const title = result.illust_series_detail?.title || "漫画系列"
        return cacheSeriesNav(
          seriesID,
          "manga",
          title,
          rawAscending.map((it, idx) => ({
            id: Number(it.id),
            title: it.title || `第${idx + 1}话`,
            episodeNumber: idx + 1,
          }))
        )
      } else {
        // 请求第 1 页
        const result = await session.call((token) => novelSeries(seriesID, token))
        const allRawNovels: PixivNovel[] = Array.isArray(result.novels)
          ? [...result.novels]
          : []
        let currentNextURL = result.next_url ?? null
        const visitedUrls = new Set<string>()

        let foundTarget = targetWorkID ? allRawNovels.some((it) => it.id === targetWorkID) : false
        let pageCount = 1
        const MAX_PAGES = 5

        while (!foundTarget && currentNextURL && !visitedUrls.has(currentNextURL) && pageCount < MAX_PAGES) {
          visitedUrls.add(currentNextURL)
          pageCount++
          try {
            const nextResult = await session.call((token) => nextNovelSeries(currentNextURL!, token))
            if (Array.isArray(nextResult.novels) && nextResult.novels.length > 0) {
              allRawNovels.push(...nextResult.novels)
              currentNextURL = nextResult.next_url ?? null
              if (targetWorkID && nextResult.novels.some((it) => it.id === targetWorkID)) {
                foundTarget = true
                break
              }
            } else {
              break
            }
          } catch {
            break
          }
        }

        const title = result.novel_series_detail?.title || "小说系列"
        return cacheSeriesNav(
          seriesID,
          "novel",
          title,
          allRawNovels.map((it, idx) => ({
            id: Number(it.id),
            title: it.title || `第${idx + 1}话`,
            episodeNumber: idx + 1,
          }))
        )
      }
    } catch {
      return null
    } finally {
      inflightNavRequests.delete(requestKey)
    }
  })()

  inflightNavRequests.set(requestKey, task)
  return task
}
