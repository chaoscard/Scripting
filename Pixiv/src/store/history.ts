// 本地浏览记录：Pixiv 的历史接口需要会员，改为本地记录。
// 插画、漫画和小说共用一个 iCloud 同步文件，按类型分别展示。
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

type StoredHistoryEntry = {
  illustration?: PixivIllustration
  novel?: PixivNovel
  kind?: "illust" | "novel"
  viewedAt?: number
}

const HISTORY_FILE_NAME = "history.json"

let entries: HistoryEntry[] | null = null
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

function persist(next: HistoryEntry[]): boolean {
  try {
    writeTextSafely(historyFilePath(), JSON.stringify(next), (raw) => {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error("历史记录格式错误")
    })
    return true
  } catch (error: any) {
    console.log("history persist error:", error?.message ?? error)
    return false
  }
}

function commit(next: HistoryEntry[]): boolean {
  if (!persist(next)) return false
  entries = next
  emitChanged()
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
  await prepareHistoryStorage()
  entries = null
  emitChanged()
}

function entryKey(entry: HistoryEntry): string {
  return entry.kind === "illust"
    ? `illust:${entry.illustration.id}`
    : `novel:${entry.novel.id}`
}

function parseEntries(rawEntries: StoredHistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>()
  const valid: HistoryEntry[] = []
  for (const raw of rawEntries) {
    const viewedAt = typeof raw?.viewedAt === "number" ? raw.viewedAt : 0
    const entry: HistoryEntry | null = raw?.novel
      ? { kind: "novel", novel: raw.novel, viewedAt }
      : raw?.illustration
        ? { kind: "illust", illustration: raw.illustration, viewedAt }
        : null
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

function recordEntry(entry: HistoryEntry): void {
  if (!loadSettings().recordHistory) return
  const list = [...loadEntries()]
  const key = entryKey(entry)
  const index = list.findIndex((item) => entryKey(item) === key)
  if (index >= 0) list.splice(index, 1)
  list.unshift(entry)
  commit(list)
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
  commit(next)
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
  commit(next)
}

export function removeHistoryEntry(kind: HistoryEntry["kind"], id: number): void {
  const list = loadEntries()
  const next = list.filter((entry) => {
    if (entry.kind !== kind) return true
    if (entry.kind === "illust") return entry.illustration.id !== id
    return entry.novel.id !== id
  })
  if (next.length !== list.length) commit(next)
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
  if (next.length !== list.length) commit(next)
}

export function clearHistory(): void {
  commit([])
}
