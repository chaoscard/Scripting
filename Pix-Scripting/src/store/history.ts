// 本地浏览记录：Pixiv 的历史接口需要会员，改为本地记录。
// 插画、漫画和小说分别使用独立的 iCloud 同步 JSON 文件（history_illust.json, history_manga.json, history_novel.json）。
// 架构：轻量精简存储字段 + 内存分类型独立缓存 + 1.5s 防抖批量落盘。
import { loadSettings } from "./settings"
import { pixivHistoryDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import { clearNovelProgress } from "./novelProgress"
import { session } from "../api/session"
import { notifyLocalMutation, recordClearBefore, recordTombstone, syncHistoryNow } from "./historySync"
import type { PixivIllustration, PixivNovel } from "../types"

export type HistoryContentKind = "illustration" | "manga" | "novel"

export interface IllustrationHistoryEntry {
  kind: "illust"
  illustration: PixivIllustration
  viewedAt: number
}

export interface NovelHistoryEntry {
  kind: "novel"
  novel: PixivNovel
  viewedAt: number
}

export type HistoryEntry = IllustrationHistoryEntry | NovelHistoryEntry

// 磁盘精简存储模型（剔除长富文本简介、原图大图、完整分页等高开销字段）
interface StoredIllustData {
  id: number
  title: string
  type?: "illust" | "manga" | "ugoira"
  image_urls?: {
    medium?: string
    square_medium?: string
    large?: string
  }
  user: {
    id: number
    name: string
  }
  tags?: {
    name: string
    translated_name?: string | null
  }[]
  page_count?: number
  width?: number
  height?: number
  total_view?: number
  total_bookmarks?: number
  is_bookmarked?: boolean
  x_restrict?: number
  illust_ai_type?: number
  series?: { id: number; title?: string | null } | null
  episode_number?: number
}

interface StoredNovelData {
  id: number
  title: string
  image_urls?: {
    medium?: string
    square_medium?: string
    large?: string
  } | null
  cover?: {
    urls?: { "240mw"?: string; "480mw"?: string; "1200x1200"?: string }
  } | null
  user: {
    id: number
    name: string
  }
  tags?: {
    name: string
    translated_name?: string | null
  }[]
  total_view?: number
  total_bookmarks?: number
  is_bookmarked?: boolean
  x_restrict?: number
  novel_ai_type?: number
  text_length?: number
  episode_number?: number
  series?: { id: number; title?: string | null } | null
}

interface StoredHistoryEntry {
  kind: "illust" | "novel"
  viewedAt: number
  illustration?: StoredIllustData
  novel?: StoredNovelData
}

const HISTORY_ILLUST_FILE = "history_illust.json"
const HISTORY_MANGA_FILE = "history_manga.json"
const HISTORY_NOVEL_FILE = "history_novel.json"
const DEBOUNCE_DELAY_MS = 1500

const caches: {
  illustration: IllustrationHistoryEntry[] | null
  manga: IllustrationHistoryEntry[] | null
  novel: NovelHistoryEntry[] | null
} = {
  illustration: null,
  manga: null,
  novel: null,
}

const dirtyFlags: { [key in HistoryContentKind]: boolean } = {
  illustration: false,
  manga: false,
  novel: false,
}

const saveTimers: { [key in HistoryContentKind]?: ReturnType<typeof setTimeout> | null } = {
  illustration: null,
  manga: null,
  novel: null,
}

const listeners = new Set<() => void>()

function fileNameForKind(kind: HistoryContentKind): string {
  switch (kind) {
    case "illustration":
      return HISTORY_ILLUST_FILE
    case "manga":
      return HISTORY_MANGA_FILE
    case "novel":
      return HISTORY_NOVEL_FILE
  }
}

export function historyFilePath(
  kind: HistoryContentKind,
  userId?: string | number | null
): string {
  return `${pixivHistoryDirectory(userId ?? session.userID)}/${fileNameForKind(kind)}`
}

export async function prepareHistoryStorage(): Promise<void> {
  const path = historyFilePath("illustration")
  const dir = path.substring(0, path.lastIndexOf("/"))
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
}

function toStoredIllustData(illust: PixivIllustration): StoredIllustData {
  return {
    id: illust.id,
    title: illust.title ?? "",
    type: illust.type ?? "illust",
    image_urls: {
      large: illust.image_urls?.large,
      medium: illust.image_urls?.medium,
      square_medium: illust.image_urls?.square_medium,
    },
    user: {
      id: illust.user?.id ?? 0,
      name: illust.user?.name ?? "",
    },
    tags: (illust.tags ?? []).map((t) => ({
      name: t.name,
      translated_name: t.translated_name ?? null,
    })),
    page_count: illust.page_count ?? 1,
    width: illust.width ?? 0,
    height: illust.height ?? 0,
    total_view: illust.total_view ?? 0,
    total_bookmarks: illust.total_bookmarks ?? 0,
    is_bookmarked: Boolean(illust.is_bookmarked),
    x_restrict: illust.x_restrict ?? 0,
    illust_ai_type: illust.illust_ai_type ?? 0,
    series: illust.series ? { id: illust.series.id, title: illust.series.title } : undefined,
    episode_number: illust.episode_number,
  }
}

function toStoredNovelData(novel: PixivNovel): StoredNovelData {
  return {
    id: novel.id,
    title: novel.title ?? "",
    image_urls: novel.image_urls
      ? {
          medium: novel.image_urls.medium,
          square_medium: novel.image_urls.square_medium,
        }
      : null,
    cover: novel.cover?.urls ? { urls: novel.cover.urls } : null,
    user: {
      id: novel.user?.id ?? 0,
      name: novel.user?.name ?? "",
    },
    tags: (novel.tags ?? []).map((t) => ({
      name: t.name,
      translated_name: t.translated_name ?? null,
    })),
    total_view: novel.total_view ?? 0,
    total_bookmarks: novel.total_bookmarks ?? 0,
    is_bookmarked: Boolean(novel.is_bookmarked),
    x_restrict: novel.x_restrict ?? 0,
    novel_ai_type: novel.novel_ai_type ?? 0,
    text_length: novel.text_length ?? 0,
    episode_number: novel.episode_number,
    series: novel.series ? { id: novel.series.id, title: novel.series.title } : undefined,
  }
}

export function toStoredEntry(entry: HistoryEntry): StoredHistoryEntry {
  if (entry.kind === "illust") {
    return {
      kind: "illust",
      viewedAt: entry.viewedAt,
      illustration: toStoredIllustData(entry.illustration),
    }
  }
  return {
    kind: "novel",
    viewedAt: entry.viewedAt,
    novel: toStoredNovelData(entry.novel),
  }
}

function inflateIllust(data: StoredIllustData): PixivIllustration {
  return {
    id: data.id,
    title: data.title,
    type: data.type ?? "illust",
    image_urls: {
      square_medium: data.image_urls?.square_medium,
      medium: data.image_urls?.medium,
      large: data.image_urls?.large,
    },
    caption: "",
    user: {
      id: data.user.id,
      name: data.user.name,
      account: "",
    },
    tags: (data.tags ?? []).map((t) => ({
      name: t.name,
      translated_name: t.translated_name ?? null,
    })),
    create_date: "",
    page_count: data.page_count ?? 1,
    width: data.width ?? 0,
    height: data.height ?? 0,
    x_restrict: data.x_restrict ?? 0,
    series: data.series ?? null,
    episode_number: data.episode_number,
    meta_pages: [],
    total_view: data.total_view ?? 0,
    total_bookmarks: data.total_bookmarks ?? 0,
    is_bookmarked: Boolean(data.is_bookmarked),
    is_muted: false,
    illust_ai_type: data.illust_ai_type ?? 0,
    total_comments: 0,
    comment_access_control: 0,
  }
}

function inflateNovel(data: StoredNovelData): PixivNovel {
  return {
    id: data.id,
    title: data.title,
    user: {
      id: data.user.id,
      name: data.user.name,
      account: "",
    },
    tags: (data.tags ?? []).map((t) => ({
      name: t.name,
      translated_name: t.translated_name ?? null,
    })),
    create_date: "",
    page_count: 1,
    x_restrict: data.x_restrict ?? 0,
    total_view: data.total_view ?? 0,
    total_bookmarks: data.total_bookmarks ?? 0,
    is_bookmarked: Boolean(data.is_bookmarked),
    is_muted: false,
    novel_ai_type: data.novel_ai_type ?? 0,
    total_comments: 0,
    text_length: data.text_length ?? 0,
    visible: true,
    series: data.series ?? null,
    episode_number: data.episode_number,
    image_urls: data.image_urls ?? null,
    cover: data.cover ?? null,
  }
}

function persistKindSync(kind: HistoryContentKind): boolean {
  try {
    const list = caches[kind] ?? []
    const compactEntries = list.map(toStoredEntry)
    const filePath = historyFilePath(kind)
    writeTextSafely(filePath, JSON.stringify(compactEntries), (raw) => {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error(`${kind} 历史记录格式错误`)
    })
    dirtyFlags[kind] = false
    return true
  } catch (error: any) {
    console.warn(`${kind} history persist error:`, error?.message ?? error)
    return false
  }
}

export function flushHistory(): boolean {
  let ok = true
  const kinds: HistoryContentKind[] = ["illustration", "manga", "novel"]
  for (const k of kinds) {
    if (saveTimers[k]) {
      clearTimeout(saveTimers[k]!)
      saveTimers[k] = null
    }
    if (dirtyFlags[k] && caches[k]) {
      if (!persistKindSync(k)) {
        ok = false
      }
    }
  }
  return ok
}

function commitKind(kind: HistoryContentKind, next: any[], immediate = false): boolean {
  caches[kind] = next as any
  dirtyFlags[kind] = true
  emitChanged()
  notifyLocalMutation()

  if (immediate) {
    if (saveTimers[kind]) {
      clearTimeout(saveTimers[kind]!)
      saveTimers[kind] = null
    }
    return persistKindSync(kind)
  }

  if (saveTimers[kind]) {
    clearTimeout(saveTimers[kind]!)
  }
  saveTimers[kind] = setTimeout(() => {
    saveTimers[kind] = null
    if (dirtyFlags[kind] && caches[kind]) {
      persistKindSync(kind)
    }
  }, DEBOUNCE_DELAY_MS)
  return true
}

function emitChanged(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {}
  }
}

export function clearHistoryMemoryCache(): void {
  for (const k of ["illustration", "manga", "novel"] as const) {
    if (saveTimers[k]) {
      clearTimeout(saveTimers[k]!)
      saveTimers[k] = null
    }
    dirtyFlags[k] = false
  }
  caches.illustration = null
  caches.manga = null
  caches.novel = null
  emitChanged()
}

export function onHistoryChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export async function refreshHistoryFromCloud(): Promise<void> {
  await syncHistoryNow()
}

export function replaceKindEntries(kind: HistoryContentKind, next: any[], persist = true): void {
  caches[kind] = next as any
  if (persist) {
    if (saveTimers[kind]) {
      clearTimeout(saveTimers[kind]!)
      saveTimers[kind] = null
    }
    persistKindSync(kind)
  }
  emitChanged()
}

export function parseRawEntriesForKind(
  kind: HistoryContentKind,
  rawEntries: any[]
): (IllustrationHistoryEntry | NovelHistoryEntry)[] {
  const seen = new Set<number>()
  const valid: (IllustrationHistoryEntry | NovelHistoryEntry)[] = []

  for (const raw of rawEntries) {
    const viewedAt = typeof raw?.viewedAt === "number" ? raw.viewedAt : 0

    if (kind === "novel") {
      const novelData = raw?.novel
      if (novelData && typeof novelData.id === "number" && !seen.has(novelData.id)) {
        seen.add(novelData.id)
        valid.push({ kind: "novel", novel: inflateNovel(novelData), viewedAt })
      }
    } else {
      const illustData = raw?.illustration
      if (illustData && typeof illustData.id === "number" && !seen.has(illustData.id)) {
        seen.add(illustData.id)
        valid.push({
          kind: "illust",
          illustration: inflateIllust(illustData),
          viewedAt,
        })
      }
    }
  }

  return valid.sort((a, b) => b.viewedAt - a.viewedAt)
}

export function loadKindEntries(kind: HistoryContentKind): (IllustrationHistoryEntry | NovelHistoryEntry)[] {
  if (caches[kind] !== null) {
    return caches[kind]!
  }

  const filePath = historyFilePath(kind)
  try {
    recoverFile(filePath)
    if (!FileManager.existsSync(filePath)) {
      caches[kind] = []
      return caches[kind]!
    }
    const raw = FileManager.readAsStringSync(filePath, "utf-8")
    const decoded = JSON.parse(raw)
    if (Array.isArray(decoded)) {
      caches[kind] = parseRawEntriesForKind(kind, decoded) as any
    } else {
      caches[kind] = []
    }
  } catch {
    caches[kind] = []
  }

  return caches[kind]!
}

export function getHistory(kind?: HistoryContentKind): HistoryEntry[] {
  if (kind) {
    return loadKindEntries(kind) as HistoryEntry[]
  }
  const all: HistoryEntry[] = [
    ...(loadKindEntries("illustration") as HistoryEntry[]),
    ...(loadKindEntries("manga") as HistoryEntry[]),
    ...(loadKindEntries("novel") as HistoryEntry[]),
  ]
  return all.sort((a, b) => b.viewedAt - a.viewedAt)
}

export function historyCount(kind?: HistoryContentKind): number {
  if (kind) {
    return loadKindEntries(kind).length
  }
  return (
    loadKindEntries("illustration").length +
    loadKindEntries("manga").length +
    loadKindEntries("novel").length
  )
}

export function historyKindCount(kind: HistoryContentKind): number {
  return loadKindEntries(kind).length
}

export function recordHistory(illustration: PixivIllustration): void {
  if (!loadSettings().recordHistory) return
  const isManga = illustration.type === "manga"
  const kind: HistoryContentKind = isManga ? "manga" : "illustration"
  const list = [...(loadKindEntries(kind) as IllustrationHistoryEntry[])]
  const index = list.findIndex((item) => item.illustration.id === illustration.id)
  if (index >= 0) list.splice(index, 1)
  list.unshift({ kind: "illust", illustration, viewedAt: Date.now() })
  commitKind(kind, list, false)
}

export function recordNovelHistory(novel: PixivNovel): void {
  if (!loadSettings().recordHistory) return
  const kind: HistoryContentKind = "novel"
  const list = [...(loadKindEntries(kind) as NovelHistoryEntry[])]
  const index = list.findIndex((item) => item.novel.id === novel.id)
  if (index >= 0) list.splice(index, 1)
  list.unshift({ kind: "novel", novel, viewedAt: Date.now() })
  commitKind(kind, list, false)
}

export function updateHistoryBookmark(id: number, isBookmarked: boolean): void {
  const kinds: HistoryContentKind[] = ["illustration", "manga"]
  for (const kind of kinds) {
    const list = loadKindEntries(kind) as IllustrationHistoryEntry[]
    const index = list.findIndex((item) => item.illustration.id === id)
    if (index >= 0) {
      const next = [...list]
      next[index] = {
        ...next[index],
        illustration: { ...next[index].illustration, is_bookmarked: isBookmarked },
      }
      commitKind(kind, next, false)
    }
  }
}

export function updateNovelHistoryBookmark(id: number, isBookmarked: boolean): void {
  const kind: HistoryContentKind = "novel"
  const list = loadKindEntries(kind) as NovelHistoryEntry[]
  const index = list.findIndex((item) => item.novel.id === id)
  if (index >= 0) {
    const next = [...list]
    next[index] = {
      ...next[index],
      novel: { ...next[index].novel, is_bookmarked: isBookmarked },
    }
    commitKind(kind, next, false)
  }
}

export function removeHistoryEntry(kind: HistoryEntry["kind"], id: number): void {
  if (kind === "novel") {
    const list = loadKindEntries("novel") as NovelHistoryEntry[]
    const next = list.filter((e) => e.novel.id !== id)
    if (next.length !== list.length) {
      commitKind("novel", next, true)
    }
    clearNovelProgress(id)
    recordTombstone("novel", id)
  } else {
    for (const k of ["illustration", "manga"] as const) {
      const list = loadKindEntries(k) as IllustrationHistoryEntry[]
      const next = list.filter((e) => e.illustration.id !== id)
      if (next.length !== list.length) {
        commitKind(k, next, true)
        recordTombstone(k, id)
      }
    }
  }
}

export function clearHistoryKind(kind: HistoryContentKind): void {
  commitKind(kind, [], true)
  recordClearBefore(kind)
  if (kind === "novel") {
    clearNovelProgress()
  }
}

export function clearHistory(): void {
  commitKind("illustration", [], true)
  commitKind("manga", [], true)
  commitKind("novel", [], true)
  recordClearBefore("illustration")
  recordClearBefore("manga")
  recordClearBefore("novel")
  clearNovelProgress()
}
