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
  isIllustContentVisible,
  isR18ContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { destinationElement } from "./routes"
import { useLatest, usePagedList } from "./hooks"
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
      <VStack alignment="leading" spacing={8}>
        <FollowKindPicker
          mode={mode}
          value={segmentedValue}
          onChanged={selectSegmentedKind}
        />
        {mode === "following" ? (
          followingKind === "illust" ? (
            <FollowingIllustrationFeed
              key={`following:illust:${scope}`}
              scope={scope}
              onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
            />
          ) : (
            <FollowingNovelFeed
              key={`following:novel:${scope}`}
              scope={scope}
              onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
            />
          )
        ) : mode === "watchlist" ? (
          <WatchlistFeed
            key={`watchlist:${watchKind}`}
            kind={watchKind}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : friendKind === "illust" ? (
          <FriendIllustrationFeed
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : (
          <FriendNovelFeed
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
  return appToolbar(
    props.onClose,
    "关注",
    <Menu label={<Image systemName="ellipsis.circle" />}>
      <Menu title="关注" systemImage="person.2">
        <Picker
          title="关注范围"
          value={props.scope}
          onChanged={(value: string) => {
            props.onModeChange("following")
            props.onScopeChange(value as FollowScope)
          }}
        >
          <Label tag="all" title="全部" systemImage="person.2" />
          <Label tag="private" title="私密" systemImage="lock" />
        </Picker>
      </Menu>
      {props.mode === "following" ? (
        <>
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
        </>
      ) : (
        <Picker
          title="动态类型"
          value={props.mode}
          onChanged={(value: string) => props.onModeChange(value as FollowMode)}
        >
          <Label
            tag="watchlist"
            title="追更"
            systemImage="bookmark"
          />
          <Label
            tag="friends"
            title="好友"
            systemImage="person.2.badge.gearshape"
          />
        </Picker>
      )}
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

function FollowingIllustrationFeed(props: {
  scope: FollowScope
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { scope, onRegisterRefresh } = props
  const paged = usePagedList<PixivIllustration>({
    first: (token) => followingFeed(scope, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterFollowingIllustrationItems,
    deps: [scope],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel
  })
  useSettingsFilter(paged, true)

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={10}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="关注的人还没有新作品" systemImage="person.2" />
      ) : (
        <IllustFlowFeed
          items={paged.items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
        />
      )}
    </VStack>
  )
}

function FollowingNovelFeed(props: {
  scope: FollowScope
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { scope, onRegisterRefresh } = props
  const paged = usePagedList<PixivNovel>({
    first: (token) => followingNovels(scope, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterFollowingNovelItems,
    deps: [scope],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel
  })
  useSettingsFilter(paged, true)

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={10}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="关注的人还没有新小说" systemImage="book" />
      ) : (
        <NovelFeedItems
          items={paged.items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
        />
      )}
    </VStack>
  )
}

function WatchlistFeed(props: {
  kind: WatchKind
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, onRegisterRefresh } = props
  const paged = usePagedList<PixivWatchlistSeries>({
    first: (token) =>
      kind === "manga" ? watchlistManga(token) : watchlistNovels(token),
    more: (nextURL, token) => nextWatchlist(nextURL, token),
    filter: (items) => items,
    deps: [kind],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(watchlistThumbUrlOf)).cancel
  })
  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.refresh()
    })
  }, [])

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={10}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text={`暂无追更${kind === "manga" ? "漫画" : "小说"}`} systemImage="bookmark" />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {paged.items.map((item) => (
            <WatchlistSeriesCard key={item.id} item={item} kind={kind} />
          ))}
          <LoadMoreTrigger
            anchor={paged.items[paged.items.length - 1].id}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        </LazyVStack>
      )}
    </VStack>
  )
}

function FriendIllustrationFeed(props: {
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const paged = usePagedList<PixivIllustration>({
    first: myPixivFeed,
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrationItems,
    deps: [],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel
  })
  useSettingsFilter(paged, true)

  useEffect(() => {
    props.onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, props.onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={10}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="好友还没有新作品" systemImage="person.2" />
      ) : (
        <IllustFlowFeed
          items={paged.items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
        />
      )}
    </VStack>
  )
}

function FriendNovelFeed(props: {
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const paged = usePagedList<PixivNovel>({
    first: myPixivNovels,
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelItems,
    deps: [],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel
  })
  useSettingsFilter(paged, true)

  useEffect(() => {
    props.onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, props.onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={10}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="好友还没有新小说" systemImage="book" />
      ) : (
        <NovelFeedItems
          items={paged.items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
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

function useSettingsFilter(
  paged: ReturnType<typeof usePagedList<PixivIllustration>> | ReturnType<typeof usePagedList<PixivNovel>>,
  active: boolean
) {
  const pagedRef = useLatest(paged)
  const activeRef = useLatest(active)
  useEffect(() => {
    return onSettingsChanged(() => {
      if (!activeRef.current) return
      pagedRef.current.reapplyFilter()
      pagedRef.current.refresh()
    })
  }, [])
}

function filterFollowingIllustrationItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isIllustContentVisible(item, settings, settings.followFilterExempt)
  )
}

function filterFollowingNovelItems(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter(
    (novel) =>
      settings.followFilterExempt || (
        isR18ContentVisible(novel.x_restrict, settings.showR18, settings.showR18G) &&
        (settings.showAI || novel.novel_ai_type !== 2)
      )
  )
}

function filterIllustrationItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterNovelItems(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter(
    (item) =>
      isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G) &&
      (settings.showAI || item.novel_ai_type !== 2)
  )
}

function watchlistThumbUrlOf(item: PixivWatchlistSeries): string | null {
  return item.url ?? null
}
