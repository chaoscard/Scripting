import { Navigation, Script } from "scripting"
import { RootView } from "./src/ui/root"
import { flushHistory, prepareHistoryStorage } from "./src/store/history"
import { prepareSettingsStorage } from "./src/store/settings"
import { prepareBlocklistStorage } from "./src/store/blocklist"
import { flushNovelProgress, prepareNovelProgressStorage } from "./src/store/novelProgress"
import { flushSearchHistory, prepareSearchHistoryStorage } from "./src/store/searchHistory"
import { flushSeriesCache, prepareSeriesCacheStorage } from "./src/store/seriesCache"
import { startHistorySyncScheduler, triggerResumeSync } from "./src/store/historySync"
import { requestPixivRoute } from "./src/ui/routeNavigation"
import { populateWidgetPool, seedIllustFromWidgetPool, seedPixivisionFromWidgetPool } from "./src/store/widgetStore"
import { normalizeRoute } from "./src/ui/routes"
import { abortAllAITasks } from "./src/api/aiService"

function seedIfRoute(route?: string | null) {
  if (!route) return
  const norm = normalizeRoute(route)
  if (norm.startsWith("illust:")) {
    const id = Number(norm.slice("illust:".length))
    if (Number.isFinite(id) && id > 0) {
      seedIllustFromWidgetPool(id)
    }
  } else if (norm.startsWith("pixivision:")) {
    const id = Number(norm.slice("pixivision:".length))
    if (Number.isFinite(id) && id > 0) {
      seedPixivisionFromWidgetPool(id)
    }
  }
}

async function main() {
  try {
    const startupRoute =
      (Script.queryParameters?.route as string | undefined) ||
      (Script.widgetParameter
        ? (Script.widgetParameter.includes(":") ? Script.widgetParameter : `illust:${Script.widgetParameter}`)
        : null)
    if (startupRoute && typeof startupRoute === "string") {
      seedIfRoute(startupRoute)
      requestPixivRoute(startupRoute)
    }

    Script.onResume((details) => {
      const resumeRoute =
        (details.queryParameters?.route as string | undefined) ||
        (details.widgetParameter
          ? (details.widgetParameter.includes(":") ? details.widgetParameter : `illust:${details.widgetParameter}`)
          : null)
      if (resumeRoute && typeof resumeRoute === "string") {
        seedIfRoute(resumeRoute)
        requestPixivRoute(resumeRoute)
      }
      triggerResumeSync()
    })
    Script.onMinimize(() => {
      flushHistory()
      flushNovelProgress()
      flushSearchHistory()
      flushSeriesCache()
    })
    Script.enableMinimize()

    await Promise.all([
      prepareHistoryStorage(),
      prepareSettingsStorage(),
      prepareBlocklistStorage(),
      prepareNovelProgressStorage(),
      prepareSearchHistoryStorage(),
      prepareSeriesCacheStorage(),
    ]).catch(() => {})

    // 后台静默预热小组件数据池
    populateWidgetPool().catch(() => {})

    // 启动低频 iCloud 同步调度器 (5s启动延迟 + 15分钟周期)
    const stopSyncScheduler = startHistorySyncScheduler()

    await Navigation.present({
      element: <RootView />,
      modalPresentationStyle: "overFullScreen",
    })
    stopSyncScheduler()
    abortAllAITasks()
    flushHistory()
    flushNovelProgress()
    flushSearchHistory()
    flushSeriesCache()
    Script.exit()
  } catch (e) {
    abortAllAITasks()
    flushHistory()
    flushNovelProgress()
    flushSearchHistory()
    flushSeriesCache()
    console.present().then(Script.exit)
    console.error(e)
  }
}

main()

