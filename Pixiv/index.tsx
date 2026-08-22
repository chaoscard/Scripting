import { Navigation, Script } from "scripting"
import { RootView } from "./src/ui/root"
import { flushHistory, prepareHistoryStorage } from "./src/store/history"
import { prepareSettingsStorage } from "./src/store/settings"
import { prepareBlocklistStorage } from "./src/store/blocklist"

async function main() {
  try {
    Script.onResume(() => {
      // 保持长驻实例监听
    })
    Script.onMinimize(() => {
      flushHistory()
    })
    Script.enableMinimize()

    await Promise.all([
      prepareHistoryStorage(),
      prepareSettingsStorage(),
      prepareBlocklistStorage(),
    ]).catch(() => {})

    await Navigation.present({
      element: <RootView />,
      modalPresentationStyle: "overFullScreen",
    })
    flushHistory()
    Script.exit()
  } catch (e) {
    flushHistory()
    console.present().then(Script.exit)
    console.error(e)
  }
}

main()
