import {
  LazyVStack,
  Picker,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  nextIllustrations,
  nextNovels,
  userNovels,
  userWorks,
} from "../api/pixiv"
import { session } from "../api/session"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  isIllustContentVisible,
  isR18ContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { useLatest, usePagedList } from "./hooks"
import type { PixivIllustration, PixivNovel } from "../types"
import {
  EmptyView,
  ErrorView,
  IllustFlowFeed,
  LoadingView,
  LoadMoreTrigger,
  NovelCard,
  RefreshableScrollView,
} from "./components"

export type WorkTab = "illust" | "manga" | "novel"

export function UserWorksView(props: { userID?: number; title?: string }) {
  const currentUserID = props.userID ?? session.userID ?? null
  const [tab, setTab] = useState<WorkTab>("illust")
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  if (currentUserID == null) {
    return (
      <RefreshableScrollView
        navigationTitle={props.title ?? "作品"}
        navigationBarTitleDisplayMode="inline"
        refreshable={() => Promise.resolve()}
      >
        <EmptyView text="请先登录以查看作品" systemImage="person.crop.circle.badge.exclamationmark" />
      </RefreshableScrollView>
    )
  }

  return (
    <RefreshableScrollView
      navigationTitle={props.title ?? "作品"}
      navigationBarTitleDisplayMode="inline"
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack alignment="leading" spacing={8}>
        <Picker
          title="作品类型"
          value={tab}
          onChanged={(value: string) => setTab(value as WorkTab)}
          pickerStyle="segmented"
          padding={{ horizontal: 14 }}
        >
          <Text tag="illust">插画</Text>
          <Text tag="manga">漫画</Text>
          <Text tag="novel">小说</Text>
        </Picker>

        {tab === "illust" ? (
          <UserWorksIllustFeed
            key={`illust:${currentUserID}`}
            userID={currentUserID}
            kind="illust"
            emptyText="暂无插画投稿"
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : tab === "manga" ? (
          <UserWorksIllustFeed
            key={`manga:${currentUserID}`}
            userID={currentUserID}
            kind="manga"
            emptyText="暂无漫画投稿"
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : (
          <UserWorksNovelFeed
            key={`novel:${currentUserID}`}
            userID={currentUserID}
            emptyText="暂无小说投稿"
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function UserWorksIllustFeed(props: {
  userID: number
  kind: "illust" | "manga"
  emptyText: string
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, kind, emptyText, onRegisterRefresh } = props

  const paged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(userID, kind, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrations,
    deps: [userID, kind],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
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

  if (paged.initialLoading) {
    return <LoadingView />
  }
  if (paged.error && paged.items.length === 0) {
    return <ErrorView message={paged.error} onRetry={paged.refresh} />
  }
  if (paged.items.length === 0) {
    return <EmptyView text={emptyText} systemImage="photo.on.rectangle" />
  }
  return (
    <IllustFlowFeed
      items={paged.items}
      onLoadMore={paged.loadMore}
      hasMore={paged.hasMore}
      isLoading={paged.loadingMore}
    />
  )
}

function UserWorksNovelFeed(props: {
  userID: number
  emptyText: string
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, emptyText, onRegisterRefresh } = props

  const paged = usePagedList<PixivNovel>({
    first: (token) => userNovels(userID, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovels,
    deps: [userID],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel,
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

  if (paged.initialLoading) {
    return <LoadingView />
  }
  if (paged.error && paged.items.length === 0) {
    return <ErrorView message={paged.error} onRetry={paged.refresh} />
  }
  if (paged.items.length === 0) {
    return <EmptyView text={emptyText} systemImage="book" />
  }
  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
      {paged.items.map((novel, index) => (
        <NovelCard key={novel.id} novel={novel} priority={index} />
      ))}
      <LoadMoreTrigger
        anchor={paged.items[paged.items.length - 1].id}
        onLoadMore={paged.loadMore}
        hasMore={paged.hasMore}
        isLoading={paged.loadingMore}
      />
    </LazyVStack>
  )
}

function filterIllustrations(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterNovels(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter(
    (item) =>
      isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G) &&
      (settings.showAI || item.novel_ai_type !== 2)
  )
}
