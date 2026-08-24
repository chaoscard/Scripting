import { pixivHistoryDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

const KEY = "pixiv_search_history_v1"
const SEARCH_HISTORY_FILE_NAME = "search_history.json"
const MAX_SEARCH_HISTORY_ITEMS = 30

let cachedSearchHistory: string[] | null = null
const listeners = new Set<() => void>()

function searchHistoryFilePath(): string {
  return `${pixivHistoryDirectory()}/${SEARCH_HISTORY_FILE_NAME}`
}

export async function prepareSearchHistoryStorage(): Promise<void> {
  if (!FileManager.isiCloudEnabled) return
  const path = searchHistoryFilePath()
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
    // 忽略下载异常
  }
}

function persistSearchHistory(history: string[]): boolean {
  try {
    writeTextSafely(searchHistoryFilePath(), JSON.stringify(history, null, 2), (raw) => {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error("搜索历史格式错误")
    })
  } catch (error: any) {
    console.log("searchHistory persist error:", error?.message ?? error)
  }
  Storage.set(KEY, history)
  return true
}

export function getSearchHistory(): string[] {
  if (cachedSearchHistory) return cachedSearchHistory
  const path = searchHistoryFilePath()
  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        cachedSearchHistory = parsed.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
        Storage.set(KEY, cachedSearchHistory)
        return cachedSearchHistory
      }
    }
  } catch {
    // 降级到 Storage
  }

  const stored = Storage.get(KEY)
  if (Array.isArray(stored)) {
    cachedSearchHistory = stored.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    )
    persistSearchHistory(cachedSearchHistory)
    return cachedSearchHistory
  }

  cachedSearchHistory = []
  return cachedSearchHistory
}

function emitChanged(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {}
  }
}

export function addSearchHistory(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) return getSearchHistory()
  const current = getSearchHistory()
  const filtered = current.filter((item) => item !== trimmed)
  const next = [trimmed, ...filtered].slice(0, MAX_SEARCH_HISTORY_ITEMS)
  cachedSearchHistory = next
  persistSearchHistory(next)
  emitChanged()
  return next
}

export function removeSearchHistory(query: string): string[] {
  const current = getSearchHistory()
  const next = current.filter((item) => item !== query)
  cachedSearchHistory = next
  persistSearchHistory(next)
  emitChanged()
  return next
}

export function clearSearchHistory(): void {
  cachedSearchHistory = []
  persistSearchHistory([])
  emitChanged()
}

export function onSearchHistoryChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
