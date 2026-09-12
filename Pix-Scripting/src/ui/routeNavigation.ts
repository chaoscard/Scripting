import { useEffect, useState } from "scripting"
import { normalizeRoute } from "./routes"

export type PixivRoute = string
export type PixivTabKind = "discovery" | "ranking" | "following" | "search" | "more"

type PixivRouteNavigator = (route: PixivRoute) => void

let activeTabKind: PixivTabKind = "discovery"
const activeTabListeners = new Set<(tab: PixivTabKind) => void>()
const tabNavigators: Partial<Record<PixivTabKind, PixivRouteNavigator>> = {}
let globalNavigator: PixivRouteNavigator | null = null
type DualRouteDispatcher = (route: PixivRoute) => boolean
let globalDualRouteDispatcher: DualRouteDispatcher | null = null
let pendingRoute: { route: PixivRoute; explicitTab?: PixivTabKind } | null = null

export function setDualRouteDispatcher(dispatcher: DualRouteDispatcher | null): () => void {
  globalDualRouteDispatcher = dispatcher
  return () => {
    if (globalDualRouteDispatcher === dispatcher) {
      globalDualRouteDispatcher = null
    }
  }
}

export function setActiveTabKind(tab: PixivTabKind): void {
  if (activeTabKind !== tab) {
    activeTabKind = tab
    activeTabListeners.forEach((fn) => {
      try {
        fn(tab)
      } catch {}
    })
  }
}

export function onActiveTabChanged(listener: (tab: PixivTabKind) => void): () => void {
  activeTabListeners.add(listener)
  return () => {
    activeTabListeners.delete(listener)
  }
}

export function useIsCurrentTab(tab: PixivTabKind): boolean {
  const [isCurrent, setIsCurrent] = useState(() => activeTabKind === tab)
  useEffect(() => {
    setIsCurrent(activeTabKind === tab)
    return onActiveTabChanged((curr) => {
      setIsCurrent(curr === tab)
    })
  }, [tab])
  return isCurrent
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

  // 若处于双栏平行视界模式，优先分发至右侧详情宿主
  if (globalDualRouteDispatcher) {
    try {
      const handled = globalDualRouteDispatcher(route)
      if (handled) return
    } catch {}
  }

  const targetTab = explicitTab || activeTabKind
  const tabNav = tabNavigators[targetTab]
  if (tabNav) {
    try {
      tabNav(route)
    } catch {
      setTimeout(() => tabNav(route), 0)
    }
    return
  }

  if (globalNavigator) {
    try {
      globalNavigator(route)
    } catch {
      setTimeout(() => globalNavigator?.(route), 0)
    }
    return
  }

  pendingRoute = { route, explicitTab }
}
