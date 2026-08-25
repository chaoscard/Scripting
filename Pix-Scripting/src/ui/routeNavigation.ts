import { normalizeRoute } from "./routes"

export type PixivRoute = string

type PixivRouteNavigator = (route: PixivRoute) => void

let navigator: PixivRouteNavigator | null = null
let pendingRoute: PixivRoute | null = null

export function setPixivRouteNavigator(
  nextNavigator: PixivRouteNavigator
): () => void {
  navigator = nextNavigator
  if (pendingRoute) {
    const routeToPush = pendingRoute
    pendingRoute = null
    setTimeout(() => {
      nextNavigator(routeToPush)
    }, 150)
  }
  return () => {
    if (navigator === nextNavigator) navigator = null
  }
}

export function requestPixivRoute(rawRoute: PixivRoute): void {
  if (!rawRoute) return
  const route = normalizeRoute(rawRoute)
  if (!route) return
  if (navigator) {
    navigator(route)
  } else {
    pendingRoute = route
  }
}
