import {
  LazyVStack,
  Picker,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  nextIllustrations,
  nextNovels,
  userNovels,
  userWorks,
} from "../api/pixiv"
import { session } from "../api/session"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import { isUserFollowed, onUserFollowChanged } from "../store/userFollow"
import { useLatest, usePagedList, currentBatchSize } from "./hooks"
import type { PixivIllustration, PixivNovel } from "../types"
import {
  EmptyView,
  ErrorView,
  IllustFlowFeed,
  LoadingView,
  LoadMoreTrigger,
  NovelCard,
  RefreshableScrollView,
} from "./components"

export type WorkTab = "illust" | "manga" | "novel"

export function UserWorksView(props: { userID?: number; title?: string }) {
  const currentUserID = props.userID ?? session.userID ?? null
  const [tab, setTab] = useState<WorkTab>("illust")
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  if (currentUserID == null) {
    return (
      <RefreshableScrollView
        navigationTitle={props.title ?? "作品"}
        navigationBarTitleDisplayMode="inline"
        refreshable={() => Promise.resolve()}
      >
        <EmptyView text="请先登录以查看作品" systemImage="person.crop.circle.badge.exclamationmark" />
      </RefreshableScrollView>
    )
  }

  return (
    <RefreshableScrollView
      navigationTitle={props.title ?? "作品"}
      navigationBarTitleDisplayMode="inline"
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack alignment="leading" spacing={8}>
        <Picker
          title="作品类型"
          value={tab}
          onChanged={(value: string) => setTab(value as WorkTab)}
          pickerStyle="segmented"
          padding={{ horizontal: 14 }}
        >
          <Text tag="illust">插画</Text>
          <Text tag="manga">漫画</Text>
          <Text tag="novel">小说</Text>
        </Picker>

        <UserWorksFeed
          userID={currentUserID}
          tab={tab}
          onRegisterRefresh={(fn) => {
            refreshHandlerRef.current = fn
          }}
        />
      </VStack>
    </RefreshableScrollView>
  )
}

function UserWorksFeed(props: {
  userID: number
  tab: WorkTab
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, tab, onRegisterRefresh } = props
  const [isFollowed, setIsFollowed] = useState(() => isUserFollowed(userID) ?? false)

  useEffect(() => {
    return onUserFollowChanged((changedUserID, followed) => {
      if (changedUserID === userID) {
        setIsFollowed(followed)
      }
    })
  }, [userID])

  // 1. 插画
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(userID, "illust", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => filterIllustrations(items, isFollowed),
    deps: [userID, "illust", isFollowed],
    enabled: tab === "illust",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 漫画
  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(userID, "manga", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => filterIllustrations(items, isFollowed),
    deps: [userID, "manga", isFollowed],
    enabled: tab === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 小说
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => userNovels(userID, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => filterNovels(items, isFollowed),
    deps: [userID, isFollowed],
    enabled: tab === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const illustPagedRef = useLatest(illustPaged)
  const mangaPagedRef = useLatest(mangaPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    return onSettingsChanged(() => {
      illustPagedRef.current.reapplyFilter()
      mangaPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
    })
  }, [])

  useEffect(() => {
    illustPagedRef.current.reapplyFilter()
    mangaPagedRef.current.reapplyFilter()
    novelPagedRef.current.reapplyFilter()
  }, [isFollowed])

  const activeRefresh =
    tab === "illust"
      ? illustPaged.refresh
      : tab === "manga"
        ? mangaPaged.refresh
        : novelPaged.refresh

  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  if (tab === "illust") {
    if (illustPaged.initialLoading) return <LoadingView />
    if (illustPaged.error && illustPaged.items.length === 0) {
      return <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
    }
    if (illustPaged.items.length === 0) {
      return <EmptyView text="暂无插画投稿" systemImage="photo" />
    }
    return (
      <IllustFlowFeed
        items={illustPaged.items}
        onLoadMore={illustPaged.loadMore}
        hasMore={illustPaged.hasMore}
        isLoading={illustPaged.loadingMore}
      />
    )
  }

  if (tab === "manga") {
    if (mangaPaged.initialLoading) return <LoadingView />
    if (mangaPaged.error && mangaPaged.items.length === 0) {
      return <ErrorView message={mangaPaged.error} onRetry={mangaPaged.refresh} />
    }
    if (mangaPaged.items.length === 0) {
      return <EmptyView text="暂无漫画投稿" systemImage="photo.on.rectangle" />
    }
    return (
      <IllustFlowFeed
        items={mangaPaged.items}
        onLoadMore={mangaPaged.loadMore}
        hasMore={mangaPaged.hasMore}
        isLoading={mangaPaged.loadingMore}
      />
    )
  }

  if (novelPaged.initialLoading) return <LoadingView />
  if (novelPaged.error && novelPaged.items.length === 0) {
    return <ErrorView message={novelPaged.error} onRetry={novelPaged.refresh} />
  }
  if (novelPaged.items.length === 0) {
    return <EmptyView text="暂无小说投稿" systemImage="book" />
  }
  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
      {novelPaged.items.map((novel, index) => (
        <NovelCard key={novel.id} novel={novel} priority={index} />
      ))}
      <LoadMoreTrigger
        anchor={novelPaged.items[novelPaged.items.length - 1]?.id}
        onLoadMore={novelPaged.loadMore}
        hasMore={novelPaged.hasMore}
        isLoading={novelPaged.loadingMore}
      />
    </LazyVStack>
  )
}

function filterIllustrations(items: PixivIllustration[], isAuthorFollowed = false): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isIllustContentVisible(item, settings, { isAuthorFollowed })
  )
}

function filterNovels(items: PixivNovel[], isAuthorFollowed = false): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isNovelContentVisible(item, settings, { isAuthorFollowed })
  )
}
