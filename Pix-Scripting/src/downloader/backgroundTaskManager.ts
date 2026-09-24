import {
  Notification,
  Script,
} from "scripting"
import { PixivTaskLiveActivity, type TaskLiveActivityState } from "../../live_activity"
import { loadSettings } from "../store/settings"
import { triggerHaptic } from "../platform/haptics"
import { isScriptingProUser } from "../platform/pro"
import {
  saveActiveTaskActivityMeta,
  clearActiveTaskActivityMeta,
  clearTaskSignal,
  peekTaskSignal,
} from "./TaskSignal"

export interface BackgroundTaskOptions {
  taskId?: string
  title: string
  subtitle?: string
  total?: number
  categoryIcon?: string
  initialStatus?: string
}

export interface BackgroundTaskHandle {
  taskId: string
  updateProgress: (options: {
    current: number
    total?: number
    statusText: string
    isPaused?: boolean
  }) => void
  finish: (options: {
    success: boolean
    summary: string
    errorMessage?: string
    detailTitle?: string
    isCanceled?: boolean
  }) => Promise<void>
}

/**
 * 全局后台保活引用计数中枢（严格保证多任务、相册批量写入与子流程并发时保活不被意外中断）
 */
let globalKeepAliveRefCount = 0

/**
 * 申请全局系统后台保活令牌（Pro 权限门禁拦截）
 * 仅在首次申请（引用计数从 0 -> 1）时真正触发系统 BackgroundKeeper.keepAlive()
 */
export async function acquireGlobalKeepAlive(): Promise<boolean> {
  if (!isScriptingProUser()) return false
  globalKeepAliveRefCount++
  if (globalKeepAliveRefCount === 1) {
    try {
      if (typeof BackgroundKeeper !== "undefined" && typeof BackgroundKeeper.keepAlive === "function") {
        const started = await BackgroundKeeper.keepAlive()
        if (!started) {
          console.log("BackgroundKeeper.keepAlive: system refused")
          globalKeepAliveRefCount = 0
          return false
        }
        return true
      }
    } catch (e: any) {
      console.log("BackgroundKeeper.keepAlive error:", e?.message ?? e)
      globalKeepAliveRefCount = 0
      return false
    }
  }
  return true
}

/**
 * 释放全局系统后台保活令牌
 * 仅当全进程所有持有者全部释放（引用计数严格降至 0）时才真正触发 BackgroundKeeper.stopKeepAlive()
 */
export async function releaseGlobalKeepAlive(): Promise<void> {
  if (!isScriptingProUser()) return
  if (globalKeepAliveRefCount > 0) {
    globalKeepAliveRefCount--
  }
  if (globalKeepAliveRefCount === 0) {
    try {
      if (typeof BackgroundKeeper !== "undefined" && typeof BackgroundKeeper.stopKeepAlive === "function") {
        await BackgroundKeeper.stopKeepAlive()
      }
    } catch (e: any) {
      console.log("BackgroundKeeper.stopKeepAlive error:", e?.message ?? e)
    }
  }
}

/**
 * 启动后台任务管理：包含后台保活、灵动岛实时活动生命周期与任务完成通知
 */
export async function beginBackgroundTask(
  options: BackgroundTaskOptions
): Promise<BackgroundTaskHandle> {
  const taskId = options.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const settings = loadSettings()
  
  // 1. 开启系统后台保活（统一通过全局单例中枢申请，Pro 用户门禁）
  let isKeptAlive = false
  if (isScriptingProUser()) {
    isKeptAlive = await acquireGlobalKeepAlive()
  }

  // 2. 检查灵动岛能力与用户设置
  let liveActivityInstance: ReturnType<typeof PixivTaskLiveActivity> | null = null
  let currentTotal = options.total && options.total > 0 ? options.total : 1
  let currentCount = 0
  let isFinished = false
  let lastUpdateTime = 0
  let isCurrentlyPaused = false

  if (settings.enableLiveActivity) {
    try {
      liveActivityInstance = PixivTaskLiveActivity()
      const initialState: TaskLiveActivityState = {
        taskId,
        title: options.title,
        subtitle: options.subtitle,
        statusText: options.initialStatus || "正在准备任务…",
        progress: 0.0,
        current: 0,
        total: currentTotal,
        categoryIcon: options.categoryIcon || "square.and.arrow.down.fill",
        isDone: false,
        isError: false,
        isPaused: false,
      }
      await liveActivityInstance.start(initialState)
      saveActiveTaskActivityMeta({
        taskId,
        activityId: liveActivityInstance.activityId,
        title: options.title,
        subtitle: options.subtitle,
        statusText: options.initialStatus || "正在准备任务…",
        progress: 0.0,
        current: 0,
        total: currentTotal,
        categoryIcon: options.categoryIcon || "square.and.arrow.down.fill",
        isPaused: false,
        isDone: false,
        isError: false,
        updatedAt: Date.now(),
      })
    } catch (err: any) {
      console.log("LiveActivity start error:", err?.message ?? err)
      liveActivityInstance = null
    }
  }

  // 3. 进度更新函数
  const updateProgress = (progressOptions: {
    current: number
    total?: number
    statusText: string
    isPaused?: boolean
  }) => {
    if (isFinished) return
    if (progressOptions.total && progressOptions.total > 0) {
      currentTotal = progressOptions.total
    }
    currentCount = Math.max(0, progressOptions.current)
    const progressVal = Math.max(0, Math.min(1, currentTotal > 0 ? currentCount / currentTotal : 0))

    // 状态熔断保护：若当前已标记为暂停，或外部有尚未消费的 pause 信号，严禁将 isPaused 冲刷为 false！
    const pendingSignal = peekTaskSignal(taskId)
    if (pendingSignal === "pause") {
      isCurrentlyPaused = true
    } else if (progressOptions.isPaused !== undefined) {
      isCurrentlyPaused = Boolean(progressOptions.isPaused)
    }

    const now = Date.now()
    // 防抖限频：非状态切换且小于 80ms 时防抖
    if (progressOptions.isPaused === undefined && now - lastUpdateTime < 80 && currentCount < currentTotal) {
      return
    }
    lastUpdateTime = now

    if (liveActivityInstance) {
      try {
        const finalStatus = isCurrentlyPaused ? "任务已暂停" : progressOptions.statusText
        liveActivityInstance.update({
          taskId,
          title: options.title,
          subtitle: options.subtitle,
          statusText: finalStatus,
          progress: progressVal,
          current: currentCount,
          total: currentTotal,
          categoryIcon: options.categoryIcon || "square.and.arrow.down.fill",
          isDone: false,
          isError: false,
          isPaused: isCurrentlyPaused,
        })
        saveActiveTaskActivityMeta({
          taskId,
          activityId: liveActivityInstance.activityId,
          title: options.title,
          subtitle: options.subtitle,
          statusText: finalStatus,
          progress: progressVal,
          current: currentCount,
          total: currentTotal,
          categoryIcon: options.categoryIcon || "square.and.arrow.down.fill",
          isPaused: isCurrentlyPaused,
          isDone: false,
          isError: false,
          updatedAt: Date.now(),
        })
      } catch (err: any) {
        console.log("LiveActivity update error:", err?.message ?? err)
      }
    }
  }

  // 4. 完成任务函数
  const finish = async (finishOptions: {
    success: boolean
    summary: string
    errorMessage?: string
    detailTitle?: string
    isCanceled?: boolean
  }) => {
    if (isFinished) return
    isFinished = true

    clearActiveTaskActivityMeta()
    clearTaskSignal(taskId)

    const currentSettings = loadSettings()
    const isCanceled = Boolean(finishOptions.isCanceled)

    // 4.1 结束灵动岛实时活动：取消时立即销毁(0秒)；成功保留4秒；真错误保留6秒
    if (liveActivityInstance) {
      try {
        const finalState: TaskLiveActivityState = {
          taskId,
          title: finishOptions.detailTitle || options.title,
          subtitle: options.subtitle,
          statusText: finishOptions.summary,
          progress: finishOptions.success ? 1.0 : (currentTotal > 0 ? currentCount / currentTotal : 0),
          current: finishOptions.success ? currentTotal : currentCount,
          total: currentTotal,
          categoryIcon: options.categoryIcon || "square.and.arrow.down.fill",
          isDone: finishOptions.success,
          isError: !finishOptions.success && !isCanceled,
          isPaused: false,
        }
        await liveActivityInstance.end(finalState, {
          dismissTimeInterval: isCanceled ? 0 : finishOptions.success ? 4 : 6,
        })
      } catch (err: any) {
        console.log("LiveActivity end error:", err?.message ?? err)
      }
      liveActivityInstance = null
    }

    // 4.2 发送本地通知与震动反馈（主动取消不打扰、不误报失败）
    if (currentSettings.enableTaskNotification && !isCanceled) {
      try {
        const notifyTitle = finishOptions.success
          ? `✅ ${options.title}完成`
          : `❌ ${options.title}失败`

        await Notification.schedule({
          title: notifyTitle,
          subtitle: options.subtitle,
          body: finishOptions.summary,
          silent: false,
          tapAction: "none",
        })
      } catch (err: any) {
        console.log("Notification.schedule error:", err?.message ?? err)
      }
    }

    // 触感反馈（取消不触发错误触感）
    if (!isCanceled) {
      if (finishOptions.success) {
        triggerHaptic("success")
      } else {
        triggerHaptic("error")
      }
    }

    // 4.3 释放后台保活（通过全局单例中枢安全扣减，仅当全局引用归零时才真正注销系统保活）
    if (isKeptAlive) {
      isKeptAlive = false
      await releaseGlobalKeepAlive()
    }
  }

  return {
    taskId,
    updateProgress,
    finish,
  }
}

/**
 * 用后台任务与灵动岛托管执行异步任务（具备自动完结兜底保护）
 */
export async function runWithBackgroundTask<T>(
  options: BackgroundTaskOptions,
  runner: (task: BackgroundTaskHandle) => Promise<T>
): Promise<T> {
  const task = await beginBackgroundTask(options)
  let isFinished = false

  // 包装 handle，记录外部 runner 是否已主动 finish
  const wrappedTask: BackgroundTaskHandle = {
    ...task,
    finish: async (res) => {
      isFinished = true
      await task.finish(res)
    },
  }

  try {
    const result = await runner(wrappedTask)
    // 成功路径兜底：若 runner 执行完毕后未显式调用 finish，自动标记成功并释放保活
    if (!isFinished) {
      await task.finish({ success: true, summary: "任务已完成" })
    }
    return result
  } catch (error: any) {
    // 异常路径兜底：若 runner 抛出异常前未显式 finish，自动标记失败并上报错误
    if (!isFinished) {
      await task.finish({
        success: false,
        summary: error?.message ? `执行中断: ${error.message}` : "任务执行过程中发生异常",
        errorMessage: String(error),
      })
    }
    throw error
  }
}
