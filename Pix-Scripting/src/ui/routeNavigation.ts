import { normalizeRoute } from "./routes"

export type PixivRoute = string
export type PixivTabKind = "discovery" | "ranking" | "following" | "search" | "more"

type PixivRouteNavigator = (route: PixivRoute) => void

let activeTabKind: PixivTabKind = "discovery"
const tabNavigators: Partial<Record<PixivTabKind, PixivRouteNavigator>> = {}
let globalNavigator: PixivRouteNavigator | null = null
let pendingRoute: { route: PixivRoute; explicitTab?: PixivTabKind } | null = null

export function setActiveTabKind(tab: PixivTabKind): void {
  activeTabKind = tab
}

export function getActiveTabKind(): PixivTabKind {
  return activeTabKind
}

export function registerTabNavigator(
  tab: PixivTabKind,
  nav: PixivRouteNavigator
): () => void {
  tabNavigators[tab] = nav
  if (pendingRoute && (!pendingRoute.explicitTab || pendingRoute.explicitTab === tab)) {
    const r = pendingRoute
    pendingRoute = null
    setTimeout(() => {
      nav(r.route)
    }, 150)
  }
  return () => {
    if (tabNavigators[tab] === nav) {
      delete tabNavigators[tab]
    }
  }
}

export function setPixivRouteNavigator(
  nextNavigator: PixivRouteNavigator
): () => void {
  globalNavigator = nextNavigator
  if (pendingRoute) {
    const r = pendingRoute
    pendingRoute = null
    setTimeout(() => {
      nextNavigator(r.route)
    }, 150)
  }
  return () => {
    if (globalNavigator === nextNavigator) globalNavigator = null
  }
}

export function requestPixivRoute(
  rawRoute: PixivRoute,
  explicitTab?: PixivTabKind
): void {
  if (!rawRoute) return
  const route = normalizeRoute(rawRoute)
  if (!route) return

  const targetTab = explicitTab || activeTabKind
  const tabNav = tabNavigators[targetTab]
  if (tabNav) {
    // 延迟 120ms 派发，确保系统 Context Menu / 弹窗的 Dismiss 动画完成后无阻碍 Push
    setTimeout(() => {
      tabNav(route)
    }, 120)
    return
  }

  if (globalNavigator) {
    setTimeout(() => {
      globalNavigator?.(route)
    }, 120)
    return
  }

  pendingRoute = { route, explicitTab }
}
