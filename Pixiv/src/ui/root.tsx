import {
  Image,
  Navigation,
  NavigationStack,
  ProgressView,
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
import { setPixivRouteNavigator } from "./routeNavigation"

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
            Pixiv
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
    // 冷启动过渡体验：启动就绪缓冲（2000ms），给首屏网络请求与首批图片解码留出充分时间，
    // 确保过渡后首屏卡片与图片完全就绪、无空白闪烁。
    const timer = setTimeout(() => {
      if (!cancelled) {
        setIsReady(true)
      }
    }, 2000)
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

      {/* 顶层：启动动画遮罩，动画期间遮挡并给首屏预热留出 2 秒时间，就绪后移开 */}
      {!isReady ? (
        <LaunchExperienceView />
      ) : null}
    </ZStack>
  )
}

export function TabNavigationStack(props: { children: any }) {
  return <NavigationStack>{props.children}</NavigationStack>
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
    return setPixivRouteNavigator((route: string) => {
      const activeTab = selection.value
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
  }, [selection, discoveryPath, rankingPath, followingPath, searchPath, morePath])

  return (
    <TabView
      selection={selection}
      tabBarMinimizeBehavior="onScrollDown"
    >
      <Tab title="探索" systemImage="photo.on.rectangle.angled" value="discovery">
        <NavigationStack path={discoveryPath}>
          <DiscoveryView
            onClose={props.onClose}
            active={selection.value === "discovery"}
          />
        </NavigationStack>
      </Tab>
      <Tab title="排行" systemImage="trophy" value="ranking">
        <NavigationStack path={rankingPath}>
          <RankingView
            onClose={props.onClose}
            active={selection.value === "ranking"}
          />
        </NavigationStack>
      </Tab>
      <Tab title="关注" systemImage="person.2.fill" value="following">
        <NavigationStack path={followingPath}>
          <FollowFeedView
            onClose={props.onClose}
            active={selection.value === "following"}
          />
        </NavigationStack>
      </Tab>
      <Tab title="搜索" systemImage="magnifyingglass" value="search" role="search">
        <NavigationStack path={searchPath}>
          <SearchView
            onClose={props.onClose}
            active={selection.value === "search"}
          />
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
