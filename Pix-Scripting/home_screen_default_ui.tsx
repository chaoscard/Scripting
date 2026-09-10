import { useEffect } from "scripting"
import { Script, ZStack } from "scripting"
import { RootView } from "./src/ui/root"
import {
  bootstrapStorage,
  startBackgroundServices,
  stopBackgroundServices,
  flushAllCaches,
  seedIfRoute,
} from "./src/bootstrap"
import { triggerResumeSync } from "./src/store/historySync"
import { abortAllAITasks } from "./src/api/aiService"
import { requestPixivRoute } from "./src/ui/routeNavigation"
import { useIsFullScreen } from "./src/ui/fullScreenState"

// 顶层初始化：首次挂载 Tab 时执行存储准备与服务预热
bootstrapStorage().catch(() => {})
startBackgroundServices()

const startupRoute =
  (Script.queryParameters?.route as string | undefined) ||
  (Script.widgetParameter
    ? (Script.widgetParameter.includes(":") ? Script.widgetParameter : `illust:${Script.widgetParameter}`)
    : null)
if (startupRoute && typeof startupRoute === "string") {
  seedIfRoute(startupRoute)
  requestPixivRoute(startupRoute)
}

export default function HomeScreenEntry() {
  const isFull = useIsFullScreen()

  useEffect(() => {
    // 监听 Home Tab 切换事件
    const unsubscribeHomeTab = Script.onHomeTabEvent((event) => {
      switch (event) {
        case "selected":
          // 切回首页 Tab：触发轻量增量同步
          triggerResumeSync()
          break
        case "reselected":
          // 再次点击首页 Tab：保持原生交互
          break
        case "deselected":
          // 切离首页 Tab：暂停耗时任务并立即将缓存落盘
          abortAllAITasks()
          flushAllCaches()
          break
      }
    })

    // 监听从小组件或外部深度链接唤醒
    const unsubscribeResume = Script.onResume((details) => {
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

    return () => {
      unsubscribeHomeTab()
      unsubscribeResume()
      stopBackgroundServices()
      flushAllCaches()
    }
  }, [])

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      tabBarVisibility={isFull ? "hidden" : "visible"}
    >
      <RootView />
    </ZStack>
  )
}
