import {
  Button,
  Device,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  Text,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { useIsCurrentTab } from "./routeNavigation"
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
import { requestPixivRoute, setActiveTabKind } from "./routeNavigation"
import {
  DockActionBar,
  DockSegmentedBar,
  useRegisterBottomAccessory,
} from "./bottomAccessory"
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

declare const Haptics: any

type ExploreMode = "recommended" | "latest" | "pixivision"
type FeedMode = Exclude<ExploreMode, "pixivision">
type FeedKind = "illustration" | "manga" | "novel"

export function DiscoveryView(props: { onClose: () => void }) {
  useEffect(() => {
    setActiveTabKind("discovery")
  }, [])

  const isLaunchTab = useRef(loadSettings().launchPage === "discovery").current
  const [activated, setActivated] = useState(isLaunchTab)
  const [mode, setMode] = useState<ExploreMode>("recommended")
  const [kind, setKind] = useState<FeedKind>("illustration")
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(null)
  const isTabActive = useIsCurrentTab("discovery")
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl, isTabActive)
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      setHideNovels(nextSettings.hideNovels)
      setPageLayout(nextSettings.pageLayout)
      if (nextSettings.hideNovels && kind === "novel") {
        setKind("illustration")
      }
    })
  }, [kind])

  const discoveryItems = useMemo<Array<{ tag: FeedKind; label: string }>>(() => {
    const items: Array<{ tag: FeedKind; label: string }> = [
      { tag: "illustration", label: "插画" },
      { tag: "manga", label: "漫画" },
    ]
    if (!hideNovels) {
      items.push({ tag: "novel", label: "小说" })
    }
    return items
  }, [hideNovels])

  const discoveryBottomAccessory = useMemo(() => {
    if (mode === "pixivision") {
      return (
        <DockActionBar
          items={[
            {
              key: "pixivisionBookmarks",
              label: "特辑收藏",
              icon: "heart",
              color: "#3172EB",
              action: () => {
                try {
                  void Haptics.transient()
                } catch {}
                requestPixivRoute("library:pixivision", "discovery")
              },
            },
          ]}
        />
      )
    }
    return (
      <DockSegmentedBar
        items={discoveryItems}
        value={kind}
        onChanged={setKind}
      />
    )
  }, [mode, discoveryItems, kind])

  useRegisterBottomAccessory(
    "discovery",
    discoveryBottomAccessory,
    isAppleMusic
  )

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      background={ambientBackground}
      toolbar={exploreToolbar({
        mode,
        kind,
        hideNovels,
        isAppleMusic,
        onModeChange: setMode,
        onKindChange: setKind,
        onClose: props.onClose,
      })}
      onAppear={() => {
        if (!activated) setActivated(true)
      }}
    >
      {/* 1. 推荐模式（即刻挂载与卸载） */}
      {mode === "recommended" && (
        <RecommendedExploreFeed
          kind={kind}
          enabled={activated}
          hideNovels={hideNovels}
          isAppleMusic={isAppleMusic}
          onKindChange={setKind}
          onFirstImageUrlChange={setAmbientImageUrl}
        />
      )}

      {/* 2. 最新模式（即刻挂载与卸载） */}
      {mode === "latest" && (
        <LatestExploreFeed
          kind={kind}
          enabled={activated}
          hideNovels={hideNovels}
          isAppleMusic={isAppleMusic}
          onKindChange={setKind}
          onFirstImageUrlChange={setAmbientImageUrl}
        />
      )}

      {/* 3. 特辑模式（即刻挂载与卸载） */}
      {mode === "pixivision" && (
        <PixivisionExploreFeed
          enabled={activated}
          onFirstImageUrlChange={setAmbientImageUrl}
        />
      )}
    </ZStack>
  )
}

function RecommendedExploreFeed(props: {
  kind: FeedKind
  enabled?: boolean
  hideNovels?: boolean
  isAppleMusic?: boolean
  onKindChange?: (kind: FeedKind) => void
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const {
    kind,
    enabled = true,
    hideNovels,
    isAppleMusic,
    onKindChange,
    onFirstImageUrlChange,
  } = props

  const [visitedKinds, setVisitedKinds] = useState<Set<FeedKind>>(() => new Set([kind]))

  useEffect(() => {
    setVisitedKinds((prev) => {
      if (prev.has(kind)) return prev
      const next = new Set(prev)
      next.add(kind)
      return next
    })
  }, [kind])

  // 1. 推荐 - 插画
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => recommendations("illustration", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["recommended", "illustration"],
    enabled: enabled && visitedKinds.has("illustration"),
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 推荐 - 漫画
  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) => recommendations("manga", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["recommended", "manga"],
    enabled: enabled && visitedKinds.has("manga"),
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 推荐 - 小说
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => recommendedNovels(token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelItems,
    deps: ["recommended"],
    enabled: enabled && visitedKinds.has("novel"),
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

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 1. 插画独立滚动保活容器 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        opacity={kind === "illustration" ? 1 : 0}
        zIndex={kind === "illustration" ? 1 : 0}
        allowsHitTesting={kind === "illustration"}
      >
        <RefreshableScrollView refreshable={illustPaged.refresh}>
          <IllustFeedContent paged={illustPaged} label="推荐" />
        </RefreshableScrollView>
      </VStack>

      {/* 2. 漫画独立滚动保活容器 */}
      {visitedKinds.has("manga") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={kind === "manga" ? 1 : 0}
          zIndex={kind === "manga" ? 1 : 0}
          allowsHitTesting={kind === "manga"}
        >
          <RefreshableScrollView refreshable={mangaPaged.refresh}>
            <IllustFeedContent paged={mangaPaged} label="推荐" />
          </RefreshableScrollView>
        </VStack>
      ) : null}

      {/* 3. 小说独立滚动保活容器 */}
      {visitedKinds.has("novel") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={kind === "novel" ? 1 : 0}
          zIndex={kind === "novel" ? 1 : 0}
          allowsHitTesting={kind === "novel"}
        >
          <RefreshableScrollView refreshable={novelPaged.refresh}>
            <NovelFeedContent paged={novelPaged} label="推荐" />
          </RefreshableScrollView>
        </VStack>
      ) : null}
    </ZStack>
  )
}

function LatestExploreFeed(props: {
  kind: FeedKind
  enabled?: boolean
  hideNovels?: boolean
  isAppleMusic?: boolean
  onKindChange?: (kind: FeedKind) => void
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const {
    kind,
    enabled = true,
    hideNovels,
    isAppleMusic,
    onKindChange,
    onFirstImageUrlChange,
  } = props

  const [visitedKinds, setVisitedKinds] = useState<Set<FeedKind>>(() => new Set([kind]))

  useEffect(() => {
    setVisitedKinds((prev) => {
      if (prev.has(kind)) return prev
      const next = new Set(prev)
      next.add(kind)
      return next
    })
  }, [kind])

  // 1. 最新 - 插画
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => newIllustrations("illustration", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["latest", "illustration"],
    enabled: enabled && visitedKinds.has("illustration"),
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 最新 - 漫画
  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) => newIllustrations("manga", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustItems,
    deps: ["latest", "manga"],
    enabled: enabled && visitedKinds.has("manga"),
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 最新 - 小说
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => newNovels(token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelItems,
    deps: ["latest"],
    enabled: enabled && visitedKinds.has("novel"),
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

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 1. 最新 - 插画 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        opacity={kind === "illustration" ? 1 : 0}
        zIndex={kind === "illustration" ? 1 : 0}
        allowsHitTesting={kind === "illustration"}
      >
        <RefreshableScrollView refreshable={illustPaged.refresh}>
          <IllustFeedContent paged={illustPaged} label="最新作品" />
        </RefreshableScrollView>
      </VStack>

      {/* 2. 最新 - 漫画 */}
      {visitedKinds.has("manga") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={kind === "manga" ? 1 : 0}
          zIndex={kind === "manga" ? 1 : 0}
          allowsHitTesting={kind === "manga"}
        >
          <RefreshableScrollView refreshable={mangaPaged.refresh}>
            <IllustFeedContent paged={mangaPaged} label="最新作品" />
          </RefreshableScrollView>
        </VStack>
      ) : null}

      {/* 3. 最新 - 小说 */}
      {visitedKinds.has("novel") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={kind === "novel" ? 1 : 0}
          zIndex={kind === "novel" ? 1 : 0}
          allowsHitTesting={kind === "novel"}
        >
          <RefreshableScrollView refreshable={novelPaged.refresh}>
            <NovelFeedContent paged={novelPaged} label="最新作品" />
          </RefreshableScrollView>
        </VStack>
      ) : null}
    </ZStack>
  )
}

function PixivisionExploreFeed(props: {
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const { enabled = true, onFirstImageUrlChange } = props

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

  return (
    <RefreshableScrollView refreshable={paged.refresh}>
      <PixivisionFeedContent paged={paged} />
    </RefreshableScrollView>
  )
}

function exploreToolbar(props: {
  mode: ExploreMode
  kind: FeedKind
  hideNovels?: boolean
  isAppleMusic?: boolean
  onModeChange: (mode: ExploreMode) => void
  onKindChange: (kind: FeedKind) => void
  onClose: () => void
}) {
  const isiPad = Device.isiPad
  const isClassic = !props.isAppleMusic
  const kindLabel =
    props.kind === "illustration" ? "插画" : props.kind === "manga" ? "漫画" : "小说"
  const baseTitle =
    props.mode === "recommended"
      ? "推荐"
      : props.mode === "latest"
        ? "最新"
        : "特辑"

  const fullTitle =
    props.mode === "pixivision" ? "特辑" : `${baseTitle} · ${kindLabel}`

  const titleNode = (
    <Text font={isiPad ? "headline" : "title2"} fontWeight="bold">
      {isClassic ? fullTitle : baseTitle}
    </Text>
  )

  const trailingMenuLabel = isiPad ? (
    <HStack alignment="center" spacing={4}>
      <Text font="subheadline" fontWeight="semibold">
        {props.isAppleMusic
          ? props.mode === "pixivision"
            ? "特辑"
            : baseTitle
          : props.mode === "pixivision"
            ? "特辑"
            : `${baseTitle} · ${kindLabel}`}
      </Text>
      <Image
        systemName="chevron.down"
        font="caption2"
        foregroundStyle="secondaryLabel"
      />
    </HStack>
  ) : (
    <Image systemName="ellipsis.circle" />
  )

  const trailingMenu = (
    <Menu label={trailingMenuLabel}>
      <Picker
        title="探索类型"
        value={props.mode}
        onChanged={(value: string) => props.onModeChange(value as ExploreMode)}
      >
        <Label tag="recommended" title="推荐" systemImage="sparkles" />
        <Label tag="latest" title="最新" systemImage="clock" />
        <Label tag="pixivision" title="特辑" systemImage="rectangle.stack" />
      </Picker>
      {isClassic && props.mode !== "pixivision" && (
        <Picker
          title="媒体类型"
          value={props.kind}
          onChanged={(value: string) => props.onKindChange(value as FeedKind)}
        >
          <Label tag="illustration" title="插画" systemImage="photo" />
          <Label tag="manga" title="漫画" systemImage="photo.on.rectangle" />
          {!props.hideNovels && (
            <Label tag="novel" title="小说" systemImage="book" />
          )}
        </Picker>
      )}
    </Menu>
  )

  return appToolbar(props.onClose, titleNode, trailingMenu)
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
