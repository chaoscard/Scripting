// 本地浏览记录：Pixiv 的历史接口需要会员，改为本地记录。
// 插画、漫画和小说共用一个 iCloud 同步文件，按类型分别展示。
// 架构：轻量精简存储字段 + 内存实时响应 + 1.5s 防抖批量落盘。
import { loadSettings } from "./settings"
import { pixivHistoryDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import type { PixivIllustration, PixivNovel } from "../types"

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

const HISTORY_FILE_NAME = "history.json"
const DEBOUNCE_DELAY_MS = 1500

let entries: HistoryEntry[] | null = null
let isDirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function historyFilePath(): string {
  return `${pixivHistoryDirectory()}/${HISTORY_FILE_NAME}`
}

export async function prepareHistoryStorage(): Promise<void> {
  if (!FileManager.isiCloudEnabled) return
  const path = historyFilePath()
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
    // 云端文件暂不可下载时在下次启动或刷新时再重试。
  }
}

function toStoredIllustData(illust: PixivIllustration): StoredIllustData {
  return {
    id: illust.id,
    title: illust.title ?? "",
    type: illust.type ?? "illust",
    image_urls: {
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

function toStoredEntry(entry: HistoryEntry): StoredHistoryEntry {
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

function persistSync(targetEntries: HistoryEntry[]): boolean {
  try {
    const compactEntries = targetEntries.map(toStoredEntry)
    writeTextSafely(historyFilePath(), JSON.stringify(compactEntries), (raw) => {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error("历史记录格式错误")
    })
    isDirty = false
    return true
  } catch (error: any) {
    console.log("history persist error:", error?.message ?? error)
    return false
  }
}

export function flushHistory(): boolean {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!isDirty || !entries) return true
  return persistSync(entries)
}

function commit(next: HistoryEntry[], immediate = false): boolean {
  entries = next
  isDirty = true
  emitChanged()

  if (immediate) {
    return flushHistory()
  }

  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (isDirty && entries) {
      persistSync(entries)
    }
  }, DEBOUNCE_DELAY_MS)
  return true
}

function emitChanged(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // 单个监听器异常不影响其他
    }
  }
}

export function onHistoryChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export async function refreshHistoryFromCloud(): Promise<void> {
  flushHistory()
  await prepareHistoryStorage()
  entries = null
  emitChanged()
}

function entryKey(entry: HistoryEntry): string {
  return entry.kind === "illust"
    ? `illust:${entry.illustration.id}`
    : `novel:${entry.novel.id}`
}

function parseEntries(rawEntries: any[]): HistoryEntry[] {
  const seen = new Set<string>()
  const valid: HistoryEntry[] = []
  for (const raw of rawEntries) {
    const viewedAt = typeof raw?.viewedAt === "number" ? raw.viewedAt : 0
    let entry: HistoryEntry | null = null

    if (raw?.kind === "novel" && raw.novel) {
      entry = { kind: "novel", novel: inflateNovel(raw.novel), viewedAt }
    } else if (raw?.kind === "illust" && raw.illustration) {
      entry = { kind: "illust", illustration: inflateIllust(raw.illustration), viewedAt }
    } else if (raw?.novel) {
      // 兼容旧格式未标记 kind 的条目
      entry = { kind: "novel", novel: inflateNovel(raw.novel), viewedAt }
    } else if (raw?.illustration) {
      entry = { kind: "illust", illustration: inflateIllust(raw.illustration), viewedAt }
    }

    if (!entry) continue
    const key = entryKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    valid.push(entry)
  }
  return valid.sort((a, b) => b.viewedAt - a.viewedAt)
}

function loadEntries(): HistoryEntry[] {
  if (entries) return entries
  const path = historyFilePath()
  try {
    recoverFile(path)
    if (!FileManager.existsSync(path)) {
      entries = []
      return entries
    }
    const raw = FileManager.readAsStringSync(path, "utf-8")
    const decoded = JSON.parse(raw)
    entries = Array.isArray(decoded) ? parseEntries(decoded) : []
  } catch {
    entries = []
  }
  return entries
}

export function getHistory(): HistoryEntry[] {
  return loadEntries()
}

export function historyCount(): number {
  return loadEntries().length
}

export function historyKindCount(kind: HistoryContentKind): number {
  const list = loadEntries()
  let count = 0
  for (const entry of list) {
    if (kind === "novel") {
      if (entry.kind === "novel") count++
    } else if (entry.kind === "illust") {
      const isManga = entry.illustration?.type === "manga"
      if (kind === "manga" ? isManga : !isManga) count++
    }
  }
  return count
}

function recordEntry(entry: HistoryEntry): void {
  if (!loadSettings().recordHistory) return
  const list = [...loadEntries()]
  const key = entryKey(entry)
  const index = list.findIndex((item) => entryKey(item) === key)
  if (index >= 0) list.splice(index, 1)
  list.unshift(entry)
  commit(list, false)
}

export function recordHistory(illustration: PixivIllustration): void {
  recordEntry({ kind: "illust", illustration, viewedAt: Date.now() })
}

export function recordNovelHistory(novel: PixivNovel): void {
  recordEntry({ kind: "novel", novel, viewedAt: Date.now() })
}

export function updateHistoryBookmark(id: number, isBookmarked: boolean): void {
  const list = loadEntries()
  const index = list.findIndex(
    (entry) => entry.kind === "illust" && entry.illustration.id === id
  )
  if (index < 0) return
  const next = [...list]
  const entry = next[index] as IllustrationHistoryEntry
  next[index] = {
    ...entry,
    illustration: { ...entry.illustration, is_bookmarked: isBookmarked },
  }
  commit(next, false)
}

export function updateNovelHistoryBookmark(id: number, isBookmarked: boolean): void {
  const list = loadEntries()
  const index = list.findIndex(
    (entry) => entry.kind === "novel" && entry.novel.id === id
  )
  if (index < 0) return
  const next = [...list]
  const entry = next[index] as NovelHistoryEntry
  next[index] = {
    ...entry,
    novel: { ...entry.novel, is_bookmarked: isBookmarked },
  }
  commit(next, false)
}

export function removeHistoryEntry(kind: HistoryEntry["kind"], id: number): void {
  const list = loadEntries()
  const next = list.filter((entry) => {
    if (entry.kind !== kind) return true
    if (entry.kind === "illust") return entry.illustration.id !== id
    return entry.novel.id !== id
  })
  if (next.length !== list.length) commit(next, true)
}

export type HistoryContentKind = "illustration" | "manga" | "novel"

export function clearHistoryKind(kind: HistoryContentKind): void {
  const list = loadEntries()
  const next = list.filter((entry) => {
    if (kind === "novel") return entry.kind !== "novel"
    if (entry.kind !== "illust") return true
    return kind === "manga"
      ? entry.illustration.type !== "manga"
      : entry.illustration.type === "manga"
  })
  if (next.length !== list.length) commit(next, true)
}

export function clearHistory(): void {
  commit([], true)
}
