import { Navigation, Script } from "scripting"
import { RootView } from "./src/ui/root"
import { prepareHistoryStorage } from "./src/store/history"
import { prepareSettingsStorage } from "./src/store/settings"
import { prepareBlocklistStorage } from "./src/store/blocklist"

async function main() {
  try {
    Script.onResume(() => {
      // 保持长驻实例监听
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
    Script.exit()
  } catch (e) {
    console.present().then(Script.exit)
    console.error(e)
  }
}

main()
