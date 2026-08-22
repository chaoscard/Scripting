export type PixivRoute = string

type PixivRouteNavigator = (route: PixivRoute) => void

let navigator: PixivRouteNavigator | null = null

export function setPixivRouteNavigator(
  nextNavigator: PixivRouteNavigator
): () => void {
  navigator = nextNavigator
  return () => {
    if (navigator === nextNavigator) navigator = null
  }
}

export function requestPixivRoute(route: PixivRoute): void {
  navigator?.(route)
}
