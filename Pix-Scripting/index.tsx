import { Navigation, Script } from "scripting"
import { RootView } from "./src/ui/root"
import { flushHistory, prepareHistoryStorage } from "./src/store/history"
import { prepareSettingsStorage } from "./src/store/settings"
import { prepareBlocklistStorage } from "./src/store/blocklist"
import { flushNovelProgress, prepareNovelProgressStorage } from "./src/store/novelProgress"
import { prepareSearchHistoryStorage } from "./src/store/searchHistory"

async function main() {
  try {
    Script.onResume(() => {
      // 保持长驻实例监听
    })
    Script.onMinimize(() => {
      flushHistory()
      flushNovelProgress()
    })
    Script.enableMinimize()

    await Promise.all([
      prepareHistoryStorage(),
      prepareSettingsStorage(),
      prepareBlocklistStorage(),
      prepareNovelProgressStorage(),
      prepareSearchHistoryStorage(),
    ]).catch(() => {})

    await Navigation.present({
      element: <RootView />,
      modalPresentationStyle: "overFullScreen",
    })
    flushHistory()
    flushNovelProgress()
    Script.exit()
  } catch (e) {
    flushHistory()
    flushNovelProgress()
    console.present().then(Script.exit)
    console.error(e)
  }
}

main()
