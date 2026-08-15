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
  MasonryIllustFeed,
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

  // 七个流完全常驻挂载，切换时仅切换原生 hidden 属性，
  // 零销毁、零重建、零重复布局，实现毫秒级秒切。
  return (
    <VStack
      alignment="leading"
      spacing={8}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      navigationDestination={destinationElement}
      toolbar={exploreToolbar({ mode, onModeChange: setMode, onClose: props.onClose })}
    >
      {mode === "vision" ? null : (
        <FeedKindPicker kind={kind} onKindChange={setKind} />
      )}
      <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <IllustFeed
          mode="recommended"
          kind="illustration"
          active={mode === "recommended" && kind === "illustration"}
        />
        <IllustFeed
          mode="recommended"
          kind="manga"
          active={mode === "recommended" && kind === "manga"}
        />
        <NovelFeed
          mode="recommended"
          active={mode === "recommended" && kind === "novel"}
        />
        <IllustFeed
          mode="latest"
          kind="illustration"
          active={mode === "latest" && kind === "illustration"}
        />
        <IllustFeed
          mode="latest"
          kind="manga"
          active={mode === "latest" && kind === "manga"}
        />
        <NovelFeed
          mode="latest"
          active={mode === "latest" && kind === "novel"}
        />
        <VisionFeed
          active={mode === "vision"}
        />
      </ZStack>
    </VStack>
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
      padding={{ horizontal: 14, top: 4 }}
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
  active: boolean
}) {
  const { mode, kind, active } = props
  const paged = usePagedList<PixivIllustration>({
    first: (token) =>
      mode === "recommended"
        ? recommendations(kind, token)
        : newIllustrations(kind, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: [mode, kind],
    enabled: active,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel
  })

  const pagedRef = useLatest(paged)
  const activeRef = useLatest(active)
  useEffect(() => {
    return onSettingsChanged(() => {
      if (!activeRef.current) return
      pagedRef.current.reapplyFilter()
      pagedRef.current.refresh()
    })
  }, [])

  const label = feedLabel(mode)
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
          <EmptyView text={`暂无${label}，下拉刷新试试`} />
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

function NovelFeed(props: {
  mode: FeedMode
  active: boolean
}) {
  const { mode, active } = props
  const paged = usePagedList<PixivNovel>({
    first: (token) =>
      mode === "recommended" ? recommendedNovels(token) : newNovels(token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelItems,
    deps: [mode],
    enabled: active,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel
  })
  const pagedRef = useLatest(paged)
  const activeRef = useLatest(active)
  useEffect(() => {
    return onSettingsChanged(() => {
      if (!activeRef.current) return
      pagedRef.current.reapplyFilter()
      pagedRef.current.refresh()
    })
  }, [])

  const label = feedLabel(mode)
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
    </RefreshableScrollView>
  )
}

function VisionFeed(props: { active: boolean }) {
  const paged = usePagedList<PixivVisionArticle>({
    first: (token) => visionHome(token),
    more: (nextURL, token) => nextVision(nextURL, token),
    deps: [],
    enabled: props.active,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map((item) => item.imageURL)).cancel
  })

  return (
    <RefreshableScrollView
      hidden={!props.active}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
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
    </RefreshableScrollView>
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
