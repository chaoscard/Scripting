import {
  Navigation,
  NavigationStack,
  Tab,
  TabView,
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

export function RootView() {
  const [loggedIn, setLoggedIn] = useState(session.isAuthenticated)

  useEffect(() => {
    return session.onAuthChanged(() => {
      setLoggedIn(session.isAuthenticated)
    })
  }, [])

  const dismiss = Navigation.useDismiss()
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
