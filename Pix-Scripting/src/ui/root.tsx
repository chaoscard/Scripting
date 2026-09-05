import {
  Image,
  Navigation,
  NavigationStack,
  ProgressView,
  Rectangle,
  Script,
  Spacer,
  Tab,
  TabView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
} from "scripting"
import { session } from "../api/session"
import { loadSettings, onSettingsChanged } from "../store/settings"
import {
  CapsuleAccessoryContainer,
  getActiveAccessory,
  subscribeBottomAccessory,
} from "./bottomAccessory"
import { getLatestCachedArtworkPath } from "../image/imageLoader"
import { DreamyFluidBackground } from "./components/DreamyBackground"
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
  const bgImage = useMemo(() => {
    try {
      const cachedPath = getLatestCachedArtworkPath()
      if (cachedPath) {
        const raw = UIImage.fromFile(cachedPath)
        if (raw) {
          return raw.blurred(1)
        }
      }
    } catch {}
    return null
  }, [])

  return (
    <ZStack
      alignment="center"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
    >
      {/* 1. 背景层：若有缓存插画则展示柔和高斯模糊图，若无则无缝展示梦幻流体光晕 */}
      {bgImage ? (
        <>
          <Rectangle
            fill="clear"
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            ignoresSafeArea={true}
            clipped={true}
            overlay={
              <Image
                image={bgImage}
                resizable={true}
                aspectRatio={{ contentMode: "fill" }}
                frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                clipped={true}
                ignoresSafeArea={true}
              />
            }
          />
          <Rectangle
            fill={{
              colors: [
                "rgba(0, 0, 0, 0.02)",
                "rgba(0, 0, 0, 0.08)",
                "rgba(0, 0, 0, 0.18)",
              ],
              startPoint: "top",
              endPoint: "bottom",
            }}
            ignoresSafeArea={true}
          />
        </>
      ) : (
        <DreamyFluidBackground />
      )}

      {/* 2. 居中品牌字与加载组件（严格与登录页保持一致的高质感排版） */}
      <VStack
        alignment="center"
        spacing={24}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}
        padding={32}
      >
        <Text
          font={38}
          fontWeight="heavy"
          foregroundStyle="white"
          shadow={{ color: "rgba(0, 0, 0, 0.32)", radius: 10, y: 3 }}
        >
          Pix-Scripting
        </Text>
        <VStack spacing={14} alignment="center" padding={{ top: 12 }}>
          <ProgressView progressViewStyle="circular" />
        </VStack>
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
        background="clear"
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
  const [settings, setSettings] = useState(() => loadSettings())
  const initialTab = useRef(settings.launchPage).current
  const selection = useObservable<string>(initialTab)
  const discoveryPath = useObservable<string[]>([])
  const rankingPath = useObservable<string[]>([])
  const followingPath = useObservable<string[]>([])
  const searchPath = useObservable<string[]>([])
  const morePath = useObservable<string[]>([])

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

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

  const isAppleMusic = settings.pageLayout === "appleMusic"
  const [, setAccessoryTick] = useState(0)

  useEffect(() => {
    const trigger = () => setAccessoryTick((t) => t + 1)
    const unsubs: Array<(() => void) | null | undefined> = [
      subscribeBottomAccessory(trigger),
      (selection as any)?.subscribe ? (selection as any).subscribe(trigger) : null,
      (discoveryPath as any)?.subscribe ? (discoveryPath as any).subscribe(trigger) : null,
      (rankingPath as any)?.subscribe ? (rankingPath as any).subscribe(trigger) : null,
      (followingPath as any)?.subscribe ? (followingPath as any).subscribe(trigger) : null,
      (searchPath as any)?.subscribe ? (searchPath as any).subscribe(trigger) : null,
      (morePath as any)?.subscribe ? (morePath as any).subscribe(trigger) : null,
    ]
    return () => {
      for (const unsub of unsubs) {
        if (typeof unsub === "function") {
          unsub()
        }
      }
    }
  }, [selection, discoveryPath, rankingPath, followingPath, searchPath, morePath])

  const activeTab = selection.value
  let activePath: string[] = []
  if (activeTab === "discovery") activePath = discoveryPath.value
  else if (activeTab === "ranking") activePath = rankingPath.value
  else if (activeTab === "following") activePath = followingPath.value
  else if (activeTab === "search") activePath = searchPath.value
  else if (activeTab === "more") activePath = morePath.value

  const activeAccessoryNode = isAppleMusic
    ? getActiveAccessory(activeTab, activePath)
    : null

  const tabViewProps: any = {
    selection,
    tabBarMinimizeBehavior: "onScrollDown",
  }

  if (isAppleMusic && activeAccessoryNode) {
    tabViewProps.tabViewBottomAccessory = (
      <CapsuleAccessoryContainer>
        {activeAccessoryNode}
      </CapsuleAccessoryContainer>
    )
  }

  return (
    <TabView {...tabViewProps}>
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
