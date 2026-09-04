import { getCategoryDirectory } from "./directoryResolver"
import { beginBackgroundTask, type BackgroundTaskHandle } from "./backgroundTaskManager"
import { notifyDownloadFilesChanged } from "./downloadFileManager"
import { yieldToMainThread } from "./downloadHelper"

export type DownloadTaskType =
  | "illust_album"
  | "illust_zip"
  | "ugoira_album"
  | "ugoira_export"
  | "manga_cbz"
  | "manga_epub"
  | "novel_epub"
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
 * 任务执行控制令牌，提供细粒度暂停、恢复、取消及断点等待能力
 */
export class TaskControlToken {
  private _isPaused = false
  private _isCancelled = false
  private _resumePromise: Promise<void> | null = null
  private _resumeResolver: (() => void) | null = null

  get isPaused(): boolean {
    return this._isPaused
  }

  get isCancelled(): boolean {
    return this._isCancelled
  }

  pause(): void {
    if (this._isCancelled || this._isPaused) return
    this._isPaused = true
    this._resumePromise = new Promise<void>((resolve) => {
      this._resumeResolver = resolve
    })
  }

  resume(): void {
    if (!this._isPaused) return
    this._isPaused = false
    if (this._resumeResolver) {
      this._resumeResolver()
      this._resumeResolver = null
      this._resumePromise = null
    }
  }

  cancel(): void {
    this._isCancelled = true
    if (this._resumeResolver) {
      this._resumeResolver()
      this._resumeResolver = null
      this._resumePromise = null
    }
  }

  async checkOrWait(): Promise<void> {
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
}

class DownloadTaskManagerImpl {
  private tasks = new Map<string, InternalTaskRecord>()
  private taskOrder: string[] = []
  private activeTaskId: string | null = null
  private listeners = new Set<() => void>()
  private notifyTimer: any = null

  constructor() {
    this.ensureTaskDirectory()
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
      (options.type.includes("novel")
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

    const token = new TaskControlToken()
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
        
        // 状态锁保护：如果任务已处于暂停或令牌已暂停，禁止并发回调冲刷为运行态
        const isCurrentlyPaused =
          record.item.status === "paused" || record.token.isPaused || Boolean(isPaused)
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
      this.notify()
      void this.scheduleNext()
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

    if (record.item.status === "running") {
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
      this.notify()
      return true
    } else if (record.item.status === "queued") {
      record.item = {
        ...record.item,
        status: "paused",
        statusText: "已暂停",
      }
      this.notify()
      return true
    }
    return false
  }

  /**
   * 恢复任务
   */
  async resumeTask(taskId?: string): Promise<boolean> {
    const targetId = taskId || this.taskOrder.find((id) => this.tasks.get(id)?.item.status === "paused")
    if (!targetId) return false
    const record = this.tasks.get(targetId)
    if (!record) return false

    if (record.item.status === "paused") {
      if (record.token.isPaused) {
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
      } else {
        // 从挂起队列重新入队调度
        record.item = {
          ...record.item,
          status: "queued",
          statusText: "排队中…",
        }
        this.notify()
        this.scheduleNext()
        return true
      }
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

    record.token.cancel()
    if (record.item.status === "running") {
      record.item = {
        ...record.item,
        status: "canceled",
        statusText: "正在取消…",
      }
      this.notify()
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
    this.notify()
  }

  /**
   * 清理任务专属临时工作区
   */
  cleanupTaskDir(taskId: string): void {
    try {
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
