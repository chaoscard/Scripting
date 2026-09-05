import {
  LazyVStack,
  Picker,
  Text,
  useCallback,
  useEffect,
  useMemo,
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
import { loadSettings, onSettingsChanged } from "../store/settings"
import {
  onIllustBookmarkChanged,
  onNovelBookmarkChanged,
} from "../store/bookmarkSync"
import { useAsyncGuard, useLatest, usePagedList, currentBatchSize, useExperimentalAmbientPalette } from "./hooks"
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
import { DockSegmentedBar, useRegisterBottomAccessory } from "./bottomAccessory"

type BookmarkKind = "illustration" | "novel"

export function UserBookmarksView(props: { userID: number }) {
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [kind, setKind] = useState<BookmarkKind>("illustration")
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"
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

  const userBookmarkItems = useMemo<Array<{ tag: BookmarkKind; label: string }>>(() => {
    const items: Array<{ tag: BookmarkKind; label: string }> = [
      { tag: "illustration", label: "插画·漫画" },
    ]
    if (!hideNovels) {
      items.push({ tag: "novel", label: "小说" })
    }
    return items
  }, [hideNovels])

  useRegisterBottomAccessory(
    "userBookmarks",
    hideNovels || userBookmarkItems.length <= 1 ? null : (
      <DockSegmentedBar
        items={userBookmarkItems}
        value={kind}
        onChanged={setKind}
      />
    ),
    isAppleMusic
  )

  return (
    <RefreshableScrollView
      navigationTitle="收藏"
      navigationBarTitleDisplayMode="inline"
      background={ambientBackground}
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack alignment="leading" spacing={8}>
        {hideNovels || isAppleMusic ? null : (
          <BookmarkKindPicker kind={kind} onChanged={setKind} />
        )}
        <UserBookmarksFeed
          userID={props.userID}
          kind={kind}
          onFirstImageUrlChange={setAmbientImageUrl}
          onRegisterRefresh={(fn) => {
            refreshHandlerRef.current = fn
          }}
        />
      </VStack>
    </RefreshableScrollView>
  )
}

function UserBookmarksFeed(props: {
  userID: number
  kind: BookmarkKind
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, kind, onFirstImageUrlChange, onRegisterRefresh } = props
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

  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => userBookmarks(userID, "public", token, activeTag),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrationBookmarks,
    deps: [userID, activeTag],
    enabled: kind === "illustration",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => userNovelBookmarks(userID, "public", null, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelBookmarks,
    deps: [userID],
    enabled: kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  useEffect(() => {
    if (kind === "illustration") {
      void loadTags()
    }
  }, [userID, kind])

  const illustPagedRef = useLatest(illustPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    const unsubs = [
      onSettingsChanged(() => {
        illustPagedRef.current.reapplyFilter()
        novelPagedRef.current.reapplyFilter()
      }),
      onIllustBookmarkChanged((_, bookmarked) => {
        if (!bookmarked) {
          illustPagedRef.current.reapplyFilter()
        }
      }),
      onNovelBookmarkChanged((_, bookmarked) => {
        if (!bookmarked) {
          novelPagedRef.current.reapplyFilter()
        }
      }),
    ]
    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [])

  useEffect(() => {
    if (kind === "illustration") {
      const first = illustPaged.items[0]
      if (first) {
        onFirstImageUrlChange?.(cardThumbUrlOf(first))
      } else if (!illustPaged.initialLoading && illustPaged.items.length === 0) {
        onFirstImageUrlChange?.(null)
      }
    } else {
      const first = novelPaged.items[0]
      if (first) {
        onFirstImageUrlChange?.(novelThumbUrlOf(first))
      } else if (!novelPaged.initialLoading && novelPaged.items.length === 0) {
        onFirstImageUrlChange?.(null)
      }
    }
  }, [
    kind,
    illustPaged.items[0]?.id,
    illustPaged.initialLoading,
    illustPaged.items.length,
    novelPaged.items[0]?.id,
    novelPaged.initialLoading,
    novelPaged.items.length,
    onFirstImageUrlChange,
  ])

  const activeRefresh = useCallback(async () => {
    if (kind === "illustration") {
      await Promise.all([illustPaged.refresh(), loadTags()])
    } else {
      await novelPaged.refresh()
    }
  }, [kind, illustPaged.refresh, novelPaged.refresh])

  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  if (kind === "illustration") {
    return (
      <VStack alignment="leading" spacing={10}>
        <BookmarkTags tags={tags} activeTag={activeTag} onTagChange={setActiveTag} />
        {illustPaged.initialLoading ? (
          <LoadingView />
        ) : illustPaged.error && illustPaged.items.length === 0 ? (
          <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
        ) : illustPaged.items.length === 0 ? (
          <EmptyView
            text={
              illustPaged.hasFilteredContent
                ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                : "暂无公开收藏作品"
            }
            systemImage={illustPaged.hasFilteredContent ? "eye.slash" : "heart"}
          />
        ) : (
          <IllustFlowFeed
            items={illustPaged.items}
            onLoadMore={illustPaged.loadMore}
            hasMore={illustPaged.hasMore}
            isLoading={illustPaged.loadingMore}
          />
        )}
      </VStack>
    )
  }

  return (
    <VStack alignment="leading" spacing={10}>
      <BookmarkTags tags={tags} activeTag={activeTag} onTagChange={setActiveTag} />
      {novelPaged.initialLoading ? (
        <LoadingView />
      ) : novelPaged.error && novelPaged.items.length === 0 ? (
        <ErrorView message={novelPaged.error} onRetry={novelPaged.refresh} />
      ) : novelPaged.items.length === 0 ? (
        <EmptyView
          text={
            novelPaged.hasFilteredContent
              ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
              : "暂无公开收藏小说"
          }
          systemImage={novelPaged.hasFilteredContent ? "eye.slash" : "book"}
        />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {novelPaged.items.map((novel, index) => (
            <NovelCard key={novel.id} novel={novel} priority={index} />
          ))}
          <LoadMoreTrigger
            anchor={novelPaged.items[novelPaged.items.length - 1]?.id}
            onLoadMore={novelPaged.loadMore}
            hasMore={novelPaged.hasMore}
            isLoading={novelPaged.loadingMore}
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
