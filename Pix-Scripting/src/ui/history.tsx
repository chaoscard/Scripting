import {
  Button,
  Color,
  Device,
  Divider,
  Group,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  ScrollView,
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
import { searchAutocomplete } from "../api/pixiv"
import { session } from "../api/session"
import type { PixivAutocompleteTag } from "../types"
import { appGlass } from "./components/glass"
import {
  PAGE_TOOLBAR_BACKGROUND,
  PAGE_TOOLBAR_BACKGROUND_VISIBILITY,
} from "./components/pageChrome"
import {
  EmptyView,
  FilteredContentNotice,
  formatDate,
  IllustFlowFeed,
  LoadMoreTrigger,
  NovelCard,
  RefreshableScrollView,
} from "./components"
import { DockSegmentedBar, useRegisterBottomAccessory } from "./bottomAccessory"
import {
  checkAndConsumeViewingHistoryDetail,
  checkAndResetHistoryDirty,
  clearHistoryKind,
  getHistory,
  markHistoryRevisitDirty,
  onHistoryChanged,
  onHistoryEntryRecorded,
  refreshHistoryFromCloud,
  removeHistoryEntry,
  type HistoryContentKind,
  type HistoryEntry,
} from "../store/history"
import {
  loadSettings,
  onSettingsChanged,
  updateSettings,
} from "../store/settings"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import { cacheIllust } from "../store/illustCache"
import { cacheNovel } from "../store/novelCache"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import { currentBatchSize, useLatest, usePagedList, useLayoutMetrics, IPAD_WIDE_MIN_WIDTH } from "./Hooks"
import { useExperimentalAmbientPalette, getLastActiveAmbientImageUrl, recordActiveAmbientImageUrl } from "./ambient"
import { useDualRoute } from "./DualRouteContext"
import { getActiveTabKind, onActiveTabChanged, requestPixivRoute, useIsCurrentTab, type PixivTabKind } from "../store/routeNavigation"
import { HistoryAnalyticsView } from "./HistoryAnalytics"
import type { PixivIllustration, PixivNovel } from "../types"

export type HistoryKind = HistoryContentKind

declare const Dialog: any
import { triggerHaptic } from "../platform/haptics"

export interface HistoryIllustItem extends PixivIllustration {
  viewedAt: number
}

export interface HistoryNovelItem extends PixivNovel {
  viewedAt: number
}

function parseHistoryQuery(query: string): ReadonlyArray<string> {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export function matchesHistoryQuery(item: HistoryIllustItem | HistoryNovelItem, query: string): boolean {
  return matchesHistoryWords(item, parseHistoryQuery(query))
}

function matchesHistoryWords(item: HistoryIllustItem | HistoryNovelItem, words: ReadonlyArray<string>): boolean {
  return words.every((word) => {
    // 1. 作品 ID
    if (String(item.id).includes(word)) return true

    // 2. 作品标题
    if (item.title && item.title.toLowerCase().includes(word)) return true

    // 3. 作者昵称与 UID
    if (item.user) {
      if (item.user.name && item.user.name.toLowerCase().includes(word)) return true
      if (String(item.user.id).includes(word)) return true
    }

    // 4. 所属系列名称与 ID
    if (item.series) {
      if (item.series.title && item.series.title.toLowerCase().includes(word)) return true
      if (String(item.series.id).includes(word)) return true
    }

    // 5. 标签原文与官方翻译名
    if (item.tags && item.tags.length > 0) {
      for (const tag of item.tags) {
        if (tag.name && tag.name.toLowerCase().includes(word)) return true
        if (tag.translated_name && tag.translated_name.toLowerCase().includes(word)) return true
      }
    }

    return false
  })
}

export function loadHistoryIllusts(kind: "illustration" | "manga"): HistoryIllustItem[] {
  return getHistory(kind)
    .filter((entry): entry is Extract<HistoryEntry, { kind: "illust" }> => entry.kind === "illust")
    .map((entry) => {
      return {
        ...entry.illustration,
        viewedAt: entry.viewedAt,
      }
    })
}

export function loadHistoryNovels(): HistoryNovelItem[] {
  return getHistory("novel")
    .filter((entry): entry is Extract<HistoryEntry, { kind: "novel" }> => entry.kind === "novel")
    .map((entry) => {
      return {
        ...entry.novel,
        viewedAt: entry.viewedAt,
      }
    })
}

// 每个保活流只保留一份展开快照；变更事件仅失效，不驱动列表刷新/重排。
// 回看、收藏、删除、云端 replace 与账号 clear 都会 emitChanged；再校验原始数组引用，
// 覆盖冷读/重载。不能使用当前恒为 1 的 getHistoryVersion 充当 revision。
function useHistorySearchItems<T>(kind: HistoryKind, loader: () => T[]): () => T[] {
  const loaderRef = useLatest(loader)
  const snapshotRef = useRef<{ entries: HistoryEntry[]; items: T[] } | null>(null)
  useEffect(() => onHistoryChanged(() => {
    snapshotRef.current = null
  }), [])
  return useCallback(() => {
    const entries = getHistory(kind)
    const snapshot = snapshotRef.current
    if (snapshot?.entries === entries) return snapshot.items
    const items = loaderRef.current()
    snapshotRef.current = { entries, items }
    return items
  }, [kind])
}

export function filterHistoryIllusts(items: HistoryIllustItem[]): HistoryIllustItem[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isIllustContentVisible(item, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
    })
  )
}

export function filterHistoryNovels(items: HistoryNovelItem[]): HistoryNovelItem[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isNovelContentVisible(item, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
    })
  )
}

export function HistoryView() {
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [kind, setKind] = useState<HistoryKind>("illustration")
  const [searchQuery, setSearchQuery] = useState("")
  const searchWords = useMemo(() => parseHistoryQuery(searchQuery), [searchQuery])
  const [tagSuggestions, setTagSuggestions] = useState<PixivAutocompleteTag[]>([])
  const [tagSuggestionsLoading, setTagSuggestionsLoading] = useState(false)
  const tagSeqRef = useRef(0)
  const debounceTimerRef = useRef<any>(null)

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  const handleSearchQueryChanged = (val: string) => {
    setSearchQuery(val)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    const trimmed = val.trim()
    if (!trimmed) {
      tagSeqRef.current++
      setTagSuggestions([])
      setTagSuggestionsLoading(false)
      return
    }

    const seq = ++tagSeqRef.current
    debounceTimerRef.current = setTimeout(() => {
      setTagSuggestionsLoading(true)
      session
        .call((authToken) => searchAutocomplete(trimmed, authToken))
        .then((tags) => {
          if (seq === tagSeqRef.current) {
            setTagSuggestions(tags)
            setTagSuggestionsLoading(false)
          }
        })
        .catch(() => {
          if (seq === tagSeqRef.current) {
            setTagSuggestions([])
            setTagSuggestionsLoading(false)
          }
        })
    }, 300)
  }

  const handleApplySuggestion = (tag: string) => {
    try {
      triggerHaptic("selection")
    } catch {}
    setSearchQuery(tag)
    setTagSuggestions([])
    setTagSuggestionsLoading(false)
  }
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"
  const [visitedKinds, setVisitedKinds] = useState<Set<HistoryKind>>(() => new Set([kind]))

  useEffect(() => {
    setVisitedKinds((prev) => {
      if (prev.has(kind)) return prev
      const next = new Set(prev)
      next.add(kind)
      return next
    })
  }, [kind])
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(
    () => getLastActiveAmbientImageUrl()
  )
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)

  useEffect(() => {
    if (ambientImageUrl) {
      recordActiveAmbientImageUrl(ambientImageUrl)
    }
  }, [ambientImageUrl])
  const refreshHandlersRef = useRef<Map<HistoryKind, () => Promise<void>>>(new Map())
  const [isAnalyticsPresented, setIsAnalyticsPresented] = useState(false)
  const isSelectingFromAnalyticsRef = useRef(false)
  const { isSplitViewActive, openDetailRoute } = useDualRoute()
  const layoutMetrics = useLayoutMetrics()
  const isFullScreenPad =
    Device.isiPad &&
    !isSplitViewActive &&
    layoutMetrics.width >= IPAD_WIDE_MIN_WIDTH
  const [showNoticeAlert, setShowNoticeAlert] = useState(false)
  const hasCheckedNoticeRef = useRef(false)

  useEffect(() => {
    if (!hasCheckedNoticeRef.current) {
      hasCheckedNoticeRef.current = true
      const settings = loadSettings()
      if (!settings.dismissHistoryNotice) {
        setShowNoticeAlert(true)
      }
    }
  }, [])

  const refreshAllFeeds = useCallback(async () => {
    const activeHandler = refreshHandlersRef.current.get(kind)
    if (activeHandler) {
      await activeHandler()
    }
    for (const [k, handler] of refreshHandlersRef.current.entries()) {
      if (k !== kind) {
        void handler()
      }
    }
  }, [kind])

  const initialTab = useRef(getActiveTabKind()).current
  const isTabActive = useIsCurrentTab(initialTab)
  const tabRef = useRef(initialTab)

  useEffect(() => {
    return () => {
      checkAndConsumeViewingHistoryDetail()
    }
  }, [])

  // 切换 Tab 离开历史页后切回时：若曾有静默回看标脏，执行全量重排刷新
  useEffect(() => {
    return onActiveTabChanged((nextTab: PixivTabKind) => {
      if (nextTab !== tabRef.current) {
        // 切换到其他 Tab 离开历史页：重置搜索关键词与建议
        setSearchQuery("")
        setTagSuggestions([])
        setTagSuggestionsLoading(false)
      } else {
        // 切回历史页所属 Tab：若曾有静默回看标脏，执行全量重排刷新
        if (checkAndResetHistoryDirty()) {
          void refreshAllFeeds()
        }
      }
    })
  }, [refreshAllFeeds])

  const handleOpenAnalytics = useCallback(() => {
    triggerHaptic("selection")
    if (isSplitViewActive) {
      openDetailRoute(`historyAnalytics:${kind}`)
    } else {
      setIsAnalyticsPresented(true)
    }
  }, [isSplitViewActive, openDetailRoute, kind])

  useEffect(() => {
    return onSettingsChanged(() => {
      const next = loadSettings()
      setHideNovels(next.hideNovels)
      setPageLayout(next.pageLayout)
      if (next.hideNovels && kind === "novel") {
        setKind("illustration")
      }
    })
  }, [kind])

  const historyItems = useMemo<Array<{ tag: HistoryKind; label: string }>>(() => {
    const items: Array<{ tag: HistoryKind; label: string }> = [
      { tag: "illustration", label: "插画" },
      { tag: "manga", label: "漫画" },
    ]
    if (!hideNovels) {
      items.push({ tag: "novel", label: "小说" })
    }
    return items
  }, [hideNovels])

  const historyBottomAccessory = useMemo(() => historyItems.length <= 1 ? null : (
    <DockSegmentedBar
      items={historyItems}
      value={kind}
      onChanged={setKind}
    />
  ), [historyItems, kind])
  useRegisterBottomAccessory("history", historyBottomAccessory, isAppleMusic)

  function clearCurrentKind() {
    clearHistoryKind(kind)
    void refreshAllFeeds()
  }

  return (
    <ZStack
      navigationBarTitleDisplayMode="inline"
      toolbarBackground={PAGE_TOOLBAR_BACKGROUND}
      toolbarBackgroundVisibility={PAGE_TOOLBAR_BACKGROUND_VISIBILITY}
      background={ambientBackground}
      alert={{
        title: "浏览记录说明",
        message: (
          <Text>
            轻轻下拉可以展开搜索框，快速检索作品、作者或标签；点击右上角图表标志可以查看「我的足迹」统计分析看板。
          </Text>
        ),
        isPresented: showNoticeAlert,
        onChanged: (val: boolean) => setShowNoticeAlert(val),
        actions: (
          <Group>
            <Button
              title="永久关闭"
              action={() => {
                updateSettings({ dismissHistoryNotice: true })
                setShowNoticeAlert(false)
              }}
            />
            <Button
              title="本次关闭"
              action={() => {
                setShowNoticeAlert(false)
              }}
            />
          </Group>
        ),
      }}
      onAppear={() => {
        if (isSelectingFromAnalyticsRef.current) {
          isSelectingFromAnalyticsRef.current = false
          return
        }
        const fromDetail = checkAndConsumeViewingHistoryDetail()
        if (fromDetail) {
          // 从二级详情页返回历史列表：拦截全量刷新，保持老作品原位不动，新推荐置顶
          return
        }
        // 从上一级页面进入 / 退出历史页后重新进入：清空搜索关键词与建议，恢复全量历史展示
        setSearchQuery("")
        setTagSuggestions([])
        setTagSuggestionsLoading(false)
        // 检测是否有标脏，有则全量重排刷新
        if (checkAndResetHistoryDirty()) {
          void refreshAllFeeds()
        }
      }}
      sheet={{
        isPresented: isAnalyticsPresented,
        onChanged: (val: boolean) => setIsAnalyticsPresented(val),
        content: (
          <HistoryAnalyticsView
            key={`history-analytics-${kind}`}
            initialScope={kind}
            onDismiss={() => setIsAnalyticsPresented(false)}
            onSelectTag={(tag) => {
              isSelectingFromAnalyticsRef.current = true
              setIsAnalyticsPresented(false)
              setSearchQuery(tag)
            }}
            onSelectCreator={(_cId, cName) => {
              isSelectingFromAnalyticsRef.current = true
              setIsAnalyticsPresented(false)
              setSearchQuery(cName)
            }}
            onOpenUserDetail={(userId) => {
              setIsAnalyticsPresented(false)
              setTimeout(() => {
                requestPixivRoute(`user:${userId}`)
              }, 260)
            }}
          />
        ),
      }}
      toolbar={historyToolbar({
        kind,
        hideNovels,
        isAppleMusic,
        isSplitViewActive,
        isFullScreenPad,
        onKindChange: setKind,
        onClear: clearCurrentKind,
        onOpenAnalytics: handleOpenAnalytics,
      })}
      searchable={{
        value: searchQuery,
        onChanged: handleSearchQueryChanged,
        placement: "navigationBarDrawer",
        prompt: "搜索作者、标题和标签",
      }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      {/* 搜索联想建议卡片：带毛玻璃背景、放大镜与官方翻译，点击快速将搜索词填入并过滤本地历史（自然完整展开） */}
      {tagSuggestions.length > 0 ? (
        <ScrollView
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={{ horizontal: 8, top: 1, bottom: 4 }}
          zIndex={10}
        >
          <VStack
            spacing={0}
            glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}
            clipShape={{ type: "rect", cornerRadius: 14 }}
            shadow={{ color: "#00000028", radius: 10, y: 3 }}
            frame={{ maxWidth: "infinity" }}
          >
            {tagSuggestions.map((item, index) => (
              <VStack key={`${item.name}-${index}`} spacing={0} frame={{ maxWidth: "infinity" }}>
                {index > 0 ? <Divider /> : null}
                <Button
                  buttonStyle="plain"
                  action={() => handleApplySuggestion(item.name)}
                  contentShape="rect"
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  <HStack
                    alignment="center"
                    spacing={10}
                    padding={{ horizontal: 14, vertical: 10 }}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                    contentShape="rect"
                  >
                    <Image
                      systemName="magnifyingglass"
                      font="subheadline"
                      foregroundStyle="secondaryLabel"
                    />
                    <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <Text font="body" foregroundStyle="label" lineLimit={1}>
                        {item.name}
                      </Text>
                      {item.translated_name ? (
                        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                          {item.translated_name}
                        </Text>
                      ) : null}
                    </VStack>
                    <Spacer />
                    <Image
                      systemName="arrow.up.left"
                      font="caption"
                      foregroundStyle="tertiaryLabel"
                    />
                  </HStack>
                </Button>
              </VStack>
            ))}
          </VStack>
        </ScrollView>
      ) : null}
      {/* 1. 插画历史保活容器 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        opacity={kind === "illustration" ? 1 : 0}
        zIndex={kind === "illustration" ? 1 : 0}
        allowsHitTesting={kind === "illustration"}
      >
        <RefreshableScrollView refreshable={() => refreshAllFeeds()}>
          <VStack alignment="leading" spacing={8} padding={{ top: 1 }} frame={{ minHeight: 500, maxWidth: "infinity" }}>
            <HistoryFeed
              kind="illustration"
              enabled={isTabActive && kind === "illustration"}
              searchWords={searchWords}
              searchQuery={searchQuery}
              onFirstImageUrlChange={(url) => {
                if (kind === "illustration") setAmbientImageUrl(url)
              }}
              onRegisterRefresh={(fn) => {
                refreshHandlersRef.current.set("illustration", fn)
              }}
            />
          </VStack>
        </RefreshableScrollView>
      </VStack>

      {/* 2. 漫画历史保活容器 */}
      {visitedKinds.has("manga") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={kind === "manga" ? 1 : 0}
          zIndex={kind === "manga" ? 1 : 0}
          allowsHitTesting={kind === "manga"}
        >
          <RefreshableScrollView refreshable={() => refreshAllFeeds()}>
            <VStack alignment="leading" spacing={8} padding={{ top: 1 }} frame={{ minHeight: 500, maxWidth: "infinity" }}>
              <HistoryFeed
                kind="manga"
                enabled={isTabActive && kind === "manga"}
                searchWords={searchWords}
                searchQuery={searchQuery}
                onFirstImageUrlChange={(url) => {
                  if (kind === "manga") setAmbientImageUrl(url)
                }}
                onRegisterRefresh={(fn) => {
                  refreshHandlersRef.current.set("manga", fn)
                }}
              />
            </VStack>
          </RefreshableScrollView>
        </VStack>
      ) : null}

      {/* 3. 小说历史保活容器 */}
      {visitedKinds.has("novel") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={kind === "novel" ? 1 : 0}
          zIndex={kind === "novel" ? 1 : 0}
          allowsHitTesting={kind === "novel"}
        >
          <RefreshableScrollView refreshable={() => refreshAllFeeds()}>
            <VStack alignment="leading" spacing={8} padding={{ top: 1 }} frame={{ minHeight: 500, maxWidth: "infinity" }}>
              <HistoryFeed
                kind="novel"
                enabled={isTabActive && kind === "novel" && !hideNovels}
                searchWords={searchWords}
                searchQuery={searchQuery}
                onFirstImageUrlChange={(url) => {
                  if (kind === "novel") setAmbientImageUrl(url)
                }}
                onRegisterRefresh={(fn) => {
                  refreshHandlersRef.current.set("novel", fn)
                }}
              />
            </VStack>
          </RefreshableScrollView>
        </VStack>
      ) : null}
    </ZStack>
  )
}

function historyToolbar(props: {
  kind: HistoryKind
  hideNovels: boolean
  isAppleMusic?: boolean
  isSplitViewActive?: boolean
  isFullScreenPad?: boolean
  onKindChange: (kind: HistoryKind) => void
  onClear: () => void
  onOpenAnalytics?: () => void
}) {
  const isClassic = !props.isAppleMusic
  const kindLabel = historyKindTitle(props.kind)
  const fullTitle = `浏览记录 · ${kindLabel}`
  const settings = loadSettings()
  const customTint =
    settings.glassCustomTintEnabled && settings.glassTintColor
      ? (settings.glassTintColor as Color)
      : undefined

  async function handleClearConfirm() {
    try {
      triggerHaptic("light")
    } catch {}
    const targetLabel = historyKindTitle(props.kind)
    let confirmed = false
    if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
      confirmed = await Dialog.confirm({
        title: `清空${targetLabel}浏览记录`,
        message: `确定要清空全部${targetLabel}浏览记录吗？`,
        confirmLabel: "清空",
        cancelLabel: "取消",
      })
    } else {
      confirmed = true
    }
    if (confirmed) {
      try {
        triggerHaptic("warning")
      } catch {}
      props.onClear()
    }
  }

  const trailingActions = (() => {
    // 1. iPad 宽屏单栏（isFullScreenPad）：展示大热区全称胶囊菜单，消除双层顶栏并统领分类、足迹与清空
    if (props.isFullScreenPad) {
      return (
        <Menu
          key="history-wide-menu"
          label={
            <HStack alignment="center" spacing={4}>
              <Text font="subheadline" fontWeight="semibold">
                {fullTitle}
              </Text>
              <Image
                systemName="chevron.down"
                font="caption2"
                foregroundStyle="secondaryLabel"
              />
            </HStack>
          }
        >
          {props.onOpenAnalytics ? (
            <Button
              title="我的足迹"
              systemImage="chart.xyaxis.line"
              action={props.onOpenAnalytics}
            />
          ) : null}
          <Picker
            title="记录类型"
            value={props.kind}
            onChanged={(v: string) => props.onKindChange(v as HistoryKind)}
          >
            <Label tag="illustration" title="插画" systemImage="photo" />
            <Label tag="manga" title="漫画" systemImage="photo.on.rectangle" />
            {!props.hideNovels && (
              <Label tag="novel" title="小说" systemImage="book" />
            )}
          </Picker>
          <Button
            title={`清空${kindLabel}记录`}
            systemImage="trash"
            role="destructive"
            action={handleClearConfirm}
          />
        </Menu>
      )
    }

    // 2. 分栏双栏模式（isSplitViewActive）：收拢在更多菜单内，避免向左挤压 Tab 胶囊
    if (props.isSplitViewActive) {
      if (props.isAppleMusic) {
        return (
          <Menu key="apple-music-history-menu" label={<Image systemName="ellipsis.circle" />}>
            {props.onOpenAnalytics ? (
              <Button
                title="我的足迹"
                systemImage="chart.xyaxis.line"
                action={props.onOpenAnalytics}
              />
            ) : null}
            <Button
              title={`清空${kindLabel}记录`}
              systemImage="trash"
              role="destructive"
              action={handleClearConfirm}
            />
          </Menu>
        )
      }
      return (
        <Menu key="more-menu" label={<Image systemName="ellipsis.circle" />}>
          {props.onOpenAnalytics ? (
            <Button
              title="我的足迹"
              systemImage="chart.xyaxis.line"
              action={props.onOpenAnalytics}
            />
          ) : null}
          <Picker
            title="记录类型"
            value={props.kind}
            onChanged={(v: string) => props.onKindChange(v as HistoryKind)}
          >
            <Label tag="illustration" title="插画" systemImage="photo" />
            <Label tag="manga" title="漫画" systemImage="photo.on.rectangle" />
            {!props.hideNovels && (
              <Label tag="novel" title="小说" systemImage="book" />
            )}
          </Picker>
          <Button
            title={`清空${kindLabel}记录`}
            systemImage="trash"
            role="destructive"
            action={handleClearConfirm}
          />
        </Menu>
      )
    }

    // 2. 单栏模式（iPhone 真机 / iPad 台前调度窄窗 / iPad 全屏单栏）：平铺展开按钮
    if (props.isAppleMusic) {
      // 苹果音乐样式：底栏已有配件切换分类，顶栏平铺「我的足迹」和「清空记录」双按钮
      const actions: any[] = []
      if (props.onOpenAnalytics) {
        actions.push(
          <Button
            key="history-analytics-btn"
            action={props.onOpenAnalytics}
          >
            <Image systemName="chart.xyaxis.line" />
          </Button>
        )
      }
      actions.push(
        <Button
          key="history-clear-btn"
          role="destructive"
          tint={customTint ?? "systemRed"}
          action={handleClearConfirm}
        >
          <Image
            systemName="trash"
            foregroundStyle={customTint ?? "systemRed"}
          />
        </Button>
      )
      return actions
    }

    // 经典样式单栏（iPhone / 台前调度窄窗）：收拢为单一更多菜单，避免挤压中间标题「浏览记录 · 分类」
    return (
      <Menu key="history-classic-more-menu" label={<Image systemName="ellipsis.circle" />}>
        {props.onOpenAnalytics ? (
          <Button
            title="我的足迹"
            systemImage="chart.xyaxis.line"
            action={props.onOpenAnalytics}
          />
        ) : null}
        <Picker
          title="记录类型"
          value={props.kind}
          onChanged={(v: string) => props.onKindChange(v as HistoryKind)}
        >
          <Label tag="illustration" title="插画" systemImage="photo" />
          <Label tag="manga" title="漫画" systemImage="photo.on.rectangle" />
          {!props.hideNovels && (
            <Label tag="novel" title="小说" systemImage="book" />
          )}
        </Picker>
        <Button
          title={`清空${kindLabel}记录`}
          systemImage="trash"
          role="destructive"
          action={handleClearConfirm}
        />
      </Menu>
    )
  })()

  return {
    principal: props.isFullScreenPad ? undefined : (
      <Text font="title2" fontWeight="bold">
        {isClassic ? fullTitle : "浏览记录"}
      </Text>
    ),
    topBarTrailing: trailingActions,
  }
}

function historyKindTitle(kind: HistoryKind): string {
  switch (kind) {
    case "illustration":
      return "插画"
    case "manga":
      return "漫画"
    case "novel":
      return "小说"
  }
}



function IllustHistoryFeed(props: {
  kind: "illustration" | "manga"
  enabled?: boolean
  searchQuery?: string
  searchWords?: ReadonlyArray<string>
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, enabled = true, searchQuery = "", searchWords, onFirstImageUrlChange, onRegisterRefresh } = props
  const queryWords = useMemo(() => searchWords ?? parseHistoryQuery(searchQuery), [searchWords, searchQuery])
  const readItems = useHistorySearchItems(kind, () => loadHistoryIllusts(kind))

  const paged = usePagedList<HistoryIllustItem>({
    enabled,
    first: async () => {
      const items = readItems()
      const filtered = queryWords.length > 0
        ? items.filter((item) => matchesHistoryWords(item, queryWords))
        : items
      return {
        items: filtered,
        nextURL: null,
      }
    },
    filter: filterHistoryIllusts,
    deps: ["history", kind, searchQuery],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const pagedRef = useLatest(paged)
  const searchWordsRef = useLatest(queryWords)
  const displayedIdsRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    displayedIdsRef.current = new Set(paged.items.map((i) => Number(i.id)))
  }, [paged.items])

  useEffect(() => {
    return onHistoryEntryRecorded((entry) => {
      if (entry.kind !== "illust") return

      const isManga = entry.illustration.type === "manga"
      // 分类精准对齐：漫画容器只收漫画，插画容器只收插画
      if (kind === "manga" ? !isManga : isManga) return

      const illust = entry.illustration
      cacheIllust(illust)
      const currentWords = searchWordsRef.current

      if (displayedIdsRef.current.has(illust.id)) {
        // 老作品安静回看：数据层已落盘并更新 viewedAt，视图保持不动，标记待重排
        markHistoryRevisitDirty()
      } else {
        // 新探索作品：实时增量置顶追加到列表最上方
        const item: HistoryIllustItem = {
          ...illust,
          viewedAt: entry.viewedAt,
        }
        if (matchesHistoryWords(item, currentWords)) {
          displayedIdsRef.current.add(illust.id)
          pagedRef.current.prependItems([item])
        }
      }
    })
  }, [kind])

  useEffect(() => {
    let url: string | null = null
    if (paged.items[0]) url = cardThumbUrlOf(paged.items[0])
    if (url) {
      onFirstImageUrlChange?.(url)
    } else if (!paged.initialLoading && paged.items.length === 0) {
      onFirstImageUrlChange?.(null)
    }
  }, [
    paged.items[0]?.id,
    paged.initialLoading,
    paged.items.length,
    onFirstImageUrlChange,
  ])

  useEffect(() => {
    onRegisterRefresh?.(async () => {
      await refreshHistoryFromCloud()
      await paged.refresh()
    })
  }, [paged.refresh, onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={10}>
      <IllustHistoryContent
        paged={paged}
        kind={kind}
        searchQuery={searchQuery}
      />
    </VStack>
  )
}

function NovelHistoryFeed(props: {
  enabled?: boolean
  searchQuery?: string
  searchWords?: ReadonlyArray<string>
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { enabled = true, searchQuery = "", searchWords, onFirstImageUrlChange, onRegisterRefresh } = props
  const queryWords = useMemo(() => searchWords ?? parseHistoryQuery(searchQuery), [searchWords, searchQuery])
  const readItems = useHistorySearchItems("novel", loadHistoryNovels)

  const paged = usePagedList<HistoryNovelItem>({
    enabled,
    first: async () => {
      const items = readItems()
      const filtered = queryWords.length > 0
        ? items.filter((item) => matchesHistoryWords(item, queryWords))
        : items
      return {
        items: filtered,
        nextURL: null,
      }
    },
    filter: filterHistoryNovels,
    deps: ["history", "novel", searchQuery],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const pagedRef = useLatest(paged)
  const searchWordsRef = useLatest(queryWords)
  const displayedIdsRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    displayedIdsRef.current = new Set(paged.items.map((i) => Number(i.id)))
  }, [paged.items])

  useEffect(() => {
    return onHistoryEntryRecorded((entry) => {
      if (entry.kind !== "novel") return

      const novel = entry.novel
      cacheNovel(novel)
      const currentWords = searchWordsRef.current

      if (displayedIdsRef.current.has(novel.id)) {
        // 老小说安静回看：数据层已落盘并更新 viewedAt，视图保持不动，标记待重排
        markHistoryRevisitDirty()
      } else {
        // 新探索小说（包括沉浸阅读器连读新章节）：实时增量置顶追加到列表最上方
        const item: HistoryNovelItem = {
          ...novel,
          viewedAt: entry.viewedAt,
        }
        if (matchesHistoryWords(item, currentWords)) {
          displayedIdsRef.current.add(novel.id)
          pagedRef.current.prependItems([item])
        }
      }
    })
  }, [])

  useEffect(() => {
    let url: string | null = null
    if (paged.items[0]) url = novelThumbUrlOf(paged.items[0])
    if (url) {
      onFirstImageUrlChange?.(url)
    } else if (!paged.initialLoading && paged.items.length === 0) {
      onFirstImageUrlChange?.(null)
    }
  }, [
    paged.items[0]?.id,
    paged.initialLoading,
    paged.items.length,
    onFirstImageUrlChange,
  ])

  useEffect(() => {
    onRegisterRefresh?.(async () => {
      await refreshHistoryFromCloud()
      await paged.refresh()
    })
  }, [paged.refresh, onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={10}>
      <NovelHistoryContent
        paged={paged}
        searchQuery={searchQuery}
      />
    </VStack>
  )
}

function HistoryFeed(props: {
  kind: HistoryKind
  enabled?: boolean
  searchQuery?: string
  searchWords?: ReadonlyArray<string>
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  if (props.kind === "novel") {
    return (
      <NovelHistoryFeed
        enabled={props.enabled}
        searchQuery={props.searchQuery}
        searchWords={props.searchWords}
        onFirstImageUrlChange={props.onFirstImageUrlChange}
        onRegisterRefresh={props.onRegisterRefresh}
      />
    )
  }

  return (
    <IllustHistoryFeed
      kind={props.kind}
      enabled={props.enabled}
      searchQuery={props.searchQuery}
      searchWords={props.searchWords}
      onFirstImageUrlChange={props.onFirstImageUrlChange}
      onRegisterRefresh={props.onRegisterRefresh}
    />
  )
}

function IllustHistoryContent(props: {
  paged: ReturnType<typeof usePagedList<HistoryIllustItem>>
  kind: "illustration" | "manga"
  searchQuery?: string
}) {
  const { paged, kind, searchQuery = "" } = props

  const footerTextOf = useCallback((illust: PixivIllustration) => {
    const viewedAt = (illust as HistoryIllustItem).viewedAt
    return viewedAt ? formatDate(new Date(viewedAt).toISOString()) : undefined
  }, [])

  const contextMenuOf = useCallback((illust: PixivIllustration) => ({
    menuItems: (
      <Group>
        <Button
          title="删除记录"
          systemImage="trash"
          role="destructive"
          action={() => {
            removeHistoryEntry("illust", illust.id)
            paged.refresh()
          }}
        />
      </Group>
    ),
  }), [paged])

  const isSearching = Boolean(searchQuery.trim())

  if (paged.items.length === 0 && !paged.initialLoading) {
    if (paged.hasFilteredContent) {
      return (
        <EmptyView
          text="当前页面部分作品被内容显示设置过滤，暂时无法显示"
          systemImage="eye.slash"
        />
      )
    }
    if (isSearching) {
      return (
        <EmptyView
          text={`未找到与 「${searchQuery.trim()}」 相关的${kind === "manga" ? "漫画" : "插画"}浏览记录`}
          systemImage="magnifyingglass"
        />
      )
    }
    const text =
      kind === "manga"
        ? "暂无漫画浏览记录"
        : "暂无插画浏览记录"
    return (
      <EmptyView
        text={text}
        systemImage={kind === "manga" ? "photo.on.rectangle" : "photo"}
      />
    )
  }

  return (
    <VStack alignment="leading" spacing={8} frame={{ minHeight: 500, maxWidth: "infinity" }}>
      {paged.hasFilteredContent ? <FilteredContentNotice isNovel={false} /> : null}
      <IllustFlowFeed
        items={paged.items}
        onLoadMore={paged.loadMore}
        hasMore={paged.hasMore}
        isLoading={paged.loadingMore}
        loadMoreError={paged.loadMoreError}
        onRetryLoadMore={paged.retryLoadMore}
        footerTextOf={footerTextOf}
        contextMenuOf={contextMenuOf}
      />
    </VStack>
  )
}

function NovelHistoryContent(props: {
  paged: ReturnType<typeof usePagedList<HistoryNovelItem>>
  searchQuery?: string
}) {
  const { paged, searchQuery = "" } = props

  const isSearching = Boolean(searchQuery.trim())

  if (paged.items.length === 0 && !paged.initialLoading) {
    if (paged.hasFilteredContent) {
      return (
        <EmptyView
          text="当前页面部分小说被内容显示设置过滤，暂时无法显示"
          systemImage="eye.slash"
        />
      )
    }
    if (isSearching) {
      return (
        <EmptyView
          text={`未找到与 「${searchQuery.trim()}」 相关的小说浏览记录`}
          systemImage="magnifyingglass"
        />
      )
    }
    return (
      <EmptyView
        text="暂无小说浏览记录"
        systemImage="book"
      />
    )
  }

  const lastNovel = paged.items[paged.items.length - 1]

  return (
    <VStack alignment="leading" spacing={8} frame={{ minHeight: 500, maxWidth: "infinity" }}>
      {paged.hasFilteredContent ? <FilteredContentNotice isNovel={true} /> : null}
      <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 8 }}>
        {paged.items.map((entry, index) => (
          <NovelCard
            key={entry.id}
            novel={entry}
            priority={index}
            footerText={formatDate(new Date(entry.viewedAt).toISOString())}
            contextMenu={{
              menuItems: (
                <Group>
                  <Button
                    title="删除记录"
                    systemImage="trash"
                    role="destructive"
                    action={() => {
                      removeHistoryEntry("novel", entry.id)
                      paged.refresh()
                    }}
                  />
                </Group>
              ),
            }}
          />
        ))}
        {lastNovel ? (
          <LoadMoreTrigger
            anchor={lastNovel.id}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
            loadMoreError={paged.loadMoreError}
            onRetry={paged.retryLoadMore}
          />
        ) : null}
      </LazyVStack>
    </VStack>
  )
}
