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
  useState,
  VStack,
  ZStack,
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
  MasonryIllustFeed,
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

  // 十二个榜单流完全常驻挂载，切换时仅切换原生 hidden 属性，
  // 零销毁、零重建、零重复布局，实现毫秒级秒切。
  return (
    <VStack
      alignment="leading"
      spacing={8}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      navigationDestination={destinationElement}
      toolbar={rankingToolbar({ kind, onKindChange: setKind, onClose: props.onClose })}
    >
      {rootModes && rootSelectedMode ? (
        <RankingModePicker
          modes={rootModes}
          selected={rootSelectedMode}
          onSelect={selectRootMode}
        />
      ) : null}
      <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        {ILLUSTRATION_MODES.map((mode) => (
          <IllustRankingFeed
            key={`illustration:${mode.value}`}
            kind="illustration"
            mode={mode.value}
            active={kind === "illustration" && illustrationMode === mode.value}
          />
        ))}
        {MANGA_MODES.map((mode) => (
          <IllustRankingFeed
            key={`manga:${mode.value}`}
            kind="manga"
            mode={mode.value}
            active={kind === "manga" && mangaMode === mode.value}
          />
        ))}
        {NOVEL_MODES.map((mode) => (
          <NovelRankingFeed
            key={`novel:${mode.value}`}
            mode={mode.value}
            active={kind === "novel" && novelMode === mode.value}
          />
        ))}
        <AdvancedSearchPlaceholder
          active={kind === "advanced"}
        />
      </ZStack>
    </VStack>
  )
}

function rankingToolbar(props: {
  kind: RankingKind
  onKindChange: (kind: RankingKind) => void
  onClose: () => void
}) {
  return appToolbar(
    props.onClose,
    "排行",
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
  active: boolean
}) {
  const { kind, mode, active } = props
  const paged = usePagedList<PixivIllustration>({
    first: (token) => ranking(mode, null, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: kind === "manga" ? filterMangaRankingItems : filterRankingItems,
    deps: [kind, mode],
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
          <EmptyView text="暂无排行数据，下拉刷新试试" />
        ) : (
          <MasonryIllustFeed
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
    </RefreshableScrollView>
  )
}

function NovelRankingFeed(props: {
  mode: NovelRankingMode
  active: boolean
}) {
  const { mode, active } = props
  const paged = usePagedList<PixivNovel>({
    first: (token) => novelRanking(mode, null, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelRankingItems,
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
          <EmptyView text="暂无小说排行，下拉刷新试试" systemImage="book" />
        ) : (
          <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
            {paged.items.map((novel, index) => (
              <NovelCard
                key={novel.id}
                novel={novel}
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
    </RefreshableScrollView>
  )
}

function AdvancedSearchPlaceholder(props: { active: boolean }) {
  return (
    <ScrollView
      hidden={!props.active}
      navigationBarTitleDisplayMode="inline"
    >
      <VStack alignment="center" spacing={12} padding={{ top: 80, horizontal: 20 }}>
        <Image systemName="slider.horizontal.3" font="largeTitle" foregroundStyle="secondaryLabel" />
        <Text font="headline" fontWeight="bold">
          高级搜索
        </Text>
        <Text font="subheadline" foregroundStyle="secondaryLabel">
          根据收藏数、日期区间与排序方式精确筛选
        </Text>
      </VStack>
    </ScrollView>
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
