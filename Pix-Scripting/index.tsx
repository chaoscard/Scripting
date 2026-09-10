import { Navigation, Script } from "scripting"
import { RootView } from "./src/ui/root"
import {
  bootstrapStorage,
  cleanupAppResources,
  flushAllCaches,
  seedIfRoute,
  startBackgroundServices,
} from "./src/bootstrap"
import { triggerResumeSync } from "./src/store/historySync"
import { requestPixivRoute } from "./src/ui/routeNavigation"

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
      flushAllCaches()
    })
    Script.enableMinimize()

    await bootstrapStorage()
    startBackgroundServices()

    await Navigation.present({
      element: <RootView />,
      modalPresentationStyle: "fullScreen",
    })
  } catch (e: any) {
    console.error("Main app runtime error:", e)
    try {
      await console.present()
    } catch {}
  } finally {
    cleanupAppResources()
    Script.exit()
  }
}

main()
