import { updateHistoryBookmark } from "./history"

// 插画/漫画收藏同步
export type IllustBookmarkListener = (
  illustID: number,
  bookmarked: boolean,
  restrict?: "public" | "private",
  tags?: string[]
) => void

const illustListeners = new Set<IllustBookmarkListener>()
const illustBookmarkCache = new Map<number, boolean>()

export function onIllustBookmarkChanged(listener: IllustBookmarkListener): () => void {
  illustListeners.add(listener)
  return () => {
    illustListeners.delete(listener)
  }
}

export function notifyIllustBookmarkChanged(
  illustID: number,
  bookmarked: boolean,
  restrict?: "public" | "private",
  tags?: string[]
): void {
  if (typeof illustID === "number" && illustID > 0) {
    illustBookmarkCache.set(illustID, bookmarked)
  }
  // 同步更新本地浏览历史记录中的收藏标记
  try {
    updateHistoryBookmark(illustID, bookmarked)
  } catch {}

  for (const listener of illustListeners) {
    try {
      listener(illustID, bookmarked, restrict, tags)
    } catch {}
  }
}

export function getCachedIllustBookmark(illustID: number): boolean | undefined {
  return illustBookmarkCache.get(illustID)
}

export function recordIllustBookmark(illustID: number, bookmarked: boolean): void {
  if (typeof illustID === "number" && illustID > 0) {
    illustBookmarkCache.set(illustID, bookmarked)
  }
}

// 小说收藏同步
export type NovelBookmarkListener = (
  novelID: number,
  bookmarked: boolean,
  restrict?: "public" | "private",
  tags?: string[]
) => void

const novelListeners = new Set<NovelBookmarkListener>()
const novelBookmarkCache = new Map<number, boolean>()

export function onNovelBookmarkChanged(listener: NovelBookmarkListener): () => void {
  novelListeners.add(listener)
  return () => {
    novelListeners.delete(listener)
  }
}

export function notifyNovelBookmarkChanged(
  novelID: number,
  bookmarked: boolean,
  restrict?: "public" | "private",
  tags?: string[]
): void {
  if (typeof novelID === "number" && novelID > 0) {
    novelBookmarkCache.set(novelID, bookmarked)
  }
  for (const listener of novelListeners) {
    try {
      listener(novelID, bookmarked, restrict, tags)
    } catch {}
  }
}

export function getCachedNovelBookmark(novelID: number): boolean | undefined {
  return novelBookmarkCache.get(novelID)
}

export function recordNovelBookmark(novelID: number, bookmarked: boolean): void {
  if (typeof novelID === "number" && novelID > 0) {
    novelBookmarkCache.set(novelID, bookmarked)
  }
}

// 系列追更（漫画/小说）同步
export type WatchlistListener = (
  seriesID: number,
  kind: "manga" | "novel",
  watched: boolean
) => void

const watchlistListeners = new Set<WatchlistListener>()
const watchlistCache = new Map<string, boolean>()

function watchlistKey(seriesID: number, kind: "manga" | "novel"): string {
  return `${kind}_${seriesID}`
}

export function onWatchlistChanged(listener: WatchlistListener): () => void {
  watchlistListeners.add(listener)
  return () => {
    watchlistListeners.delete(listener)
  }
}

export function notifyWatchlistChanged(
  seriesID: number,
  kind: "manga" | "novel",
  watched: boolean
): void {
  if (typeof seriesID === "number" && seriesID > 0) {
    watchlistCache.set(watchlistKey(seriesID, kind), watched)
  }
  for (const listener of watchlistListeners) {
    try {
      listener(seriesID, kind, watched)
    } catch {}
  }
}

export function getCachedWatchlist(
  seriesID: number,
  kind: "manga" | "novel"
): boolean | undefined {
  return watchlistCache.get(watchlistKey(seriesID, kind))
}

export function recordWatchlist(
  seriesID: number,
  kind: "manga" | "novel",
  watched: boolean
): void {
  if (typeof seriesID === "number" && seriesID > 0) {
    watchlistCache.set(watchlistKey(seriesID, kind), watched)
  }
}

// 小说阅读书签（Marker）同步
export type NovelMarkerListener = (
  novelID: number,
  page: number | null
) => void

const novelMarkerListeners = new Set<NovelMarkerListener>()
const novelMarkerCache = new Map<number, number | null>()

export function onNovelMarkerChanged(listener: NovelMarkerListener): () => void {
  novelMarkerListeners.add(listener)
  return () => {
    novelMarkerListeners.delete(listener)
  }
}

export function notifyNovelMarkerChanged(
  novelID: number,
  page: number | null
): void {
  if (typeof novelID === "number" && novelID > 0) {
    novelMarkerCache.set(novelID, page)
  }
  for (const listener of novelMarkerListeners) {
    try {
      listener(novelID, page)
    } catch {}
  }
}

export function getCachedNovelMarker(novelID: number): number | null | undefined {
  return novelMarkerCache.get(novelID)
}

export function recordNovelMarker(novelID: number, page: number | null): void {
  if (typeof novelID === "number" && novelID > 0) {
    novelMarkerCache.set(novelID, page)
  }
}

