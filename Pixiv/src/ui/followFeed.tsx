import {
  Button,
  HStack,
  Image,
  Label,
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
import { destinationElement } from "./routes"
import { useLatest, usePagedList, currentBatchSize } from "./hooks"
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
  RefreshableScrollView,
  WatchlistSeriesCard,
} from "./components"

export type FollowMode = "following" | "watchlist" | "friends"
export type FollowScope = "all" | "private"
type WorkKind = "illust" | "novel"
type WatchKind = "manga" | "novel"

const WATCH_KINDS: WatchKind[] = ["manga", "novel"]
const WORK_KINDS: WorkKind[] = ["illust", "novel"]

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
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

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
      toolbar={followToolbar({
        mode,
        scope,
        onModeChange: setMode,
        onScopeChange: setScope,
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
        <FollowKindPicker
          mode={mode}
          value={segmentedValue}
          onChanged={selectSegmentedKind}
        />
        {mode === "following" ? (
          <FollowingFeed
            key={`following:${scope}`}
            enabled={activated}
            kind={followingKind}
            scope={scope}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : mode === "watchlist" ? (
          <WatchlistFeed
            key="watchlist"
            enabled={activated}
            kind={watchKind}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : (
          <FriendsFeed
            key="friends"
            enabled={activated}
            kind={friendKind}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function followToolbar(props: {
  mode: FollowMode
  scope: FollowScope
  onModeChange: (mode: FollowMode) => void
  onScopeChange: (scope: FollowScope) => void
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
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { enabled = true, kind, scope, onRegisterRefresh } = props

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

  useSettingsFilter(illustPaged)
  useSettingsFilter(novelPaged)

  const activeRefresh = kind === "illust" ? illustPaged.refresh : novelPaged.refresh
  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  if (kind === "illust") {
    return (
      <VStack alignment="leading" spacing={10}>
        {illustPaged.initialLoading ? (
          <LoadingView />
        ) : illustPaged.error && illustPaged.items.length === 0 ? (
          <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
        ) : illustPaged.items.length === 0 ? (
          <EmptyView text="关注的人还没有新作品" systemImage="person.2" />
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
        <EmptyView text="关注的人还没有新小说" systemImage="book" />
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
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { enabled = true, kind, onRegisterRefresh } = props

  const mangaPaged = usePagedList<PixivWatchlistSeries>({
    first: (token) => watchlistManga(token),
    more: (nextURL, token) => nextWatchlist(nextURL, token),
    filter: (items) => filterWatchlistItems(items, "manga"),
    deps: ["watchlist", "manga"],
    enabled: enabled && kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(watchlistThumbUrlOf)).cancel,
  })

  const novelPaged = usePagedList<PixivWatchlistSeries>({
    first: (token) => watchlistNovels(token),
    more: (nextURL, token) => nextWatchlist(nextURL, token),
    filter: (items) => filterWatchlistItems(items, "novel"),
    deps: ["watchlist", "novel"],
    enabled: enabled && kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(watchlistThumbUrlOf)).cancel,
  })

  useSettingsFilter(mangaPaged)
  useSettingsFilter(novelPaged)

  const activeRefresh = kind === "manga" ? mangaPaged.refresh : novelPaged.refresh
  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  const currentPaged = kind === "manga" ? mangaPaged : novelPaged

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
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { enabled = true, kind, onRegisterRefresh } = props

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

  useSettingsFilter(illustPaged)
  useSettingsFilter(novelPaged)

  const activeRefresh = kind === "illust" ? illustPaged.refresh : novelPaged.refresh
  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  if (kind === "illust") {
    return (
      <VStack alignment="leading" spacing={10}>
        {illustPaged.initialLoading ? (
          <LoadingView />
        ) : illustPaged.error && illustPaged.items.length === 0 ? (
          <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
        ) : illustPaged.items.length === 0 ? (
          <EmptyView text="好友还没有新作品" systemImage="person.2" />
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
        <EmptyView text="好友还没有新小说" systemImage="book" />
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

function useSettingsFilter(paged: ReturnType<typeof usePagedList<any>>) {
  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])
}

function filterFollowingIllustrationItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterFollowingNovelItems(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((novel) => isNovelContentVisible(novel, settings))
}

function filterWatchlistItems(
  items: PixivWatchlistSeries[],
  kind: WatchKind
): PixivWatchlistSeries[] {
  return items.filter((item) => {
    // 隐藏 Pixiv 返回的无权限阅读的作品（如带 mask_text 等限制的作品）
    if (item.mask_text) return false
    return true
  })
}

function watchlistThumbUrlOf(item: PixivWatchlistSeries): string | null {
  return item.url ?? null
}
