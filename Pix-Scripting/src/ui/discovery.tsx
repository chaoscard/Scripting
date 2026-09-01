import {
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
  nextPixivision,
  pixivisionHome,
  recommendedNovels,
  recommendations,
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
import { useLatest, usePagedList, currentBatchSize, useExperimentalAmbientPalette } from "./hooks"
import type {
  PixivIllustration,
  PixivNovel,
  PixivisionArticle,
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
  PixivisionCard,
} from "./components"

type ExploreMode = "recommended" | "latest" | "pixivision"
type FeedMode = Exclude<ExploreMode, "pixivision">
type FeedKind = "illustration" | "manga" | "novel"

export function DiscoveryView(props: { onClose: () => void }) {
  const isLaunchTab = useRef(loadSettings().launchPage === "discovery").current
  const [activated, setActivated] = useState(isLaunchTab)
  const [mode, setMode] = useState<ExploreMode>("recommended")
  const [kind, setKind] = useState<FeedKind>("illustration")
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(null)
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    return onSettingsChanged(() => {
      const next = loadSettings().hideNovels
      setHideNovels(next)
      if (next && kind === "novel") {
        setKind("illustration")
      }
    })
  }, [kind])

  return (
    <RefreshableScrollView
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      toolbar={exploreToolbar({ mode, onModeChange: setMode, onClose: props.onClose })}
      background={ambientBackground}
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack
        alignment="leading"
        spacing={8}
        onAppear={() => {
          if (!activated) setActivated(true)
        }}
      >
        {mode === "pixivision" ? null : (
          <FeedKindPicker kind={kind} hideNovels={hideNovels} onKindChange={setKind} />
        )}
        {mode === "pixivision" ? (
          <PixivisionExploreFeed
            key="pixivision"
            enabled={activated}
            onFirstImageUrlChange={setAmbientImageUrl}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : mode === "recommended" ? (
          <RecommendedExploreFeed
            key="recommended"
            kind={kind}
            enabled={activated}
            onFirstImageUrlChange={setAmbientImageUrl}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : (
          <LatestExploreFeed
            key="latest"
            kind={kind}
            enabled={activated}
            onFirstImageUrlChange={setAmbientImageUrl}
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
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, enabled = true, onFirstImageUrlChange, onRegisterRefresh } = props

  // 1. 推荐 - 插画
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => recommendations("illustration", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["recommended", "illustration"],
    enabled: enabled && kind === "illustration",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 推荐 - 漫画
  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) => recommendations("manga", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["recommended", "manga"],
    enabled: enabled && kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 推荐 - 小说
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => recommendedNovels(token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelItems,
    deps: ["recommended"],
    enabled: enabled && kind === "novel",
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

  const activeRefresh =
    kind === "illustration"
      ? illustPaged.refresh
      : kind === "manga"
        ? mangaPaged.refresh
        : novelPaged.refresh

  useEffect(() => {
    let url: string | null = null
    let hasLoaded = false
    let isEmpty = false
    if (kind === "illustration") {
      if (illustPaged.items[0]) url = cardThumbUrlOf(illustPaged.items[0])
      hasLoaded = !illustPaged.initialLoading
      isEmpty = illustPaged.items.length === 0
    } else if (kind === "manga") {
      if (mangaPaged.items[0]) url = cardThumbUrlOf(mangaPaged.items[0])
      hasLoaded = !mangaPaged.initialLoading
      isEmpty = mangaPaged.items.length === 0
    } else if (kind === "novel") {
      if (novelPaged.items[0]) url = novelThumbUrlOf(novelPaged.items[0])
      hasLoaded = !novelPaged.initialLoading
      isEmpty = novelPaged.items.length === 0
    }
    if (url) {
      onFirstImageUrlChange?.(url)
    } else if (hasLoaded && isEmpty) {
      onFirstImageUrlChange?.(null)
    }
  }, [
    kind,
    illustPaged.items[0]?.id,
    illustPaged.initialLoading,
    illustPaged.items.length,
    mangaPaged.items[0]?.id,
    mangaPaged.initialLoading,
    mangaPaged.items.length,
    novelPaged.items[0]?.id,
    novelPaged.initialLoading,
    novelPaged.items.length,
    onFirstImageUrlChange,
  ])

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
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, enabled = true, onFirstImageUrlChange, onRegisterRefresh } = props

  // 1. 最新 - 插画
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => newIllustrations("illustration", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["latest", "illustration"],
    enabled: enabled && kind === "illustration",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 最新 - 漫画
  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) => newIllustrations("manga", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["latest", "manga"],
    enabled: enabled && kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 最新 - 小说
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => newNovels(token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelItems,
    deps: ["latest"],
    enabled: enabled && kind === "novel",
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

  const activeRefresh =
    kind === "illustration"
      ? illustPaged.refresh
      : kind === "manga"
        ? mangaPaged.refresh
        : novelPaged.refresh

  useEffect(() => {
    let url: string | null = null
    let hasLoaded = false
    let isEmpty = false
    if (kind === "illustration") {
      if (illustPaged.items[0]) url = cardThumbUrlOf(illustPaged.items[0])
      hasLoaded = !illustPaged.initialLoading
      isEmpty = illustPaged.items.length === 0
    } else if (kind === "manga") {
      if (mangaPaged.items[0]) url = cardThumbUrlOf(mangaPaged.items[0])
      hasLoaded = !mangaPaged.initialLoading
      isEmpty = mangaPaged.items.length === 0
    } else if (kind === "novel") {
      if (novelPaged.items[0]) url = novelThumbUrlOf(novelPaged.items[0])
      hasLoaded = !novelPaged.initialLoading
      isEmpty = novelPaged.items.length === 0
    }
    if (url) {
      onFirstImageUrlChange?.(url)
    } else if (hasLoaded && isEmpty) {
      onFirstImageUrlChange?.(null)
    }
  }, [
    kind,
    illustPaged.items[0]?.id,
    illustPaged.initialLoading,
    illustPaged.items.length,
    mangaPaged.items[0]?.id,
    mangaPaged.initialLoading,
    mangaPaged.items.length,
    novelPaged.items[0]?.id,
    novelPaged.initialLoading,
    novelPaged.items.length,
    onFirstImageUrlChange,
  ])

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

function PixivisionExploreFeed(props: {
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { enabled = true, onFirstImageUrlChange, onRegisterRefresh } = props

  const paged = usePagedList<PixivisionArticle>({
    first: () => pixivisionHome(),
    more: (nextURL) => nextPixivision(nextURL),
    deps: [],
    enabled,
    requiresAuth: false,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map((item) => item.imageURL)).cancel,
  })

  useEffect(() => {
    const firstUrl = paged.items[0]?.imageURL
    if (firstUrl) {
      onFirstImageUrlChange?.(firstUrl)
    } else if (!paged.initialLoading && paged.items.length === 0) {
      onFirstImageUrlChange?.(null)
    }
  }, [paged.items[0]?.id, paged.items[0]?.imageURL, paged.initialLoading, paged.items.length, onFirstImageUrlChange])

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  return <PixivisionFeedContent paged={paged} />
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
        : "特辑"
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
        <Label tag="pixivision" title="特辑" systemImage="rectangle.stack" />
      </Picker>
    </Menu>
  )
}

function FeedKindPicker(props: {
  kind: FeedKind
  hideNovels?: boolean
  onKindChange: (kind: FeedKind) => void
}) {
  const kinds: { tag: FeedKind; label: string }[] = [
    { tag: "illustration", label: "插画" },
    { tag: "manga", label: "漫画" },
  ]
  if (!props.hideNovels) {
    kinds.push({ tag: "novel", label: "小说" })
  }
  if (kinds.length <= 1) return null

  return (
    <Picker
      title="作品类型"
      value={props.kind}
      onChanged={(value: string) => props.onKindChange(value as FeedKind)}
      pickerStyle="segmented"
      padding={{ horizontal: 14 }}
    >
      {kinds.map((item) => (
        <Text key={item.tag} tag={item.tag}>
          {item.label}
        </Text>
      ))}
    </Picker>
  )
}

function IllustFeedContent(props: {
  paged: ReturnType<typeof usePagedList<PixivIllustration>>
  label: string
}) {
  const { paged, label } = props
  const [heroFirst, setHeroFirst] = useState(() => loadSettings().heroFirstFeedCard)

  useEffect(() => {
    return onSettingsChanged(() => {
      setHeroFirst(loadSettings().heroFirstFeedCard)
    })
  }, [])

  return (
    <VStack alignment="leading" spacing={8}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView
          text={
            paged.hasFilteredContent
              ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
              : `暂无${label}，下拉刷新试试`
          }
          systemImage={paged.hasFilteredContent ? "eye.slash" : "photo"}
        />
      ) : (
        <IllustFlowFeed
          items={paged.items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
          enableHeroFirst={heroFirst}
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
    <VStack alignment="leading" spacing={8}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView
          text={
            paged.hasFilteredContent
              ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
              : `暂无${label}小说，下拉刷新试试`
          }
          systemImage={paged.hasFilteredContent ? "eye.slash" : "book"}
        />
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

function PixivisionFeedContent(props: {
  paged: ReturnType<typeof usePagedList<PixivisionArticle>>
}) {
  const { paged } = props
  return (
    <VStack alignment="leading" spacing={8} padding={{ top: 4, bottom: 24 }}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无特辑，下拉刷新试试" systemImage="rectangle.stack" />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 12 }}>
          {paged.items.map((article, index) => (
            <PixivisionCard key={article.id} article={article} priority={index} />
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
  return items.filter((item) => isNovelContentVisible(item, settings))
}
