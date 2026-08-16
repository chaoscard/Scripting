import {
  Button,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  ScrollView,
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
  isR18ContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { destinationElement } from "./routes"
import { useLatest, usePagedList } from "./hooks"
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
type IllustRankingKind = Exclude<RankingKind, "novel" | "advanced">

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
type IllustRankingMode = IllustrationRankingMode | MangaRankingMode
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
      <VStack alignment="leading" spacing={8}>
        {rootModes && rootSelectedMode ? (
          <RankingModePicker
            modes={rootModes}
            selected={rootSelectedMode}
            onSelect={selectRootMode}
          />
        ) : null}
        {kind === "illustration" ? (
          <IllustRankingFeed
            key={`illustration:${illustrationMode}`}
            kind="illustration"
            mode={illustrationMode}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : kind === "manga" ? (
          <IllustRankingFeed
            key={`manga:${mangaMode}`}
            kind="manga"
            mode={mangaMode}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : kind === "novel" ? (
          <NovelRankingFeed
            key={`novel:${novelMode}`}
            mode={novelMode}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
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
        <Label tag="manga" title="漫画" systemImage="book.closed" />
        <Label tag="novel" title="小说" systemImage="text.book.closed" />
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

function IllustRankingFeed(props: {
  kind: IllustRankingKind
  mode: IllustRankingMode
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, mode, onRegisterRefresh } = props
  const paged = usePagedList<PixivIllustration>({
    first: (token) => ranking(mode, null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: kind === "manga" ? filterMangaRankingItems : filterRankingItems,
    deps: [kind, mode],
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

  return (
    <VStack alignment="leading" spacing={10}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无排行数据，下拉刷新试试" />
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

function NovelRankingFeed(props: {
  mode: NovelRankingMode
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { mode, onRegisterRefresh } = props
  const paged = usePagedList<PixivNovel>({
    first: (token) => novelRanking(mode, null, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelRankingItems,
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

  return (
    <VStack alignment="leading" spacing={10}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无小说排行，下拉刷新试试" systemImage="book" />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {paged.items.map((novel, index) => (
            <NovelCard
              key={novel.id}
              novel={novel}
              priority={index}
              footerText={index < 50 ? `第 ${index + 1} 名` : undefined}
            />
          ))}
          <LoadMoreTrigger
            anchor={paged.items[paged.items.length - 1]?.id}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        </LazyVStack>
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
  return items.filter(
    (item) =>
      isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G) &&
      (settings.showAI || item.novel_ai_type !== 2)
  )
}
