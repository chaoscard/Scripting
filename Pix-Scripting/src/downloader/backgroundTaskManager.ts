import {
  Notification,
  Script,
} from "scripting"
import { PixivTaskLiveActivity, type TaskLiveActivityState } from "../../live_activity"
import { loadSettings } from "../store/settings"

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

let activeTasksCount = 0

/**
 * 启动后台任务管理：包含后台保活、灵动岛实时活动生命周期与任务完成通知
 */
export async function beginBackgroundTask(
  options: BackgroundTaskOptions
): Promise<BackgroundTaskHandle> {
  const taskId = options.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const settings = loadSettings()
  
  // 1. 开启系统后台保活（校验返回值与多任务安全配对）
  let isKeptAlive = false
  try {
    if (typeof BackgroundKeeper !== "undefined" && typeof BackgroundKeeper.keepAlive === "function") {
      const started = await BackgroundKeeper.keepAlive()
      if (started) {
        isKeptAlive = true
        activeTasksCount++
      } else {
        console.log("BackgroundKeeper.keepAlive: system refused or non-PRO mode active")
      }
    }
  } catch (e: any) {
    console.log("BackgroundKeeper.keepAlive error:", e?.message ?? e)
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
        categoryIcon: options.categoryIcon || "arrow.down.circle.fill",
        isDone: false,
        isError: false,
        isPaused: false,
      }
      await liveActivityInstance.start(initialState)
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

    if (progressOptions.isPaused !== undefined) {
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
        liveActivityInstance.update({
          taskId,
          title: options.title,
          subtitle: options.subtitle,
          statusText: isCurrentlyPaused ? "任务已暂停" : progressOptions.statusText,
          progress: progressVal,
          current: currentCount,
          total: currentTotal,
          categoryIcon: options.categoryIcon || "arrow.down.circle.fill",
          isDone: false,
          isError: false,
          isPaused: isCurrentlyPaused,
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
          categoryIcon: options.categoryIcon || "arrow.down.circle.fill",
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
      try {
        if (typeof HapticFeedback !== "undefined") {
          if (finishOptions.success) {
            HapticFeedback.notificationSuccess()
          } else {
            HapticFeedback.notificationError()
          }
        }
      } catch {}
    }

    // 4.3 释放后台保活
    if (isKeptAlive) {
      isKeptAlive = false
      try {
        if (typeof BackgroundKeeper !== "undefined" && typeof BackgroundKeeper.stopKeepAlive === "function") {
          if (activeTasksCount > 0) {
            activeTasksCount--
          }
          await BackgroundKeeper.stopKeepAlive()
        }
      } catch (e: any) {
        console.log("BackgroundKeeper.stopKeepAlive error:", e?.message ?? e)
      }
    }
  }

  return {
    taskId,
    updateProgress,
    finish,
  }
}

/**
 * 用后台任务与灵动岛托管执行异步任务
 */
export async function runWithBackgroundTask<T>(
  options: BackgroundTaskOptions,
  runner: (task: BackgroundTaskHandle) => Promise<T>
): Promise<T> {
  const task = await beginBackgroundTask(options)
  try {
    const result = await runner(task)
    return result
  } catch (error: any) {
    await task.finish({
      success: false,
      summary: error?.message ? `执行中断: ${error.message}` : "任务执行过程中发生异常",
      errorMessage: String(error),
    })
    throw error
  }
}
