import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { advanceWidgetArtwork, toggleWidgetArtworkBookmark } from "./src/store/widgetStore"

declare const Haptics: any

export const NextArtworkIntent = AppIntentManager.register({
  name: "PixivNextArtworkIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (param?: string) => {
    try {
      try {
        void Haptics.transient()
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
        void Haptics.transient(0.8, 0.8)
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
  if (globalTaskHandler) {
    try {
      return await globalTaskHandler(action, taskId)
    } catch (e: any) {
      console.log(`dispatchTaskAction ${action} error:`, e?.message ?? e)
      return false
    }
  }
  try {
    const { DownloadTaskManager } = await import("./src/downloader/downloadTaskManager")
    if (action === "pause") {
      return await DownloadTaskManager.pauseTask(taskId)
    } else if (action === "resume") {
      return await DownloadTaskManager.resumeTask(taskId)
    } else if (action === "cancel") {
      return await DownloadTaskManager.cancelTask(taskId)
    }
  } catch (err: any) {
    console.log(`dispatchTaskAction lazy import error:`, err?.message ?? err)
  }
  return false
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
