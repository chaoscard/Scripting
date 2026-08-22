import { session } from "../api/session"
import {
  illustrationSeries,
  nextIllustrationSeries,
  nextNovelSeries,
  novelSeries,
} from "../api/pixiv"
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
}

const MAX_SERIES_CACHE = 100
const MAX_WORK_ASSOCIATIONS = 1000
const mangaSeriesNavCache = new Map<number, SeriesNavData>()
const novelSeriesNavCache = new Map<number, SeriesNavData>()
const workToSeriesCache = new Map<string, WorkSeriesRef>()
const inflightNavRequests = new Map<string, Promise<SeriesNavData | null>>()

function workKey(workID: number, kind: "manga" | "novel"): string {
  return `${kind}:${workID}`
}

export function recordWorkSeriesAssociation(
  workID: number | null | undefined,
  kind: "manga" | "novel",
  seriesID: number | null | undefined,
  seriesTitle?: string | null,
  episodeNumber?: number | null
): void {
  if (!workID || !seriesID) return
  const key = workKey(workID, kind)
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
    seriesTitle: seriesTitle?.trim() || (kind === "novel" ? "小说系列" : "漫画系列"),
    episodeNumber: episodeNumber ?? undefined,
  })
}

export function getSeriesByWorkID(
  workID: number | null | undefined,
  kind: "manga" | "novel"
): WorkSeriesRef | null {
  if (!workID) return null
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
  const cache = kind === "novel" ? novelSeriesNavCache : mangaSeriesNavCache
  return cache.get(seriesID) ?? null
}

export function cacheSeriesNav(
  seriesID: number,
  kind: "manga" | "novel",
  title: string,
  items: { id: number; title: string; episodeNumber?: number }[]
): SeriesNavData {
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
    recordWorkSeriesAssociation(itemID, kind, seriesID, title, epNum)
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
  }
  cache.set(seriesID, data)
  return data
}

export async function fetchSeriesNav(
  seriesID: number,
  kind: "manga" | "novel"
): Promise<SeriesNavData | null> {
  if (!seriesID) return null
  const cache = kind === "novel" ? novelSeriesNavCache : mangaSeriesNavCache
  const cached = cache.get(seriesID)
  if (cached) return cached

  const requestKey = `${kind}:${seriesID}`
  const existing = inflightNavRequests.get(requestKey)
  if (existing) return existing

  const task = (async () => {
    try {
      if (kind === "manga") {
        const result = await session.call((token) => illustrationSeries(seriesID, token))
        const allRawIllusts: PixivIllustrationSeriesItem[] = Array.isArray(result.illusts)
          ? [...result.illusts]
          : []
        let currentNextURL = result.next_url ?? null

        while (currentNextURL && allRawIllusts.length < 500) {
          try {
            const nextResult = await session.call((token) => nextIllustrationSeries(currentNextURL!, token))
            if (Array.isArray(nextResult.illusts) && nextResult.illusts.length > 0) {
              allRawIllusts.push(...nextResult.illusts)
              currentNextURL = nextResult.next_url ?? null
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
        const result = await session.call((token) => novelSeries(seriesID, token))
        const allRawNovels: PixivNovel[] = Array.isArray(result.novels)
          ? [...result.novels]
          : []
        let currentNextURL = result.next_url ?? null

        while (currentNextURL && allRawNovels.length < 500) {
          try {
            const nextResult = await session.call((token) => nextNovelSeries(currentNextURL!, token))
            if (Array.isArray(nextResult.novels) && nextResult.novels.length > 0) {
              allRawNovels.push(...nextResult.novels)
              currentNextURL = nextResult.next_url ?? null
            } else {
              break
            }
          } catch {
            break
          }
        }

        // Pixiv 小说系列 API 返回默认为 1..N 正序
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
