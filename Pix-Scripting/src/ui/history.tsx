import {
  Button,
  Group,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  Text,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
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
  clearHistoryKind,
  getHistory,
  historyKindCount,
  onHistoryChanged,
  refreshHistoryFromCloud,
  removeHistoryEntry,
  type HistoryContentKind,
  type HistoryEntry,
} from "../store/history"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import { cacheIllust } from "../store/illustCache"
import { cacheNovel } from "../store/novelCache"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import { currentBatchSize, useLatest, usePagedList, useExperimentalAmbientPalette } from "./hooks"
import type { PixivIllustration, PixivNovel } from "../types"

export type HistoryKind = HistoryContentKind

declare const Dialog: any
import { triggerHaptic } from "../utils/haptics"

export interface HistoryIllustItem extends PixivIllustration {
  viewedAt: number
}

export interface HistoryNovelItem extends PixivNovel {
  viewedAt: number
}

export function matchesHistoryQuery(item: HistoryIllustItem | HistoryNovelItem, query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return true

  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true

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
      cacheIllust(entry.illustration)
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
      cacheNovel(entry.novel)
      return {
        ...entry.novel,
        viewedAt: entry.viewedAt,
      }
    })
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
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(null)
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

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

  useRegisterBottomAccessory(
    "history",
    historyItems.length <= 1 ? null : (
      <DockSegmentedBar
        items={historyItems}
        value={kind}
        onChanged={setKind}
      />
    ),
    isAppleMusic
  )

  function clearCurrentKind() {
    clearHistoryKind(kind)
    void refreshHandlerRef.current()
  }

  return (
    <ZStack
      navigationBarTitleDisplayMode="inline"
      background={ambientBackground}
      toolbar={historyToolbar({
        kind,
        hideNovels,
        isAppleMusic,
        onKindChange: setKind,
        onClear: clearCurrentKind,
      })}
      searchable={{
        value: searchQuery,
        onChanged: setSearchQuery,
        placement: "navigationBarDrawer",
        prompt: "搜索作者、标题和标签",
      }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      {/* 1. 插画历史保活容器 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        opacity={kind === "illustration" ? 1 : 0}
        zIndex={kind === "illustration" ? 1 : 0}
        allowsHitTesting={kind === "illustration"}
      >
        <RefreshableScrollView refreshable={() => refreshHandlerRef.current()}>
          <VStack alignment="leading" spacing={8}>
            <HistoryFeed
              kind="illustration"
              searchQuery={searchQuery}
              onFirstImageUrlChange={(url) => {
                if (kind === "illustration") setAmbientImageUrl(url)
              }}
              onRegisterRefresh={(fn) => {
                if (kind === "illustration") refreshHandlerRef.current = fn
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
          <RefreshableScrollView refreshable={() => refreshHandlerRef.current()}>
            <VStack alignment="leading" spacing={8}>
              <HistoryFeed
                kind="manga"
                searchQuery={searchQuery}
                onFirstImageUrlChange={(url) => {
                  if (kind === "manga") setAmbientImageUrl(url)
                }}
                onRegisterRefresh={(fn) => {
                  if (kind === "manga") refreshHandlerRef.current = fn
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
          <RefreshableScrollView refreshable={() => refreshHandlerRef.current()}>
            <VStack alignment="leading" spacing={8}>
              <HistoryFeed
                kind="novel"
                searchQuery={searchQuery}
                onFirstImageUrlChange={(url) => {
                  if (kind === "novel") setAmbientImageUrl(url)
                }}
                onRegisterRefresh={(fn) => {
                  if (kind === "novel") refreshHandlerRef.current = fn
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
  onKindChange: (kind: HistoryKind) => void
  onClear: () => void
}) {
  const isClassic = !props.isAppleMusic
  const kindLabel = historyKindTitle(props.kind)

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

  return {
    principal: (
      <Text font="title2" fontWeight="bold">
        {isClassic ? `浏览记录 · ${kindLabel}` : "浏览记录"}
      </Text>
    ),
    topBarTrailing: [
      props.isAppleMusic ? (
        <Button key="clear-button" action={handleClearConfirm}>
          <Image systemName="trash" foregroundStyle="systemRed" />
        </Button>
      ) : (
        <Menu key="more-menu" label={<Image systemName="ellipsis.circle" />}>
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
      ),
    ],
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



function HistoryFeed(props: {
  kind: HistoryKind
  searchQuery?: string
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, searchQuery = "", onFirstImageUrlChange, onRegisterRefresh } = props
  const mountTime = useRef(Date.now()).current

  // 1. 插画历史流
  const illustPaged = usePagedList<HistoryIllustItem>({
    first: async () => {
      const items = loadHistoryIllusts("illustration")
      const filtered = searchQuery.trim()
        ? items.filter((item) => matchesHistoryQuery(item, searchQuery))
        : items
      return {
        items: filtered,
        nextURL: null,
      }
    },
    filter: filterHistoryIllusts,
    deps: ["history", "illustration", searchQuery, mountTime],
    enabled: kind === "illustration",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 漫画历史流
  const mangaPaged = usePagedList<HistoryIllustItem>({
    first: async () => {
      const items = loadHistoryIllusts("manga")
      const filtered = searchQuery.trim()
        ? items.filter((item) => matchesHistoryQuery(item, searchQuery))
        : items
      return {
        items: filtered,
        nextURL: null,
      }
    },
    filter: filterHistoryIllusts,
    deps: ["history", "manga", searchQuery, mountTime],
    enabled: kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 小说历史流
  const novelPaged = usePagedList<HistoryNovelItem>({
    first: async () => {
      const items = loadHistoryNovels()
      const filtered = searchQuery.trim()
        ? items.filter((item) => matchesHistoryQuery(item, searchQuery))
        : items
      return {
        items: filtered,
        nextURL: null,
      }
    },
    filter: filterHistoryNovels,
    deps: ["history", "novel", searchQuery, mountTime],
    enabled: kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const illustPagedRef = useLatest(illustPaged)
  const mangaPagedRef = useLatest(mangaPaged)
  const novelPagedRef = useLatest(novelPaged)

  const [historyVersion, setHistoryVersion] = useState(0)

  useEffect(() => {
    const handleSettingsChange = () => {
      illustPagedRef.current.reapplyFilter()
      mangaPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
    }
    const unsubscribeSettings = onSettingsChanged(handleSettingsChange)
    return () => {
      unsubscribeSettings()
    }
  }, [])

  const currentCount = useMemo(() => {
    void historyVersion
    return historyKindCount(kind)
  }, [kind, historyVersion])

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
    onRegisterRefresh?.(async () => {
      await refreshHistoryFromCloud()
      await activeRefresh()
    })
  }, [activeRefresh, onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={10}>
      {kind === "illustration" ? (
        <IllustHistoryContent
          paged={illustPaged}
          kind="illustration"
          totalCount={currentCount}
          searchQuery={searchQuery}
        />
      ) : kind === "manga" ? (
        <IllustHistoryContent
          paged={mangaPaged}
          kind="manga"
          totalCount={currentCount}
          searchQuery={searchQuery}
        />
      ) : (
        <NovelHistoryContent
          paged={novelPaged}
          totalCount={currentCount}
          searchQuery={searchQuery}
        />
      )}
    </VStack>
  )
}

function IllustHistoryContent(props: {
  paged: ReturnType<typeof usePagedList<HistoryIllustItem>>
  kind: "illustration" | "manga"
  totalCount: number
  searchQuery?: string
}) {
  const { paged, kind, totalCount, searchQuery = "" } = props

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
          text={`未找到与 “${searchQuery.trim()}” 相关的${kind === "manga" ? "漫画" : "插画"}浏览记录`}
          systemImage="magnifyingglass"
        />
      )
    }
    const text =
      kind === "manga"
        ? "暂无漫画浏览记录，打开作品后会自动记录"
        : "暂无插画浏览记录，打开作品后会自动记录"
    return <EmptyView text={text} systemImage="clock" />
  }

  const countSummary = isSearching
    ? `共 ${totalCount} 条记录 · 找到 ${paged.items.length} 条`
    : `共 ${totalCount} 条记录`

  return (
    <VStack alignment="leading" spacing={8}>
      {paged.hasFilteredContent ? <FilteredContentNotice isNovel={false} /> : null}
      <HStack frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ horizontal: 14 }}>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          multilineTextAlignment="center"
          frame={{ maxWidth: "infinity", alignment: "center" }}
        >
          {countSummary}
        </Text>
      </HStack>
      <IllustFlowFeed
        items={paged.items}
        onLoadMore={paged.loadMore}
        hasMore={paged.hasMore}
        isLoading={paged.loadingMore}
        footerTextOf={footerTextOf}
        contextMenuOf={contextMenuOf}
      />
    </VStack>
  )
}

function NovelHistoryContent(props: {
  paged: ReturnType<typeof usePagedList<HistoryNovelItem>>
  totalCount: number
  searchQuery?: string
}) {
  const { paged, totalCount, searchQuery = "" } = props

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
          text={`未找到与 “${searchQuery.trim()}” 相关的小说浏览记录`}
          systemImage="magnifyingglass"
        />
      )
    }
    return (
      <EmptyView
        text="暂无小说浏览记录，打开小说后会自动记录"
        systemImage="clock"
      />
    )
  }

  const lastNovel = paged.items[paged.items.length - 1]
  const countSummary = isSearching
    ? `共 ${totalCount} 条记录 · 找到 ${paged.items.length} 条`
    : `共 ${totalCount} 条记录`

  return (
    <VStack alignment="leading" spacing={8}>
      {paged.hasFilteredContent ? <FilteredContentNotice isNovel={true} /> : null}
      <HStack frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ horizontal: 14 }}>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          multilineTextAlignment="center"
          frame={{ maxWidth: "infinity", alignment: "center" }}
        >
          {countSummary}
        </Text>
      </HStack>
      <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
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
          />
        ) : null}
      </LazyVStack>
    </VStack>
  )
}
