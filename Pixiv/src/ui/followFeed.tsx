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
  useState,
  VStack,
  ZStack,
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
  MasonryIllustFeed,
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

  // 八个流完全常驻挂载，切换时仅切换原生 hidden 属性，
  // 零销毁、零重建、零重复布局，实现毫秒级秒切。
  return (
    <VStack
      alignment="leading"
      spacing={8}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      navigationDestination={destinationElement}
      toolbar={followToolbar({
        mode,
        scope,
        onModeChange: setMode,
        onScopeChange: setScope,
        onClose: props.onClose,
      })}
    >
      <FollowKindPicker
        mode={mode}
        value={segmentedValue}
        onChanged={selectSegmentedKind}
      />
      <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <FollowingIllustrationFeed
          scope="all"
          active={
            mode === "following" && scope === "all" && followingKind === "illust"
          }
        />
        <FollowingNovelFeed
          scope="all"
          active={
            mode === "following" && scope === "all" && followingKind === "novel"
          }
        />
        <FollowingIllustrationFeed
          scope="private"
          active={
            mode === "following" &&
            scope === "private" &&
            followingKind === "illust"
          }
        />
        <FollowingNovelFeed
          scope="private"
          active={
            mode === "following" &&
            scope === "private" &&
            followingKind === "novel"
          }
        />
        {WATCH_KINDS.map((kind) => (
          <WatchlistFeed
            key={`watchlist:${kind}`}
            kind={kind}
            active={mode === "watchlist" && watchKind === kind}
          />
        ))}
        {WORK_KINDS.map((kind) =>
          kind === "illust" ? (
            <FriendIllustrationFeed
              key={`friends:${kind}`}
              active={mode === "friends" && friendKind === kind}
            />
          ) : (
            <FriendNovelFeed
              key={`friends:${kind}`}
              active={mode === "friends" && friendKind === kind}
            />
          )
        )}
      </ZStack>
    </VStack>
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
      padding={{ horizontal: 14, top: 4 }}
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
  active: boolean
}) {
  const { scope, active } = props
  const paged = usePagedList<PixivIllustration>({
    first: (token) => followingFeed(scope, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterFollowingIllustrationItems,
    deps: [scope],
    enabled: active,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel
  })
  useSettingsFilter(paged, active)

  return (
    <RefreshableScrollView
      hidden={!active}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
      <VStack alignment="leading" spacing={10}>
        {paged.initialLoading ? (
          <LoadingView />
        ) : paged.error && paged.items.length === 0 ? (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        ) : paged.items.length === 0 ? (
          <EmptyView text="关注的人还没有新作品" systemImage="person.2" />
        ) : (
          <MasonryIllustFeed
            items={paged.items}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function FollowingNovelFeed(props: {
  scope: FollowScope
  active: boolean
}) {
  const { scope, active } = props
  const paged = usePagedList<PixivNovel>({
    first: (token) => followingNovels(scope, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterFollowingNovelItems,
    deps: [scope],
    enabled: active,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel
  })
  useSettingsFilter(paged, active)

  return (
    <RefreshableScrollView
      hidden={!active}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
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
    </RefreshableScrollView>
  )
}

function WatchlistFeed(props: {
  kind: WatchKind
  active: boolean
}) {
  const { kind, active } = props
  const paged = usePagedList<PixivWatchlistSeries>({
    first: (token) =>
      kind === "manga" ? watchlistManga(token) : watchlistNovels(token),
    more: (nextURL, token) => nextWatchlist(nextURL, token),
    filter: (items) => items,
    deps: [kind],
    enabled: active,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(watchlistThumbUrlOf)).cancel
  })
  const pagedRef = useLatest(paged)
  const activeRef = useLatest(active)
  useEffect(() => {
    return onSettingsChanged(() => {
      if (!activeRef.current) return
      pagedRef.current.refresh()
    })
  }, [])

  return (
    <RefreshableScrollView
      hidden={!active}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
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
    </RefreshableScrollView>
  )
}

function FriendIllustrationFeed(props: {
  active: boolean
}) {
  const paged = usePagedList<PixivIllustration>({
    first: myPixivFeed,
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrationItems,
    deps: [],
    enabled: props.active,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel
  })
  useSettingsFilter(paged, props.active)

  return (
    <RefreshableScrollView
      hidden={!props.active}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
      <VStack alignment="leading" spacing={10}>
        {paged.initialLoading ? (
          <LoadingView />
        ) : paged.error && paged.items.length === 0 ? (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        ) : paged.items.length === 0 ? (
          <EmptyView text="好友还没有新作品" systemImage="person.2" />
        ) : (
          <MasonryIllustFeed
            items={paged.items}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function FriendNovelFeed(props: {
  active: boolean
}) {
  const paged = usePagedList<PixivNovel>({
    first: myPixivNovels,
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelItems,
    deps: [],
    enabled: props.active,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel
  })
  useSettingsFilter(paged, props.active)

  return (
    <RefreshableScrollView
      hidden={!props.active}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
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
    </RefreshableScrollView>
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
      {props.items.map((novel) => (
        <NovelCard key={novel.id} novel={novel} />
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
