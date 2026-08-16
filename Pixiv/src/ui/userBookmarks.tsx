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
  bookmarkTags,
  nextIllustrations,
  nextNovels,
  userBookmarks,
  userNovelBookmarks,
} from "../api/pixiv"
import { session } from "../api/session"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import { onSettingsChanged } from "../store/settings"
import { useAsyncGuard, useLatest, usePagedList } from "./hooks"
import type { PixivBookmarkTag, PixivIllustration, PixivNovel } from "../types"
import {
  BookmarkTags,
  filterIllustrationBookmarks,
  filterNovelBookmarks,
} from "./library"
import {
  EmptyView,
  ErrorView,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

type BookmarkKind = "illustration" | "novel"

export function UserBookmarksView(props: { userID: number }) {
  const [kind, setKind] = useState<BookmarkKind>("illustration")
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  return (
    <RefreshableScrollView
      navigationTitle="收藏"
      navigationBarTitleDisplayMode="inline"
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack alignment="leading" spacing={8}>
        <BookmarkKindPicker kind={kind} onChanged={setKind} />
        {kind === "illustration" ? (
          <UserIllustrationBookmarkFeed
            key={`illust:${props.userID}`}
            userID={props.userID}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        ) : (
          <UserNovelBookmarkFeed
            key={`novel:${props.userID}`}
            userID={props.userID}
            onRegisterRefresh={(fn) => {
              refreshHandlerRef.current = fn
            }}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function UserIllustrationBookmarkFeed(props: {
  userID: number
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, onRegisterRefresh } = props
  const [tags, setTags] = useState<PixivBookmarkTag[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const guard = useAsyncGuard()

  async function loadTags() {
    const g = guard()
    try {
      const page = await session.call((token) =>
        bookmarkTags(userID, "public", token)
      )
      if (g.isCurrent()) setTags(page.items)
    } catch {
      if (g.isCurrent()) setTags([])
    }
  }

  const paged = usePagedList<PixivIllustration>({
    first: (token) => userBookmarks(userID, "public", token, activeTag),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrationBookmarks,
    deps: [userID, activeTag],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })

  useEffect(() => {
    void loadTags()
  }, [userID])

  useEffect(() => {
    onRegisterRefresh?.(async () => {
      await Promise.all([paged.refresh(), loadTags()])
    })
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
      <BookmarkTags tags={tags} activeTag={activeTag} onTagChange={setActiveTag} />
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无公开收藏作品" systemImage="heart" />
      ) : (
        <IllustFlowFeed
          items={paged.items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
        />
      )}
    </VStack>
  )
}

function UserNovelBookmarkFeed(props: {
  userID: number
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, onRegisterRefresh } = props

  const paged = usePagedList<PixivNovel>({
    first: (token) => userNovelBookmarks(userID, "public", null, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelBookmarks,
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

  return (
    <VStack alignment="leading" spacing={10}>
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无公开收藏小说" systemImage="book" />
      ) : (
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
      )}
    </VStack>
  )
}

function BookmarkKindPicker(props: {
  kind: BookmarkKind
  onChanged: (kind: BookmarkKind) => void
}) {
  return (
    <Picker
      title="收藏类型"
      value={props.kind}
      onChanged={(value: string) => props.onChanged(value as BookmarkKind)}
      pickerStyle="segmented"
      padding={{ horizontal: 14 }}
    >
      <Text tag="illustration">插画·漫画</Text>
      <Text tag="novel">小说</Text>
    </Picker>
  )
}
