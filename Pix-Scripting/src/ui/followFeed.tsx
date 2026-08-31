import {
  Button,
  Image,
  LazyVStack,
  Menu,
  Picker,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  followingFeed,
  followingNovels,
  myPixivFeed,
  myPixivNovels,
  nextIllustrations,
  nextNovels,
  nextWatchlist,
  watchlistManga,
  watchlistNovels,
} from "../api/pixiv"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import { onWatchlistChanged } from "../store/bookmarkSync"
import { recordWorkSeriesAssociation } from "../store/seriesCache"
import { destinationElement } from "./routes"
import { useLatest, usePagedList, currentBatchSize, useExperimentalAmbientPalette } from "./hooks"
import type {
  PixivIllustration,
  PixivNovel,
  PixivWatchlistSeries,
} from "../types"
import {
  appToolbar,
  EmptyView,
  ErrorView,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RecommendedUsersSheet,
  RefreshableScrollView,
  WatchlistSeriesCard,
} from "./components"

type FollowMode = "following" | "watchlist" | "friends"
type FollowScope = "all" | "private"
type WorkKind = "illust" | "novel"
type WatchKind = "manga" | "novel"

export function FollowFeedView(props: {
  initialMode?: FollowMode
  onClose: () => void
}) {
  const isLaunchTab = useRef(loadSettings().launchPage === "following").current
  const [activated, setActivated] = useState(isLaunchTab)
  const [mode, setMode] = useState<FollowMode>(props.initialMode ?? "following")
  const [scope, setScope] = useState<FollowScope>("all")
  const [followingKind, setFollowingKind] = useState<WorkKind>("illust")
  const [watchKind, setWatchKind] = useState<WatchKind>("manga")
  const [friendKind, setFriendKind] = useState<WorkKind>("illust")
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [showRecommendedUsers, setShowRecommendedUsers] = useState(false)
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(null)
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    return onSettingsChanged(() => {
      const next = loadSettings().hideNovels
      setHideNovels(next)
      if (next) {
        setFollowingKind("illust")
        setWatchKind("manga")
        setFriendKind("illust")
      }
    })
  }, [])

  const segmentedValue =
    mode === "following"
      ? followingKind
      : mode === "watchlist"
        ? watchKind
        : friendKind
  function selectSegmentedKind(value: string) {
    if (mode === "following") setFollowingKind(value as WorkKind)
    else if (mode === "watchlist") setWatchKind(value as WatchKind)
    else setFriendKind(value as WorkKind)
  }

  return (
    <RefreshableScrollView
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      background={ambientBackground}
      toolbar={followToolbar({
        mode,
        scope,
        onModeChange: setMode,
        onScopeChange: setScope,
        onOpenRecommendedUsers: () => setShowRecommendedUsers(true),
        onClose: props.onClose,
      })}
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack
        alignment="leading"
        spacing={8}
        onAppear={() => {
          if (!activated) setActivated(true)
        }}
      >
        {hideNovels ? null : (
          <FollowKindPicker
            mode={mode}
            value={segmentedValue}
            onChanged={selectSegmentedKind}
          />
        )}
        {mode === "following" ? (
          <FollowingFeed
            key={`following:${scope}`}
            enabled={activated}
            kind={followingKind}
            scope={scope}
            onFirstImageUrlChange={setAmbientImageUrl}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : mode === "watchlist" ? (
          <WatchlistFeed
            key="watchlist"
            enabled={activated}
            kind={watchKind}
            onFirstImageUrlChange={setAmbientImageUrl}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : (
          <FriendsFeed
            key="friends"
            enabled={activated}
            kind={friendKind}
            onFirstImageUrlChange={setAmbientImageUrl}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        )}
        <VStack
          sheet={{
            content: (
              <RecommendedUsersSheet
                onClose={() => setShowRecommendedUsers(false)}
              />
            ),
            isPresented: showRecommendedUsers,
            onChanged: setShowRecommendedUsers,
          }}
        />
      </VStack>
    </RefreshableScrollView>
  )
}

function followToolbar(props: {
  mode: FollowMode
  scope: FollowScope
  onModeChange: (mode: FollowMode) => void
  onScopeChange: (scope: FollowScope) => void
  onOpenRecommendedUsers: () => void
  onClose: () => void
}) {
  const title =
    props.mode === "following"
      ? "关注"
      : props.mode === "watchlist"
        ? "追更"
        : "好友"
  return appToolbar(
    props.onClose,
    title,
    <Menu label={<Image systemName="ellipsis.circle" />}>
      <Menu title="关注" systemImage="person.2">
        <Button
          title="公开"
          systemImage="globe"
          action={() => {
            props.onModeChange("following")
            props.onScopeChange("all")
          }}
        />
        <Button
          title="私密"
          systemImage="lock"
          action={() => {
            props.onModeChange("following")
            props.onScopeChange("private")
          }}
        />
      </Menu>
      <Button
        title="追更"
        systemImage="bookmark"
        action={() => props.onModeChange("watchlist")}
      />
      <Button
        title="好友"
        systemImage="person.2.badge.gearshape"
        action={() => props.onModeChange("friends")}
      />
      <Button
        title="推荐"
        systemImage="sparkles"
        action={props.onOpenRecommendedUsers}
      />
    </Menu>
  )
}

function FollowKindPicker(props: {
  mode: FollowMode
  value: string
  onChanged: (value: string) => void
}) {
  return (
    <Picker
      title="内容类型"
      value={props.value}
      onChanged={props.onChanged}
      pickerStyle="segmented"
      padding={{ horizontal: 14 }}
    >
      {props.mode === "watchlist" ? (
        <>
          <Text tag="manga">漫画</Text>
          <Text tag="novel">小说</Text>
        </>
      ) : (
        <>
          <Text tag="illust">插画·漫画</Text>
          <Text tag="novel">小说</Text>
        </>
      )}
    </Picker>
  )
}

function FollowingFeed(props: {
  enabled?: boolean
  kind: WorkKind
  scope: FollowScope
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { enabled = true, kind, scope, onFirstImageUrlChange, onRegisterRefresh } = props

  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => followingFeed(scope, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterFollowingIllustrationItems,
    deps: ["following", "illust", scope],
    enabled: enabled && kind === "illust",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => followingNovels(scope, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterFollowingNovelItems,
    deps: ["following", "novel", scope],
    enabled: enabled && kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const activeRefresh = kind === "illust" ? illustPaged.refresh : novelPaged.refresh
  const illustPagedRef = useLatest(illustPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    if (kind === "illust") {
      const first = illustPaged.items[0]
      if (first) {
        onFirstImageUrlChange?.(cardThumbUrlOf(first))
      } else if (!illustPaged.initialLoading && illustPaged.items.length === 0) {
        onFirstImageUrlChange?.(null)
      }
    } else {
      const first = novelPaged.items[0]
      if (first) {
        onFirstImageUrlChange?.(novelThumbUrlOf(first))
      } else if (!novelPaged.initialLoading && novelPaged.items.length === 0) {
        onFirstImageUrlChange?.(null)
      }
    }
  }, [
    kind,
    illustPaged.items[0]?.id,
    illustPaged.initialLoading,
    illustPaged.items.length,
    novelPaged.items[0]?.id,
    novelPaged.initialLoading,
    novelPaged.items.length,
    onFirstImageUrlChange,
  ])

  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  useEffect(() => {
    return onSettingsChanged(() => {
      illustPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
    })
  }, [])

  if (kind === "illust") {
    return (
      <VStack alignment="leading" spacing={10}>
        {illustPaged.initialLoading ? (
          <LoadingView />
        ) : illustPaged.error && illustPaged.items.length === 0 ? (
          <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
        ) : illustPaged.items.length === 0 ? (
          <EmptyView
            text={
              illustPaged.hasFilteredContent
                ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                : "关注的人还没有新作品"
            }
            systemImage={illustPaged.hasFilteredContent ? "eye.slash" : "person.2"}
          />
        ) : (
          <IllustFlowFeed
            items={illustPaged.items}
            onLoadMore={illustPaged.loadMore}
            hasMore={illustPaged.hasMore}
            isLoading={illustPaged.loadingMore}
          />
        )}
      </VStack>
    )
  }

  return (
    <VStack alignment="leading" spacing={10}>
      {novelPaged.initialLoading ? (
        <LoadingView />
      ) : novelPaged.error && novelPaged.items.length === 0 ? (
        <ErrorView message={novelPaged.error} onRetry={novelPaged.refresh} />
      ) : novelPaged.items.length === 0 ? (
        <EmptyView
          text={
            novelPaged.hasFilteredContent
              ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
              : "关注的人还没有新小说"
          }
          systemImage={novelPaged.hasFilteredContent ? "eye.slash" : "book"}
        />
      ) : (
        <NovelFeedItems
          items={novelPaged.items}
          onLoadMore={novelPaged.loadMore}
          hasMore={novelPaged.hasMore}
          isLoading={novelPaged.loadingMore}
        />
      )}
    </VStack>
  )
}

function WatchlistFeed(props: {
  enabled?: boolean
  kind: WatchKind
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { enabled = true, kind, onFirstImageUrlChange, onRegisterRefresh } = props

  const mangaPaged = usePagedList<PixivWatchlistSeries>({
    first: (token) => watchlistManga(token),
    more: (nextURL, token) => nextWatchlist(nextURL, token),
    filter: filterWatchlistItems,
    deps: ["watchlist", "manga"],
    enabled: enabled && kind === "manga",
    onBatchPublished: (_, pendingItems) => {
      for (const it of pendingItems) {
        if (it.latest_content_id) {
          recordWorkSeriesAssociation(it.latest_content_id, "manga", it.id, it.title, it.published_content_count)
        }
      }
      return prefetch(pendingItems.slice(0, currentBatchSize()).map(watchlistThumbUrlOf)).cancel
    },
  })

  const novelPaged = usePagedList<PixivWatchlistSeries>({
    first: (token) => watchlistNovels(token),
    more: (nextURL, token) => nextWatchlist(nextURL, token),
    filter: filterWatchlistItems,
    deps: ["watchlist", "novel"],
    enabled: enabled && kind === "novel",
    onBatchPublished: (_, pendingItems) => {
      for (const it of pendingItems) {
        if (it.latest_content_id) {
          recordWorkSeriesAssociation(it.latest_content_id, "novel", it.id, it.title, it.published_content_count)
        }
      }
      return prefetch(pendingItems.slice(0, currentBatchSize()).map(watchlistThumbUrlOf)).cancel
    },
  })

  const activeRefresh = kind === "manga" ? mangaPaged.refresh : novelPaged.refresh
  const currentPaged = kind === "manga" ? mangaPaged : novelPaged

  useEffect(() => {
    const first = currentPaged.items[0]
    if (first) {
      onFirstImageUrlChange?.(watchlistThumbUrlOf(first))
    } else if (!currentPaged.initialLoading && currentPaged.items.length === 0) {
      onFirstImageUrlChange?.(null)
    }
  }, [
    currentPaged.items[0]?.id,
    currentPaged.initialLoading,
    currentPaged.items.length,
    onFirstImageUrlChange,
  ])

  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  useEffect(() => {
    return onWatchlistChanged((_, changedKind) => {
      if (changedKind === kind) {
        activeRefresh()
      }
    })
  }, [activeRefresh, kind])

  return (
    <VStack alignment="leading" spacing={10}>
      {currentPaged.initialLoading ? (
        <LoadingView />
      ) : currentPaged.error && currentPaged.items.length === 0 ? (
        <ErrorView message={currentPaged.error} onRetry={currentPaged.refresh} />
      ) : currentPaged.items.length === 0 ? (
        <EmptyView text={`暂无追更${kind === "manga" ? "漫画" : "小说"}，下拉刷新试试`} systemImage="bookmark" />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {currentPaged.items.map((item, index) => (
            <WatchlistSeriesCard key={item.id} item={item} kind={kind} priority={index} />
          ))}
          <LoadMoreTrigger
            anchor={currentPaged.items[currentPaged.items.length - 1].id}
            onLoadMore={currentPaged.loadMore}
            hasMore={currentPaged.hasMore}
            isLoading={currentPaged.loadingMore}
          />
        </LazyVStack>
      )}
    </VStack>
  )
}

function FriendsFeed(props: {
  enabled?: boolean
  kind: WorkKind
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { enabled = true, kind, onFirstImageUrlChange, onRegisterRefresh } = props

  const illustPaged = usePagedList<PixivIllustration>({
    first: myPixivFeed,
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterFollowingIllustrationItems,
    deps: ["friends", "illust"],
    enabled: enabled && kind === "illust",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const novelPaged = usePagedList<PixivNovel>({
    first: myPixivNovels,
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterFollowingNovelItems,
    deps: ["friends", "novel"],
    enabled: enabled && kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const activeRefresh = kind === "illust" ? illustPaged.refresh : novelPaged.refresh
  const illustPagedRef = useLatest(illustPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    if (kind === "illust") {
      const first = illustPaged.items[0]
      if (first) {
        onFirstImageUrlChange?.(cardThumbUrlOf(first))
      } else if (!illustPaged.initialLoading && illustPaged.items.length === 0) {
        onFirstImageUrlChange?.(null)
      }
    } else {
      const first = novelPaged.items[0]
      if (first) {
        onFirstImageUrlChange?.(novelThumbUrlOf(first))
      } else if (!novelPaged.initialLoading && novelPaged.items.length === 0) {
        onFirstImageUrlChange?.(null)
      }
    }
  }, [
    kind,
    illustPaged.items[0]?.id,
    illustPaged.initialLoading,
    illustPaged.items.length,
    novelPaged.items[0]?.id,
    novelPaged.initialLoading,
    novelPaged.items.length,
    onFirstImageUrlChange,
  ])

  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  useEffect(() => {
    return onSettingsChanged(() => {
      illustPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
    })
  }, [])

  if (kind === "illust") {
    return (
      <VStack alignment="leading" spacing={10}>
        {illustPaged.initialLoading ? (
          <LoadingView />
        ) : illustPaged.error && illustPaged.items.length === 0 ? (
          <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
        ) : illustPaged.items.length === 0 ? (
          <EmptyView
            text={
              illustPaged.hasFilteredContent
                ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                : "好友还没有新作品"
            }
            systemImage={illustPaged.hasFilteredContent ? "eye.slash" : "person.2"}
          />
        ) : (
          <IllustFlowFeed
            items={illustPaged.items}
            onLoadMore={illustPaged.loadMore}
            hasMore={illustPaged.hasMore}
            isLoading={illustPaged.loadingMore}
          />
        )}
      </VStack>
    )
  }

  return (
    <VStack alignment="leading" spacing={10}>
      {novelPaged.initialLoading ? (
        <LoadingView />
      ) : novelPaged.error && novelPaged.items.length === 0 ? (
        <ErrorView message={novelPaged.error} onRetry={novelPaged.refresh} />
      ) : novelPaged.items.length === 0 ? (
        <EmptyView
          text={
            novelPaged.hasFilteredContent
              ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
              : "好友还没有新小说"
          }
          systemImage={novelPaged.hasFilteredContent ? "eye.slash" : "book"}
        />
      ) : (
        <NovelFeedItems
          items={novelPaged.items}
          onLoadMore={novelPaged.loadMore}
          hasMore={novelPaged.hasMore}
          isLoading={novelPaged.loadingMore}
        />
      )}
    </VStack>
  )
}

function NovelFeedItems(props: {
  items: PixivNovel[]
  onLoadMore: (anchor: number | string) => void
  hasMore: boolean
  isLoading: boolean
}) {
  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
      {props.items.map((novel, index) => (
        <NovelCard key={novel.id} novel={novel} priority={index} />
      ))}
      <LoadMoreTrigger
        anchor={props.items[props.items.length - 1].id}
        onLoadMore={props.onLoadMore}
        hasMore={props.hasMore}
        isLoading={props.isLoading}
      />
    </LazyVStack>
  )
}

function filterFollowingIllustrationItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isIllustContentVisible(item, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
    })
  )
}

function filterFollowingNovelItems(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((novel) =>
    isNovelContentVisible(novel, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
    })
  )
}

function filterWatchlistItems(
  items: PixivWatchlistSeries[]
): PixivWatchlistSeries[] {
  return items.filter((item) => !item.mask_text)
}

function watchlistThumbUrlOf(item: PixivWatchlistSeries): string | null {
  return item.url ?? null
}
