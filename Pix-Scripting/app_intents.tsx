import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { advanceWidgetArtwork } from "./src/store/widgetStore"

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
