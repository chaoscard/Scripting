import { flushHistory, prepareHistoryStorage } from "./store/history"
import { prepareSettingsStorage } from "./store/settings"
import { prepareBlocklistStorage } from "./store/blocklist"
import { flushNovelProgress, prepareNovelProgressStorage } from "./store/novelProgress"
import { flushSearchHistory, prepareSearchHistoryStorage } from "./store/searchHistory"
import { flushSeriesCache, prepareSeriesCacheStorage } from "./store/seriesCache"
import { startHistorySyncScheduler, triggerResumeSync } from "./store/historySync"
import { populateWidgetPool, seedIllustFromWidgetPool, seedPixivisionFromWidgetPool } from "./store/widgetStore"
import { normalizeRoute } from "./ui/routes"
import { abortAllAITasks } from "./api/aiService"

let stopSyncScheduler: (() => void) | null = null

export function seedIfRoute(route?: string | null) {
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

export async function bootstrapStorage() {
  const storageTasks = [
    { name: "history", task: prepareHistoryStorage() },
    { name: "settings", task: prepareSettingsStorage() },
    { name: "blocklist", task: prepareBlocklistStorage() },
    { name: "novelProgress", task: prepareNovelProgressStorage() },
    { name: "searchHistory", task: prepareSearchHistoryStorage() },
    { name: "seriesCache", task: prepareSeriesCacheStorage() },
  ]

  const storageResults = await Promise.allSettled(storageTasks.map((t) => t.task))
  for (let i = 0; i < storageResults.length; i++) {
    const res = storageResults[i]
    if (res.status === "rejected") {
      console.log(`[Storage] prepare ${storageTasks[i].name} storage notice:`, res.reason?.message ?? res.reason)
    }
  }
}

export function startBackgroundServices() {
  // 后台静默预热小组件数据池
  populateWidgetPool().catch(() => {})

  // 启动低频 iCloud 同步调度器 (5s启动延迟 + 15分钟周期)
  if (!stopSyncScheduler) {
    stopSyncScheduler = startHistorySyncScheduler()
  }
}

export function stopBackgroundServices() {
  try {
    if (stopSyncScheduler) {
      stopSyncScheduler()
      stopSyncScheduler = null
    }
  } catch {}
}

export function flushAllCaches() {
  try {
    flushHistory()
    flushNovelProgress()
    flushSearchHistory()
    flushSeriesCache()
  } catch {}
}

export function cleanupAppResources() {
  stopBackgroundServices()
  try {
    abortAllAITasks()
  } catch {}
  flushAllCaches()
}
