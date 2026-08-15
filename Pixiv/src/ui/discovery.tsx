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
  newIllustrations,
  newNovels,
  nextIllustrations,
  nextNovels,
  nextVision,
  recommendedNovels,
  recommendations,
  visionHome,
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
  PixivVisionArticle,
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
  VisionCard,
} from "./components"

type ExploreMode = "recommended" | "latest" | "vision"
type FeedMode = Exclude<ExploreMode, "vision">
type FeedKind = "illustration" | "manga" | "novel"
type IllustrationKind = Exclude<FeedKind, "novel">

export function DiscoveryView(props: { onClose: () => void }) {
  const [mode, setMode] = useState<ExploreMode>("recommended")
  const [kind, setKind] = useState<FeedKind>("illustration")
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  return (
    <RefreshableScrollView
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      toolbar={exploreToolbar({ mode, onModeChange: setMode, onClose: props.onClose })}
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack alignment="leading" spacing={8}>
        {mode === "vision" ? null : (
          <FeedKindPicker kind={kind} onKindChange={setKind} />
        )}
        {mode === "vision" ? (
          <VisionFeed onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }} />
        ) : mode === "recommended" ? (
          kind === "illustration" ? (
            <IllustFeed
              key="recommended:illustration"
              mode="recommended"
              kind="illustration"
              onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
            />
          ) : kind === "manga" ? (
            <IllustFeed
              key="recommended:manga"
              mode="recommended"
              kind="manga"
              onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
            />
          ) : (
            <NovelFeed
              key="recommended:novel"
              mode="recommended"
              onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
            />
          )
        ) : kind === "illustration" ? (
          <IllustFeed
            key="latest:illustration"
            mode="latest"
            kind="illustration"
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : kind === "manga" ? (
          <IllustFeed
            key="latest:manga"
            mode="latest"
            kind="manga"
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : (
          <NovelFeed
            key="latest:novel"
            mode="latest"
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function exploreToolbar(props: {
  mode: ExploreMode
  onModeChange: (mode: ExploreMode) => void
  onClose: () => void
}) {
  return appToolbar(
    props.onClose,
    "探索",
    <Menu label={<Image systemName="ellipsis.circle" />}>
      <Picker
        title="探索类型"
        value={props.mode}
        onChanged={(value: string) => props.onModeChange(value as ExploreMode)}
      >
        <Label tag="recommended" title="推荐" systemImage="sparkles" />
        <Label tag="latest" title="最新" systemImage="clock" />
        <Label tag="vision" title="专辑" systemImage="rectangle.stack" />
      </Picker>
    </Menu>
  )
}

function FeedKindPicker(props: {
  kind: FeedKind
  onKindChange: (kind: FeedKind) => void
}) {
  return (
    <Picker
      title="作品类型"
      value={props.kind}
      onChanged={(value: string) => props.onKindChange(value as FeedKind)}
      pickerStyle="segmented"
      padding={{ horizontal: 14 }}
    >
      <Text tag="illustration">插画</Text>
      <Text tag="manga">漫画</Text>
      <Text tag="novel">小说</Text>
    </Picker>
  )
}

function feedLabel(mode: FeedMode): string {
  return mode === "recommended" ? "推荐" : "最新作品"
}

function IllustFeed(props: {
  mode: FeedMode
  kind: IllustrationKind
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { mode, kind, onRegisterRefresh } = props
  const paged = usePagedList<PixivIllustration>({
    first: (token) =>
      mode === "recommended"
        ? recommendations(kind, token)
        : newIllustrations(kind, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: [mode, kind],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel
  })

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
      pagedRef.current.refresh()
    })
  }, [])

  const label = feedLabel(mode)
  return (
    <VStack alignment="leading" spacing={10}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text={`暂无${label}，下拉刷新试试`} />
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

function NovelFeed(props: {
  mode: FeedMode
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { mode, onRegisterRefresh } = props
  const paged = usePagedList<PixivNovel>({
    first: (token) =>
      mode === "recommended" ? recommendedNovels(token) : newNovels(token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelItems,
    deps: [mode],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel
  })

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
      pagedRef.current.refresh()
    })
  }, [])

  const label = feedLabel(mode)
  return (
    <VStack alignment="leading" spacing={10}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text={`暂无${label}小说，下拉刷新试试`} systemImage="book" />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {paged.items.map((novel) => (
            <NovelCard key={novel.id} novel={novel} />
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

function VisionFeed(props: {
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { onRegisterRefresh } = props
  const paged = usePagedList<PixivVisionArticle>({
    first: (token) => visionHome(token),
    more: (nextURL, token) => nextVision(nextURL, token),
    deps: [],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map((item) => item.imageURL)).cancel
  })

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={12} padding={{ top: 4, bottom: 24 }}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无专辑，下拉刷新试试" systemImage="rectangle.stack" />
      ) : (
        <LazyVStack alignment="leading" spacing={12}>
          {paged.items.map((article) => (
            <VisionCard key={article.id} article={article} />
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

function filterIllustItems(items: PixivIllustration[]): PixivIllustration[] {
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
