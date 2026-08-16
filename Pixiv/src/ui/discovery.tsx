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
          <VisionExploreFeed
            key="vision"
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : mode === "recommended" ? (
          <RecommendedExploreFeed
            key="recommended"
            kind={kind}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : (
          <LatestExploreFeed
            key="latest"
            kind={kind}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function RecommendedExploreFeed(props: {
  kind: FeedKind
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, onRegisterRefresh } = props

  // 1. 推荐 - 插画
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => recommendations("illustration", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["recommended", "illustration"],
    enabled: kind === "illustration",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })

  // 2. 推荐 - 漫画
  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) => recommendations("manga", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["recommended", "manga"],
    enabled: kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })

  // 3. 推荐 - 小说
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => recommendedNovels(token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelItems,
    deps: ["recommended"],
    enabled: kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel,
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

  const activeRefresh =
    kind === "illustration"
      ? illustPaged.refresh
      : kind === "manga"
        ? mangaPaged.refresh
        : novelPaged.refresh

  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  if (kind === "illustration") {
    return <IllustFeedContent paged={illustPaged} label="推荐" />
  }
  if (kind === "manga") {
    return <IllustFeedContent paged={mangaPaged} label="推荐" />
  }
  return <NovelFeedContent paged={novelPaged} label="推荐" />
}

function LatestExploreFeed(props: {
  kind: FeedKind
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, onRegisterRefresh } = props

  // 1. 最新 - 插画
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => newIllustrations("illustration", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["latest", "illustration"],
    enabled: kind === "illustration",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })

  // 2. 最新 - 漫画
  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) => newIllustrations("manga", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["latest", "manga"],
    enabled: kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })

  // 3. 最新 - 小说
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => newNovels(token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelItems,
    deps: ["latest"],
    enabled: kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel,
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

  const activeRefresh =
    kind === "illustration"
      ? illustPaged.refresh
      : kind === "manga"
        ? mangaPaged.refresh
        : novelPaged.refresh

  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  if (kind === "illustration") {
    return <IllustFeedContent paged={illustPaged} label="最新作品" />
  }
  if (kind === "manga") {
    return <IllustFeedContent paged={mangaPaged} label="最新作品" />
  }
  return <NovelFeedContent paged={novelPaged} label="最新作品" />
}

function VisionExploreFeed(props: {
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { onRegisterRefresh } = props

  const visionPaged = usePagedList<PixivVisionArticle>({
    first: (token) => visionHome(token),
    more: (nextURL, token) => nextVision(nextURL, token),
    deps: [],
    enabled: true,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map((item) => item.imageURL)).cancel,
  })

  useEffect(() => {
    onRegisterRefresh?.(visionPaged.refresh)
  }, [visionPaged.refresh, onRegisterRefresh])

  return <VisionFeedContent paged={visionPaged} />
}

function exploreToolbar(props: {
  mode: ExploreMode
  onModeChange: (mode: ExploreMode) => void
  onClose: () => void
}) {
  const title =
    props.mode === "recommended"
      ? "推荐"
      : props.mode === "latest"
        ? "最新"
        : "专辑"
  return appToolbar(
    props.onClose,
    title,
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

function IllustFeedContent(props: {
  paged: ReturnType<typeof usePagedList<PixivIllustration>>
  label: string
}) {
  const { paged, label } = props
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

function NovelFeedContent(props: {
  paged: ReturnType<typeof usePagedList<PixivNovel>>
  label: string
}) {
  const { paged, label } = props
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
          {paged.items.map((novel, index) => (
            <NovelCard key={novel.id} novel={novel} priority={index} />
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

function VisionFeedContent(props: {
  paged: ReturnType<typeof usePagedList<PixivVisionArticle>>
}) {
  const { paged } = props
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
          {paged.items.map((article, index) => (
            <VisionCard key={article.id} article={article} priority={index} />
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
