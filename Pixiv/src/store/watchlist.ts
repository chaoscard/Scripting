type WatchlistListener = (seriesID: number, watched: boolean) => void

const KEY = "pixiv_watchlist_series_ids_v1"
let cachedWatchedSeriesIDs: Set<number> | null = null
const listeners = new Set<WatchlistListener>()

function getWatchedSeriesIDs(): Set<number> {
  if (cachedWatchedSeriesIDs) return cachedWatchedSeriesIDs
  const stored = Storage.get<number[]>(KEY)
  const ids = Array.isArray(stored)
    ? stored.filter((id): id is number => typeof id === "number" && id > 0)
    : []
  cachedWatchedSeriesIDs = new Set(ids)
  return cachedWatchedSeriesIDs
}

function persistWatchedSeriesIDs(set: Set<number>): void {
  Storage.set(KEY, Array.from(set))
}

export function isSeriesWatched(seriesID?: number | null): boolean {
  if (seriesID == null || !Number.isFinite(seriesID) || seriesID <= 0) return false
  return getWatchedSeriesIDs().has(seriesID)
}

export function recordWatchedSeries(seriesID: number, watched: boolean): void {
  if (!seriesID || seriesID <= 0) return
  const set = getWatchedSeriesIDs()
  const exists = set.has(seriesID)
  if (watched) {
    set.add(seriesID)
  } else {
    set.delete(seriesID)
  }
  if ((watched && !exists) || (!watched && exists)) {
    persistWatchedSeriesIDs(set)
    notifyWatchlistChanged(seriesID, watched)
  }
}

export function recordWatchedSeriesIDs(seriesIDs: number[]): void {
  const set = getWatchedSeriesIDs()
  let changed = false
  for (const id of seriesIDs) {
    if (typeof id === "number" && id > 0 && !set.has(id)) {
      set.add(id)
      changed = true
    }
  }
  if (changed) {
    persistWatchedSeriesIDs(set)
  }
}

export function onWatchlistChanged(listener: WatchlistListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyWatchlistChanged(seriesID: number, watched: boolean): void {
  for (const listener of listeners) {
    try {
      listener(seriesID, watched)
    } catch {}
  }
}
