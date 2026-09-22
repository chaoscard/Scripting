import {
  Device,
  NavigationStack,
  Tab,
  TabView,
  useEffect,
  useObservable,
  useRef,
  useState,
  type Color,
} from "scripting"
import { loadSettings, onSettingsChanged } from "../store/settings"
import {
  CapsuleAccessoryContainer,
  GlobalBottomAccessoryHost,
} from "./bottomAccessory"
import {
  getActiveTabKind,
  registerTabNavigator,
  setActiveTabKind,
  setPixivRouteNavigator,
  type PixivTabKind,
} from "../store/routeNavigation"
import { DiscoveryView } from "./DiscoveryView"
import { RankingView } from "./RankingView"
import { FollowFeedView } from "./FollowFeedView"
import { MoreView } from "./MoreView"

/**
 * 五个 Tab 的**内容真源** —— 单栏外壳与 iPad 平行视界双栏外壳共用同一份定义。
 *
 * 为什么要有这个文件：
 * 单栏外壳（TabViewShell）与平行视界外壳（SplitShell）背后的主浏览流均基于 MainTabView。
 * 两者背后必须是**同一个 Tab 集合、同一套标题与图标、同一个根视图**，
 * 且搜索 Tab 固定位于最末位声明 role="search" 支持 iOS 26 智能滚动收缩胶囊。
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
    id: "more",
    title: "我的",
    systemImage: "person.crop.circle",
    renderRoot: (props) => <MoreView onClose={props.onClose} />,
  },
  {
    id: "search",
    title: "搜索",
    systemImage: "magnifyingglass",
    role: "search",
    renderRoot: (props) => <SearchView onClose={props.onClose} />,
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

/**
 * 完整的主 TabView 组件 —— 承载 5 个 Tab、路由分发与底部配件。
 * 供单栏 TabViewShell 与分栏 SplitShell 共同直接复用，杜绝生命周期分裂与双重导航嵌套。
 */
export function MainTabView(props: {
  onClose: () => void
  tabViewStyle?: "tabBarOnly" | "sidebarAdaptable"
}) {
  const [settings, setSettings] = useState(() => loadSettings())
  const initialTab = useRef(settings.launchPage).current
  const selection = useObservable<string>(initialTab)
  // 五个 Tab 的导航栈与全局路由分发：与分栏外壳共用同一套基础设施
  const paths = useTabNavigation(selection)

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  const isAppleMusic = settings.pageLayout === "appleMusic"
  const tabTint =
    settings.glassCustomTintEnabled && settings.glassTintColor
      ? (settings.glassTintColor as Color)
      : undefined

  const tabViewProps: any = {
    selection,
    tabBarMinimizeBehavior: "onScrollDown",
    tabViewSearchActivation:
      (props.tabViewStyle ?? "sidebarAdaptable") === "tabBarOnly"
        ? undefined
        : "automatic",
    tabViewStyle: props.tabViewStyle ?? "sidebarAdaptable",
    tint: tabTint,
  }

  if (isAppleMusic) {
    tabViewProps.tabViewBottomAccessory = (
      <CapsuleAccessoryContainer>
        <GlobalBottomAccessoryHost selection={selection} {...paths} />
      </CapsuleAccessoryContainer>
    )
  }

  // 取 Tab 定义（仍以 TAB_CONTENT_DEFS 为唯一真源）
  const def = (id: string) =>
    TAB_CONTENT_DEFS.find((item) => item.id === id) ?? TAB_CONTENT_DEFS[0]
  const discovery = def("discovery")
  const ranking = def("ranking")
  const following = def("following")
  const search = def("search")
  const more = def("more")

  // ⚠️ <Tab> 必须作为 <TabView> 的**显式直接子节点**书写（不能用 .map 生成数组，
  //    真机桥接对数组中 Tab 的识别不可靠，会导致整个外壳空白）
  return (
    <TabView {...tabViewProps}>
      <Tab
        title={discovery.title}
        systemImage={discovery.systemImage}
        value={discovery.id}
      >
        <NavigationStack path={paths.discoveryPath}>
          {discovery.renderRoot({ onClose: props.onClose })}
        </NavigationStack>
      </Tab>
      <Tab title={ranking.title} systemImage={ranking.systemImage} value={ranking.id}>
        <NavigationStack path={paths.rankingPath}>
          {ranking.renderRoot({ onClose: props.onClose })}
        </NavigationStack>
      </Tab>
      <Tab
        title={following.title}
        systemImage={following.systemImage}
        value={following.id}
      >
        <NavigationStack path={paths.followingPath}>
          {following.renderRoot({ onClose: props.onClose })}
        </NavigationStack>
      </Tab>
      <Tab title={more.title} systemImage={more.systemImage} value={more.id}>
        <NavigationStack path={paths.morePath}>
          {more.renderRoot({ onClose: props.onClose })}
        </NavigationStack>
      </Tab>
      <Tab
        title={search.title}
        systemImage={search.systemImage}
        value={search.id}
        role="search"
      >
        <NavigationStack path={paths.searchPath}>
          {search.renderRoot({ onClose: props.onClose })}
        </NavigationStack>
      </Tab>
    </TabView>
  )
}
