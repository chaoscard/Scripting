import { pixivPixivisionBookmarkDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import { session } from "../api/session"

export interface PixivisionBookmarkItem {
  id: number
  title: string
  thumbnailURL?: string
  category?: string
  categoryLabel?: string
  publishedAt?: string
  tags?: string[]
  bookmarkedAt: number
}

const PIXIVISION_BOOKMARKS_FILE_NAME = "pixivision_bookmarks.json"

let cachedBookmarks: PixivisionBookmarkItem[] | null = null
const listeners = new Set<() => void>()

export function clearPixivisionBookmarksCache(): void {
  cachedBookmarks = null
  emitChanged()
}

function bookmarksFilePath(userId?: string | number | null): string {
  return `${pixivPixivisionBookmarkDirectory(userId ?? session.userID)}/${PIXIVISION_BOOKMARKS_FILE_NAME}`
}

export async function preparePixivisionBookmarksStorage(
  userId?: string | number | null
): Promise<void> {
  if (!FileManager.isiCloudEnabled) return
  const path = bookmarksFilePath(userId)
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

function emitChanged(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener()
    } catch {
      // 避免个别监听器异常中断广播
    }
  }
}

export function onPixivisionBookmarksChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function loadPixivisionBookmarks(userId?: string | number | null): PixivisionBookmarkItem[] {
  if (cachedBookmarks !== null) {
    return cachedBookmarks
  }
  const path = bookmarksFilePath(userId)
  recoverFile(path)
  if (!FileManager.existsSync(path)) {
    cachedBookmarks = []
    return cachedBookmarks
  }
  try {
    const text = FileManager.readAsStringSync(path)
    if (!text || !text.trim()) {
      cachedBookmarks = []
      return cachedBookmarks
    }
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      cachedBookmarks = parsed.filter(
        (item) => item && typeof item.id === "number" && item.id > 0
      )
    } else {
      cachedBookmarks = []
    }
  } catch {
    cachedBookmarks = []
  }
  return cachedBookmarks
}

export function isPixivisionBookmarked(
  articleId: number,
  userId?: string | number | null
): boolean {
  if (!articleId || articleId <= 0) return false
  const list = loadPixivisionBookmarks(userId)
  return list.some((item) => item.id === articleId)
}

function persistBookmarks(
  items: PixivisionBookmarkItem[],
  userId?: string | number | null
): void {
  cachedBookmarks = items
  const path = bookmarksFilePath(userId)
  try {
    writeTextSafely(path, JSON.stringify(items, null, 2))
  } catch {
    // 写入异常静默恢复
  }
  emitChanged()
}

export function addPixivisionBookmark(
  item: PixivisionBookmarkItem,
  userId?: string | number | null
): void {
  if (!item.id || item.id <= 0) return
  const current = loadPixivisionBookmarks(userId)
  const filtered = current.filter((x) => x.id !== item.id)
  const updated: PixivisionBookmarkItem = {
    ...item,
    bookmarkedAt: item.bookmarkedAt || Date.now(),
  }
  // 最新的插在前面
  persistBookmarks([updated, ...filtered], userId)
}

export function removePixivisionBookmark(
  articleId: number,
  userId?: string | number | null
): void {
  if (!articleId || articleId <= 0) return
  const current = loadPixivisionBookmarks(userId)
  const filtered = current.filter((x) => x.id !== articleId)
  if (filtered.length !== current.length) {
    persistBookmarks(filtered, userId)
  }
}

export function togglePixivisionBookmark(
  item: PixivisionBookmarkItem,
  userId?: string | number | null
): boolean {
  if (!item.id || item.id <= 0) return false
  const bookmarked = isPixivisionBookmarked(item.id, userId)
  if (bookmarked) {
    removePixivisionBookmark(item.id, userId)
    return false
  } else {
    addPixivisionBookmark(item, userId)
    return true
  }
}
