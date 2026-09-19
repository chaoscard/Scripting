import { pixivHistoryDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import { session } from "../api/session"
import {
  notifyLocalMutation,
  recordSearchClearBefore,
  recordSearchTombstone,
  removeSearchTombstone,
} from "./historySync"

export type SearchHistoryScope = "illust" | "novel" | "user"

export interface SearchHistoryEntry {
  query: string
  searchedAt: number
}

export interface SearchHistoryStore {
  illust: SearchHistoryEntry[]
  novel: SearchHistoryEntry[]
  user: SearchHistoryEntry[]
  updatedAt?: number
}

export const MAX_SEARCH_HISTORY_ITEMS = 100

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

export function normalizeHistoryEntries(
  rawList: any,
  fallbackTime = Date.now()
): SearchHistoryEntry[] {
  if (!Array.isArray(rawList)) return []
  const result: SearchHistoryEntry[] = []
  const seen = new Set<string>()

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i]
    let query = ""
    let searchedAt = fallbackTime - i * 1000

    if (typeof item === "string") {
      query = item.trim()
    } else if (item && typeof item === "object") {
      if (typeof item.query === "string") {
        query = item.query.trim()
      }
      if (typeof item.searchedAt === "number" && !isNaN(item.searchedAt) && item.searchedAt > 0) {
        searchedAt = item.searchedAt
      }
    }

    if (query.length > 0 && !seen.has(query)) {
      seen.add(query)
      result.push({ query, searchedAt })
    }
  }

  result.sort((a, b) => b.searchedAt - a.searchedAt)
  return result.slice(0, MAX_SEARCH_HISTORY_ITEMS)
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
          const fallback = typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now()
          cachedSearchHistory = {
            illust: normalizeHistoryEntries(parsed.illust, fallback),
            novel: normalizeHistoryEntries(parsed.novel, fallback),
            user: normalizeHistoryEntries(parsed.user, fallback),
            updatedAt: fallback,
          }
          return cachedSearchHistory
        }
        if (Array.isArray(parsed)) {
          const fallback = Date.now()
          cachedSearchHistory = {
            illust: normalizeHistoryEntries(parsed, fallback),
            novel: [],
            user: [],
            updatedAt: fallback,
          }
          return cachedSearchHistory
        }
      }
    }
  } catch {}

  cachedSearchHistory = { illust: [], novel: [], user: [], updatedAt: Date.now() }
  return cachedSearchHistory
}

export function replaceSearchHistoryStore(store: SearchHistoryStore, persist = true): void {
  const fallback = typeof store.updatedAt === "number" ? store.updatedAt : Date.now()
  cachedSearchHistory = {
    illust: normalizeHistoryEntries(store.illust, fallback),
    novel: normalizeHistoryEntries(store.novel, fallback),
    user: normalizeHistoryEntries(store.user, fallback),
    updatedAt: fallback,
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

export function getSearchHistoryEntries(scope: SearchHistoryScope = "illust"): SearchHistoryEntry[] {
  const store = getFullSearchHistoryStore()
  return store[scope] ?? []
}

export function getSearchHistory(scope: SearchHistoryScope = "illust"): string[] {
  return getSearchHistoryEntries(scope).map((e) => e.query)
}

export function addSearchHistory(query: string, scope: SearchHistoryScope = "illust"): string[] {
  const trimmed = query.trim()
  if (!trimmed) return getSearchHistory(scope)
  try {
    removeSearchTombstone(scope, trimmed)
  } catch {}
  const store = getFullSearchHistoryStore()
  const current = store[scope] ?? []
  const filtered = current.filter((item) => item.query !== trimmed)
  const now = Date.now()
  const next: SearchHistoryEntry[] = [{ query: trimmed, searchedAt: now }, ...filtered].slice(
    0,
    MAX_SEARCH_HISTORY_ITEMS
  )
  store[scope] = next
  store.updatedAt = now
  scheduleSave()
  emitChanged()
  notifyLocalMutation()
  return next.map((e) => e.query)
}

export function removeSearchHistory(query: string, scope: SearchHistoryScope = "illust"): string[] {
  const trimmed = query.trim()
  if (trimmed) {
    try {
      recordSearchTombstone(scope, trimmed)
    } catch {}
  }
  const store = getFullSearchHistoryStore()
  const current = store[scope] ?? []
  const next = current.filter((item) => item.query !== trimmed && item.query !== query)
  store[scope] = next
  store.updatedAt = Date.now()
  scheduleSave()
  emitChanged()
  notifyLocalMutation()
  return next.map((e) => e.query)
}

export function clearSearchHistory(scope: SearchHistoryScope = "illust"): void {
  try {
    recordSearchClearBefore(scope)
  } catch {}
  const store = getFullSearchHistoryStore()
  store[scope] = []
  store.updatedAt = Date.now()
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
