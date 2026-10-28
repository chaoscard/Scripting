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
  translatedName?: string | null
}

// -------------------- 标签/词条中文翻译内存映射字典 --------------------
const tagTranslationDict = new Map<string, string>()

export function recordTagTranslation(tag: string, translation?: string | null): void {
  const t = tag?.trim()
  const trans = translation?.trim()
  if (t && trans && t !== trans) {
    tagTranslationDict.set(t, trans)
  }
}

export function getTagTranslation(tag: string): string | null {
  if (!tag) return null
  return tagTranslationDict.get(tag.trim()) || null
}

export interface SearchHistoryStore {
  illust: SearchHistoryEntry[]
  novel: SearchHistoryEntry[]
  user: SearchHistoryEntry[]
  updatedAt?: number
  // ─── 跨设备共享的搜索删除墓碑与清空水位线 ───
  tombstones?: Record<string, number>
  clearBefore?: Record<string, number>
}

export const MAX_SEARCH_HISTORY_ITEMS = 100
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function pruneSearchStoreTombstones(store: SearchHistoryStore): void {
  if (!store.tombstones) return
  const now = Date.now()
  for (const [key, ts] of Object.entries(store.tombstones)) {
    if (typeof ts !== "number" || isNaN(ts) || now - ts > TOMBSTONE_TTL_MS) {
      delete store.tombstones[key]
    }
  }
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
    let translatedName: string | null = null

    if (typeof item === "string") {
      query = item.trim()
    } else if (item && typeof item === "object") {
      if (typeof item.query === "string") {
        query = item.query.trim()
      }
      if (typeof item.searchedAt === "number" && !isNaN(item.searchedAt) && item.searchedAt > 0) {
        searchedAt = item.searchedAt
      }
      if (typeof item.translatedName === "string" && item.translatedName.trim()) {
        translatedName = item.translatedName.trim()
      }
    }

    if (query.length > 0 && !seen.has(query)) {
      seen.add(query)
      const finalTrans = translatedName || tagTranslationDict.get(query) || null
      if (finalTrans) {
        recordTagTranslation(query, finalTrans)
        result.push({ query, searchedAt, translatedName: finalTrans })
      } else {
        result.push({ query, searchedAt })
      }
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
          const tombstones =
            parsed.tombstones && typeof parsed.tombstones === "object" ? { ...parsed.tombstones } : undefined
          const clearBefore =
            parsed.clearBefore && typeof parsed.clearBefore === "object" ? { ...parsed.clearBefore } : undefined
          cachedSearchHistory = {
            illust: normalizeHistoryEntries(parsed.illust, fallback),
            novel: normalizeHistoryEntries(parsed.novel, fallback),
            user: normalizeHistoryEntries(parsed.user, fallback),
            updatedAt: fallback,
            tombstones,
            clearBefore,
          }
          if (cachedSearchHistory.tombstones) {
            pruneSearchStoreTombstones(cachedSearchHistory)
          }
          // 旧词项只在冷读取时迁移一次，将本次归一化的时间固定到磁盘。
          // 不广播，不改变词项时间与排序；正常格式不会额外写入。
          const scopes: SearchHistoryScope[] = ["illust", "novel", "user"]
          const needsMigration = scopes.some((scope) => {
            const rawEntries = parsed[scope]
            const entries = cachedSearchHistory![scope]
            return !Array.isArray(rawEntries) || rawEntries.length !== entries.length ||
              entries.some((entry, index) =>
                rawEntries[index]?.query !== entry.query || rawEntries[index]?.searchedAt !== entry.searchedAt
              )
          })
          if (needsMigration) persistSearchHistory(cachedSearchHistory)
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
          persistSearchHistory(cachedSearchHistory)
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
  const tombstones = store.tombstones ? { ...store.tombstones } : undefined
  const clearBefore = store.clearBefore ? { ...store.clearBefore } : undefined
  cachedSearchHistory = {
    illust: normalizeHistoryEntries(store.illust, fallback),
    novel: normalizeHistoryEntries(store.novel, fallback),
    user: normalizeHistoryEntries(store.user, fallback),
    updatedAt: fallback,
    tombstones,
    clearBefore,
  }
  if (cachedSearchHistory.tombstones) {
    pruneSearchStoreTombstones(cachedSearchHistory)
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

export function addSearchHistory(
  query: string,
  scope: SearchHistoryScope = "illust",
  translatedName?: string | null
): string[] {
  const trimmed = query.trim()
  if (!trimmed) return getSearchHistory(scope)
  const store = getFullSearchHistoryStore()
  if (store.tombstones) {
    delete store.tombstones[`${scope}:${trimmed}`]
  }
  try {
    removeSearchTombstone(scope, trimmed)
  } catch {}
  const current = store[scope] ?? []
  const existing = current.find((item) => item.query === trimmed)
  const finalTrans =
    (translatedName && translatedName.trim()) ||
    existing?.translatedName ||
    tagTranslationDict.get(trimmed) ||
    null

  if (finalTrans) {
    recordTagTranslation(trimmed, finalTrans)
  }

  const filtered = current.filter((item) => item.query !== trimmed)
  const now = Date.now()
  const newEntry: SearchHistoryEntry = finalTrans
    ? { query: trimmed, searchedAt: now, translatedName: finalTrans }
    : { query: trimmed, searchedAt: now }

  const next: SearchHistoryEntry[] = [newEntry, ...filtered].slice(
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
  const store = getFullSearchHistoryStore()
  const now = Date.now()
  if (trimmed) {
    if (!store.tombstones) store.tombstones = {}
    store.tombstones[`${scope}:${trimmed}`] = now
    pruneSearchStoreTombstones(store)
    try {
      recordSearchTombstone(scope, trimmed)
    } catch {}
  }
  const current = store[scope] ?? []
  const next = current.filter((item) => item.query !== trimmed && item.query !== query)
  store[scope] = next
  store.updatedAt = now
  scheduleSave()
  emitChanged()
  notifyLocalMutation()
  return next.map((e) => e.query)
}

export function clearSearchHistory(scope: SearchHistoryScope = "illust"): void {
  const store = getFullSearchHistoryStore()
  const now = Date.now()
  if (!store.clearBefore) store.clearBefore = {}
  store.clearBefore[scope] = now
  if (store.tombstones) {
    const prefix = `${scope}:`
    for (const key of Object.keys(store.tombstones)) {
      if (key.startsWith(prefix)) {
        delete store.tombstones[key]
      }
    }
  }
  try {
    recordSearchClearBefore(scope)
  } catch {}
  store[scope] = []
  store.updatedAt = now
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
