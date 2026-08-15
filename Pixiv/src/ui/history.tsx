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
  isR18ContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import type { PixivNovel } from "../types"

type HistoryKind = HistoryContentKind

function getVisibleHistory(kind: HistoryKind): HistoryEntry[] {
  const settings = loadSettings()
  return getHistory().filter((entry) => {
    if (entry.kind === "novel") {
      return (
        kind === "novel" &&
        isR18ContentVisible(entry.novel.x_restrict, settings.showR18, settings.showR18G) &&
        (settings.showAI || entry.novel.novel_ai_type !== 2)
      )
    }
    const matchesKind =
      kind === "illustration"
        ? entry.illustration.type !== "manga"
        : kind === "manga"
          ? entry.illustration.type === "manga"
          : false
    return matchesKind && isIllustContentVisible(entry.illustration, settings)
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
        buttonStyle="glass"
        action={() => {}}
        frame={{ width: 30, height: 30 }}
        clipShape={{ type: "rect", cornerRadius: 15 }}
        contentShape="rect"
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
    return (
      <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
        {novels.map((entry) => (
          <NovelCard
            key={entry.novel.id}
            novel={entry.novel as PixivNovel}
            footerText={formatDate(new Date(entry.viewedAt).toISOString())}
          />
        ))}
      </LazyVStack>
    )
  }

  const illustEntries = props.items.filter(
    (entry): entry is Extract<HistoryEntry, { kind: "illust" }> =>
      entry.kind === "illust"
  )
  return (
    <IllustFlowFeed
      items={illustEntries.map((entry) => entry.illustration)}
      onLoadMore={() => {}}
      hasMore={false}
      footerTextOf={(_, index) =>
        formatDate(new Date(illustEntries[index].viewedAt).toISOString())
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
