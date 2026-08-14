import {
  LazyVStack,
  Picker,
  Text,
  useEffect,
  useState,
  VStack,
  ZStack,
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
import { useLatest, usePagedList } from "./hooks"
import type { PixivIllustration, PixivNovel } from "../types"
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
  MasonryIllustFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

type BookmarkKind = "illustration" | "novel"

export function UserBookmarksView(props: { userID: number }) {
  const [kind, setKind] = useState<BookmarkKind>("illustration")
  const [tags, setTags] = useState<{ name: string; count: number }[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => userBookmarks(props.userID, "public", token, activeTag),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrationBookmarks,
    deps: [props.userID, activeTag],
    enabled: kind === "illustration",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => userNovelBookmarks(props.userID, "public", null, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelBookmarks,
    deps: [props.userID],
    enabled: kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel,
  })
  const illustRef = useLatest(illustPaged)
  const novelRef = useLatest(novelPaged)
  const kindRef = useLatest(kind)

  async function loadTags() {
    try {
      const page = await session.call((token) =>
        bookmarkTags(props.userID, "public", token)
      )
      setTags(page.items)
    } catch {
      setTags([])
    }
  }

  useEffect(() => {
    if (kind === "illustration") void loadTags()
  }, [kind, props.userID])

  useEffect(() => {
    return onSettingsChanged(() => {
      illustRef.current.reapplyFilter()
      novelRef.current.reapplyFilter()
      if (kindRef.current === "illustration") {
        illustRef.current.refresh()
      } else {
        novelRef.current.refresh()
      }
    })
  }, [])

  return (
    <VStack
      alignment="leading"
      spacing={8}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      navigationTitle="收藏"
      navigationBarTitleDisplayMode="inline"
    >
      <BookmarkKindPicker kind={kind} onChanged={setKind} />
      <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <RefreshableScrollView
          hidden={kind !== "illustration"}
          navigationBarTitleDisplayMode="inline"
          refreshable={async () => {
            await Promise.all([illustPaged.refresh(), loadTags()])
          }}
        >
          <VStack alignment="leading" spacing={10} padding={{ top: 4 }}>
          <BookmarkTags tags={tags} activeTag={activeTag} onTagChange={setActiveTag} />
          {illustPaged.initialLoading ? (
            <LoadingView />
          ) : illustPaged.error && illustPaged.items.length === 0 ? (
            <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
          ) : illustPaged.items.length === 0 ? (
            <EmptyView text="暂无公开收藏作品" systemImage="heart" />
          ) : (
            <MasonryIllustFeed
              items={illustPaged.items}
              onLoadMore={illustPaged.loadMore}
              hasMore={illustPaged.hasMore}
              isLoading={illustPaged.loadingMore}
            />
          )}
          </VStack>
        </RefreshableScrollView>

        <RefreshableScrollView
        hidden={kind !== "novel"}
        navigationBarTitleDisplayMode="inline"
        refreshable={novelPaged.refresh}
      >
        <VStack alignment="leading" spacing={10} padding={{ top: 4 }}>
          {novelPaged.initialLoading ? (
            <LoadingView />
          ) : novelPaged.error && novelPaged.items.length === 0 ? (
            <ErrorView message={novelPaged.error} onRetry={novelPaged.refresh} />
          ) : novelPaged.items.length === 0 ? (
            <EmptyView text="暂无公开收藏小说" systemImage="book" />
          ) : (
            <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
              {novelPaged.items.map((novel) => (
                <NovelCard key={novel.id} novel={novel} />
              ))}
              <LoadMoreTrigger
                anchor={novelPaged.items[novelPaged.items.length - 1].id}
                onLoadMore={novelPaged.loadMore}
                hasMore={novelPaged.hasMore}
                isLoading={novelPaged.loadingMore}
              />
            </LazyVStack>
          )}
        </VStack>
        </RefreshableScrollView>
      </ZStack>
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
