// 历史记录与阅读进度 iCloud 低频双向同步引擎
// 5 个独立同构文件按需低频同步，支持 15条阈值 + 10秒空闲 + 30秒兜底多维触发、互斥锁与在途变更尾随排队（Trailing Queue）及 Tombstone（30天TTL）机制。
import {
  pixivCloudHistoryDirectory,
  pixivHistoryDirectory,
  resolveEffectiveUID,
} from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import { session } from "../api/session"
import {
  clearHistoryMemoryCache,
  flushHistory,
  getHistory,
  getHistoryLimitForKind,
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
  MAX_SEARCH_HISTORY_ITEMS,
  normalizeHistoryEntries,
  replaceSearchHistoryStore,
  type SearchHistoryEntry,
  type SearchHistoryScope,
  type SearchHistoryStore,
} from "./searchHistory"

export interface HistorySyncState {
  lastSyncTime: number
  tombstones: { [key: string]: number } // "kind:id" -> timestamp
  clearBefore: { [kind in HistoryContentKind]?: number }
  searchTombstones?: { [key: string]: number } // "scope:query" -> timestamp
  searchClearBefore?: { [scope in SearchHistoryScope]?: number } // scope -> timestamp
}

const SYNC_STATE_FILE = "sync_state.json"
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天
const STARTUP_DELAY_MS = 2000 // 启动 2 秒后静默拉取
const RESUME_DELAY_MS = 2000 // 切回前台 2 秒后检查
const MIN_RESUME_SYNC_INTERVAL_MS = 30 * 1000 // 切回前台最小检查间隔 30 秒

// 多维触发配置
const MUTATION_COUNT_THRESHOLD = 15 // 1. 累计 15 条变更立即触发同步
const IDLE_SYNC_DELAY_MS = 10 * 1000 // 2. 前台操作停止空闲 10 秒后自动同步
const MAX_WAIT_THROTTLE_MS = 30 * 1000 // 3. 自首次变更起，最多 30 秒兜底强制同步
const AUTO_SYNC_FALLBACK_INTERVAL_MS = 60 * 1000 // 前台轮询兜底周期 60 秒

// 单飞互斥锁与尾随排队标记
let isSyncing = false
let hasQueuedSync = false
let queuedUserId: string | number | null | undefined = undefined
let activeSyncAccount: { uid: string; generation: number } | null = null

// store 内存属于当前账号；固定目录的同步任务不得跨会话读取或提交。
function assertSyncAccount(userId?: string | number | null): void {
  const uid = resolveEffectiveUID()
  if (
    resolveEffectiveUID(userId) !== uid ||
    (activeSyncAccount && (
      activeSyncAccount.uid !== uid || activeSyncAccount.generation !== session.currentGeneration
    ))
  ) {
    throw new Error("历史同步账号已变更")
  }
}

let startupTimer: ReturnType<typeof setTimeout> | null = null
let schedulerTimer: ReturnType<typeof setTimeout> | null = null
let idleSyncTimer: ReturnType<typeof setTimeout> | null = null
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null
const deferredSyncTimers = new Set<ReturnType<typeof setTimeout>>()
let schedulerGeneration = 0
let isSchedulerStopped = false
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
          searchTombstones:
            parsed.searchTombstones && typeof parsed.searchTombstones === "object" ? parsed.searchTombstones : {},
          searchClearBefore:
            parsed.searchClearBefore && typeof parsed.searchClearBefore === "object" ? parsed.searchClearBefore : {},
        }
      }
    }
  } catch {}
  return {
    lastSyncTime: 0,
    tombstones: {},
    clearBefore: {},
    searchTombstones: {},
    searchClearBefore: {},
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

export function recordSearchTombstone(scope: SearchHistoryScope, query: string): void {
  const trimmed = typeof query === "string" ? query.trim() : ""
  if (!trimmed) return
  const state = loadSyncState()
  if (!state.searchTombstones) {
    state.searchTombstones = {}
  }
  state.searchTombstones[`${scope}:${trimmed}`] = Date.now()
  pruneTombstones(state)
  saveSyncState(state)
  notifyLocalMutation()
}

export function removeSearchTombstone(scope: SearchHistoryScope, query: string): void {
  const trimmed = typeof query === "string" ? query.trim() : ""
  if (!trimmed) return
  const state = loadSyncState()
  const key = `${scope}:${trimmed}`
  if (state.searchTombstones && typeof state.searchTombstones[key] === "number") {
    delete state.searchTombstones[key]
    saveSyncState(state)
  }
}

export function recordSearchClearBefore(scope: SearchHistoryScope): void {
  const state = loadSyncState()
  if (!state.searchClearBefore) {
    state.searchClearBefore = {}
  }
  state.searchClearBefore[scope] = Date.now()
  // 顺便清空该 scope 下的所有已有单条墓碑，避免墓碑膨胀
  if (state.searchTombstones) {
    const prefix = `${scope}:`
    for (const key of Object.keys(state.searchTombstones)) {
      if (key.startsWith(prefix)) {
        delete state.searchTombstones[key]
      }
    }
  }
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
// 采用「15条阈值立即触发 + 10秒空闲防抖 + 30秒最大等待兜底 + 执行中排队尾随」机制
export function notifyLocalMutation(): void {
  // 若未启用 iCloud 或调度器已停止，不再创建自动同步任务；本地落盘不受影响。
  if (!FileManager.isiCloudEnabled || isSchedulerStopped) {
    return
  }

  pendingMutationCount++
  const now = Date.now()
  if (firstMutationTime === 0) {
    firstMutationTime = now
  }

  // 若当前正在执行同步，标记尾随排队，确保本轮执行完毕后自动无缝触发下一轮补跑
  if (isSyncing) {
    hasQueuedSync = true
  }

  // 维度 1：累积 15 条变更立即触发同步
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
  const idleTimer = setTimeout(() => {
    if (idleSyncTimer !== idleTimer || isSchedulerStopped) return
    idleSyncTimer = null
    resetMutationTracking()
    syncHistoryNow().catch(() => {})
  }, IDLE_SYNC_DELAY_MS)
  idleSyncTimer = idleTimer

  // 维度 4：启动 30 秒最大等待兜底计时器
  if (!maxWaitTimer) {
    const remaining = Math.max(0, MAX_WAIT_THROTTLE_MS - (now - firstMutationTime))
    const waitTimer = setTimeout(() => {
      if (maxWaitTimer !== waitTimer || isSchedulerStopped) return
      maxWaitTimer = null
      resetMutationTracking()
      syncHistoryNow().catch(() => {})
    }, remaining)
    maxWaitTimer = waitTimer
  }
}

function pruneTombstones(state: HistorySyncState): void {
  const threshold = Date.now() - TOMBSTONE_TTL_MS
  for (const [k, ts] of Object.entries(state.tombstones)) {
    if (typeof ts === "number" && ts < threshold) {
      delete state.tombstones[k]
    }
  }
  if (state.searchTombstones) {
    for (const [k, ts] of Object.entries(state.searchTombstones)) {
      if (typeof ts === "number" && ts < threshold) {
        delete state.searchTombstones[k]
      }
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

// 合并项直接来自两侧数组；顺序及引用一致时无需再序列化。其它情况仍按原 JSON
// 完整比较（不省略字段、不改变键序语义），合并 JSON 只在确实需要时生成一次。
function sameSyncEntries(
  entries: readonly unknown[],
  merged: readonly unknown[],
  mergedJson: () => string
): boolean {
  return entries.length === merged.length && (
    entries.every((entry, index) => entry === merged[index]) ||
    JSON.stringify(entries) === mergedJson()
  )
}

function sameRecord(left?: Record<string, number>, right?: Record<string, number>): boolean {
  const leftKeys = Object.keys(left ?? {})
  const rightKeys = Object.keys(right ?? {})
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => left?.[key] === right?.[key])
}

// 0. 同步同步元数据文件 (sync_state.json)：墓碑与清空水位线的云端双向聚合
async function syncSyncStateFile(
  localDir: string,
  cloudDir: string,
  userId?: string | number | null
): Promise<HistorySyncState> {
  const fileName = SYNC_STATE_FILE
  const localFile = `${localDir}/${fileName}`
  const cloudFile = `${cloudDir}/${fileName}`

  await prepareCloudFile(cloudFile)
  assertSyncAccount(userId)

  const localState = loadSyncState(userId)
  pruneTombstones(localState)

  const cloudRaw = readCloudJson<any>(cloudFile)
  const cloudState: HistorySyncState = {
    lastSyncTime: typeof cloudRaw?.lastSyncTime === "number" ? cloudRaw.lastSyncTime : 0,
    tombstones: cloudRaw?.tombstones && typeof cloudRaw.tombstones === "object" ? cloudRaw.tombstones : {},
    clearBefore: cloudRaw?.clearBefore && typeof cloudRaw.clearBefore === "object" ? cloudRaw.clearBefore : {},
    searchTombstones: cloudRaw?.searchTombstones && typeof cloudRaw.searchTombstones === "object" ? cloudRaw.searchTombstones : {},
    searchClearBefore: cloudRaw?.searchClearBefore && typeof cloudRaw.searchClearBefore === "object" ? cloudRaw.searchClearBefore : {},
  }
  pruneTombstones(cloudState)

  const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000
  const now = Date.now()

  // 1. 合并插画/漫画/小说浏览历史单条删除墓碑
  const mergedTombstones: Record<string, number> = {}
  for (const src of [localState.tombstones, cloudState.tombstones]) {
    if (!src) continue
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "number" && !isNaN(v) && now - v <= TOMBSTONE_TTL) {
        mergedTombstones[k] = Math.max(mergedTombstones[k] ?? 0, v)
      }
    }
  }

  // 2. 合并浏览历史分类清空水位线
  const mergedClearBefore: Partial<Record<HistoryContentKind, number>> = {}
  for (const src of [localState.clearBefore, cloudState.clearBefore]) {
    if (!src) continue
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "number" && !isNaN(v)) {
        mergedClearBefore[k as HistoryContentKind] = Math.max(mergedClearBefore[k as HistoryContentKind] ?? 0, v)
      }
    }
  }

  // 3. 合并搜索历史墓碑与水位线
  const mergedSearchTombstones: Record<string, number> = {}
  for (const src of [localState.searchTombstones, cloudState.searchTombstones]) {
    if (!src) continue
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "number" && !isNaN(v) && now - v <= TOMBSTONE_TTL) {
        mergedSearchTombstones[k] = Math.max(mergedSearchTombstones[k] ?? 0, v)
      }
    }
  }

  const mergedSearchClearBefore: Partial<Record<SearchHistoryScope, number>> = {}
  for (const src of [localState.searchClearBefore, cloudState.searchClearBefore]) {
    if (!src) continue
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "number" && !isNaN(v)) {
        mergedSearchClearBefore[k as SearchHistoryScope] = Math.max(mergedSearchClearBefore[k as SearchHistoryScope] ?? 0, v)
      }
    }
  }

  const mergedState: HistorySyncState = {
    lastSyncTime: Math.max(localState.lastSyncTime, cloudState.lastSyncTime),
    tombstones: mergedTombstones,
    clearBefore: mergedClearBefore,
    searchTombstones: mergedSearchTombstones,
    searchClearBefore: mergedSearchClearBefore,
  }

  const localChanged =
    !sameRecord(localState.tombstones, mergedTombstones) ||
    !sameRecord(localState.clearBefore as any, mergedClearBefore as any) ||
    !sameRecord(localState.searchTombstones, mergedSearchTombstones) ||
    !sameRecord(localState.searchClearBefore as any, mergedSearchClearBefore as any)

  const cloudChanged =
    !sameRecord(cloudState.tombstones, mergedTombstones) ||
    !sameRecord(cloudState.clearBefore as any, mergedClearBefore as any) ||
    !sameRecord(cloudState.searchTombstones, mergedSearchTombstones) ||
    !sameRecord(cloudState.searchClearBefore as any, mergedSearchClearBefore as any)

  if (localChanged) {
    saveSyncState(mergedState, userId)
  }

  if (cloudChanged || !FileManager.existsSync(cloudFile)) {
    try {
      writeTextSafely(cloudFile, JSON.stringify(mergedState))
    } catch (e: any) {
      console.warn("write cloud sync_state error:", e?.message ?? e)
    }
  }

  return mergedState
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

  // 云端准备期间仍可浏览、删除或清空；在本分支唯一的 await 后取最新本地快照和墓碑。
  await prepareCloudFile(cloudFile)
  assertSyncAccount(userId)
  const localEntries = loadKindEntries(kind)
  const localStored = localEntries.map(toStoredEntry)
  const freshState = loadSyncState(userId)
  pruneTombstones(freshState)
  const cloudRaw = readCloudJson<any[]>(cloudFile)
  const cloudStored: any[] = Array.isArray(cloudRaw) ? cloudRaw : []

  // 内存双向合并
  const map = new Map<number, any>()
  const tombstones = { ...state.tombstones, ...freshState.tombstones }
  const clearBeforeTs = Math.max(state.clearBefore[kind] ?? 0, freshState.clearBefore[kind] ?? 0)

  // 放入本地
  for (const entry of localStored) {
    const id = entry.kind === "illust" ? entry.illustration?.id : entry.novel?.id
    if (!id) continue
    const key = `${kind}:${id}`
    if (tombstones[key] && entry.viewedAt <= tombstones[key]) continue
    if (clearBeforeTs > 0 && entry.viewedAt <= clearBeforeTs) continue
    if (tombstones[key] && entry.viewedAt > tombstones[key]) {
      delete tombstones[key]
    }
    map.set(id, entry)
  }

  // 放入云端
  for (const entry of cloudStored) {
    const id = entry.kind === "illust" ? entry.illustration?.id : entry.novel?.id
    if (!id) continue
    const key = `${kind}:${id}`
    if (tombstones[key] && entry.viewedAt <= tombstones[key]) continue
    if (clearBeforeTs > 0 && entry.viewedAt <= clearBeforeTs) continue
    if (tombstones[key] && entry.viewedAt > tombstones[key]) {
      delete tombstones[key]
    }

    const existing = map.get(id)
    if (!existing || (typeof entry.viewedAt === "number" && entry.viewedAt > existing.viewedAt)) {
      map.set(id, entry)
    }
  }

  const maxLimit = getHistoryLimitForKind(kind)
  const mergedStored = Array.from(map.values())
    .sort((a, b) => b.viewedAt - a.viewedAt)
    .slice(0, maxLimit)
  let mergedJson: string | undefined
  const getMergedJson = () => mergedJson ?? (mergedJson = JSON.stringify(mergedStored))

  // 只有本地确实变化时才 inflate，避免无变化同步重建全部作品模型。
  if (!sameSyncEntries(localStored, mergedStored, getMergedJson)) {
    const localDecoded = parseRawEntriesForKind(kind, mergedStored)
    replaceKindEntries(kind, localDecoded as any, true)
  }

  // 仍逐轮检查远端，不以本地脏状态跳过他端更新。
  if (!sameSyncEntries(cloudStored, mergedStored, getMergedJson)) {
    try {
      writeTextSafely(cloudFile, getMergedJson())
    } catch (e: any) {
      console.warn(`write cloud history for ${kind} error:`, e?.message ?? e)
    }
  }

  // 同步结束后将可能消费/抹除的墓碑写回状态与本地磁盘
  freshState.tombstones = { ...tombstones }
  state.tombstones = { ...tombstones }
  saveSyncState(freshState, userId)
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

  await prepareCloudFile(cloudFile)
  assertSyncAccount(userId)
  // 阅读器可在云文件下载期间推进页码，不使用 await 前的旧进度覆盖它。
  const localMap = getAllNovelProgressMap()
  const localList = Array.from(localMap.values())
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
  let mergedJson: string | undefined
  const getMergedJson = () => mergedJson ?? (mergedJson = JSON.stringify(mergedList))

  if (!sameSyncEntries(localList, mergedList, getMergedJson)) {
    replaceNovelProgressMap(map, true)
  }

  if (!sameSyncEntries(cloudList, mergedList, getMergedJson)) {
    try {
      writeTextSafely(cloudFile, getMergedJson())
    } catch (e: any) {
      console.warn("write cloud novel progress error:", e?.message ?? e)
    }
  }
}

// 3. 同步搜索历史 (search_history.json)
async function syncSearchHistoryFile(
  localDir: string,
  cloudDir: string,
  state: HistorySyncState,
  userId?: string | number | null
): Promise<void> {
  const fileName = "search_history.json"
  const localFile = `${localDir}/${fileName}`
  const cloudFile = `${cloudDir}/${fileName}`

  await prepareCloudFile(cloudFile)
  assertSyncAccount(userId)
  // 云端准备期间本地仍可变更；在本分支唯一的 await 之后再取快照。
  const localStore = getFullSearchHistoryStore()
  const localUpdated = typeof localStore.updatedAt === "number" ? localStore.updatedAt : 0
  const cloudRaw = readCloudJson<any>(cloudFile)
  const cloudUpdated = typeof cloudRaw?.updatedAt === "number" ? cloudRaw.updatedAt : 0

  // 云端原始数据归一化（旧顶层数组归入 illust，与本地读取规则一致；同步解析携带的墓碑与清空水位线）。
  const cloudTombstones =
    cloudRaw?.tombstones && typeof cloudRaw.tombstones === "object"
      ? (cloudRaw.tombstones as Record<string, number>)
      : undefined
  const cloudClearBefore =
    cloudRaw?.clearBefore && typeof cloudRaw.clearBefore === "object"
      ? (cloudRaw.clearBefore as Record<string, number>)
      : undefined

  const cloudStore: SearchHistoryStore = {
    illust: normalizeHistoryEntries(Array.isArray(cloudRaw) ? cloudRaw : cloudRaw?.illust, cloudUpdated),
    novel: normalizeHistoryEntries(cloudRaw?.novel, cloudUpdated),
    user: normalizeHistoryEntries(cloudRaw?.user, cloudUpdated),
    updatedAt: cloudUpdated,
    tombstones: cloudTombstones,
    clearBefore: cloudClearBefore,
  }

  // 动态合并最新磁盘与跨端状态：四方墓碑与清空水位线聚合（内存快照、本地磁盘、本地store、云端store）
  const freshState = loadSyncState(userId)
  const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000
  const nowTs = Date.now()

  const searchTombstones: Record<string, number> = {}
  for (const src of [
    state.searchTombstones,
    freshState.searchTombstones,
    localStore.tombstones,
    cloudStore.tombstones,
  ]) {
    if (!src) continue
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "number" && !isNaN(v) && nowTs - v <= TOMBSTONE_TTL) {
        searchTombstones[k] = Math.max(searchTombstones[k] ?? 0, v)
      }
    }
  }

  const searchClearBefore: Record<string, number> = {}
  for (const src of [
    state.searchClearBefore,
    freshState.searchClearBefore,
    localStore.clearBefore,
    cloudStore.clearBefore,
  ]) {
    if (!src) continue
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "number" && !isNaN(v)) {
        searchClearBefore[k] = Math.max(searchClearBefore[k] ?? 0, v)
      }
    }
  }

  // 双向增量合并（基于独立 searchedAt 与单条墓碑/清空水位线精确比对，杜绝僵尸词复活）
  function mergeScopeEntries(
    scope: SearchHistoryScope,
    localEntries: SearchHistoryEntry[],
    cloudEntries: SearchHistoryEntry[]
  ): SearchHistoryEntry[] {
    const clearBeforeTs = searchClearBefore[scope] ?? 0
    const map = new Map<string, SearchHistoryEntry>()

    // 1. 本地条目（过滤处于清空水位线或删除墓碑之前的条目）
    for (const entry of localEntries) {
      const query = entry.query.trim()
      if (!query) continue
      if (clearBeforeTs > 0 && entry.searchedAt <= clearBeforeTs) continue
      const tombstoneTs = searchTombstones[`${scope}:${query}`] ?? 0
      if (tombstoneTs > 0 && entry.searchedAt <= tombstoneTs) continue
      // 若用户后续重新主动搜索（searchedAt > tombstoneTs），清除旧墓碑
      if (tombstoneTs > 0 && entry.searchedAt > tombstoneTs) {
        delete searchTombstones[`${scope}:${query}`]
      }

      map.set(query, entry)
    }

    // 2. 云端条目（过滤处于清空水位线或删除墓碑之前的条目，取较新版本）
    for (const entry of cloudEntries) {
      const query = entry.query.trim()
      if (!query) continue
      if (clearBeforeTs > 0 && entry.searchedAt <= clearBeforeTs) continue
      const tombstoneTs = searchTombstones[`${scope}:${query}`] ?? 0
      if (tombstoneTs > 0 && entry.searchedAt <= tombstoneTs) continue
      if (tombstoneTs > 0 && entry.searchedAt > tombstoneTs) {
        delete searchTombstones[`${scope}:${query}`]
      }

      const existing = map.get(query)
      if (!existing || entry.searchedAt > existing.searchedAt) {
        map.set(query, entry)
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.searchedAt - a.searchedAt)
      .slice(0, MAX_SEARCH_HISTORY_ITEMS)
  }

  const scopes: SearchHistoryScope[] = ["illust", "novel", "user"]
  function sameScopeEntries(left: SearchHistoryEntry[], right: SearchHistoryEntry[]): boolean {
    return left.length === right.length && left.every((entry, index) =>
      entry?.query === right[index].query && entry?.searchedAt === right[index].searchedAt
    )
  }

  const mergedUpdated = Math.max(localUpdated, cloudUpdated)
  const normalizationTime = Math.max(mergedUpdated, Date.now())
  const hasTombstones = Object.keys(searchTombstones).length > 0
  const hasClearBefore = Object.keys(searchClearBefore).length > 0

  // 先按原有时间过滤墓碑，再补齐旧数组可能产生的非正时间；确保本地替换再次
  // normalize 后与云端落盘一致，避免迁移后第二轮因词项时间变化再次同步。
  const mergedStore: SearchHistoryStore = {
    illust: normalizeHistoryEntries(mergeScopeEntries("illust", localStore.illust, cloudStore.illust), normalizationTime),
    novel: normalizeHistoryEntries(mergeScopeEntries("novel", localStore.novel, cloudStore.novel), normalizationTime),
    user: normalizeHistoryEntries(mergeScopeEntries("user", localStore.user, cloudStore.user), normalizationTime),
    updatedAt: mergedUpdated,
    tombstones: hasTombstones ? searchTombstones : undefined,
    clearBefore: hasClearBefore ? searchClearBefore : undefined,
  }

  // 语义包括分类内词序、query、searchedAt 以及跨端墓碑与清空水位线，不包括容器 updatedAt。
  const localChanged =
    scopes.some((scope) => !sameScopeEntries(localStore[scope], mergedStore[scope])) ||
    !sameRecord(localStore.tombstones, mergedStore.tombstones) ||
    !sameRecord(localStore.clearBefore, mergedStore.clearBefore)

  const cloudChanged =
    scopes.some((scope) => !sameScopeEntries(cloudStore[scope], mergedStore[scope])) ||
    !sameRecord(cloudStore.tombstones, mergedStore.tombstones) ||
    !sameRecord(cloudStore.clearBefore, mergedStore.clearBefore)

  // 不能只比较归一化云对象：缺失/空文件、旧字符串数组、未归一化条目仍须修盘。
  // updatedAt 在 SearchHistoryStore 中可省略；已存在的合法数值不同不构成迁移。
  const cloudNeedsMigration =
    scopes.some((scope) =>
      !Array.isArray(cloudRaw?.[scope]) || !sameScopeEntries(cloudRaw[scope], cloudStore[scope])
    ) ||
    (cloudRaw?.updatedAt !== undefined && typeof cloudRaw.updatedAt !== "number") ||
    (cloudRaw?.tombstones !== undefined && typeof cloudRaw.tombstones !== "object") ||
    (cloudRaw?.clearBefore !== undefined && typeof cloudRaw.clearBefore !== "object")

  if (localChanged || cloudChanged) {
    mergedStore.updatedAt = normalizationTime
  }

  // 1. 仅语义与防复活元数据变更才替换本地、持久化并广播；不为容器时间戳差异刷新订阅者。
  if (localChanged) {
    replaceSearchHistoryStore(mergedStore, true)
  }

  // 2. 内容变更或物理格式待迁移才写云端（包括清除已删除的脏条目与同步墓碑）。
  if (cloudChanged || cloudNeedsMigration) {
    try {
      writeTextSafely(cloudFile, JSON.stringify(mergedStore))
    } catch (e: any) {
      console.warn("write cloud search history error:", e?.message ?? e)
    }
  }

  // 3. 将聚合后的墓碑与水位线写回本地 sync_state，保持双向一致
  freshState.searchTombstones = { ...searchTombstones }
  freshState.searchClearBefore = { ...searchClearBefore }
  saveSyncState(freshState, userId)
}

// 统一立即同步入口（用于下拉刷新、多维触发或定时调度）
export async function syncHistoryNow(userId?: string | number | null): Promise<boolean> {
  if (!FileManager.isiCloudEnabled) {
    return false
  }

  // 显式 UID 不能借用另一账号的全局 store；在任何目录访问/刷盘前拒绝。
  const uid = resolveEffectiveUID(userId)
  if (uid !== resolveEffectiveUID()) return false

  // 单飞互斥保护：若当前已经在执行同步，记录排队请求并安全退出，防止在途重入冲突
  if (isSyncing) {
    hasQueuedSync = true
    queuedUserId = userId
    return false
  }

  const cloudDir = pixivCloudHistoryDirectory(uid)
  if (!cloudDir) return false

  isSyncing = true
  activeSyncAccount = { uid, generation: session.currentGeneration }
  hasQueuedSync = false
  try {
    // 1. 同步前先强制刷盘本地所有未持久化数据
    flushHistory()
    flushNovelProgress()
    flushSearchHistory()

    const localDir = pixivHistoryDirectory(uid)

    // 0. 优先同步与聚合云端与本地的墓碑与清空水位线
    const state = await syncSyncStateFile(localDir, cloudDir, uid)

    // 1. 依次同步 5 个独立业务文件；各分类均能感知多端聚合后的最新墓碑与水位线
    await syncHistoryCategory("illustration", localDir, cloudDir, state, uid)
    await syncHistoryCategory("manga", localDir, cloudDir, state, uid)
    await syncHistoryCategory("novel", localDir, cloudDir, state, uid)
    await syncNovelProgressFile(localDir, cloudDir, uid)
    await syncSearchHistoryFile(localDir, cloudDir, state, uid)

    // 2. 更新同步状态：重新从磁盘读取最新状态，防止冲掉同步在途产生的局部修改
    assertSyncAccount(uid)
    const latestState = loadSyncState(uid)
    pruneTombstones(latestState)
    latestState.lastSyncTime = Date.now()
    saveSyncState(latestState, uid)
    try {
      writeTextSafely(`${cloudDir}/${SYNC_STATE_FILE}`, JSON.stringify(latestState))
    } catch (e: any) {
      console.warn("write cloud final sync_state error:", e?.message ?? e)
    }
    return true
  } catch (error: any) {
    console.warn("syncHistoryNow error:", error?.message ?? error)
    return false
  } finally {
    isSyncing = false
    activeSyncAccount = null
    // 4. 尾随排队检测：如果本次同步期间产生了新变更或新的同步请求，无缝自动启动下一轮补跑
    if (hasQueuedSync) {
      hasQueuedSync = false
      const nextUid = queuedUserId
      queuedUserId = undefined
      scheduleDeferredSync(50, nextUid)
    }
  }
}

// 恢复和尾随任务统一登记；停止时全部撤销，已出队的旧回调也不能在重启后复活。
function scheduleDeferredSync(delay: number, userId?: string | number | null): void {
  if (isSchedulerStopped) return
  const timer = setTimeout(() => {
    if (!deferredSyncTimers.delete(timer) || isSchedulerStopped) return
    syncHistoryNow(userId).catch(() => {})
  }, delay)
  deferredSyncTimers.add(timer)
}

// 启动后台低频同步调度器
export function startHistorySyncScheduler(): () => void {
  if (!FileManager.isiCloudEnabled) {
    return () => {}
  }

  isSchedulerRunning = true
  isSchedulerStopped = false
  const generation = ++schedulerGeneration

  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }

  // 启动 2 秒后延迟执行一次静默拉取
  startupTimer = setTimeout(() => {
    if (!isSchedulerRunning || generation !== schedulerGeneration) return
    startupTimer = null
    syncHistoryNow().catch(() => {})
  }, STARTUP_DELAY_MS)

  // 循环调度：定期检查
  function scheduleNextCheck() {
    if (!isSchedulerRunning || generation !== schedulerGeneration) return
    schedulerTimer = setTimeout(async () => {
      if (!isSchedulerRunning || generation !== schedulerGeneration) return
      schedulerTimer = null
      try {
        const state = loadSyncState()
        if (pendingMutationCount > 0 || Date.now() - state.lastSyncTime >= AUTO_SYNC_FALLBACK_INTERVAL_MS) {
          await syncHistoryNow()
        }
      } catch {}
      if (isSchedulerRunning && generation === schedulerGeneration) {
        scheduleNextCheck()
      }
    }, 15000)
  }

  scheduleNextCheck()

  return () => {
    // 旧启动实例的 cleanup 不得停止后来创建的新实例。
    if (generation !== schedulerGeneration) return
    isSchedulerRunning = false
    isSchedulerStopped = true
    schedulerGeneration++
    if (startupTimer) {
      clearTimeout(startupTimer)
      startupTimer = null
    }
    if (schedulerTimer) {
      clearTimeout(schedulerTimer)
      schedulerTimer = null
    }
    for (const timer of deferredSyncTimers) clearTimeout(timer)
    deferredSyncTimers.clear()
    hasQueuedSync = false
    queuedUserId = undefined
    resetMutationTracking()
  }
}

// 切回前台时的同步检查：满 30 秒后延迟 2 秒拉取
export function triggerResumeSync(): void {
  if (!FileManager.isiCloudEnabled || isSchedulerStopped) {
    return
  }
  const state = loadSyncState()
  if (Date.now() - state.lastSyncTime >= MIN_RESUME_SYNC_INTERVAL_MS) {
    scheduleDeferredSync(RESUME_DELAY_MS)
  }
}
