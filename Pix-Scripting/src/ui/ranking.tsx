import {
  Button,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import { nextIllustrations, nextNovels, novelRanking, ranking } from "../api/pixiv"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  ALL_ILLUST_RANKING_OPTIONS,
  ALL_MANGA_RANKING_OPTIONS,
  ALL_NOVEL_RANKING_OPTIONS,
  getCustomRankingModesForKind,
  loadSettings,
  onSettingsChanged,
  type AppSettings,
} from "../store/settings"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import { destinationElement } from "./routes"
import { setActiveTabKind } from "./routeNavigation"
import { useLatest, usePagedList, currentBatchSize, useExperimentalAmbientPalette } from "./hooks"
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
import {
  getInitialAdvancedParams,
  RankingAdvancedSheet,
  type AdvancedRankingParams,
} from "./rankingAdvancedSheet"

type RankingKind = "illustration" | "manga" | "novel" | "advanced"

const DEFAULT_ILLUSTRATION_MODES: ReadonlyArray<{ value: string; title: string }> = [
  { value: "day", title: "每日" },
  { value: "week", title: "每周" },
  { value: "month", title: "每月" },
  { value: "week_original", title: "原创" },
  { value: "week_rookie", title: "新人" },
]

const DEFAULT_MANGA_MODES: ReadonlyArray<{ value: string; title: string }> = [
  { value: "day_manga", title: "每日" },
  { value: "week_manga", title: "每周" },
  { value: "month_manga", title: "每月" },
  { value: "week_rookie_manga", title: "新人" },
]

const DEFAULT_NOVEL_MODES: ReadonlyArray<{ value: string; title: string }> = [
  { value: "day", title: "每日" },
  { value: "week", title: "每周" },
  { value: "week_rookie", title: "新人" },
]

function getRankingModeTitle(
  category: "illustration" | "manga" | "novel",
  mode: string
): string {
  const list =
    category === "illustration"
      ? ALL_ILLUST_RANKING_OPTIONS
      : category === "manga"
        ? ALL_MANGA_RANKING_OPTIONS
        : ALL_NOVEL_RANKING_OPTIONS
  const match = list.find((item) => item.key === mode)
  return match?.title ?? mode
}

export function RankingView(props: { onClose: () => void }) {
  useEffect(() => {
    setActiveTabKind("ranking")
  }, [])

  const isLaunchTab = useRef(loadSettings().launchPage === "ranking").current
  const [activated, setActivated] = useState(isLaunchTab)
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [kind, setKind] = useState<RankingKind>("illustration")
  const [illustrationMode, setIllustrationMode] = useState<string>("day")
  const [mangaMode, setMangaMode] = useState<string>("day_manga")
  const [novelMode, setNovelMode] = useState<string>("day")

  // 高级模式状态
  const [advancedParams, setAdvancedParams] = useState<AdvancedRankingParams>(
    () => getInitialAdvancedParams()
  )
  const [isAdvancedSheetOpen, setIsAdvancedSheetOpen] = useState(false)
  const hasQueriedAdvancedRef = useRef(false)
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(null)
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)

  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    return onSettingsChanged(() => {
      const next = loadSettings()
      setSettings(next)
      if (next.hideNovels) {
        if (kind === "novel") {
          setKind("illustration")
        }
        if (advancedParams.category === "novel") {
          setAdvancedParams((prev) => ({
            ...prev,
            category: "illustration",
            mode: "day",
          }))
        }
      }
    })
  }, [kind, advancedParams.category])

  // 获取当前分类下可用的模式列表（受自定义设置与内容显示设置联动）
  const activeModes =
    kind === "illustration"
      ? settings.customRankingEnabled
        ? getCustomRankingModesForKind("illustration", settings)
        : DEFAULT_ILLUSTRATION_MODES
      : kind === "manga"
        ? settings.customRankingEnabled
          ? getCustomRankingModesForKind("manga", settings)
          : DEFAULT_MANGA_MODES
        : kind === "novel"
          ? settings.customRankingEnabled
            ? getCustomRankingModesForKind("novel", settings)
            : DEFAULT_NOVEL_MODES
          : null

  const selectedMode =
    kind === "illustration"
      ? illustrationMode
      : kind === "manga"
        ? mangaMode
        : kind === "novel"
          ? novelMode
          : null

  // 保证当前选中的模式在当前可用模式列表中有效
  useEffect(() => {
    if (activeModes && activeModes.length > 0 && selectedMode) {
      const exists = activeModes.some((m) => m.value === selectedMode)
      if (!exists) {
        const fallback = activeModes[0].value
        if (kind === "illustration") setIllustrationMode(fallback)
        else if (kind === "manga") setMangaMode(fallback)
        else if (kind === "novel") setNovelMode(fallback)
      }
    }
  }, [activeModes, selectedMode, kind])

  function handleSelectMode(value: string) {
    if (kind === "illustration") setIllustrationMode(value)
    else if (kind === "manga") setMangaMode(value)
    else if (kind === "novel") setNovelMode(value)
  }

  function handleKindChange(nextKind: RankingKind) {
    setKind(nextKind)
    if (nextKind === "advanced" && !hasQueriedAdvancedRef.current) {
      setIsAdvancedSheetOpen(true)
    }
  }

  return (
    <RefreshableScrollView
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      background={ambientBackground}
      sheet={{
        isPresented: isAdvancedSheetOpen,
        onChanged: (presented: boolean) => setIsAdvancedSheetOpen(presented),
        content: (
          <RankingAdvancedSheet
            currentParams={advancedParams}
            settings={settings}
            onApply={(params) => {
              hasQueriedAdvancedRef.current = true
              setAdvancedParams(params)
              setIsAdvancedSheetOpen(false)
            }}
            onCancel={() => setIsAdvancedSheetOpen(false)}
          />
        ),
      }}
      toolbar={rankingToolbar({
        kind,
        hideNovels: settings.hideNovels,
        onKindChange: handleKindChange,
        onOpenAdvancedSheet: () => setIsAdvancedSheetOpen(true),
        onClose: props.onClose,
      })}
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack
        alignment="leading"
        spacing={8}
        frame={{ maxWidth: "infinity" }}
        onAppear={() => {
          if (!activated) setActivated(true)
        }}
      >
        {kind === "advanced" ? (
          <AdvancedRankingBar
            params={advancedParams}
            onPress={() => setIsAdvancedSheetOpen(true)}
          />
        ) : activeModes && activeModes.length > 0 && selectedMode ? (
          <RankingModePicker
            modes={activeModes}
            selected={selectedMode}
            onSelect={handleSelectMode}
          />
        ) : null}

        {/* 右上角菜单切换分类时销毁非激活分类内存；分类内部横向Picker切换时保持已访问模式挂载，0 重载 0 转圈 */}
        {kind === "illustration" ? (
          <IllustRankingSection
            key="ranking-illust"
            selectedMode={illustrationMode}
            label="插画"
            enabled={activated}
            onFirstImageUrlChange={setAmbientImageUrl}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : kind === "manga" ? (
          <IllustRankingSection
            key="ranking-manga"
            selectedMode={mangaMode}
            label="漫画"
            enabled={activated}
            onFirstImageUrlChange={setAmbientImageUrl}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : kind === "novel" ? (
          <NovelRankingSection
            key="ranking-novel"
            selectedMode={novelMode}
            enabled={activated}
            onFirstImageUrlChange={setAmbientImageUrl}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : (
          <AdvancedRankingFeedItem
            key={`ranking-advanced-${advancedParams.category}-${advancedParams.mode}-${advancedParams.date}`}
            params={advancedParams}
            active={true}
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

function AdvancedRankingBar(props: {
  params: AdvancedRankingParams
  onPress: () => void
}) {
  const { params, onPress } = props
  const categoryLabel =
    params.category === "illustration"
      ? "插画"
      : params.category === "manga"
        ? "漫画"
        : "小说"
  const modeTitle = getRankingModeTitle(params.category, params.mode)

  return (
    <Button
      buttonStyle="plain"
      action={onPress}
      padding={{ horizontal: 14, vertical: 4 }}
    >
      <HStack
        alignment="center"
        spacing={8}
        padding={{ horizontal: 12, vertical: 8 }}
        background="#8E8E9318"
        clipShape={{ type: "rect", cornerRadius: 10 }}
        frame={{ maxWidth: "infinity" }}
      >
        <Image
          systemName="calendar"
          foregroundStyle="accentColor"
          font="subheadline"
        />
        <Text font="subheadline" fontWeight="medium" foregroundStyle="label">
          {params.date}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          •
        </Text>
        <Text font="subheadline" foregroundStyle="secondaryLabel">
          {categoryLabel}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          •
        </Text>
        <Text font="subheadline" foregroundStyle="secondaryLabel">
          {modeTitle}
        </Text>
        <Spacer />
        <Image
          systemName="chevron.right"
          font="caption"
          foregroundStyle="tertiaryLabel"
        />
      </HStack>
    </Button>
  )
}

function rankingToolbar(props: {
  kind: RankingKind
  hideNovels: boolean
  onKindChange: (kind: RankingKind) => void
  onOpenAdvancedSheet: () => void
  onClose: () => void
}) {
  const title =
    props.kind === "illustration"
      ? "插画"
      : props.kind === "manga"
        ? "漫画"
        : props.kind === "novel"
          ? "小说"
          : "历史"

  const trailingItems = [
    props.kind === "advanced" ? (
      <Button
        title="高级筛选"
        systemImage="slider.horizontal.3"
        action={props.onOpenAdvancedSheet}
      />
    ) : null,
    <Menu label={<Image systemName="ellipsis.circle" />}>
      <Picker
        title="排行榜类型"
        value={props.kind}
        onChanged={(value: string) => props.onKindChange(value as RankingKind)}
      >
        <Label tag="illustration" title="插画" systemImage="photo" />
        <Label tag="manga" title="漫画" systemImage="photo.on.rectangle" />
        {props.hideNovels ? null : (
          <Label tag="novel" title="小说" systemImage="book" />
        )}
        <Label
          tag="advanced"
          title="历史"
          systemImage="clock.arrow.circlepath"
        />
      </Picker>
    </Menu>,
  ].filter(Boolean)

  return appToolbar(props.onClose, title, trailingItems)
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

function IllustRankingSection(props: {
  selectedMode: string
  label: "插画" | "漫画"
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { selectedMode, label, enabled = true, onFirstImageUrlChange, onRegisterRefresh } = props
  const [visitedModes, setVisitedModes] = useState<string[]>(() => [selectedMode])

  useEffect(() => {
    if (selectedMode) {
      setVisitedModes((prev) =>
        prev.includes(selectedMode) ? prev : [...prev, selectedMode]
      )
    }
  }, [selectedMode])

  return (
    <>
      {visitedModes.map((m) => {
        const isCurrent = selectedMode === m
        return (
          <IllustRankingFeedItem
            key={m}
            mode={m}
            label={label}
            active={isCurrent}
            enabled={enabled && isCurrent}
            onFirstImageUrlChange={onFirstImageUrlChange}
            onRegisterRefresh={onRegisterRefresh}
          />
        )
      })}
    </>
  )
}

function NovelRankingSection(props: {
  selectedMode: string
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { selectedMode, enabled = true, onFirstImageUrlChange, onRegisterRefresh } = props
  const [visitedModes, setVisitedModes] = useState<string[]>(() => [selectedMode])

  useEffect(() => {
    if (selectedMode) {
      setVisitedModes((prev) =>
        prev.includes(selectedMode) ? prev : [...prev, selectedMode]
      )
    }
  }, [selectedMode])

  return (
    <>
      {visitedModes.map((m) => {
        const isCurrent = selectedMode === m
        return (
          <NovelRankingFeedItem
            key={m}
            mode={m}
            active={isCurrent}
            enabled={enabled && isCurrent}
            onFirstImageUrlChange={onFirstImageUrlChange}
            onRegisterRefresh={onRegisterRefresh}
          />
        )
      })}
    </>
  )
}

function IllustRankingFeedItem(props: {
  mode: string
  label: "插画" | "漫画"
  date?: string | null
  active: boolean
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { mode, label, date = null, active, enabled = true, onFirstImageUrlChange, onRegisterRefresh } = props

  const paged = usePagedList<PixivIllustration>({
    first: (token) => ranking(mode, date, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterRankingItems,
    deps: [label, mode, date ?? ""],
    enabled,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const pagedRef = useLatest(paged)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  useEffect(() => {
    if (active && enabled) {
      const first = paged.items[0]
      if (first) {
        onFirstImageUrlChange?.(cardThumbUrlOf(first))
      } else if (!paged.initialLoading && paged.items.length === 0) {
        onFirstImageUrlChange?.(null)
      }
      onRegisterRefresh?.(paged.refresh)
    }
  }, [active, enabled, paged.items[0]?.id, paged.initialLoading, paged.items.length, paged.refresh, onFirstImageUrlChange, onRegisterRefresh])

  if (!active) return null

  return <IllustRankingFeedContent paged={paged} label={label} />
}

function NovelRankingFeedItem(props: {
  mode: string
  date?: string | null
  active: boolean
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { mode, date = null, active, enabled = true, onFirstImageUrlChange, onRegisterRefresh } = props

  const paged = usePagedList<PixivNovel>({
    first: (token) => novelRanking(mode, date, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelRankingItems,
    deps: ["novel", mode, date ?? ""],
    enabled,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const pagedRef = useLatest(paged)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  useEffect(() => {
    if (active && enabled) {
      const first = paged.items[0]
      if (first) {
        onFirstImageUrlChange?.(novelThumbUrlOf(first))
      } else if (!paged.initialLoading && paged.items.length === 0) {
        onFirstImageUrlChange?.(null)
      }
      onRegisterRefresh?.(paged.refresh)
    }
  }, [active, enabled, paged.items[0]?.id, paged.initialLoading, paged.items.length, paged.refresh, onFirstImageUrlChange, onRegisterRefresh])

  if (!active) return null

  return <NovelRankingFeedContent paged={paged} />
}

function AdvancedRankingFeedItem(props: {
  params: AdvancedRankingParams
  active: boolean
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { params, active, enabled = true, onFirstImageUrlChange, onRegisterRefresh } = props
  const isNovel = params.category === "novel"

  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => ranking(params.mode, params.date, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterRankingItems,
    deps: [params.category, params.mode, params.date],
    enabled: enabled && !isNovel,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => novelRanking(params.mode, params.date, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelRankingItems,
    deps: ["novel", params.mode, params.date],
    enabled: enabled && isNovel,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const illustPagedRef = useLatest(illustPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    return onSettingsChanged(() => {
      illustPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
    })
  }, [])

  const activeRefresh = isNovel ? novelPaged.refresh : illustPaged.refresh

  useEffect(() => {
    if (active && enabled) {
      if (isNovel) {
        const first = novelPaged.items[0]
        if (first) {
          onFirstImageUrlChange?.(novelThumbUrlOf(first))
        } else if (!novelPaged.initialLoading && novelPaged.items.length === 0) {
          onFirstImageUrlChange?.(null)
        }
      } else {
        const first = illustPaged.items[0]
        if (first) {
          onFirstImageUrlChange?.(cardThumbUrlOf(first))
        } else if (!illustPaged.initialLoading && illustPaged.items.length === 0) {
          onFirstImageUrlChange?.(null)
        }
      }
      onRegisterRefresh?.(activeRefresh)
    }
  }, [
    active,
    enabled,
    isNovel,
    illustPaged.items[0]?.id,
    illustPaged.initialLoading,
    illustPaged.items.length,
    novelPaged.items[0]?.id,
    novelPaged.initialLoading,
    novelPaged.items.length,
    activeRefresh,
    onFirstImageUrlChange,
    onRegisterRefresh,
  ])

  if (!active) return null

  if (isNovel) {
    return <NovelRankingFeedContent paged={novelPaged} />
  }
  return (
    <IllustRankingFeedContent
      paged={illustPaged}
      label={params.category === "manga" ? "漫画" : "插画"}
    />
  )
}

function NovelRankingFeedContent(props: {
  paged: ReturnType<typeof usePagedList<PixivNovel>>
}) {
  const { paged } = props
  return (
    <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView
          text={
            paged.hasFilteredContent
              ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
              : "暂无小说排行，下拉刷新试试"
          }
          systemImage={paged.hasFilteredContent ? "eye.slash" : "book"}
        />
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

function IllustRankingFeedContent(props: {
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

  const badgeOf = useCallback(
    (_: PixivIllustration, index: number) => {
      if (heroFirst && index === 0) return undefined
      return index < 50 ? <ImageNumberBadge number={index + 1} /> : undefined
    },
    [heroFirst]
  )
  return (
    <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView
          text={
            paged.hasFilteredContent
              ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
              : `暂无${label}排行，下拉刷新试试`
          }
          systemImage={
            paged.hasFilteredContent
              ? "eye.slash"
              : label.includes("漫画")
                ? "photo.on.rectangle"
                : "photo"
          }
        />
      ) : (
        <IllustFlowFeed
          items={paged.items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
          cornerBadgeOf={badgeOf}
          enableHeroFirst={heroFirst}
        />
      )}
    </VStack>
  )
}

function filterRankingItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterNovelRankingItems(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) => isNovelContentVisible(item, settings))
}
