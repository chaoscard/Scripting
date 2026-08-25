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
  }) => void
  finish: (options: {
    success: boolean
    summary: string
    errorMessage?: string
    detailTitle?: string
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
  
  // 1. 开启系统后台保活
  try {
    if (typeof BackgroundKeeper !== "undefined" && BackgroundKeeper.keepAlive) {
      await BackgroundKeeper.keepAlive()
      activeTasksCount++
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

  if (settings.enableLiveActivity) {
    try {
      liveActivityInstance = PixivTaskLiveActivity()
      const initialState: TaskLiveActivityState = {
        title: options.title,
        subtitle: options.subtitle,
        statusText: options.initialStatus || "正在准备任务…",
        progress: 0.0,
        current: 0,
        total: currentTotal,
        categoryIcon: options.categoryIcon || "arrow.down.circle.fill",
        isDone: false,
        isError: false,
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
  }) => {
    if (isFinished) return
    if (progressOptions.total && progressOptions.total > 0) {
      currentTotal = progressOptions.total
    }
    currentCount = Math.max(0, progressOptions.current)
    const progressVal = Math.max(0, Math.min(1, currentTotal > 0 ? currentCount / currentTotal : 0))

    const now = Date.now()
    // 防抖限频：至少间隔 80ms 更新一次 LiveActivity
    if (now - lastUpdateTime < 80 && currentCount < currentTotal) {
      return
    }
    lastUpdateTime = now

    if (liveActivityInstance) {
      try {
        liveActivityInstance.update({
          title: options.title,
          subtitle: options.subtitle,
          statusText: progressOptions.statusText,
          progress: progressVal,
          current: currentCount,
          total: currentTotal,
          categoryIcon: options.categoryIcon || "arrow.down.circle.fill",
          isDone: false,
          isError: false,
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
  }) => {
    if (isFinished) return
    isFinished = true

    const currentSettings = loadSettings()

    // 4.1 结束灵动岛实时活动
    if (liveActivityInstance) {
      try {
        const finalState: TaskLiveActivityState = {
          title: finishOptions.detailTitle || options.title,
          subtitle: options.subtitle,
          statusText: finishOptions.summary,
          progress: finishOptions.success ? 1.0 : (currentTotal > 0 ? currentCount / currentTotal : 0),
          current: finishOptions.success ? currentTotal : currentCount,
          total: currentTotal,
          categoryIcon: options.categoryIcon || "arrow.down.circle.fill",
          isDone: finishOptions.success,
          isError: !finishOptions.success,
        }
        await liveActivityInstance.end(finalState, {
          dismissTimeInterval: finishOptions.success ? 4 : 8,
        })
      } catch (err: any) {
        console.log("LiveActivity end error:", err?.message ?? err)
      }
      liveActivityInstance = null
    }

    // 4.2 发送本地通知与震动反馈
    if (currentSettings.enableTaskNotification) {
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

    // 触感反馈
    try {
      if (typeof HapticFeedback !== "undefined") {
        if (finishOptions.success) {
          HapticFeedback.notificationSuccess()
        } else {
          HapticFeedback.notificationError()
        }
      }
    } catch {}

    // 4.3 释放后台保活
    try {
      if (typeof BackgroundKeeper !== "undefined" && BackgroundKeeper.stopKeepAlive) {
        if (activeTasksCount > 0) {
          activeTasksCount--
          await BackgroundKeeper.stopKeepAlive()
        }
      }
    } catch (e: any) {
      console.log("BackgroundKeeper.stopKeepAlive error:", e?.message ?? e)
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
