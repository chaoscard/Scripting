import {
  Button,
  Device,
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
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"

import { useIsCurrentTab } from "./routeNavigation"
import { triggerHaptic } from "../utils/haptics"
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
import { DockSegmentedBar, useRegisterBottomAccessory } from "./bottomAccessory"
import { useLatest, usePagedList, currentBatchSize } from "./hooks"
import { useExperimentalAmbientPalette } from "./ambient"
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
  formatDateToPixivDate,
  getInitialAdvancedParams,
  getYesterdayTimestamp,
  RankingAdvancedSheet,
  type AdvancedRankingParams,
} from "./rankingAdvancedSheet"

type RankingKind = "illustration" | "manga" | "novel" | "advanced"

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
  const [illustrationMode, setIllustrationMode] = useState<string>(() => {
    const initialSettings = loadSettings()
    const modes = getCustomRankingModesForKind("illustration", initialSettings)
    return modes[0]?.value ?? "day"
  })
  const [mangaMode, setMangaMode] = useState<string>(() => {
    const initialSettings = loadSettings()
    const modes = getCustomRankingModesForKind("manga", initialSettings)
    return modes[0]?.value ?? "day_manga"
  })
  const [novelMode, setNovelMode] = useState<string>(() => {
    const initialSettings = loadSettings()
    const modes = getCustomRankingModesForKind("novel", initialSettings)
    return modes[0]?.value ?? "day"
  })

  // 高级模式状态
  const [advancedParams, setAdvancedParams] = useState<AdvancedRankingParams>(
    () => getInitialAdvancedParams()
  )
  const [isAdvancedSheetOpen, setIsAdvancedSheetOpen] = useState(false)
  const hasQueriedAdvancedRef = useRef(false)
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(null)
  const isTabActive = useIsCurrentTab("ranking")
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl, isTabActive)

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

  // 获取当前分类下可用的模式列表（受自定义设置、设备类型与内容显示设置联动）
  const activeModes =
    kind === "illustration" || kind === "manga" || kind === "novel"
      ? getCustomRankingModesForKind(kind, settings)
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

  const isAppleMusic = settings.pageLayout === "appleMusic"

  const rankingItems = useMemo(() => {
    if (!activeModes) return []
    return activeModes.map((m) => ({ tag: m.value, label: m.title }))
  }, [activeModes])

  const advancedCategoryLabel =
    advancedParams.category === "illustration"
      ? "插画"
      : advancedParams.category === "manga"
        ? "漫画"
        : "小说"
  const advancedModeTitle = getRankingModeTitle(
    advancedParams.category,
    advancedParams.mode
  )

  const rawDate = (advancedParams.date || "").replace(/-/g, "")
  const compactDate =
    rawDate.length === 8 ? rawDate.slice(2) : rawDate.replace(/^20/, "")
  const compactHistoryTitle = `${compactDate}${advancedCategoryLabel}${advancedModeTitle}`

  const historyRankingAccessory = useMemo(() => {
    if (kind !== "advanced") return null
    return (
      <HStack
        alignment="center"
        frame={{ maxWidth: "infinity" }}
        padding={{ horizontal: 8 }}
      >
        <Button
          buttonStyle="plain"
          frame={{ maxWidth: "infinity" }}
          action={() => {
            try {
              triggerHaptic("selection")
            } catch {}
            setIsAdvancedSheetOpen(true)
          }}
        >
          <HStack
            alignment="center"
            frame={{ maxWidth: "infinity" }}
            padding={{ vertical: 6 }}
            spacing={4}
          >
            <Image
              systemName="calendar"
              font={13}
              foregroundStyle="#3172EB"
            />
            <Text
              font="subheadline"
              fontWeight="bold"
              foregroundStyle="#3172EB"
              lineLimit={1}
              fixedSize={{ horizontal: true, vertical: false }}
            >
              {compactHistoryTitle}
            </Text>
          </HStack>
        </Button>
        <Button
          buttonStyle="plain"
          action={() => {
            try {
              triggerHaptic("selection")
            } catch {}
            setKind("illustration")
          }}
        >
          <HStack
            alignment="center"
            padding={{ vertical: 6, horizontal: 8 }}
            spacing={4}
          >
            <Image
              systemName="arrow.uturn.backward"
              font={13}
              foregroundStyle="#3172EB"
            />
            <Text
              font="subheadline"
              fontWeight="bold"
              foregroundStyle="#3172EB"
              lineLimit={1}
              fixedSize={{ horizontal: true, vertical: false }}
            >
              返回
            </Text>
          </HStack>
        </Button>
      </HStack>
    )
  }, [kind, compactHistoryTitle])

  useRegisterBottomAccessory(
    "ranking",
    kind === "advanced"
      ? historyRankingAccessory
      : rankingItems.length <= 1 || !selectedMode
        ? null
        : (
          <DockSegmentedBar
            items={rankingItems}
            value={selectedMode}
            onChanged={handleSelectMode}
          />
        ),
    isAppleMusic
  )

  return (
    <ZStack
      navigationBarTitleDisplayMode="inline"
      toolbarBackground="clear"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      navigationDestination={destinationElement}
      background={ambientBackground}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
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
        selectedMode:
          kind === "illustration"
            ? illustrationMode
            : kind === "manga"
              ? mangaMode
              : kind === "novel"
                ? novelMode
                : advancedParams.mode,
        activeModes: activeModes ?? [],
        hideNovels: settings.hideNovels,
        isAppleMusic,
        onKindChange: handleKindChange,
        onModeChange: handleSelectMode,
        onOpenAdvancedSheet: () => setIsAdvancedSheetOpen(true),
        onClose: props.onClose,
      })}
      onAppear={() => {
        if (!activated) setActivated(true)
      }}
    >
      {/* 1. 插画排行榜（大分类切换即刻卸载，内部多榜单模式独立保活） */}
      {kind === "illustration" && (
        <IllustRankingSection
          selectedMode={illustrationMode}
          label="插画"
          enabled={activated}
          onFirstImageUrlChange={setAmbientImageUrl}
        />
      )}

      {/* 2. 漫画排行榜（大分类切换即刻卸载，内部多榜单模式独立保活） */}
      {kind === "manga" && (
        <IllustRankingSection
          selectedMode={mangaMode}
          label="漫画"
          enabled={activated}
          onFirstImageUrlChange={setAmbientImageUrl}
        />
      )}

      {/* 3. 小说排行榜（大分类切换即刻卸载，内部多榜单模式独立保活） */}
      {kind === "novel" && (
        <NovelRankingSection
          selectedMode={novelMode}
          enabled={activated}
          onFirstImageUrlChange={setAmbientImageUrl}
        />
      )}

      {/* 4. 自定义历史榜单（切换即刻卸载） */}
      {kind === "advanced" && (
        <RefreshableScrollView refreshable={() => refreshHandlerRef.current()}>
          <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
            <AdvancedRankingBar
              params={advancedParams}
              onPress={() => setIsAdvancedSheetOpen(true)}
              onBack={() => setKind("illustration")}
            />
            <AdvancedRankingFeedItem
              params={advancedParams}
              active={true}
              enabled={activated}
              onFirstImageUrlChange={setAmbientImageUrl}
              onRegisterRefresh={(fn) => {
                refreshHandlerRef.current = fn
              }}
              onBackToDefault={() => setKind("illustration")}
            />
          </VStack>
        </RefreshableScrollView>
      )}
    </ZStack>
  )
}

function AdvancedRankingBar(props: {
  params: AdvancedRankingParams
  onPress: () => void
  onBack: () => void
}) {
  const { params, onPress, onBack } = props
  const categoryLabel =
    params.category === "illustration"
      ? "插画"
      : params.category === "manga"
        ? "漫画"
        : "小说"
  const modeTitle = getRankingModeTitle(params.category, params.mode)

  return (
    <HStack
      alignment="center"
      spacing={8}
      padding={{ horizontal: 14, vertical: 4 }}
    >
      <Button
        buttonStyle="plain"
        action={onPress}
      >
        <HStack
          alignment="center"
          spacing={6}
          padding={{ horizontal: 12, vertical: 8 }}
          background="#8E8E9318"
          clipShape={{ type: "rect", cornerRadius: 10 }}
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
          <Image
            systemName="chevron.right"
            font="caption"
            foregroundStyle="tertiaryLabel"
          />
        </HStack>
      </Button>
      <Spacer />
      <Button
        buttonStyle="plain"
        action={onBack}
      >
        <HStack alignment="center" spacing={4}>
          <Image
            systemName="arrow.uturn.backward"
            font="caption"
            foregroundStyle="#007AFF"
          />
          <Text font="subheadline" foregroundStyle="#007AFF">
            返回
          </Text>
        </HStack>
      </Button>
    </HStack>
  )
}

function rankingToolbar(props: {
  kind: RankingKind
  selectedMode: string
  activeModes: ReadonlyArray<{ value: string; title: string }>
  hideNovels: boolean
  isAppleMusic?: boolean
  onKindChange: (kind: RankingKind) => void
  onModeChange: (mode: string) => void
  onOpenAdvancedSheet: () => void
  onClose: () => void
}) {
  const isiPad = Device.isiPad
  const isClassic = !props.isAppleMusic
  const baseTitle =
    props.kind === "illustration"
      ? "插画"
      : props.kind === "manga"
        ? "漫画"
        : props.kind === "novel"
          ? "小说"
          : "历史"

  const currentModeObj = props.activeModes.find((m) => m.value === props.selectedMode)
  const modeTitle = currentModeObj?.title ?? ""

  const fullTitle =
    props.kind === "advanced" || !modeTitle
      ? baseTitle
      : `${baseTitle} · ${modeTitle}`

  const titleNode = (
    <Text font={isiPad ? "headline" : "title2"} fontWeight="bold">
      {isClassic ? fullTitle : baseTitle}
    </Text>
  )

  const trailingMenuLabel = isiPad ? (
    <HStack alignment="center" spacing={4}>
      <Text font="subheadline" fontWeight="semibold">
        {props.isAppleMusic || props.kind === "advanced" || !modeTitle
          ? baseTitle
          : `${baseTitle} · ${modeTitle}`}
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

  const trailingItems = [
    props.kind === "advanced" ? (
      <Button
        title="高级筛选"
        systemImage="slider.horizontal.3"
        action={props.onOpenAdvancedSheet}
      />
    ) : null,
    <Menu label={trailingMenuLabel}>
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
      {isClassic && props.kind !== "advanced" && props.activeModes.length > 0 && (
        <Picker
          title="榜单周期"
          value={props.selectedMode}
          onChanged={(value: string) => props.onModeChange(value)}
        >
          {props.activeModes.map((m) => (
            <Label
              key={m.value}
              tag={m.value}
              title={m.title}
              systemImage="chart.bar"
            />
          ))}
        </Picker>
      )}
    </Menu>,
  ].filter(Boolean)

  return appToolbar(props.onClose, titleNode, trailingItems)
}

function IllustRankingSection(props: {
  selectedMode: string
  label: "插画" | "漫画"
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const {
    selectedMode,
    label,
    enabled = true,
    onFirstImageUrlChange,
  } = props
  const [visitedModes, setVisitedModes] = useState<string[]>(() => [selectedMode])

  useEffect(() => {
    if (selectedMode) {
      setVisitedModes((prev) =>
        prev.includes(selectedMode) ? prev : [...prev, selectedMode]
      )
    }
  }, [selectedMode])

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {visitedModes.map((m) => {
        const isCurrent = selectedMode === m
        return (
          <VStack
            key={m}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            opacity={isCurrent ? 1 : 0}
            zIndex={isCurrent ? 1 : 0}
            allowsHitTesting={isCurrent}
          >
            <IllustRankingFeedItem
              mode={m}
              label={label}
              active={isCurrent}
              enabled={enabled}
              onFirstImageUrlChange={onFirstImageUrlChange}
            />
          </VStack>
        )
      })}
    </ZStack>
  )
}

function NovelRankingSection(props: {
  selectedMode: string
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const {
    selectedMode,
    enabled = true,
    onFirstImageUrlChange,
  } = props
  const [visitedModes, setVisitedModes] = useState<string[]>(() => [selectedMode])

  useEffect(() => {
    if (selectedMode) {
      setVisitedModes((prev) =>
        prev.includes(selectedMode) ? prev : [...prev, selectedMode]
      )
    }
  }, [selectedMode])

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {visitedModes.map((m) => {
        const isCurrent = selectedMode === m
        return (
          <VStack
            key={m}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            opacity={isCurrent ? 1 : 0}
            zIndex={isCurrent ? 1 : 0}
            allowsHitTesting={isCurrent}
          >
            <NovelRankingFeedItem
              mode={m}
              active={isCurrent}
              enabled={enabled}
              onFirstImageUrlChange={onFirstImageUrlChange}
            />
          </VStack>
        )
      })}
    </ZStack>
  )
}

function IllustRankingFeedItem(props: {
  mode: string
  label: "插画" | "漫画"
  date?: string | null
  active: boolean
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const {
    mode,
    label,
    date = null,
    active,
    enabled = true,
    onFirstImageUrlChange,
  } = props

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
    }
  }, [active, enabled, paged.items[0]?.id, paged.initialLoading, paged.items.length, onFirstImageUrlChange])

  return (
    <RefreshableScrollView refreshable={paged.refresh}>
      <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
        <IllustRankingFeedContent paged={paged} label={label} />
      </VStack>
    </RefreshableScrollView>
  )
}

function NovelRankingFeedItem(props: {
  mode: string
  date?: string | null
  active: boolean
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const {
    mode,
    date = null,
    active,
    enabled = true,
    onFirstImageUrlChange,
  } = props

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
    }
  }, [active, enabled, paged.items[0]?.id, paged.initialLoading, paged.items.length, onFirstImageUrlChange])

  return (
    <RefreshableScrollView refreshable={paged.refresh}>
      <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
        <NovelRankingFeedContent paged={paged} />
      </VStack>
    </RefreshableScrollView>
  )
}

function AdvancedRankingFeedItem(props: {
  params: AdvancedRankingParams
  active: boolean
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
  onBackToDefault?: () => void
}) {
  const {
    params,
    active,
    enabled = true,
    onFirstImageUrlChange,
    onRegisterRefresh,
    onBackToDefault,
  } = props
  const isNovel = params.category === "novel"
  const label =
    params.category === "manga" ? "漫画" : isNovel ? "小说" : "插画"

  const isYesterday =
    params.date === formatDateToPixivDate(getYesterdayTimestamp())
  const isBefore11AM = new Date().getHours() < 11

  const emptyText =
    isYesterday && isBefore11AM
      ? `昨日${label}排行通常于上午 11:00 后更新，请稍后再试`
      : `未查询到该日期的${label}排行，可能官方尚未发布或该榜单设立于较晚时间`
  const emptySystemImage =
    isYesterday && isBefore11AM
      ? "clock.badge.exclamationmark"
      : "clock.badge.questionmark"

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
    return (
      <NovelRankingFeedContent
        paged={novelPaged}
        emptyText={emptyText}
        emptySystemImage={emptySystemImage}
        onBackToDefault={onBackToDefault}
      />
    )
  }
  return (
    <IllustRankingFeedContent
      paged={illustPaged}
      label={label}
      emptyText={emptyText}
      emptySystemImage={emptySystemImage}
      onBackToDefault={onBackToDefault}
    />
  )
}

function NovelRankingFeedContent(props: {
  paged: ReturnType<typeof usePagedList<PixivNovel>>
  emptyText?: string
  emptySystemImage?: string
  onBackToDefault?: () => void
}) {
  const { paged, emptyText, emptySystemImage, onBackToDefault } = props
  return (
    <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        onBackToDefault ? (
          <ZStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            padding={40}
          >
            <VStack alignment="center" spacing={14}>
              <Image
                systemName="wifi.exclamationmark"
                font="largeTitle"
                foregroundStyle="secondaryLabel"
              />
              <Text
                font="subheadline"
                foregroundStyle="secondaryLabel"
                multilineTextAlignment="center"
              >
                {paged.error}
              </Text>
              <HStack alignment="center" spacing={12}>
                <Button
                  buttonStyle="bordered"
                  title="重试"
                  action={paged.refresh}
                />
                <Button
                  buttonStyle="bordered"
                  action={() => {
                    try {
                      triggerHaptic("light")
                    } catch {}
                    onBackToDefault()
                  }}
                >
                  <HStack alignment="center" spacing={4}>
                    <Image
                      systemName="arrow.uturn.backward"
                      font="subheadline"
                    />
                    <Text font="subheadline">返回</Text>
                  </HStack>
                </Button>
              </HStack>
            </VStack>
          </ZStack>
        ) : (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        )
      ) : paged.items.length === 0 ? (
        onBackToDefault ? (
          <ZStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            padding={40}
          >
            <VStack alignment="center" spacing={14}>
              <Image
                systemName={
                  paged.hasFilteredContent
                    ? "eye.slash"
                    : emptySystemImage ?? "clock.badge.questionmark"
                }
                font="largeTitle"
                foregroundStyle="secondaryLabel"
              />
              <Text
                font="subheadline"
                foregroundStyle="secondaryLabel"
                multilineTextAlignment="center"
              >
                {paged.hasFilteredContent
                  ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
                  : emptyText ??
                    "未查询到该日期的小说排行，可能官方尚未发布或该榜单设立于较晚时间"}
              </Text>
              <Button
                buttonStyle="bordered"
                action={() => {
                  try {
                    triggerHaptic("light")
                  } catch {}
                  onBackToDefault()
                }}
              >
                <HStack alignment="center" spacing={4}>
                  <Image
                    systemName="arrow.uturn.backward"
                    font="subheadline"
                  />
                  <Text font="subheadline">返回</Text>
                </HStack>
              </Button>
            </VStack>
          </ZStack>
        ) : (
          <EmptyView
            text={
              paged.hasFilteredContent
                ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
                : "暂无小说排行，下拉刷新试试"
            }
            systemImage={paged.hasFilteredContent ? "eye.slash" : "book"}
          />
        )
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
  emptyText?: string
  emptySystemImage?: string
  onBackToDefault?: () => void
}) {
  const { paged, label, emptyText, emptySystemImage, onBackToDefault } = props
  const [heroFirst, setHeroFirst] = useState(() => loadSettings().heroFirstFeedCard)

  useEffect(() => {
    return onSettingsChanged(() => {
      setHeroFirst(loadSettings().heroFirstFeedCard)
    })
  }, [])

  const badgeOf = useCallback(
    (_: PixivIllustration, index: number) => {
      if (!Device.isiPad && heroFirst && index === 0) return undefined
      return index < 50 ? <ImageNumberBadge number={index + 1} /> : undefined
    },
    [heroFirst]
  )
  return (
    <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        onBackToDefault ? (
          <ZStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            padding={40}
          >
            <VStack alignment="center" spacing={14}>
              <Image
                systemName="wifi.exclamationmark"
                font="largeTitle"
                foregroundStyle="secondaryLabel"
              />
              <Text
                font="subheadline"
                foregroundStyle="secondaryLabel"
                multilineTextAlignment="center"
              >
                {paged.error}
              </Text>
              <HStack alignment="center" spacing={12}>
                <Button
                  buttonStyle="bordered"
                  title="重试"
                  action={paged.refresh}
                />
                <Button
                  buttonStyle="bordered"
                  action={() => {
                    try {
                      triggerHaptic("light")
                    } catch {}
                    onBackToDefault()
                  }}
                >
                  <HStack alignment="center" spacing={4}>
                    <Image
                      systemName="arrow.uturn.backward"
                      font="subheadline"
                    />
                    <Text font="subheadline">返回</Text>
                  </HStack>
                </Button>
              </HStack>
            </VStack>
          </ZStack>
        ) : (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        )
      ) : paged.items.length === 0 ? (
        onBackToDefault ? (
          <ZStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            padding={40}
          >
            <VStack alignment="center" spacing={14}>
              <Image
                systemName={
                  paged.hasFilteredContent
                    ? "eye.slash"
                    : emptySystemImage ?? "clock.badge.questionmark"
                }
                font="largeTitle"
                foregroundStyle="secondaryLabel"
              />
              <Text
                font="subheadline"
                foregroundStyle="secondaryLabel"
                multilineTextAlignment="center"
              >
                {paged.hasFilteredContent
                  ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                  : emptyText ??
                    `未查询到该日期的${label}排行，可能官方尚未发布或该榜单设立于较晚时间`}
              </Text>
              <Button
                buttonStyle="bordered"
                action={() => {
                  try {
                    triggerHaptic("light")
                  } catch {}
                  onBackToDefault()
                }}
              >
                <HStack alignment="center" spacing={4}>
                  <Image
                    systemName="arrow.uturn.backward"
                    font="subheadline"
                  />
                  <Text font="subheadline">返回</Text>
                </HStack>
              </Button>
            </VStack>
          </ZStack>
        ) : (
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
        )
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
