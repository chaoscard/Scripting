import { useEffect, useState } from "scripting"

// 解析与规范化各类路由格式（支持 URL 编码如 %3A、纯数字 ID、Pixiv 网页链接等）
export function normalizeRoute(rawRoute: string): string {
  if (!rawRoute || typeof rawRoute !== "string") return ""
  let decoded = rawRoute.trim()
  try {
    decoded = decodeURIComponent(decoded)
  } catch {}
  if (
    decoded.includes("%3A") ||
    decoded.includes("%3a") ||
    decoded.includes("%2F") ||
    decoded.includes("%2f")
  ) {
    try {
      decoded = decodeURIComponent(decoded)
    } catch {}
  }
  decoded = decoded.replace(/^["']|["']$/g, "").trim()
  if (!decoded) return ""

  // 纯数字当作插画/漫画 ID
  if (/^\d+$/.test(decoded)) {
    return `illust:${decoded}`
  }
  // 网页链接匹配 https://www.pixiv.net/artworks/123456
  const artworkMatch = decoded.match(/(?:artworks|i)\/(\d+)/i) || decoded.match(/illust_id=(\d+)/i)
  if (artworkMatch) {
    return `illust:${artworkMatch[1]}`
  }
  const mangaSeriesMatch =
    decoded.match(/(?:user|users)\/\d+\/series\/(\d+)/i) ||
    decoded.match(/manga\/series\/(\d+)/i) ||
    decoded.match(/(?:illust_series|user_series)\.php\?series_id=(\d+)/i)
  if (mangaSeriesMatch) {
    return `mangaSeries:${mangaSeriesMatch[1]}`
  }
  const novelSeriesMatch =
    decoded.match(/novel\/series\/(\d+)/i) ||
    decoded.match(/novel\/series\.php\?id=(\d+)/i)
  if (novelSeriesMatch) {
    return `novelSeries:${novelSeriesMatch[1]}`
  }
  const pixivisionMatch = decoded.match(/(?:pixivision\.net)?\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?a\/(\d+)/)
  if (pixivisionMatch) {
    return `pixivision:${pixivisionMatch[1]}`
  }
  const pixivisionTagMatch = decoded.match(/(?:pixivision\.net)?\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?t\/([^/?#]+)/)
  if (pixivisionTagMatch) {
    return `pixivision-tag:${pixivisionTagMatch[1]}`
  }
  const novelMatch = decoded.match(/novel\/(?:show|series)\.php\?id=(\d+)/) || decoded.match(/novel\/(?:show|show\.php\?id=)(\d+)/i) || decoded.match(/novel_id=(\d+)/i)
  if (novelMatch) {
    return `novel:${novelMatch[1]}`
  }
  const userMatch = decoded.match(/(?:users|user|u)\/(\d+)/i) || decoded.match(/member\.php\?id=(\d+)/i)
  if (userMatch) {
    return `user:${userMatch[1]}`
  }
  return decoded
}

type RouteRenderer = (path: string) => any
let globalRouteRenderer: RouteRenderer | null = null
let activeDetailRouteRenderer: RouteRenderer | null = null

export function setGlobalRouteRenderer(renderer: RouteRenderer | null): void {
  globalRouteRenderer = renderer
}

export function renderDestination(path: string): any {
  return globalRouteRenderer ? globalRouteRenderer(path) : null
}

export function setDetailRouteRenderer(renderer: RouteRenderer | null): void {
  activeDetailRouteRenderer = renderer
}

export function renderDetailDestination(route: string): any {
  return activeDetailRouteRenderer ? activeDetailRouteRenderer(route) : null
}

export type PixivRoute = string
export type PixivTabKind = "discovery" | "ranking" | "following" | "search" | "more"

export type PixivRouteNavigator = (route: PixivRoute) => void

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
