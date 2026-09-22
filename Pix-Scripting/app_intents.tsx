import { AppIntentManager, AppIntentProtocol, LiveActivity, Widget } from "scripting"
import { advanceWidgetArtwork, toggleWidgetArtworkBookmark } from "./src/store/widgetStore"
import { triggerHaptic } from "./src/platform/haptics"
import {
  sendTaskSignal,
  getActiveTaskActivityMeta,
  saveActiveTaskActivityMeta,
  clearActiveTaskActivityMeta,
} from "./src/downloader/TaskSignal"

export const NextArtworkIntent = AppIntentManager.register({
  name: "PixivNextArtworkIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (param?: string) => {
    try {
      try {
        triggerHaptic("light")
      } catch {}
      await advanceWidgetArtwork(param)
      Widget.reloadAll()
    } catch (e: any) {
      console.log("NextArtworkIntent error:", e?.message ?? e)
    }
  },
})

export const BookmarkArtworkIntent = AppIntentManager.register({
  name: "PixivBookmarkArtworkIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (param?: string) => {
    try {
      try {
        triggerHaptic("heavy")
      } catch {}
      let poolParam = param || ""
      let targetId: number | undefined = undefined
      if (poolParam.includes("::")) {
        const parts = poolParam.split("::")
        poolParam = parts[0]
        targetId = parseInt(parts[1], 10) || undefined
      }
      await toggleWidgetArtworkBookmark(poolParam, targetId)
      Widget.reloadAll()
    } catch (e: any) {
      console.log("BookmarkArtworkIntent error:", e?.message ?? e)
    }
  },
})

export type TaskAction = "pause" | "resume" | "cancel"
export type TaskActionHandler = (action: TaskAction, taskId?: string) => Promise<boolean> | boolean

let globalTaskHandler: TaskActionHandler | null = null

export function registerTaskActionHandler(handler: TaskActionHandler): () => void {
  globalTaskHandler = handler
  return () => {
    if (globalTaskHandler === handler) {
      globalTaskHandler = null
    }
  }
}

export async function dispatchTaskAction(action: TaskAction, taskId?: string): Promise<boolean> {
  // 1. 获取有效任务标识与活动元数据
  const meta = getActiveTaskActivityMeta()
  const effectiveTaskId = taskId || meta?.taskId

  // 2. 向 AppGroup 发送跨进程持久化控制信号
  if (effectiveTaskId) {
    sendTaskSignal(effectiveTaskId, action)
  }

  // 3. 灵动岛 / 锁屏 LiveActivity 原生即时 UI 翻转（0 延迟直接响应用户手势）
  try {
    let targetActivityId = meta?.activityId
    if (!targetActivityId) {
      try {
        const ids = await LiveActivity.getAllActivitiesIds()
        if (ids && ids.length > 0) {
          targetActivityId = ids[0]
        }
      } catch {}
    }

    if (targetActivityId) {
      const activity = await LiveActivity.from<any>(targetActivityId, "PixivTaskLiveActivity")
      if (activity) {
        if (action === "pause") {
          const updatedState = {
            ...(meta || {}),
            taskId: effectiveTaskId,
            title: meta?.title || "下载任务",
            statusText: "任务已暂停",
            progress: meta?.progress ?? 0,
            current: meta?.current ?? 0,
            total: meta?.total ?? 1,
            isPaused: true,
            isDone: false,
            isError: false,
          }
          await activity.update(updatedState)
          if (meta) {
            saveActiveTaskActivityMeta({ ...meta, isPaused: true, statusText: "任务已暂停" })
          }
        } else if (action === "resume") {
          const updatedState = {
            ...(meta || {}),
            taskId: effectiveTaskId,
            title: meta?.title || "下载任务",
            statusText: "继续下载中…",
            progress: meta?.progress ?? 0,
            current: meta?.current ?? 0,
            total: meta?.total ?? 1,
            isPaused: false,
            isDone: false,
            isError: false,
          }
          await activity.update(updatedState)
          if (meta) {
            saveActiveTaskActivityMeta({ ...meta, isPaused: false, statusText: "继续下载中…" })
          }
        } else if (action === "cancel") {
          const finalState = {
            ...(meta || {}),
            taskId: effectiveTaskId,
            title: meta?.title || "下载任务",
            statusText: "下载已取消",
            progress: meta?.progress ?? 0,
            current: meta?.current ?? 0,
            total: meta?.total ?? 1,
            isPaused: false,
            isDone: false,
            isError: false,
          }
          await activity.end(finalState, { dismissTimeInterval: 0 })
          clearActiveTaskActivityMeta()
        }
      }
    }
  } catch (err: any) {
    console.log(`dispatchTaskAction LiveActivity flip error for ${action}:`, err?.message ?? err)
  }

  // 4. 若在主应用前台且持有内存直连 handler，直接执行
  if (globalTaskHandler) {
    try {
      return await globalTaskHandler(action, effectiveTaskId)
    } catch (e: any) {
      console.log(`dispatchTaskAction ${action} error:`, e?.message ?? e)
    }
  }

  // 5. 后备懒加载调用
  try {
    const { DownloadTaskManager } = await import("./src/downloader/downloadTaskManager")
    if (action === "pause") {
      return await DownloadTaskManager.pauseTask(effectiveTaskId)
    } else if (action === "resume") {
      return await DownloadTaskManager.resumeTask(effectiveTaskId)
    } else if (action === "cancel") {
      return await DownloadTaskManager.cancelTask(effectiveTaskId)
    }
  } catch (err: any) {
    console.log(`dispatchTaskAction lazy import error:`, err?.message ?? err)
  }
  return true
}

export const PauseDownloadIntent = AppIntentManager.register({
  name: "PixivPauseDownloadIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (taskId?: string) => {
    await dispatchTaskAction("pause", taskId)
  },
})

export const ResumeDownloadIntent = AppIntentManager.register({
  name: "PixivResumeDownloadIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (taskId?: string) => {
    await dispatchTaskAction("resume", taskId)
  },
})

export const CancelDownloadIntent = AppIntentManager.register({
  name: "PixivCancelDownloadIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (taskId?: string) => {
    await dispatchTaskAction("cancel", taskId)
  },
})
