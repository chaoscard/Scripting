import { pixivWatchlistDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

type WatchlistListener = (seriesID: number, watched: boolean) => void

const KEY = "pixiv_watchlist_series_ids_v1"
const WATCHLIST_FILE_NAME = "watchlist.json"

let cachedWatchedSeriesIDs: Set<number> | null = null
const listeners = new Set<WatchlistListener>()

function watchlistFilePath(): string {
  return `${pixivWatchlistDirectory()}/${WATCHLIST_FILE_NAME}`
}

export async function prepareWatchlistStorage(): Promise<void> {
  if (!FileManager.isiCloudEnabled) return
  const path = watchlistFilePath()
  if (
    !FileManager.existsSync(path) ||
    !FileManager.isFileStoredIniCloud(path) ||
    FileManager.isiCloudFileDownloaded(path)
  ) {
    return
  }
  try {
    await FileManager.downloadFileFromiCloud(path)
  } catch {
    // 云端文件暂不可下载时在下次启动或刷新时重试。
  }
}

function getWatchedSeriesIDs(): Set<number> {
  if (cachedWatchedSeriesIDs) return cachedWatchedSeriesIDs
  const path = watchlistFilePath()
  let ids: number[] | null = null

  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      const decoded = JSON.parse(raw)
      if (Array.isArray(decoded)) {
        ids = decoded.filter((id): id is number => typeof id === "number" && id > 0)
      }
    }
  } catch {
    // 读取云端文件异常时回退 Storage
  }

  let needPersist = false
  if (!ids) {
    const stored = Storage.get<number[]>(KEY)
    ids = Array.isArray(stored)
      ? stored.filter((id): id is number => typeof id === "number" && id > 0)
      : []
    needPersist = true
  }

  cachedWatchedSeriesIDs = new Set(ids)
  if (needPersist || !FileManager.existsSync(path)) {
    persistWatchedSeriesIDs(cachedWatchedSeriesIDs)
  }
  return cachedWatchedSeriesIDs
}

function persistWatchedSeriesIDs(set: Set<number>): void {
  const ids = Array.from(set)
  try {
    writeTextSafely(watchlistFilePath(), JSON.stringify(ids, null, 2), (raw) => {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error("追更列表格式错误")
    })
  } catch (error: any) {
    console.log("watchlist persist error:", error?.message ?? error)
  }
  Storage.set(KEY, ids)
  cachedWatchedSeriesIDs = set
}

export async function refreshWatchlistFromCloud(): Promise<void> {
  await prepareWatchlistStorage()
  cachedWatchedSeriesIDs = null
  getWatchedSeriesIDs()
  emitChanged()
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

function emitChanged(): void {
  for (const listener of listeners) {
    try {
      listener(0, false)
    } catch {}
  }
}
