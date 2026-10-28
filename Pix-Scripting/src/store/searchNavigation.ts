import type { AdvancedSearchParams, SearchScope, SearchSort } from "../types"

export interface SearchSessionParams {
  keyword: string
  scope?: SearchScope
  sort?: SearchSort
  advancedParams?: AdvancedSearchParams
}

export interface TabPathController {
  popToRoot: () => void
  pop: (count?: number) => void
}

let nextSessionId = 1
const searchSessionStore = new Map<number, SearchSessionParams>()

export function createSearchSession(params: SearchSessionParams): number {
  const id = nextSessionId++
  searchSessionStore.set(id, params)
  return id
}

export function getSearchSession(id: number): SearchSessionParams | undefined {
  return searchSessionStore.get(id)
}

export function searchResultsRoute(id: number): string {
  return `searchResults:${id}`
}

export function parseSearchResultsRoute(route: string): number | null {
  if (typeof route !== "string") return null
  const prefix = "searchResults:"
  if (!route.startsWith(prefix)) return null
  const id = parseInt(route.slice(prefix.length), 10)
  return Number.isFinite(id) ? id : null
}

const tabControllers = new Map<string, TabPathController>()

export function registerTabPathController(tab: string, controller: TabPathController): () => void {
  tabControllers.set(tab, controller)
  return () => {
    if (tabControllers.get(tab) === controller) {
      tabControllers.delete(tab)
    }
  }
}

export function popTabToRoot(tab: string): boolean {
  const controller = tabControllers.get(tab)
  if (controller) {
    controller.popToRoot()
    return true
  }
  return false
}

export function popTabLevel(tab: string, count = 1): boolean {
  const controller = tabControllers.get(tab)
  if (controller) {
    controller.pop(count)
    return true
  }
  return false
}

