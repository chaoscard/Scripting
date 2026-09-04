import {
  Image,
  Navigation,
  NavigationStack,
  ProgressView,
  Script,
  Spacer,
  Tab,
  TabView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useRef,
  useState,
} from "scripting"
import { session } from "../api/session"
import { loadSettings } from "../store/settings"
import { DiscoveryView } from "./discovery"
import { RankingView } from "./ranking"
import { SearchView } from "./search"
import { MoreView } from "./more"
import { LoginView } from "./login"
import { FollowFeedView } from "./followFeed"
import {
  registerTabNavigator,
  setActiveTabKind,
  getActiveTabKind,
  setPixivRouteNavigator,
  type PixivTabKind,
} from "./routeNavigation"

function LaunchExperienceView() {
  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="systemBackground"
      ignoresSafeArea={true}
    >
      <VStack
        alignment="center"
        spacing={20}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <Spacer />
        <VStack alignment="center" spacing={14}>
          <Image
            systemName="paintpalette.fill"
            font="largeTitle"
            foregroundStyle="#0096FA"
          />
          <Text font="title2" fontWeight="bold">
            Pix-Scripting
          </Text>
        </VStack>
        <ProgressView progressViewStyle="circular" />
        <Spacer />
      </VStack>
    </ZStack>
  )
}

export function RootView() {
  const [loggedIn, setLoggedIn] = useState(session.isAuthenticated)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    return session.onAuthChanged(() => {
      setLoggedIn(session.isAuthenticated)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const hasStartupRoute = Boolean(
      Script.queryParameters?.route || Script.widgetParameter
    )
    const defaultDuration = loadSettings().launchAnimationDuration ?? 1500
    // 冷启动过渡体验：从小组件/外部直达特定作品时缩短至 100ms，直接展现内容；常规启动保留完整就绪缓冲
    const duration = hasStartupRoute ? 100 : defaultDuration
    const timer = setTimeout(() => {
      if (!cancelled) {
        setIsReady(true)
      }
    }, duration)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  const dismiss = Navigation.useDismiss()

  if (!loggedIn) {
    return (
      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background="systemBackground"
        ignoresSafeArea={true}
      >
        <NavigationStack>
          <LoginView
            onClose={dismiss}
            onSuccess={() => {
              setLoggedIn(true)
            }}
          />
        </NavigationStack>
      </ZStack>
    )
  }

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="systemBackground"
      ignoresSafeArea={true}
    >
      {/* 底层：主界面在第 0 毫秒即挂载并全力在后台请求数据与预载图片 */}
      <MainTabView onClose={dismiss} />

      {/* 顶层：启动动画遮罩，根据调试设置自定义时长（默认 1500ms）平滑过渡 */}
      {!isReady ? (
        <LaunchExperienceView />
      ) : null}
    </ZStack>
  )
}

function MainTabView(props: {
  onClose: () => void
}) {
  const initialTab = useRef(loadSettings().launchPage).current
  const selection = useObservable<string>(initialTab)
  const discoveryPath = useObservable<string[]>([])
  const rankingPath = useObservable<string[]>([])
  const followingPath = useObservable<string[]>([])
  const searchPath = useObservable<string[]>([])
  const morePath = useObservable<string[]>([])

  useEffect(() => {
    const unregisterDiscovery = registerTabNavigator("discovery", (route) => {
      discoveryPath.setValue([...discoveryPath.value, route])
    })
    const unregisterRanking = registerTabNavigator("ranking", (route) => {
      rankingPath.setValue([...rankingPath.value, route])
    })
    const unregisterFollowing = registerTabNavigator("following", (route) => {
      followingPath.setValue([...followingPath.value, route])
    })
    const unregisterSearch = registerTabNavigator("search", (route) => {
      searchPath.setValue([...searchPath.value, route])
    })
    const unregisterMore = registerTabNavigator("more", (route) => {
      morePath.setValue([...morePath.value, route])
    })

    const unregisterGlobal = setPixivRouteNavigator((route: string) => {
      const activeTab = getActiveTabKind() || (selection.value as PixivTabKind) || initialTab || "discovery"
      if (activeTab === "ranking") {
        rankingPath.setValue([...rankingPath.value, route])
      } else if (activeTab === "following") {
        followingPath.setValue([...followingPath.value, route])
      } else if (activeTab === "search") {
        searchPath.setValue([...searchPath.value, route])
      } else if (activeTab === "more") {
        morePath.setValue([...morePath.value, route])
      } else {
        discoveryPath.setValue([...discoveryPath.value, route])
      }
    })

    return () => {
      unregisterDiscovery()
      unregisterRanking()
      unregisterFollowing()
      unregisterSearch()
      unregisterMore()
      unregisterGlobal()
    }
  }, [selection, discoveryPath, rankingPath, followingPath, searchPath, morePath, initialTab])

  return (
    <TabView
      selection={selection}
      tabBarMinimizeBehavior="onScrollDown"
    >
      <Tab title="探索" systemImage="photo.on.rectangle.angled" value="discovery">
        <NavigationStack path={discoveryPath}>
          <DiscoveryView onClose={props.onClose} />
        </NavigationStack>
      </Tab>
      <Tab title="排行" systemImage="trophy" value="ranking">
        <NavigationStack path={rankingPath}>
          <RankingView onClose={props.onClose} />
        </NavigationStack>
      </Tab>
      <Tab title="关注" systemImage="person.2.fill" value="following">
        <NavigationStack path={followingPath}>
          <FollowFeedView onClose={props.onClose} />
        </NavigationStack>
      </Tab>
      <Tab title="搜索" systemImage="magnifyingglass" value="search" role="search">
        <NavigationStack path={searchPath}>
          <SearchView onClose={props.onClose} />
        </NavigationStack>
      </Tab>
      <Tab title="我的" systemImage="person.crop.circle" value="more">
        <NavigationStack path={morePath}>
          <MoreView onClose={props.onClose} />
        </NavigationStack>
      </Tab>
    </TabView>
  )
}
