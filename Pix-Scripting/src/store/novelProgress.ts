import { pixivHistoryDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

export interface NovelReadingProgress {
  novelID: number
  page: number
  chunkId?: string
  updatedAt: number
}

const PROGRESS_FILE_NAME = "novel_progress.json"
const DEBOUNCE_DELAY_MS = 1000

let progressCache: Map<number, NovelReadingProgress> | null = null
let isDirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

function progressFilePath(): string {
  return `${pixivHistoryDirectory()}/${PROGRESS_FILE_NAME}`
}

function loadProgressSync(): Map<number, NovelReadingProgress> {
  if (progressCache !== null) return progressCache
  const path = progressFilePath()
  const map = new Map<number, NovelReadingProgress>()
  try {
    if (FileManager.existsSync(path)) {
      const content = FileManager.readAsStringSync(path)
      if (content && content.trim().length > 0) {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item.novelID === "number" && item.novelID > 0) {
              map.set(item.novelID, {
                novelID: item.novelID,
                page: Math.max(1, Number(item.page) || 1),
                chunkId: typeof item.chunkId === "string" ? item.chunkId : undefined,
                updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
              })
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("load novel progress failed:", err)
    recoverFile(path)
  }
  progressCache = map
  return progressCache
}

export async function prepareNovelProgressStorage(): Promise<void> {
  if (!FileManager.isiCloudEnabled) return
  const path = progressFilePath()
  if (
    !FileManager.existsSync(path) ||
    !FileManager.isFileStoredIniCloud(path) ||
    FileManager.isiCloudFileDownloaded(path)
  ) {
    return
  }
  try {
    await FileManager.downloadFileFromiCloud(path)
  } catch {}
}

export function getNovelProgress(novelID: number): NovelReadingProgress | undefined {
  if (!novelID || novelID <= 0) return undefined
  const map = loadProgressSync()
  return map.get(novelID)
}

function persistSync(map: Map<number, NovelReadingProgress>): boolean {
  try {
    const list = Array.from(map.values())
    writeTextSafely(progressFilePath(), JSON.stringify(list), (raw) => {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error("阅读进度格式错误")
    })
    isDirty = false
    return true
  } catch (error: any) {
    console.warn("novel progress persist error:", error?.message ?? error)
    return false
  }
}

export function flushNovelProgress(): boolean {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!isDirty || !progressCache) return true
  return persistSync(progressCache)
}

export function recordNovelProgress(
  novelID: number,
  page: number,
  chunkId?: string,
  immediate = false
): void {
  if (!novelID || novelID <= 0) return
  const map = loadProgressSync()
  const existing = map.get(novelID)

  if (existing && existing.page === page && existing.chunkId === chunkId) {
    return
  }

  map.set(novelID, {
    novelID,
    page: Math.max(1, page),
    chunkId,
    updatedAt: Date.now(),
  })
  isDirty = true

  if (immediate) {
    flushNovelProgress()
    return
  }

  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushNovelProgress()
  }, DEBOUNCE_DELAY_MS)
}

export function clearNovelProgress(novelID?: number): void {
  const map = loadProgressSync()
  if (novelID) {
    map.delete(novelID)
  } else {
    map.clear()
  }
  isDirty = true
  flushNovelProgress()
}
