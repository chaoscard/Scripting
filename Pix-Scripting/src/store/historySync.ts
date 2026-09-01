// 历史记录与阅读进度 iCloud 低频双向同步引擎
// 5 个独立同构文件按需低频同步，支持 5条阈值 + 10秒空闲 + 30秒兜底多维触发与 Tombstone（30天TTL）机制。
import {
  pixivCloudHistoryDirectory,
  pixivHistoryDirectory,
} from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import { session } from "../api/session"
import {
  clearHistoryMemoryCache,
  flushHistory,
  getHistory,
  historyFilePath,
  loadKindEntries,
  onHistoryChanged,
  parseRawEntriesForKind,
  replaceKindEntries,
  toStoredEntry,
  type HistoryContentKind,
  type HistoryEntry,
  type IllustrationHistoryEntry,
  type NovelHistoryEntry,
} from "./history"
import {
  flushNovelProgress,
  getAllNovelProgressMap,
  replaceNovelProgressMap,
  type NovelReadingProgress,
} from "./novelProgress"
import {
  flushSearchHistory,
  getFullSearchHistoryStore,
  replaceSearchHistoryStore,
  type SearchHistoryScope,
  type SearchHistoryStore,
} from "./searchHistory"

export interface HistorySyncState {
  lastSyncTime: number
  tombstones: { [key: string]: number } // "kind:id" -> timestamp
  clearBefore: { [kind in HistoryContentKind]?: number }
}

const SYNC_STATE_FILE = "sync_state.json"
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天
const STARTUP_DELAY_MS = 2000 // 启动 2 秒后静默拉取
const RESUME_DELAY_MS = 2000 // 切回前台 2 秒后检查
const MIN_RESUME_SYNC_INTERVAL_MS = 30 * 1000 // 切回前台最小检查间隔 30 秒

// 多维触发配置
const MUTATION_COUNT_THRESHOLD = 5 // 1. 累计 5 条变更立即触发同步
const IDLE_SYNC_DELAY_MS = 10 * 1000 // 2. 前台操作停止空闲 10 秒后自动同步
const MAX_WAIT_THROTTLE_MS = 30 * 1000 // 3. 自首次变更起，最多 30 秒兜底强制同步
const AUTO_SYNC_FALLBACK_INTERVAL_MS = 60 * 1000 // 前台轮询兜底周期 60 秒

let isSyncing = false
let schedulerTimer: ReturnType<typeof setTimeout> | null = null
let idleSyncTimer: ReturnType<typeof setTimeout> | null = null
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null
let isSchedulerRunning = false
let pendingMutationCount = 0
let firstMutationTime = 0

function syncStateFilePath(userId?: string | number | null): string {
  return `${pixivHistoryDirectory(userId)}/${SYNC_STATE_FILE}`
}

function loadSyncState(userId?: string | number | null): HistorySyncState {
  const path = syncStateFilePath(userId)
  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object") {
        return {
          lastSyncTime: typeof parsed.lastSyncTime === "number" ? parsed.lastSyncTime : 0,
          tombstones: parsed.tombstones && typeof parsed.tombstones === "object" ? parsed.tombstones : {},
          clearBefore: parsed.clearBefore && typeof parsed.clearBefore === "object" ? parsed.clearBefore : {},
        }
      }
    }
  } catch {}
  return {
    lastSyncTime: 0,
    tombstones: {},
    clearBefore: {},
  }
}

function saveSyncState(state: HistorySyncState, userId?: string | number | null): void {
  try {
    const path = syncStateFilePath(userId)
    writeTextSafely(path, JSON.stringify(state))
  } catch (e: any) {
    console.warn("saveSyncState failed:", e?.message ?? e)
  }
}

export function recordTombstone(kind: HistoryContentKind, id: number): void {
  const state = loadSyncState()
  state.tombstones[`${kind}:${id}`] = Date.now()
  pruneTombstones(state)
  saveSyncState(state)
  notifyLocalMutation()
}

export function recordClearBefore(kind: HistoryContentKind): void {
  const state = loadSyncState()
  state.clearBefore[kind] = Date.now()
  saveSyncState(state)
  notifyLocalMutation()
}

function resetMutationTracking(): void {
  pendingMutationCount = 0
  firstMutationTime = 0
  if (idleSyncTimer) {
    clearTimeout(idleSyncTimer)
    idleSyncTimer = null
  }
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer)
    maxWaitTimer = null
  }
}

// 当本地 5 项记录（插画/漫画/小说历史、小说进度、搜索历史）中任意一项发生变更时触发：
// 采用「5条阈值立即触发 + 10秒空闲防抖 + 30秒最大等待兜底」多维触发机制
export function notifyLocalMutation(): void {
  pendingMutationCount++
  const now = Date.now()
  if (firstMutationTime === 0) {
    firstMutationTime = now
  }

  // 维度 1：累积 5 条变更立即触发同步
  if (pendingMutationCount >= MUTATION_COUNT_THRESHOLD) {
    resetMutationTracking()
    syncHistoryNow().catch(() => {})
    return
  }

  // 维度 2：达到 30 秒最大等待时间，强制触发兜底同步
  if (now - firstMutationTime >= MAX_WAIT_THROTTLE_MS) {
    resetMutationTracking()
    syncHistoryNow().catch(() => {})
    return
  }

  // 维度 3：重置 10 秒空闲防抖定时器（用户停顿看图 10 秒即触发）
  if (idleSyncTimer) {
    clearTimeout(idleSyncTimer)
    idleSyncTimer = null
  }
  idleSyncTimer = setTimeout(() => {
    idleSyncTimer = null
    resetMutationTracking()
    syncHistoryNow().catch(() => {})
  }, IDLE_SYNC_DELAY_MS)

  // 维度 4：启动 30 秒最大等待兜底计时器
  if (!maxWaitTimer) {
    const remaining = Math.max(0, MAX_WAIT_THROTTLE_MS - (now - firstMutationTime))
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null
      resetMutationTracking()
      syncHistoryNow().catch(() => {})
    }, remaining)
  }
}

function pruneTombstones(state: HistorySyncState): void {
  const threshold = Date.now() - TOMBSTONE_TTL_MS
  for (const [k, ts] of Object.entries(state.tombstones)) {
    if (typeof ts === "number" && ts < threshold) {
      delete state.tombstones[k]
    }
  }
}

async function prepareCloudFile(filePath: string): Promise<boolean> {
  if (!FileManager.existsSync(filePath)) return false
  if (!FileManager.isFileStoredIniCloud(filePath)) return true
  if (FileManager.isiCloudFileDownloaded(filePath)) return true
  try {
    return await FileManager.downloadFileFromiCloud(filePath)
  } catch {
    return false
  }
}

function readCloudJson<T = any>(filePath: string): T | null {
  try {
    recoverFile(filePath)
    if (!FileManager.existsSync(filePath)) return null
    const raw = FileManager.readAsStringSync(filePath, "utf-8")
    if (!raw || !raw.trim()) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// 1. 同步单个历史分类 (illustration / manga / novel)
async function syncHistoryCategory(
  kind: HistoryContentKind,
  localDir: string,
  cloudDir: string,
  state: HistorySyncState,
  userId?: string | number | null
): Promise<void> {
  const fileName =
    kind === "illustration"
      ? "history_illust.json"
      : kind === "manga"
        ? "history_manga.json"
        : "history_novel.json"

  const localFile = `${localDir}/${fileName}`
  const cloudFile = `${cloudDir}/${fileName}`

  // 读取本地已缓存的 entries
  const localEntries = loadKindEntries(kind)
  const localStored = localEntries.map(toStoredEntry)

  // 读取云端
  await prepareCloudFile(cloudFile)
  const cloudRaw = readCloudJson<any[]>(cloudFile)
  const cloudStored: any[] = Array.isArray(cloudRaw) ? cloudRaw : []

  // 内存双向合并
  const map = new Map<number, any>()
  const tombstones = state.tombstones
  const clearBeforeTs = state.clearBefore[kind] ?? 0

  // 放入本地
  for (const entry of localStored) {
    const id = entry.kind === "illust" ? entry.illustration?.id : entry.novel?.id
    if (!id) continue
    const key = `${kind}:${id}`
    if (tombstones[key] && entry.viewedAt <= tombstones[key]) continue
    if (clearBeforeTs > 0 && entry.viewedAt <= clearBeforeTs) continue
    map.set(id, entry)
  }

  // 放入云端
  for (const entry of cloudStored) {
    const id = entry.kind === "illust" ? entry.illustration?.id : entry.novel?.id
    if (!id) continue
    const key = `${kind}:${id}`
    if (tombstones[key] && entry.viewedAt <= tombstones[key]) continue
    if (clearBeforeTs > 0 && entry.viewedAt <= clearBeforeTs) continue

    const existing = map.get(id)
    if (!existing || (typeof entry.viewedAt === "number" && entry.viewedAt > existing.viewedAt)) {
      map.set(id, entry)
    } else if (existing) {
      // 收藏状态兜底保护
      if (entry.kind === "illust" && entry.illustration?.is_bookmarked && existing.illustration) {
        existing.illustration.is_bookmarked = true
      } else if (entry.kind === "novel" && entry.novel?.is_bookmarked && existing.novel) {
        existing.novel.is_bookmarked = true
      }
    }
  }

  const mergedStored = Array.from(map.values()).sort((a, b) => b.viewedAt - a.viewedAt)
  const localDecoded = parseRawEntriesForKind(kind, mergedStored)

  // 比对并更新本地
  const localJson = JSON.stringify(localStored)
  const mergedJson = JSON.stringify(mergedStored)
  if (localJson !== mergedJson) {
    replaceKindEntries(kind, localDecoded as any, true)
  }

  // 比对并更新云端
  const cloudJson = JSON.stringify(cloudStored)
  if (cloudJson !== mergedJson) {
    try {
      writeTextSafely(cloudFile, mergedJson)
    } catch (e: any) {
      console.warn(`write cloud history for ${kind} error:`, e?.message ?? e)
    }
  }
}

// 2. 同步小说进度 (novel_progress.json)
async function syncNovelProgressFile(
  localDir: string,
  cloudDir: string,
  userId?: string | number | null
): Promise<void> {
  const fileName = "novel_progress.json"
  const localFile = `${localDir}/${fileName}`
  const cloudFile = `${cloudDir}/${fileName}`

  const localMap = getAllNovelProgressMap()
  const localList = Array.from(localMap.values())

  await prepareCloudFile(cloudFile)
  const cloudRaw = readCloudJson<NovelReadingProgress[]>(cloudFile)
  const cloudList: NovelReadingProgress[] = Array.isArray(cloudRaw) ? cloudRaw : []

  const map = new Map<number, NovelReadingProgress>()
  for (const item of localList) {
    if (item && item.novelID > 0) {
      map.set(item.novelID, item)
    }
  }
  for (const item of cloudList) {
    if (item && item.novelID > 0) {
      const existing = map.get(item.novelID)
      if (!existing || (typeof item.updatedAt === "number" && item.updatedAt > existing.updatedAt)) {
        map.set(item.novelID, item)
      }
    }
  }

  const mergedList = Array.from(map.values())
  const localJson = JSON.stringify(localList)
  const mergedJson = JSON.stringify(mergedList)

  if (localJson !== mergedJson) {
    replaceNovelProgressMap(map, true)
  }

  const cloudJson = JSON.stringify(cloudList)
  if (cloudJson !== mergedJson) {
    try {
      writeTextSafely(cloudFile, mergedJson)
    } catch (e: any) {
      console.warn("write cloud novel progress error:", e?.message ?? e)
    }
  }
}

// 3. 同步搜索历史 (search_history.json)
async function syncSearchHistoryFile(
  localDir: string,
  cloudDir: string,
  userId?: string | number | null
): Promise<void> {
  const fileName = "search_history.json"
  const localFile = `${localDir}/${fileName}`
  const cloudFile = `${cloudDir}/${fileName}`

  const localStore = getFullSearchHistoryStore()

  await prepareCloudFile(cloudFile)
  const cloudRaw = readCloudJson<any>(cloudFile)
  const cloudStore: SearchHistoryStore = {
    illust: Array.isArray(cloudRaw?.illust) ? cloudRaw.illust : [],
    novel: Array.isArray(cloudRaw?.novel) ? cloudRaw.novel : [],
    user: Array.isArray(cloudRaw?.user) ? cloudRaw.user : [],
  }

  function mergeScopeList(localArr: string[], cloudArr: string[]): string[] {
    const set = new Set<string>()
    const result: string[] = []
    for (const it of localArr) {
      const trimmed = typeof it === "string" ? it.trim() : ""
      if (trimmed && !set.has(trimmed)) {
        set.add(trimmed)
        result.push(trimmed)
      }
    }
    for (const it of cloudArr) {
      const trimmed = typeof it === "string" ? it.trim() : ""
      if (trimmed && !set.has(trimmed)) {
        set.add(trimmed)
        result.push(trimmed)
      }
    }
    return result
  }

  const mergedStore: SearchHistoryStore = {
    illust: mergeScopeList(localStore.illust, cloudStore.illust),
    novel: mergeScopeList(localStore.novel, cloudStore.novel),
    user: mergeScopeList(localStore.user, cloudStore.user),
  }

  const localJson = JSON.stringify(localStore)
  const mergedJson = JSON.stringify(mergedStore)

  if (localJson !== mergedJson) {
    replaceSearchHistoryStore(mergedStore, true)
  }

  const cloudJson = JSON.stringify(cloudStore)
  if (cloudJson !== mergedJson) {
    try {
      writeTextSafely(cloudFile, mergedJson)
    } catch (e: any) {
      console.warn("write cloud search history error:", e?.message ?? e)
    }
  }
}

// 统一立即同步入口（用于下拉刷新或定时调度）
export async function syncHistoryNow(userId?: string | number | null): Promise<boolean> {
  if (isSyncing) return false
  const cloudDir = pixivCloudHistoryDirectory(userId)
  if (!cloudDir) return false

  isSyncing = true
  try {
    // 1. 同步前先强制刷盘本地所有未持久化数据
    flushHistory()
    flushNovelProgress()
    flushSearchHistory()

    const localDir = pixivHistoryDirectory(userId)
    const state = loadSyncState(userId)
    pruneTombstones(state)

    // 2. 依次同步 5 个独立文件
    await syncHistoryCategory("illustration", localDir, cloudDir, state, userId)
    await syncHistoryCategory("manga", localDir, cloudDir, state, userId)
    await syncHistoryCategory("novel", localDir, cloudDir, state, userId)
    await syncNovelProgressFile(localDir, cloudDir, userId)
    await syncSearchHistoryFile(localDir, cloudDir, userId)

    // 3. 更新同步状态与清空变更计数
    state.lastSyncTime = Date.now()
    saveSyncState(state, userId)
    resetMutationTracking()
    return true
  } catch (error: any) {
    console.warn("syncHistoryNow error:", error?.message ?? error)
    return false
  } finally {
    isSyncing = false
  }
}

// 启动后台低频同步调度器
export function startHistorySyncScheduler(): () => void {
  isSchedulerRunning = true

  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }

  // 启动 2 秒后延迟执行一次静默拉取
  schedulerTimer = setTimeout(() => {
    syncHistoryNow().catch(() => {})
  }, STARTUP_DELAY_MS)

  // 循环调度：定期检查
  function scheduleNextCheck() {
    if (!isSchedulerRunning) return
    schedulerTimer = setTimeout(async () => {
      if (!isSchedulerRunning) return
      try {
        const state = loadSyncState()
        if (pendingMutationCount > 0 || Date.now() - state.lastSyncTime >= AUTO_SYNC_FALLBACK_INTERVAL_MS) {
          await syncHistoryNow()
        }
      } catch {}
      if (isSchedulerRunning) {
        scheduleNextCheck()
      }
    }, 15000)
  }

  scheduleNextCheck()

  return () => {
    isSchedulerRunning = false
    if (schedulerTimer) {
      clearTimeout(schedulerTimer)
      schedulerTimer = null
    }
    resetMutationTracking()
  }
}

// 切回前台时的同步检查：满 30 秒后延迟 2 秒拉取
export function triggerResumeSync(): void {
  const state = loadSyncState()
  if (Date.now() - state.lastSyncTime >= MIN_RESUME_SYNC_INTERVAL_MS) {
    setTimeout(() => {
      syncHistoryNow().catch(() => {})
    }, RESUME_DELAY_MS)
  }
}
