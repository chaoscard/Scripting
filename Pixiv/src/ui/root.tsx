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
  useState,
} from "scripting"
import { session } from "../api/session"
import { DiscoveryView } from "./discovery"
import { RankingView } from "./ranking"
import { SearchView } from "./search"
import { MoreView } from "./more"
import { LoginView } from "./login"
import { FollowFeedView } from "./followFeed"

function LaunchExperienceView() {
  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="systemBackground"
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
    // 冷启动过渡体验：保持合理的启动就绪缓冲，等待内部首屏视图就绪
    const timer = setTimeout(() => {
      if (!cancelled) {
        setIsReady(true)
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  const dismiss = Navigation.useDismiss()
  if (!isReady) {
    return <LaunchExperienceView />
  }

  return loggedIn ? (
    <MainTabView onClose={dismiss} />
  ) : (
    <NavigationStack>
      <LoginView
        onClose={dismiss}
        onSuccess={() => {
          setLoggedIn(true)
        }}
      />
    </NavigationStack>
  )
}

export function TabNavigationStack(props: { children: any }) {
  return <NavigationStack>{props.children}</NavigationStack>
}

function MainTabView(props: { onClose: () => void }) {
  const selection = useObservable<string>("discovery")

  return (
    <TabView selection={selection} tabBarMinimizeBehavior="onScrollDown">
      <Tab title="探索" systemImage="photo.on.rectangle.angled" value="discovery">
        <TabNavigationStack>
          <DiscoveryView onClose={props.onClose} />
        </TabNavigationStack>
      </Tab>
      <Tab title="排行" systemImage="trophy" value="ranking">
        <TabNavigationStack>
          <RankingView onClose={props.onClose} />
        </TabNavigationStack>
      </Tab>
      <Tab title="关注" systemImage="person.2.fill" value="following">
        <TabNavigationStack>
          <FollowFeedView onClose={props.onClose} />
        </TabNavigationStack>
      </Tab>
      <Tab title="搜索" systemImage="magnifyingglass" value="search" role="search">
        <TabNavigationStack>
          <SearchView onClose={props.onClose} />
        </TabNavigationStack>
      </Tab>
      <Tab title="我的" systemImage="person.crop.circle" value="more">
        <TabNavigationStack>
          <MoreView onClose={props.onClose} />
        </TabNavigationStack>
      </Tab>
    </TabView>
  )
}
