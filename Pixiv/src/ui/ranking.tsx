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
import { nextIllustrations, nextNovels, novelRanking, ranking } from "../api/pixiv"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  isIllustContentVisible,
  isNovelContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { destinationElement } from "./routes"
import { useLatest, usePagedList, currentBatchSize } from "./hooks"
import type { PixivIllustration, PixivNovel } from "../types"
import {
  appToolbar,
  EmptyView,
  ErrorView,
  ImageNumberBadge,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

type RankingKind = "illustration" | "manga" | "novel" | "advanced"

type IllustrationRankingMode =
  | "day"
  | "week"
  | "month"
  | "week_original"
  | "week_rookie"

type MangaRankingMode =
  | "day_manga"
  | "week_manga"
  | "month_manga"
  | "week_rookie_manga"

type NovelRankingMode = "day" | "week" | "week_rookie"

const ILLUSTRATION_MODES: ReadonlyArray<{
  value: IllustrationRankingMode
  title: string
}> = [
  { value: "day", title: "每日" },
  { value: "week", title: "每周" },
  { value: "month", title: "每月" },
  { value: "week_original", title: "原创" },
  { value: "week_rookie", title: "新人" },
]

const MANGA_MODES: ReadonlyArray<{ value: MangaRankingMode; title: string }> = [
  { value: "day_manga", title: "每日" },
  { value: "week_manga", title: "每周" },
  { value: "month_manga", title: "每月" },
  { value: "week_rookie_manga", title: "新人" },
]

const NOVEL_MODES: ReadonlyArray<{ value: NovelRankingMode; title: string }> = [
  { value: "day", title: "每日" },
  { value: "week", title: "每周" },
  { value: "week_rookie", title: "新人" },
]

export function RankingView(props: { onClose: () => void }) {
  const [kind, setKind] = useState<RankingKind>("illustration")
  const [illustrationMode, setIllustrationMode] =
    useState<IllustrationRankingMode>("day")
  const [mangaMode, setMangaMode] = useState<MangaRankingMode>("day_manga")
  const [novelMode, setNovelMode] = useState<NovelRankingMode>("day")
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const rootModes =
    kind === "illustration"
      ? ILLUSTRATION_MODES
      : kind === "manga"
        ? MANGA_MODES
        : kind === "novel"
          ? NOVEL_MODES
          : null
  const rootSelectedMode =
    kind === "illustration"
      ? illustrationMode
      : kind === "manga"
        ? mangaMode
        : kind === "novel"
          ? novelMode
          : null

  function selectRootMode(value: string) {
    if (kind === "illustration") setIllustrationMode(value as IllustrationRankingMode)
    else if (kind === "manga") setMangaMode(value as MangaRankingMode)
    else if (kind === "novel") setNovelMode(value as NovelRankingMode)
  }

  return (
    <RefreshableScrollView
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      toolbar={rankingToolbar({ kind, onKindChange: setKind, onClose: props.onClose })}
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
        {rootModes && rootSelectedMode ? (
          <RankingModePicker
            modes={rootModes}
            selected={rootSelectedMode}
            onSelect={selectRootMode}
          />
        ) : null}
        {kind === "illustration" ? (
          <IllustrationRankingFeed
            key="illustration"
            mode={illustrationMode}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : kind === "manga" ? (
          <MangaRankingFeed
            key="manga"
            mode={mangaMode}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : kind === "novel" ? (
          <NovelRankingFeed
            key="novel"
            mode={novelMode}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : (
          <AdvancedSearchPlaceholder />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function rankingToolbar(props: {
  kind: RankingKind
  onKindChange: (kind: RankingKind) => void
  onClose: () => void
}) {
  const title =
    props.kind === "illustration"
      ? "插画"
      : props.kind === "manga"
        ? "漫画"
        : props.kind === "novel"
          ? "小说"
          : "高级"
  return appToolbar(
    props.onClose,
    title,
    <Menu label={<Image systemName="ellipsis.circle" />}>
      <Picker
        title="排行榜类型"
        value={props.kind}
        onChanged={(value: string) => props.onKindChange(value as RankingKind)}
      >
        <Label tag="illustration" title="插画" systemImage="photo" />
        <Label tag="manga" title="漫画" systemImage="photo.on.rectangle" />
        <Label tag="novel" title="小说" systemImage="book" />
        <Label
          tag="advanced"
          title="高级"
          systemImage="slider.horizontal.3"
        />
      </Picker>
    </Menu>
  )
}

function RankingModePicker(props: {
  modes: ReadonlyArray<{ value: string; title: string }>
  selected: string
  onSelect: (mode: string) => void
}) {
  return (
    <Picker
      title="榜单类型"
      value={props.selected}
      onChanged={(value: string) => props.onSelect(value)}
      pickerStyle="segmented"
      padding={{ horizontal: 14 }}
    >
      {props.modes.map((mode) => (
        <Text key={mode.value} tag={mode.value}>
          {mode.title}
        </Text>
      ))}
    </Picker>
  )
}

function IllustrationRankingFeed(props: {
  mode: IllustrationRankingMode
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { mode, onRegisterRefresh } = props

  // 1. 每日
  const dayPaged = usePagedList<PixivIllustration>({
    first: (token) => ranking("day", null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterRankingItems,
    deps: ["illustration", "day"],
    enabled: mode === "day",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 每周
  const weekPaged = usePagedList<PixivIllustration>({
    first: (token) => ranking("week", null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterRankingItems,
    deps: ["illustration", "week"],
    enabled: mode === "week",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 每月
  const monthPaged = usePagedList<PixivIllustration>({
    first: (token) => ranking("month", null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterRankingItems,
    deps: ["illustration", "month"],
    enabled: mode === "month",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 4. 原创
  const originalPaged = usePagedList<PixivIllustration>({
    first: (token) => ranking("week_original", null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterRankingItems,
    deps: ["illustration", "week_original"],
    enabled: mode === "week_original",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 5. 新人
  const rookiePaged = usePagedList<PixivIllustration>({
    first: (token) => ranking("week_rookie", null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterRankingItems,
    deps: ["illustration", "week_rookie"],
    enabled: mode === "week_rookie",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const dayPagedRef = useLatest(dayPaged)
  const weekPagedRef = useLatest(weekPaged)
  const monthPagedRef = useLatest(monthPaged)
  const originalPagedRef = useLatest(originalPaged)
  const rookiePagedRef = useLatest(rookiePaged)

  useEffect(() => {
    return onSettingsChanged(() => {
      dayPagedRef.current.reapplyFilter()
      weekPagedRef.current.reapplyFilter()
      monthPagedRef.current.reapplyFilter()
      originalPagedRef.current.reapplyFilter()
      rookiePagedRef.current.reapplyFilter()
    })
  }, [])

  const activePaged =
    mode === "day"
      ? dayPaged
      : mode === "week"
        ? weekPaged
        : mode === "month"
          ? monthPaged
          : mode === "week_original"
            ? originalPaged
            : rookiePaged

  useEffect(() => {
    onRegisterRefresh?.(activePaged.refresh)
  }, [activePaged.refresh, onRegisterRefresh])

  return <IllustRankingFeedContent paged={activePaged} label="插画" />
}

function MangaRankingFeed(props: {
  mode: MangaRankingMode
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { mode, onRegisterRefresh } = props

  // 1. 每日
  const dayPaged = usePagedList<PixivIllustration>({
    first: (token) => ranking("day_manga", null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterMangaRankingItems,
    deps: ["manga", "day_manga"],
    enabled: mode === "day_manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 每周
  const weekPaged = usePagedList<PixivIllustration>({
    first: (token) => ranking("week_manga", null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterMangaRankingItems,
    deps: ["manga", "week_manga"],
    enabled: mode === "week_manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 每月
  const monthPaged = usePagedList<PixivIllustration>({
    first: (token) => ranking("month_manga", null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterMangaRankingItems,
    deps: ["manga", "month_manga"],
    enabled: mode === "month_manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 4. 新人
  const rookiePaged = usePagedList<PixivIllustration>({
    first: (token) => ranking("week_rookie_manga", null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterMangaRankingItems,
    deps: ["manga", "week_rookie_manga"],
    enabled: mode === "week_rookie_manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const dayPagedRef = useLatest(dayPaged)
  const weekPagedRef = useLatest(weekPaged)
  const monthPagedRef = useLatest(monthPaged)
  const rookiePagedRef = useLatest(rookiePaged)

  useEffect(() => {
    return onSettingsChanged(() => {
      dayPagedRef.current.reapplyFilter()
      weekPagedRef.current.reapplyFilter()
      monthPagedRef.current.reapplyFilter()
      rookiePagedRef.current.reapplyFilter()
    })
  }, [])

  const activePaged =
    mode === "day_manga"
      ? dayPaged
      : mode === "week_manga"
        ? weekPaged
        : mode === "month_manga"
          ? monthPaged
          : rookiePaged

  useEffect(() => {
    onRegisterRefresh?.(activePaged.refresh)
  }, [activePaged.refresh, onRegisterRefresh])

  return <IllustRankingFeedContent paged={activePaged} label="漫画" />
}

function NovelRankingFeed(props: {
  mode: NovelRankingMode
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { mode, onRegisterRefresh } = props

  // 1. 每日
  const dayPaged = usePagedList<PixivNovel>({
    first: (token) => novelRanking("day", null, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelRankingItems,
    deps: ["novel", "day"],
    enabled: mode === "day",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  // 2. 每周
  const weekPaged = usePagedList<PixivNovel>({
    first: (token) => novelRanking("week", null, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelRankingItems,
    deps: ["novel", "week"],
    enabled: mode === "week",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  // 3. 新人
  const rookiePaged = usePagedList<PixivNovel>({
    first: (token) => novelRanking("week_rookie", null, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelRankingItems,
    deps: ["novel", "week_rookie"],
    enabled: mode === "week_rookie",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const dayPagedRef = useLatest(dayPaged)
  const weekPagedRef = useLatest(weekPaged)
  const rookiePagedRef = useLatest(rookiePaged)

  useEffect(() => {
    return onSettingsChanged(() => {
      dayPagedRef.current.reapplyFilter()
      weekPagedRef.current.reapplyFilter()
      rookiePagedRef.current.reapplyFilter()
    })
  }, [])

  const activePaged =
    mode === "day"
      ? dayPaged
      : mode === "week"
        ? weekPaged
        : rookiePaged

  useEffect(() => {
    onRegisterRefresh?.(activePaged.refresh)
  }, [activePaged.refresh, onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
      {activePaged.initialLoading ? (
        <LoadingView text="加载小说…" />
      ) : activePaged.error && activePaged.items.length === 0 ? (
        <ErrorView message={activePaged.error} onRetry={activePaged.refresh} />
      ) : activePaged.items.length === 0 ? (
        <EmptyView text="暂无小说排行，下拉刷新试试" systemImage="book" />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {activePaged.items.map((novel, index) => (
            <NovelCard
              key={novel.id}
              novel={novel}
              priority={index}
              footerText={index < 50 ? `第 ${index + 1} 名` : undefined}
            />
          ))}
          <LoadMoreTrigger
            anchor={activePaged.items[activePaged.items.length - 1]?.id}
            onLoadMore={activePaged.loadMore}
            hasMore={activePaged.hasMore}
            isLoading={activePaged.loadingMore}
          />
        </LazyVStack>
      )}
    </VStack>
  )
}

function IllustRankingFeedContent(props: {
  paged: ReturnType<typeof usePagedList<PixivIllustration>>
  label: string
}) {
  const { paged, label } = props
  return (
    <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
      {paged.initialLoading ? (
        <LoadingView text={`加载${label}…`} />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView
          text={`暂无${label}排行，下拉刷新试试`}
          systemImage={label.includes("漫画") ? "photo.on.rectangle" : "photo"}
        />
      ) : (
        <IllustFlowFeed
          items={paged.items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
          cornerBadgeOf={(_, index) =>
            index < 50 ? <ImageNumberBadge number={index + 1} /> : undefined
          }
        />
      )}
    </VStack>
  )
}

function AdvancedSearchPlaceholder() {
  return (
    <VStack alignment="center" spacing={12} padding={{ top: 80, horizontal: 20 }}>
      <Image systemName="slider.horizontal.3" font="largeTitle" foregroundStyle="secondaryLabel" />
      <Text font="headline" fontWeight="bold">
        高级搜索
      </Text>
      <Text font="subheadline" foregroundStyle="secondaryLabel">
        根据收藏数、日期区间与排序方式精确筛选
      </Text>
    </VStack>
  )
}

function filterRankingItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterMangaRankingItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterNovelRankingItems(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) => isNovelContentVisible(item, settings))
}
