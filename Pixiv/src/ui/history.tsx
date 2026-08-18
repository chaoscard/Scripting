import {
  Button,
  Group,
  HStack,
  Image,
  LazyVStack,
  Picker,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  EmptyView,
  formatDate,
  IllustFlowFeed,
  LoadMoreTrigger,
  NovelCard,
  RefreshableScrollView,
} from "./components"
import {
  clearHistoryKind,
  getHistory,
  onHistoryChanged,
  refreshHistoryFromCloud,
  removeHistoryEntry,
  type HistoryContentKind,
  type HistoryEntry,
} from "../store/history"
import {
  isIllustContentVisible,
  isNovelContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import type { PixivNovel } from "../types"

const UI_BATCH_SIZE = 10

type HistoryKind = HistoryContentKind

function getVisibleHistory(kind: HistoryKind): HistoryEntry[] {
  const settings = loadSettings()
  return getHistory().filter((entry) => {
    if (entry.kind === "novel") {
      return (
        kind === "novel" &&
        isNovelContentVisible(
          entry.novel,
          settings,
          settings.libraryFilterExempt
        )
      )
    }
    const matchesKind =
      kind === "illustration"
        ? entry.illustration.type !== "manga"
        : kind === "manga"
          ? entry.illustration.type === "manga"
          : false
    return (
      matchesKind &&
      isIllustContentVisible(
        entry.illustration,
        settings,
        settings.libraryFilterExempt
      )
    )
  })
}

export function HistoryView() {
  const [kind, setKind] = useState<HistoryKind>("illustration")
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  function clearCurrentKind() {
    clearHistoryKind(kind)
  }

  return (
    <RefreshableScrollView
      navigationBarTitleDisplayMode="inline"
      toolbar={historyToolbar({ kind, onClear: clearCurrentKind })}
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack alignment="leading" spacing={8}>
        <HistoryKindPicker kind={kind} onKindChange={setKind} />
        <HistoryFeed
          key={kind}
          kind={kind}
          onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
        />
      </VStack>
    </RefreshableScrollView>
  )
}

function historyToolbar(props: { kind: HistoryKind; onClear: () => void }) {
  return {
    principal: [
      <Text font="title2" fontWeight="bold">
        浏览记录
      </Text>,
    ],
    topBarTrailing: [
      <Button
        action={() => {}}
        contextMenu={{
          menuItems: (
            <Group>
              <Button
                title={`删除${historyKindTitle(props.kind)}浏览记录`}
                systemImage="trash"
                role="destructive"
                action={props.onClear}
              />
            </Group>
          ),
        }}
      >
        <Image systemName="trash" />
      </Button>,
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

function HistoryKindPicker(props: {
  kind: HistoryKind
  onKindChange: (kind: HistoryKind) => void
}) {
  return (
    <Picker
      title="浏览记录类型"
      value={props.kind}
      onChanged={(value: string) => props.onKindChange(value as HistoryKind)}
      pickerStyle="segmented"
      padding={{ horizontal: 14 }}
    >
      <Text tag="illustration">插画</Text>
      <Text tag="manga">漫画</Text>
      <Text tag="novel">小说</Text>
    </Picker>
  )
}

function HistoryFeed(props: {
  kind: HistoryKind
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, onRegisterRefresh } = props
  const [items, setItems] = useState(() => getVisibleHistory(kind))

  useEffect(() => {
    const reload = () => setItems(getVisibleHistory(kind))
    reload()
    const unsubscribeHistory = onHistoryChanged(reload)
    const unsubscribeSettings = onSettingsChanged(reload)
    return () => {
      unsubscribeHistory()
      unsubscribeSettings()
    }
  }, [kind])

  function reload() {
    setItems(getVisibleHistory(kind))
  }

  useEffect(() => {
    onRegisterRefresh?.(async () => {
      await refreshHistoryFromCloud()
      reload()
    })
  }, [onRegisterRefresh])

  return (
    <VStack alignment="leading" spacing={10}>
      <HStack spacing={8} padding={{ horizontal: 14 }}>
        <Text font="caption" foregroundStyle="secondaryLabel">
          共 {items.length} 条记录
        </Text>
      </HStack>
      <HistoryContent kind={kind} items={items} />
    </VStack>
  )
}

function HistoryContent(props: { kind: HistoryKind; items: HistoryEntry[] }) {
  const [visibleCount, setVisibleCount] = useState(UI_BATCH_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingMoreLockRef = useRef(false)
  const prevKindRef = useRef(props.kind)
  const prefetchTaskRef = useRef<{ cancel: () => void } | null>(null)

  useEffect(() => {
    if (prevKindRef.current !== props.kind) {
      prevKindRef.current = props.kind
      setVisibleCount(UI_BATCH_SIZE)
      loadingMoreLockRef.current = false
      setLoadingMore(false)
    }
  }, [props.kind])

  useEffect(() => {
    prefetchTaskRef.current?.cancel()
    if (props.kind === "novel") {
      const novels = props.items.filter(
        (entry): entry is Extract<HistoryEntry, { kind: "novel" }> =>
          entry.kind === "novel"
      )
      const nextNovels = novels.slice(visibleCount, visibleCount + UI_BATCH_SIZE)
      prefetchTaskRef.current = prefetch(
        nextNovels.map((e) => novelThumbUrlOf(e.novel as PixivNovel))
      )
    } else {
      const illustEntries = props.items.filter(
        (entry): entry is Extract<HistoryEntry, { kind: "illust" }> =>
          entry.kind === "illust"
      )
      const nextIllusts = illustEntries.slice(visibleCount, visibleCount + UI_BATCH_SIZE)
      prefetchTaskRef.current = prefetch(
        nextIllusts.map((e) => cardThumbUrlOf(e.illustration))
      )
    }
    return () => prefetchTaskRef.current?.cancel()
  }, [visibleCount, props.kind, props.items])

  if (props.items.length === 0) {
    const text =
      props.kind === "novel"
        ? "暂无小说浏览记录，打开小说后会自动记录"
        : "暂无浏览记录，打开作品后会自动记录"
    return <EmptyView text={text} systemImage="clock" />
  }

  if (props.kind === "novel") {
    const novels = props.items.filter(
      (entry): entry is Extract<HistoryEntry, { kind: "novel" }> =>
        entry.kind === "novel"
    )
    const visibleNovels = novels.slice(0, visibleCount)
    const lastNovel = visibleNovels[visibleNovels.length - 1]

    async function loadMoreNovels() {
      if (loadingMoreLockRef.current || visibleCount >= novels.length) return
      loadingMoreLockRef.current = true
      setLoadingMore(true)
      try {
        // 缓冲 1500ms：确保触底橡皮筋回弹完整展示转圈，随后平滑展开新批次卡片
        await new Promise((resolve) => setTimeout(() => resolve(undefined), 1500))
        setVisibleCount((c) => Math.min(c + UI_BATCH_SIZE, novels.length))
      } finally {
        loadingMoreLockRef.current = false
        setLoadingMore(false)
      }
    }

    return (
      <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
        {visibleNovels.map((entry, index) => (
          <NovelCard
            key={entry.novel.id}
            novel={entry.novel as PixivNovel}
            priority={index}
            footerText={formatDate(new Date(entry.viewedAt).toISOString())}
            topTrailingAction={{
              title: "移除",
              systemImage: "trash",
              tint: "#FF3B30",
              foregroundStyle: "systemRed",
              action: () => removeHistoryEntry("novel", entry.novel.id),
            }}
          />
        ))}
        {lastNovel ? (
          <LoadMoreTrigger
            anchor={lastNovel.novel.id}
            onLoadMore={() => void loadMoreNovels()}
            hasMore={visibleCount < novels.length}
            isLoading={loadingMore}
          />
        ) : null}
      </LazyVStack>
    )
  }

  const illustEntries = props.items.filter(
    (entry): entry is Extract<HistoryEntry, { kind: "illust" }> =>
      entry.kind === "illust"
  )
  const visibleIllusts = illustEntries.slice(0, visibleCount)

  async function loadMoreIllusts() {
    if (loadingMoreLockRef.current || visibleCount >= illustEntries.length) return
    loadingMoreLockRef.current = true
    setLoadingMore(true)
    try {
      // 缓冲 1500ms：确保触底橡皮筋回弹完整展示转圈，随后平滑展开新批次卡片
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 1500))
      setVisibleCount((c) => Math.min(c + UI_BATCH_SIZE, illustEntries.length))
    } finally {
      loadingMoreLockRef.current = false
      setLoadingMore(false)
    }
  }

  return (
    <IllustFlowFeed
      items={visibleIllusts.map((entry) => entry.illustration)}
      onLoadMore={() => void loadMoreIllusts()}
      hasMore={visibleCount < illustEntries.length}
      isLoading={loadingMore}
      footerTextOf={(_, index) =>
        formatDate(new Date(visibleIllusts[index].viewedAt).toISOString())
      }
      topTrailingActionOf={(illust) => ({
        title: "移除",
        systemImage: "trash",
        tint: "#FF3B30",
        foregroundStyle: "systemRed",
        action: () => removeHistoryEntry("illust", illust.id),
      })}
    />
  )
}
