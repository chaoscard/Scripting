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
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import { destinationElement } from "./routes"
import { currentBatchSize, useLatest, usePagedList } from "./hooks"
import type { PixivIllustration, PixivNovel } from "../types"

type HistoryKind = HistoryContentKind

interface HistoryIllustItem extends PixivIllustration {
  viewedAt: number
}

interface HistoryNovelItem extends PixivNovel {
  viewedAt: number
}

function loadHistoryIllusts(kind: "illustration" | "manga"): HistoryIllustItem[] {
  return getHistory()
    .filter((entry): entry is Extract<HistoryEntry, { kind: "illust" }> => {
      if (entry.kind !== "illust") return false
      return kind === "illustration"
        ? entry.illustration.type !== "manga"
        : entry.illustration.type === "manga"
    })
    .map((entry) => ({
      ...entry.illustration,
      viewedAt: entry.viewedAt,
    }))
}

function loadHistoryNovels(): HistoryNovelItem[] {
  return getHistory()
    .filter((entry): entry is Extract<HistoryEntry, { kind: "novel" }> => entry.kind === "novel")
    .map((entry) => ({
      ...entry.novel,
      viewedAt: entry.viewedAt,
    }))
}

function filterHistoryIllusts(items: HistoryIllustItem[]): HistoryIllustItem[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterHistoryNovels(items: HistoryNovelItem[]): HistoryNovelItem[] {
  const settings = loadSettings()
  return items.filter((item) => isNovelContentVisible(item, settings))
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
      navigationDestination={destinationElement}
      toolbar={historyToolbar({ kind, onClear: clearCurrentKind })}
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack alignment="leading" spacing={8}>
        <HistoryKindPicker kind={kind} onKindChange={setKind} />
        <HistoryFeed
          kind={kind}
          onRegisterRefresh={(fn) => {
            refreshHandlerRef.current = fn
          }}
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

  // 1. 插画历史流
  const illustPaged = usePagedList<HistoryIllustItem>({
    first: async () => ({
      items: loadHistoryIllusts("illustration"),
      nextURL: null,
    }),
    filter: filterHistoryIllusts,
    deps: ["history", "illustration"],
    enabled: kind === "illustration",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 漫画历史流
  const mangaPaged = usePagedList<HistoryIllustItem>({
    first: async () => ({
      items: loadHistoryIllusts("manga"),
      nextURL: null,
    }),
    filter: filterHistoryIllusts,
    deps: ["history", "manga"],
    enabled: kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 小说历史流
  const novelPaged = usePagedList<HistoryNovelItem>({
    first: async () => ({
      items: loadHistoryNovels(),
      nextURL: null,
    }),
    filter: filterHistoryNovels,
    deps: ["history", "novel"],
    enabled: kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const illustPagedRef = useLatest(illustPaged)
  const mangaPagedRef = useLatest(mangaPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    const handleHistoryChange = () => {
      illustPagedRef.current.refresh()
      mangaPagedRef.current.refresh()
      novelPagedRef.current.refresh()
    }
    const handleSettingsChange = () => {
      illustPagedRef.current.reapplyFilter()
      mangaPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
    }
    const unsubscribeHistory = onHistoryChanged(handleHistoryChange)
    const unsubscribeSettings = onSettingsChanged(handleSettingsChange)
    return () => {
      unsubscribeHistory()
      unsubscribeSettings()
    }
  }, [])

  const activeRefresh =
    kind === "illustration"
      ? illustPaged.refresh
      : kind === "manga"
        ? mangaPaged.refresh
        : novelPaged.refresh

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
          totalCount={loadHistoryIllusts("illustration").length}
        />
      ) : kind === "manga" ? (
        <IllustHistoryContent
          paged={mangaPaged}
          kind="manga"
          totalCount={loadHistoryIllusts("manga").length}
        />
      ) : (
        <NovelHistoryContent
          paged={novelPaged}
          totalCount={loadHistoryNovels().length}
        />
      )}
    </VStack>
  )
}

function IllustHistoryContent(props: {
  paged: ReturnType<typeof usePagedList<HistoryIllustItem>>
  kind: "illustration" | "manga"
  totalCount: number
}) {
  const { paged, kind, totalCount } = props

  if (paged.items.length === 0 && !paged.initialLoading) {
    const text =
      kind === "manga"
        ? "暂无漫画浏览记录，打开作品后会自动记录"
        : "暂无插画浏览记录，打开作品后会自动记录"
    return <EmptyView text={text} systemImage="clock" />
  }

  return (
    <VStack alignment="leading" spacing={8}>
      <HStack frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ horizontal: 14 }}>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          multilineTextAlignment="center"
          frame={{ maxWidth: "infinity", alignment: "center" }}
        >
          共 {totalCount} 条记录
        </Text>
      </HStack>
      <IllustFlowFeed
        items={paged.items}
        onLoadMore={paged.loadMore}
        hasMore={paged.hasMore}
        isLoading={paged.loadingMore}
        footerTextOf={(_, index) =>
          paged.items[index]
            ? formatDate(new Date(paged.items[index].viewedAt).toISOString())
            : undefined
        }
        topTrailingActionOf={(illust) => ({
          title: "移除",
          systemImage: "trash",
          tint: "#FF3B30",
          foregroundStyle: "systemRed",
          action: () => removeHistoryEntry("illust", illust.id),
        })}
      />
    </VStack>
  )
}

function NovelHistoryContent(props: {
  paged: ReturnType<typeof usePagedList<HistoryNovelItem>>
  totalCount: number
}) {
  const { paged, totalCount } = props

  if (paged.items.length === 0 && !paged.initialLoading) {
    return (
      <EmptyView
        text="暂无小说浏览记录，打开小说后会自动记录"
        systemImage="clock"
      />
    )
  }

  const lastNovel = paged.items[paged.items.length - 1]

  return (
    <VStack alignment="leading" spacing={8}>
      <HStack frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ horizontal: 14 }}>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          multilineTextAlignment="center"
          frame={{ maxWidth: "infinity", alignment: "center" }}
        >
          共 {totalCount} 条记录
        </Text>
      </HStack>
      <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
        {paged.items.map((entry, index) => (
          <NovelCard
            key={entry.id}
            novel={entry}
            priority={index}
            footerText={formatDate(new Date(entry.viewedAt).toISOString())}
            topTrailingAction={{
              title: "移除",
              systemImage: "trash",
              tint: "#FF3B30",
              foregroundStyle: "systemRed",
              action: () => removeHistoryEntry("novel", entry.id),
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
