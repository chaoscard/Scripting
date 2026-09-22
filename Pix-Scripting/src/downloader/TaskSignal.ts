export type TaskSignalAction = "pause" | "resume" | "cancel"

export interface ActiveTaskActivityMeta {
  taskId: string
  activityId?: string
  title: string
  subtitle?: string
  statusText: string
  progress: number
  current: number
  total: number
  categoryIcon?: string
  isPaused?: boolean
  isDone?: boolean
  isError?: boolean
  updatedAt: number
}

function getAppGroupBaseDir(): string {
  return FileManager.appGroupDocumentsDirectory || FileManager.documentsDirectory
}

function ensureSignalDirectory(): string {
  const dir = `${getAppGroupBaseDir()}/Pix-Scripting/TaskSignals`
  if (!FileManager.existsSync(dir)) {
    try {
      FileManager.createDirectorySync(dir, true)
    } catch {}
  }
  return dir
}

function getSignalFilePath(taskId: string): string {
  const safeId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_")
  return `${ensureSignalDirectory()}/signal_${safeId}.json`
}

function getActiveActivityMetaPath(): string {
  return `${ensureSignalDirectory()}/active_activity_meta.json`
}

/**
 * 跨进程/跨环境派发任务控制信号（由 AppIntent 或 UI 调用）
 */
export function sendTaskSignal(taskId: string, action: TaskSignalAction): void {
  if (!taskId) return
  try {
    const path = getSignalFilePath(taskId)
    const payload = {
      taskId,
      action,
      timestamp: Date.now(),
    }
    FileManager.writeAsStringSync(path, JSON.stringify(payload))
  } catch (e: any) {
    console.log(`sendTaskSignal error for ${taskId}:`, e?.message ?? e)
  }
}

/**
 * 查看指定任务的待处理信号（不消费）
 */
export function peekTaskSignal(taskId: string): TaskSignalAction | null {
  if (!taskId) return null
  try {
    const path = getSignalFilePath(taskId)
    if (FileManager.existsSync(path)) {
      const text = FileManager.readAsStringSync(path)
      if (text) {
        const parsed = JSON.parse(text)
        return parsed?.action as TaskSignalAction
      }
    }
  } catch {}
  return null
}

/**
 * 消费并清除指定任务的控制信号（由主应用下载执行循环调用）
 */
export function consumeTaskSignal(taskId: string): TaskSignalAction | null {
  if (!taskId) return null
  try {
    const path = getSignalFilePath(taskId)
    if (FileManager.existsSync(path)) {
      const text = FileManager.readAsStringSync(path)
      try {
        FileManager.removeSync(path)
      } catch {}
      if (text) {
        const parsed = JSON.parse(text)
        return parsed?.action as TaskSignalAction
      }
    }
  } catch (e: any) {
    console.log(`consumeTaskSignal error for ${taskId}:`, e?.message ?? e)
  }
  return null
}

/**
 * 清除指定任务的所有未处理信号
 */
export function clearTaskSignal(taskId: string): void {
  if (!taskId) return
  try {
    const path = getSignalFilePath(taskId)
    if (FileManager.existsSync(path)) {
      FileManager.removeSync(path)
    }
  } catch {}
}

/**
 * 持久化当前活跃灵动岛实时活动的元数据（供 AppIntent 跨进程秒级反查并翻转 UI）
 */
export function saveActiveTaskActivityMeta(meta: ActiveTaskActivityMeta): void {
  try {
    const path = getActiveActivityMetaPath()
    meta.updatedAt = Date.now()
    FileManager.writeAsStringSync(path, JSON.stringify(meta))
  } catch (e: any) {
    console.log("saveActiveTaskActivityMeta error:", e?.message ?? e)
  }
}

/**
 * 获取当前活跃灵动岛实时活动的元数据
 */
export function getActiveTaskActivityMeta(): ActiveTaskActivityMeta | null {
  try {
    const path = getActiveActivityMetaPath()
    if (FileManager.existsSync(path)) {
      const text = FileManager.readAsStringSync(path)
      if (text) {
        return JSON.parse(text) as ActiveTaskActivityMeta
      }
    }
  } catch {}
  return null
}

/**
 * 清理当前活跃灵动岛实时活动元数据
 */
export function clearActiveTaskActivityMeta(): void {
  try {
    const path = getActiveActivityMetaPath()
    if (FileManager.existsSync(path)) {
      FileManager.removeSync(path)
    }
  } catch {}
}
