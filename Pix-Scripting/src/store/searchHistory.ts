import { pixivHistoryDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import { session } from "../api/session"
import { notifyLocalMutation } from "./historySync"

export type SearchHistoryScope = "illust" | "novel" | "user"

export interface SearchHistoryStore {
  illust: string[]
  novel: string[]
  user: string[]
}

const SEARCH_HISTORY_FILE_NAME = "search_history.json"
const DEBOUNCE_DELAY_MS = 1000

let cachedSearchHistory: SearchHistoryStore | null = null
let isDirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

export function flushSearchHistory(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!isDirty) return
  isDirty = false
  if (cachedSearchHistory) {
    persistSearchHistory(cachedSearchHistory)
  }
}

function scheduleSave(): void {
  isDirty = true
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushSearchHistory()
  }, DEBOUNCE_DELAY_MS)
}

export function clearSearchHistoryMemoryCache(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  isDirty = false
  cachedSearchHistory = null
  emitChanged()
}

export function searchHistoryFilePath(userId?: string | number | null): string {
  return `${pixivHistoryDirectory(userId ?? session.userID)}/${SEARCH_HISTORY_FILE_NAME}`
}

export async function prepareSearchHistoryStorage(): Promise<void> {
  const path = searchHistoryFilePath()
  const dir = path.substring(0, path.lastIndexOf("/"))
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
}

function persistSearchHistory(history: SearchHistoryStore): boolean {
  try {
    writeTextSafely(searchHistoryFilePath(), JSON.stringify(history), (raw) => {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") throw new Error("搜索历史格式错误")
    })
  } catch (error: any) {
    console.log("searchHistory persist error:", error?.message ?? error)
  }
  return true
}

export function getFullSearchHistoryStore(): SearchHistoryStore {
  if (cachedSearchHistory) return cachedSearchHistory
  const path = searchHistoryFilePath()
  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.illust) || Array.isArray(parsed.novel) || Array.isArray(parsed.user)) {
          cachedSearchHistory = {
            illust: Array.isArray(parsed.illust)
              ? parsed.illust.filter((it: any): it is string => typeof it === "string" && it.trim().length > 0)
              : [],
            novel: Array.isArray(parsed.novel)
              ? parsed.novel.filter((it: any): it is string => typeof it === "string" && it.trim().length > 0)
              : [],
            user: Array.isArray(parsed.user)
              ? parsed.user.filter((it: any): it is string => typeof it === "string" && it.trim().length > 0)
              : [],
          }
          return cachedSearchHistory
        }
        if (Array.isArray(parsed)) {
          cachedSearchHistory = {
            illust: parsed.filter((it: any): it is string => typeof it === "string" && it.trim().length > 0),
            novel: [],
            user: [],
          }
          return cachedSearchHistory
        }
      }
    }
  } catch {}

  cachedSearchHistory = { illust: [], novel: [], user: [] }
  return cachedSearchHistory
}

export function replaceSearchHistoryStore(store: SearchHistoryStore, persist = true): void {
  cachedSearchHistory = {
    illust: [...store.illust],
    novel: [...store.novel],
    user: [...store.user],
  }
  if (persist) {
    flushSearchHistory()
    persistSearchHistory(cachedSearchHistory)
  }
  emitChanged()
}

function emitChanged(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {}
  }
}

export function getSearchHistory(scope: SearchHistoryScope = "illust"): string[] {
  const store = getFullSearchHistoryStore()
  return store[scope] ?? []
}

export function addSearchHistory(query: string, scope: SearchHistoryScope = "illust"): string[] {
  const trimmed = query.trim()
  if (!trimmed) return getSearchHistory(scope)
  const store = getFullSearchHistoryStore()
  const current = store[scope] ?? []
  const filtered = current.filter((item) => item !== trimmed)
  const next = [trimmed, ...filtered]
  store[scope] = next
  scheduleSave()
  emitChanged()
  notifyLocalMutation()
  return next
}

export function removeSearchHistory(query: string, scope: SearchHistoryScope = "illust"): string[] {
  const store = getFullSearchHistoryStore()
  const current = store[scope] ?? []
  const next = current.filter((item) => item !== query)
  store[scope] = next
  scheduleSave()
  emitChanged()
  notifyLocalMutation()
  return next
}

export function clearSearchHistory(scope: SearchHistoryScope = "illust"): void {
  const store = getFullSearchHistoryStore()
  store[scope] = []
  scheduleSave()
  emitChanged()
  notifyLocalMutation()
}

export function onSearchHistoryChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
