import { getCategoryDirectory } from "./directoryResolver"
import { beginBackgroundTask, type BackgroundTaskHandle } from "./backgroundTaskManager"
import { notifyDownloadFilesChanged } from "./downloadFileManager"
import { yieldToMainThread } from "./downloadHelper"
import {
  consumeTaskSignal,
  clearTaskSignal,
  clearActiveTaskActivityMeta,
  peekTaskSignal,
} from "./TaskSignal"

declare const AbortController: any
type AbortSignal = any

export type DownloadTaskType =
  | "illust_album"
  | "illust_zip"
  | "ugoira_album"
  | "ugoira_export"
  | "manga_cbz"
  | "manga_epub"
  | "novel_epub"
  | "pixivision_epub"
  | "custom"

export type DownloadTaskStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled"

export interface DownloadTaskItem {
  id: string
  type: DownloadTaskType
  title: string
  subtitle?: string
  categoryIcon: string
  status: DownloadTaskStatus
  progress: number // 0.0 ~ 1.0
  current: number
  total: number
  statusText: string
  errorMessage?: string
  startTime: number
  finishTime?: number
  outputPath?: string
  speedText?: string
}

export interface TaskManifest {
  taskId: string
  type: DownloadTaskType
  title: string
  subtitle?: string
  totalItems: number
  completedIndices: number[]
  partFileMap: Record<string, string>
  metadata?: Record<string, any>
  updatedAt: number
}

export class TaskAbortError extends Error {
  constructor(message = "任务已取消") {
    super(message)
    this.name = "TaskAbortError"
  }
}

export class TaskPauseError extends Error {
  constructor(message = "任务已暂停") {
    super(message)
    this.name = "TaskPauseError"
  }
}

/**
 * 任务执行控制令牌，提供细粒度暂停、恢复、取消、网络 I/O 中断及断点等待能力
 */
export class TaskControlToken {
  private _isPaused = false
  private _isCancelled = false
  private _resumePromise: Promise<void> | null = null
  private _resumeResolver: (() => void) | null = null
  private _abortController = new AbortController()

  constructor(public readonly taskId?: string) {}

  get isPaused(): boolean {
    return this._isPaused
  }

  get isCancelled(): boolean {
    return this._isCancelled
  }

  get signal(): AbortSignal {
    return this._abortController.signal
  }

  pause(): void {
    if (this._isCancelled || this._isPaused) return
    this._isPaused = true
    try {
      this._abortController.abort("Task paused")
    } catch {}
    this._abortController = new AbortController()
    this._resumePromise = new Promise<void>((resolve) => {
      this._resumeResolver = resolve
    })
  }

  resume(): void {
    if (!this._isPaused) return
    this._isPaused = false
    this._abortController = new AbortController()
    if (this._resumeResolver) {
      this._resumeResolver()
      this._resumeResolver = null
      this._resumePromise = null
    }
  }

  cancel(): void {
    this._isCancelled = true
    try {
      this._abortController.abort("Task cancelled")
    } catch {}
    if (this._resumeResolver) {
      this._resumeResolver()
      this._resumeResolver = null
      this._resumePromise = null
    }
  }

  async checkOrWait(overrideTaskId?: string): Promise<void> {
    const id = overrideTaskId || this.taskId
    if (id) {
      const signal = consumeTaskSignal(id)
      if (signal === "cancel") {
        this.cancel()
        if (typeof DownloadTaskManager !== "undefined") {
          void DownloadTaskManager.cancelTask(id)
        }
        throw new TaskAbortError()
      } else if (signal === "pause") {
        this.pause()
        if (typeof DownloadTaskManager !== "undefined") {
          void DownloadTaskManager.pauseTask(id)
        }
      } else if (signal === "resume") {
        this.resume()
        if (typeof DownloadTaskManager !== "undefined") {
          void DownloadTaskManager.resumeTask(id)
        }
      }
    }
    if (this._isCancelled) {
      throw new TaskAbortError()
    }
    if (this._isPaused && this._resumePromise) {
      await this._resumePromise
      if (this._isCancelled) {
        throw new TaskAbortError()
      }
    }
  }
}

export type TaskRunner = (
  token: TaskControlToken,
  taskHandle: BackgroundTaskHandle,
  manifest: TaskManifest,
  saveManifest: () => void
) => Promise<{ outputPath?: string; summary?: string }>

interface InternalTaskRecord {
  item: DownloadTaskItem
  runner?: TaskRunner
  token: TaskControlToken
  bgHandle?: BackgroundTaskHandle
  manifest?: TaskManifest
  manifestPath: string
  taskDir: string
  lastPauseTimestamp?: number
}

class DownloadTaskManagerImpl {
  private tasks = new Map<string, InternalTaskRecord>()
  private taskOrder: string[] = []
  private activeTaskId: string | null = null
  private listeners = new Set<() => void>()
  private notifyTimer: any = null
  private signalPollTimer: any = null

  constructor() {
    this.ensureTaskDirectory()
    this.rehydrateExistingTasks()
  }

  private resolveCategoryIcon(type: DownloadTaskType, customIcon?: string): string {
    return (
      customIcon ||
      (type.includes("pixivision")
        ? "rectangle.stack.fill"
        : type.includes("novel")
        ? "book.closed.fill"
        : type.includes("manga")
        ? "books.vertical.fill"
        : type.includes("ugoira")
        ? "film.stack"
        : "photo.stack.fill")
    )
  }

  private getHistoryFilePath(): string {
    return `${this.ensureTaskDirectory()}/tasks_history.json`
  }

  /**
   * 持久化已完成/已取消/已失败的历史终态任务快照（最多保留 30 条）
   */
  private saveHistoryTasks(): void {
    try {
      const historyItems: DownloadTaskItem[] = []
      for (const id of this.taskOrder) {
        const r = this.tasks.get(id)
        if (
          r &&
          (r.item.status === "completed" ||
            r.item.status === "failed" ||
            r.item.status === "canceled")
        ) {
          historyItems.push({ ...r.item })
          if (historyItems.length >= 30) break
        }
      }
      FileManager.writeAsStringSync(
        this.getHistoryFilePath(),
        JSON.stringify(historyItems, null, 2)
      )
    } catch (e: any) {
      console.log("saveHistoryTasks error:", e?.message ?? e)
    }
  }

  /**
   * 应用冷启动时从磁盘水合恢复历史终态任务与未完成中断任务
   */
  private rehydrateExistingTasks(): void {
    const baseDir = this.ensureTaskDirectory()
    const historyPath = this.getHistoryFilePath()

    // 1. 从 tasks_history.json 水合恢复最近的终态任务记录
    try {
      if (FileManager.existsSync(historyPath)) {
        const text = FileManager.readAsStringSync(historyPath)
        if (text) {
          const parsed = JSON.parse(text) as DownloadTaskItem[]
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && item.id && !this.tasks.has(item.id)) {
                const token = new TaskControlToken(item.id)
                this.tasks.set(item.id, {
                  item,
                  token,
                  manifestPath: `${baseDir}/${item.id}/manifest.json`,
                  taskDir: `${baseDir}/${item.id}`,
                })
                this.taskOrder.push(item.id)
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.log("rehydrate history tasks error:", err?.message ?? err)
    }

    // 2. 扫描 tasks 工作区子目录，检索因应用退出意外中断的任务与清理废弃目录
    try {
      if (FileManager.existsSync(baseDir)) {
        const entries = FileManager.readDirectorySync(baseDir, false)
        for (const entry of entries) {
          if (entry === "tasks_history.json") continue
          const taskDir = `${baseDir}/${entry}`
          try {
            if (FileManager.isDirectorySync(taskDir)) {
              const manifestPath = `${taskDir}/manifest.json`
              if (FileManager.existsSync(manifestPath)) {
                // 如果尚未在任务列表中（说明上次应用退出时该任务还在 running/queued，未能写入终态历史）
                if (!this.tasks.has(entry)) {
                  const mText = FileManager.readAsStringSync(manifestPath)
                  if (mText) {
                    const manifest = JSON.parse(mText) as TaskManifest
                    const total = manifest.totalItems || 1
                    const current = manifest.completedIndices?.length ?? 0
                    const progress = total > 0 ? Math.min(1.0, current / total) : 0
                    const defaultIcon = this.resolveCategoryIcon(manifest.type)

                    const item: DownloadTaskItem = {
                      id: manifest.taskId || entry,
                      type: manifest.type,
                      title: manifest.title || "已中断的任务",
                      subtitle: manifest.subtitle,
                      categoryIcon: defaultIcon,
                      status: "failed",
                      progress,
                      current,
                      total,
                      statusText: "应用退出导致中断",
                      errorMessage: "应用进程退出，临时切片保留在磁盘，可删除清理",
                      startTime: manifest.updatedAt || Date.now(),
                    }

                    const token = new TaskControlToken(item.id)
                    this.tasks.set(item.id, {
                      item,
                      token,
                      manifest,
                      manifestPath,
                      taskDir,
                    })
                    this.taskOrder.unshift(item.id)
                  }
                }
              }
            }
          } catch {}
        }
      }
    } catch (e: any) {
      console.log("rehydrate disk tasks error:", e?.message ?? e)
    }
  }

  private startSignalPolling(): void {
    if (this.signalPollTimer) return
    const poll = () => {
      if (!this.activeTaskId) {
        this.stopSignalPolling()
        return
      }
      const targetId = this.activeTaskId
      const signal = consumeTaskSignal(targetId)
      if (signal === "pause") {
        void this.pauseTask(targetId)
      } else if (signal === "resume") {
        void this.resumeTask(targetId)
      } else if (signal === "cancel") {
        void this.cancelTask(targetId)
      }
      this.signalPollTimer = setTimeout(poll, 250)
    }
    this.signalPollTimer = setTimeout(poll, 250)
  }

  private stopSignalPolling(): void {
    if (this.signalPollTimer) {
      clearTimeout(this.signalPollTimer)
      this.signalPollTimer = null
    }
  }

  private ensureTaskDirectory(): string {
    const baseDir = `${getCategoryDirectory("temp")}/tasks`
    if (!FileManager.existsSync(baseDir)) {
      try {
        FileManager.createDirectorySync(baseDir, true)
      } catch {}
    }
    return baseDir
  }

  private getTaskDir(taskId: string): string {
    const dir = `${this.ensureTaskDirectory()}/${taskId}`
    if (!FileManager.existsSync(dir)) {
      try {
        FileManager.createDirectorySync(dir, true)
      } catch {}
    }
    return dir
  }

  private loadManifest(taskId: string): TaskManifest | null {
    try {
      const path = `${this.getTaskDir(taskId)}/manifest.json`
      if (FileManager.existsSync(path)) {
        const text = FileManager.readAsStringSync(path)
        if (text) {
          return JSON.parse(text) as TaskManifest
        }
      }
    } catch (e) {
      console.log(`loadManifest for ${taskId} error:`, e)
    }
    return null
  }

  private saveManifest(taskId: string, manifest: TaskManifest): void {
    try {
      const path = `${this.getTaskDir(taskId)}/manifest.json`
      manifest.updatedAt = Date.now()
      FileManager.writeAsStringSync(path, JSON.stringify(manifest))
    } catch (e) {
      console.log(`saveManifest for ${taskId} error:`, e)
    }
  }

  /**
   * 注册下载变动监听器
   */
  addListener(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  notify(): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer)
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      for (const listener of Array.from(this.listeners)) {
        try {
          listener()
        } catch (e) {
          console.log("DownloadTaskManager listener error:", e)
        }
      }
    }, 60)
  }

  /**
   * 获取全部任务列表
   */
  getAllTasks(): DownloadTaskItem[] {
    return this.taskOrder
      .map((id) => this.tasks.get(id)?.item)
      .filter((it): it is DownloadTaskItem => Boolean(it))
      .map((it) => ({ ...it }))
  }

  /**
   * 获取当前活跃任务
   */
  getActiveTask(): DownloadTaskItem | undefined {
    if (this.activeTaskId) {
      return this.tasks.get(this.activeTaskId)?.item
    }
    return undefined
  }

  /**
   * 获取指定任务
   */
  getTask(taskId: string): DownloadTaskItem | undefined {
    return this.tasks.get(taskId)?.item
  }

  /**
   * 提交并启动下载任务
   */
  async submitTask(options: {
    taskId?: string
    type: DownloadTaskType
    title: string
    subtitle?: string
    categoryIcon?: string
    total?: number
    metadata?: Record<string, any>
    runner: TaskRunner
  }): Promise<string> {
    const taskId =
      options.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const taskDir = this.getTaskDir(taskId)
    const manifestPath = `${taskDir}/manifest.json`

    let manifest = this.loadManifest(taskId)
    if (!manifest) {
      manifest = {
        taskId,
        type: options.type,
        title: options.title,
        subtitle: options.subtitle,
        totalItems: options.total || 0,
        completedIndices: [],
        partFileMap: {},
        metadata: options.metadata || {},
        updatedAt: Date.now(),
      }
      this.saveManifest(taskId, manifest)
    }

    const defaultIcon =
      options.categoryIcon ||
      (options.type.includes("pixivision")
        ? "rectangle.stack.fill"
        : options.type.includes("novel")
        ? "book.closed.fill"
        : options.type.includes("manga")
        ? "books.vertical.fill"
        : options.type.includes("ugoira")
        ? "film.stack"
        : "photo.stack.fill")

    const item: DownloadTaskItem = {
      id: taskId,
      type: options.type,
      title: options.title,
      subtitle: options.subtitle,
      categoryIcon: defaultIcon,
      status: "queued",
      progress: manifest.totalItems > 0 ? manifest.completedIndices.length / manifest.totalItems : 0,
      current: manifest.completedIndices.length,
      total: options.total || manifest.totalItems || 1,
      statusText: "排队中…",
      startTime: Date.now(),
    }

    const token = new TaskControlToken(taskId)
    const record: InternalTaskRecord = {
      item,
      runner: options.runner,
      token,
      manifest,
      manifestPath,
      taskDir,
    }

    this.tasks.set(taskId, record)
    if (!this.taskOrder.includes(taskId)) {
      this.taskOrder.unshift(taskId)
    }

    this.notify()
    this.scheduleNext()
    return taskId
  }

  /**
   * 任务调度核心循环
   */
  private async scheduleNext(): Promise<void> {
    if (this.activeTaskId) {
      const current = this.tasks.get(this.activeTaskId)
      if (current && (current.item.status === "running" || current.item.status === "paused")) {
        return // 保持单任务独占高速通道，避免并发过载与竞争
      }
    }

    // 寻找下一个处于 queued 状态的任务
    const nextId = this.taskOrder.find((id) => this.tasks.get(id)?.item.status === "queued")
    if (!nextId) return

    const record = this.tasks.get(nextId)
    if (!record || !record.runner) return

    this.activeTaskId = nextId
    this.startSignalPolling()
    record.item = {
      ...record.item,
      status: "running",
      statusText: "正在准备…",
    }
    this.notify()

    const saveManifestFn = () => {
      if (record.manifest) {
        this.saveManifest(record.item.id, record.manifest)
      }
    }

    // 启动灵动岛与后台保活
    const bgHandle = await beginBackgroundTask({
      taskId: record.item.id,
      title: record.item.title,
      subtitle: record.item.subtitle,
      total: record.item.total,
      categoryIcon: record.item.categoryIcon,
      initialStatus: record.item.statusText,
    })
    record.bgHandle = bgHandle

    // 包装进度同步器
    const wrappedHandle: BackgroundTaskHandle = {
      taskId: record.item.id,
      updateProgress: ({ current, total, statusText, isPaused }) => {
        if (record.item.status !== "running" && record.item.status !== "paused") return
        
        // 状态锁保护：如果任务已处于暂停或令牌已暂停或磁盘有未消费的 pause 信号，禁止并发回调冲刷为运行态
        const hasPendingPauseSignal = peekTaskSignal(record.item.id) === "pause"
        const isCurrentlyPaused =
          record.item.status === "paused" ||
          record.token.isPaused ||
          Boolean(isPaused) ||
          hasPendingPauseSignal
        const finalStatusText = isCurrentlyPaused ? "任务已暂停" : statusText

        const newTotal = total && total > 0 ? total : record.item.total
        const newCurrent = Math.max(0, current)
        const newProgress = Math.max(0, Math.min(1, newTotal > 0 ? newCurrent / newTotal : 0))
        record.item = {
          ...record.item,
          current: newCurrent,
          total: newTotal,
          progress: newProgress,
          statusText: finalStatusText,
          status: isCurrentlyPaused ? "paused" : record.item.status,
        }
        bgHandle.updateProgress({
          current: newCurrent,
          total: newTotal,
          statusText: finalStatusText,
          isPaused: isCurrentlyPaused,
        })
        this.notify()
      },
      finish: async (opts) => {
        await bgHandle.finish(opts)
      },
    }

    try {
      const result = await record.runner(
        record.token,
        wrappedHandle,
        record.manifest!,
        saveManifestFn
      )

      record.item = {
        ...record.item,
        status: "completed",
        progress: 1.0,
        current: record.item.total,
        finishTime: Date.now(),
        outputPath: result.outputPath,
        statusText: result.summary || "下载完成",
      }

      await bgHandle.finish({
        success: true,
        summary: record.item.statusText,
        detailTitle: record.item.title,
      })

      // 清理临时工作目录
      this.cleanupTaskDir(record.item.id)
      notifyDownloadFilesChanged()
    } catch (err: any) {
      if (err instanceof TaskAbortError || record.token.isCancelled) {
        record.item = {
          ...record.item,
          status: "canceled",
          statusText: "任务已取消",
        }
        await bgHandle.finish({
          success: false,
          isCanceled: true,
          summary: "下载已取消",
        })
        this.cleanupTaskDir(record.item.id)
      } else if (err instanceof TaskPauseError || record.token.isPaused) {
        record.item = {
          ...record.item,
          status: "paused",
          statusText: "已暂停",
        }
        // 暂停时不清理临时目录，保留 manifest 便于断点恢复
      } else {
        const errorMsg = err?.message || String(err)
        record.item = {
          ...record.item,
          status: "failed",
          errorMessage: errorMsg,
          statusText: `错误: ${errorMsg}`,
        }
        await bgHandle.finish({
          success: false,
          summary: record.item.statusText,
          errorMessage: record.item.errorMessage,
        })
      }
    } finally {
      this.activeTaskId = null
      this.stopSignalPolling()
      this.saveHistoryTasks()
      this.notify()
      void this.scheduleNext()
    }
  }

  /**
   * 检查并消费当前所有任务的挂起控制信号（供前台恢复 onResume 或心跳补偿调用）
   */
  checkPendingSignals(): void {
    const activeTasks = this.taskOrder
      .map((id) => this.tasks.get(id))
      .filter((r): r is InternalTaskRecord => Boolean(r))

    for (const record of activeTasks) {
      const sig = consumeTaskSignal(record.item.id)
      if (sig === "pause") {
        void this.pauseTask(record.item.id)
      } else if (sig === "resume") {
        void this.resumeTask(record.item.id)
      } else if (sig === "cancel") {
        void this.cancelTask(record.item.id)
      }
    }
  }

  /**
   * 手动暂停任务
   */
  async pauseTask(taskId?: string): Promise<boolean> {
    const targetId = taskId || this.activeTaskId
    if (!targetId) return false
    const record = this.tasks.get(targetId)
    if (!record) return false

    if (record.item.status === "running" || !record.token.isPaused) {
      record.lastPauseTimestamp = Date.now()
      record.item = {
        ...record.item,
        status: "paused",
        statusText: "已暂停",
      }
      record.token.pause()
      if (record.bgHandle) {
        record.bgHandle.updateProgress({
          current: record.item.current,
          total: record.item.total,
          statusText: "任务已暂停",
          isPaused: true,
        })
      }
      clearTaskSignal(targetId)
      this.notify()
      return true
    } else if (record.item.status === "queued") {
      record.item = {
        ...record.item,
        status: "paused",
        statusText: "已暂停",
      }
      clearTaskSignal(targetId)
      this.notify()
      return true
    }
    return false
  }

  /**
   * 恢复任务
   */
  async resumeTask(taskId?: string): Promise<boolean> {
    const targetId =
      taskId ||
      this.taskOrder.find((id) => {
        const r = this.tasks.get(id)
        return r && (r.item.status === "paused" || r.token.isPaused)
      })
    if (!targetId) return false
    const record = this.tasks.get(targetId)
    if (!record) return false

    if (record.item.status === "paused" || record.token.isPaused) {
      // 防误触与连按冷却门禁：暂停后 600ms 内禁止立即恢复，彻底杜绝灵动岛按钮原地翻转导致的误触与时序漂移
      if (record.lastPauseTimestamp && Date.now() - record.lastPauseTimestamp < 600) {
        console.log(`[resumeTask] Debounce guard hit for ${targetId}, ignoring resume within 600ms`)
        return false
      }

      clearTaskSignal(targetId)
      record.item = {
        ...record.item,
        status: "running",
        statusText: "继续下载中…",
      }
      record.token.resume()
      if (record.bgHandle) {
        record.bgHandle.updateProgress({
          current: record.item.current,
          total: record.item.total,
          statusText: "继续下载中…",
          isPaused: false,
        })
      }
      this.notify()
      return true
    } else if (record.item.status === "queued") {
      this.notify()
      this.scheduleNext()
      return true
    }
    return false
  }

  /**
   * 取消任务并清理
   */
  async cancelTask(taskId?: string): Promise<boolean> {
    const targetId = taskId || this.activeTaskId
    if (!targetId) return false
    const record = this.tasks.get(targetId)
    if (!record) return false

    clearTaskSignal(targetId)
    clearActiveTaskActivityMeta()
    record.token.cancel()
    if (record.item.status === "running") {
      record.item = {
        ...record.item,
        status: "canceled",
        statusText: "正在取消…",
      }
      this.notify()

      // 1.2 秒超时强制兜底：若底层 runner 因网络挂死等原因未及时抛错退出，强制完成终态收尾
      setTimeout(() => {
        const currentRecord = this.tasks.get(targetId)
        if (
          currentRecord &&
          currentRecord.item.status === "canceled" &&
          currentRecord.item.statusText === "正在取消…"
        ) {
          currentRecord.item = {
            ...currentRecord.item,
            statusText: "任务已取消",
          }
          if (currentRecord.bgHandle) {
            void currentRecord.bgHandle.finish({
              success: false,
              isCanceled: true,
              summary: "下载已取消",
            })
          }
          this.cleanupTaskDir(targetId)
          if (this.activeTaskId === targetId) {
            this.activeTaskId = null
            this.stopSignalPolling()
            this.scheduleNext()
          }
          this.saveHistoryTasks()
          this.notify()
        }
      }, 1200)
    } else {
      record.item = {
        ...record.item,
        status: "canceled",
        statusText: "已取消",
      }
      if (record.bgHandle) {
        void record.bgHandle.finish({
          success: false,
          isCanceled: true,
          summary: "下载已取消",
        })
      }
      this.cleanupTaskDir(targetId)
      this.saveHistoryTasks()
      this.notify()
      if (this.activeTaskId === targetId) {
        this.activeTaskId = null
        this.scheduleNext()
      }
    }
    return true
  }

  /**
   * 重新尝试失败或取消的任务
   */
  async retryTask(taskId: string): Promise<boolean> {
    const record = this.tasks.get(taskId)
    if (!record || !record.runner) return false

    record.item = {
      ...record.item,
      status: "queued",
      statusText: "排队中…",
      errorMessage: undefined,
    }
    record.token = new TaskControlToken()
    this.notify()
    this.scheduleNext()
    return true
  }

  /**
   * 清除单条已完成/已取消/失败的任务记录
   */
  removeTask(taskId: string): void {
    const record = this.tasks.get(taskId)
    if (!record) return
    if (record.item.status === "running") return

    this.cleanupTaskDir(taskId)
    this.tasks.delete(taskId)
    this.taskOrder = this.taskOrder.filter((id) => id !== taskId)
    this.saveHistoryTasks()
    this.notify()
  }

  /**
   * 清除所有已完成/已取消的任务记录
   */
  clearCompletedTasks(): void {
    const toRemove: string[] = []
    for (const [id, record] of this.tasks.entries()) {
      if (record.item.status === "completed" || record.item.status === "canceled") {
        toRemove.push(id)
        this.cleanupTaskDir(id)
      }
    }
    for (const id of toRemove) {
      this.tasks.delete(id)
    }
    this.taskOrder = this.taskOrder.filter((id) => !toRemove.includes(id))
    this.saveHistoryTasks()
    this.notify()
  }

  /**
   * 清理任务专属临时工作区
   */
  cleanupTaskDir(taskId: string): void {
    try {
      clearTaskSignal(taskId)
      const dir = `${this.ensureTaskDirectory()}/${taskId}`
      if (FileManager.existsSync(dir)) {
        FileManager.removeSync(dir)
      }
    } catch (e) {
      console.log(`cleanupTaskDir error for ${taskId}:`, e)
    }
  }
}

export const DownloadTaskManager = new DownloadTaskManagerImpl()

// 注册 AppIntent 交互桥接处理器，实现灵动岛/锁屏与任务管理器零延迟解耦直连
try {
  const { registerTaskActionHandler } = require("../../app_intents")
  if (typeof registerTaskActionHandler === "function") {
    registerTaskActionHandler(async (action: string, taskId?: string) => {
      if (action === "pause") return DownloadTaskManager.pauseTask(taskId)
      if (action === "resume") return DownloadTaskManager.resumeTask(taskId)
      if (action === "cancel") return DownloadTaskManager.cancelTask(taskId)
      return false
    })
  }
} catch {}
