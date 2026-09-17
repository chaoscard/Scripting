import { useEffect, useObservable } from "scripting"
import {
  getActiveTabKind,
  registerTabNavigator,
  setActiveTabKind,
  setPixivRouteNavigator,
  type PixivTabKind,
} from "../store/routeNavigation"
import { DiscoveryView } from "./discovery"
import { RankingView } from "./ranking"
import { FollowFeedView } from "./followFeed"
import { MoreView } from "./more"

/**
 * 五个 Tab 的**内容真源** —— TabView 外壳与 iPad 分栏外壳共用同一份定义。
 *
 * 为什么要有这个文件：
 * 分栏外壳（splitShell）需要一个「侧边栏条目列表」，TabView 外壳需要五个 <Tab>。
 * 两者背后必须是**同一个 Tab 集合、同一套标题与图标、同一个根视图**，否则一旦新增/改名
 * 就会出现「侧边栏有、Tab 栏没有」这类不一致。
 * ⇒ 任何 Tab 的新增 / 改名 / 换图标 / 换根视图，只改这里的 TAB_CONTENT_DEFS。
 */

/** 延迟引用 SearchView，避免深层循环依赖（沿既有做法） */
function SearchView(props: any): any {
  const mod = require("./search")
  const Comp = mod.SearchView || mod.default
  return <Comp {...props} />
}

export interface TabContentDef {
  id: PixivTabKind
  title: string
  systemImage: string
  /** 仅「搜索」需要 role="search" */
  role?: "search"
  /** 该 Tab 的根视图（外壳只负责把它放进 NavigationStack） */
  renderRoot: (props: { onClose: () => void }) => any
}

export const TAB_CONTENT_DEFS: TabContentDef[] = [
  {
    id: "discovery",
    title: "探索",
    systemImage: "photo.on.rectangle.angled",
    renderRoot: (props) => <DiscoveryView onClose={props.onClose} />,
  },
  {
    id: "ranking",
    title: "排行",
    systemImage: "trophy",
    renderRoot: (props) => <RankingView onClose={props.onClose} />,
  },
  {
    id: "following",
    title: "关注",
    systemImage: "person.2.fill",
    renderRoot: (props) => <FollowFeedView onClose={props.onClose} />,
  },
  {
    id: "search",
    title: "搜索",
    systemImage: "magnifyingglass",
    role: "search",
    renderRoot: (props) => <SearchView onClose={props.onClose} />,
  },
  {
    id: "more",
    title: "我的",
    systemImage: "person.crop.circle",
    renderRoot: (props) => <MoreView onClose={props.onClose} />,
  },
]

export interface TabPaths {
  discoveryPath: Observable<string[]>
  rankingPath: Observable<string[]>
  followingPath: Observable<string[]>
  searchPath: Observable<string[]>
  morePath: Observable<string[]>
}

/** 取某个 Tab 对应的导航栈 */
export function pathObservableForTab(tab: string, paths: TabPaths): Observable<string[]> {
  if (tab === "ranking") return paths.rankingPath
  if (tab === "following") return paths.followingPath
  if (tab === "search") return paths.searchPath
  if (tab === "more") return paths.morePath
  return paths.discoveryPath
}

/**
 * 五个 Tab 的独立导航栈 + 全局路由分发注册 —— **外壳无关**的基础设施。
 *
 * 两个外壳（TabView / 分栏）都必须调用它，路由行为才一致：
 * 无论从卡片、小组件还是深度链接进来，都落到「当前 Tab 自己的栈」上。
 */
export function useTabNavigation<T extends string | null>(selection: Observable<T>): TabPaths {
  const discoveryPath = useObservable<string[]>([])
  const rankingPath = useObservable<string[]>([])
  const followingPath = useObservable<string[]>([])
  const searchPath = useObservable<string[]>([])
  const morePath = useObservable<string[]>([])

  // 活跃 Tab 追踪：供全局路由分发器判断「该落到哪个栈」
  useEffect(() => {
    const current = String(selection.value ?? "discovery") as PixivTabKind
    setActiveTabKind(current)
    return selection.subscribe
      ? (selection.subscribe(() => {
          setActiveTabKind(String(selection.value ?? "discovery") as PixivTabKind)
        }) as any)
      : undefined
  }, [selection])

  useEffect(() => {
    const push = (path: Observable<string[]>, route: string) => {
      const cur = path.value
      if (cur.length > 0 && cur[cur.length - 1] === route) return
      path.setValue([...cur, route])
    }

    const unregisterDiscovery = registerTabNavigator("discovery", (route) => push(discoveryPath, route))
    const unregisterRanking = registerTabNavigator("ranking", (route) => push(rankingPath, route))
    const unregisterFollowing = registerTabNavigator("following", (route) => push(followingPath, route))
    const unregisterSearch = registerTabNavigator("search", (route) => push(searchPath, route))
    const unregisterMore = registerTabNavigator("more", (route) => push(morePath, route))

    const paths: TabPaths = { discoveryPath, rankingPath, followingPath, searchPath, morePath }

    const unregisterGlobal = setPixivRouteNavigator((route: string) => {
      const activeTab =
        getActiveTabKind() || (String(selection.value ?? "discovery") as PixivTabKind)
      push(pathObservableForTab(activeTab, paths), route)
    })

    return () => {
      unregisterDiscovery()
      unregisterRanking()
      unregisterFollowing()
      unregisterSearch()
      unregisterMore()
      unregisterGlobal()
    }
  }, [selection, discoveryPath, rankingPath, followingPath, searchPath, morePath])

  return { discoveryPath, rankingPath, followingPath, searchPath, morePath }
}
