import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { advanceWidgetArtwork } from "./src/store/widgetStore"
import { DownloadTaskManager } from "./src/downloader/downloadTaskManager"

export const NextArtworkIntent = AppIntentManager.register({
  name: "PixivNextArtworkIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (param?: string) => {
    try {
      await advanceWidgetArtwork(param)
      Widget.reloadAll()
    } catch (e: any) {
      console.log("NextArtworkIntent error:", e?.message ?? e)
    }
  },
})

export const PauseDownloadIntent = AppIntentManager.register({
  name: "PixivPauseDownloadIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (taskId?: string) => {
    try {
      await DownloadTaskManager.pauseTask(taskId)
    } catch (e: any) {
      console.log("PauseDownloadIntent error:", e?.message ?? e)
    }
  },
})

export const ResumeDownloadIntent = AppIntentManager.register({
  name: "PixivResumeDownloadIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (taskId?: string) => {
    try {
      await DownloadTaskManager.resumeTask(taskId)
    } catch (e: any) {
      console.log("ResumeDownloadIntent error:", e?.message ?? e)
    }
  },
})

export const CancelDownloadIntent = AppIntentManager.register({
  name: "PixivCancelDownloadIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (taskId?: string) => {
    try {
      await DownloadTaskManager.cancelTask(taskId)
    } catch (e: any) {
      console.log("CancelDownloadIntent error:", e?.message ?? e)
    }
  },
})
