import {
  Button,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  ScrollView,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  bookmarkTags,
  bookmarks,
  nextIllustrations,
  nextNovels,
  novelBookmarkTags,
  userNovelBookmarks,
} from "../api/pixiv"
import { session } from "../api/session"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  isIllustContentVisible,
  isNovelContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { useAsyncGuard, useLatest, usePagedList, currentBatchSize } from "./hooks"
import type { PixivBookmarkTag, PixivIllustration, PixivNovel } from "../types"
import {
  EmptyView,
  ErrorView,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

type Visibility = "public" | "private"
type LibraryKind = "illustration" | "novel"

const MAX_TAG_CHIPS = 20

export function LibraryView() {
  const [kind, setKind] = useState<LibraryKind>("illustration")
  const [restrict, setRestrict] = useState<Visibility>("public")
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  return (
    <RefreshableScrollView
      navigationBarTitleDisplayMode="inline"
      toolbar={libraryToolbar({ restrict, onRestrictChange: setRestrict })}
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack alignment="leading" spacing={8}>
        <LibraryKindPicker kind={kind} onKindChange={setKind} />
        {kind === "illustration" ? (
          <IllustrationLibraryFeed
            key={`illustration:${restrict}`}
            restrict={restrict}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        ) : (
          <NovelLibraryFeed
            key={`novel:${restrict}`}
            restrict={restrict}
            onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function libraryToolbar(props: {
  restrict: Visibility
  onRestrictChange: (restrict: Visibility) => void
}) {
  return {
    principal: [
      <Text font="title2" fontWeight="bold">
        我的收藏
      </Text>,
    ],
    topBarTrailing: [
      <Menu label={<Image systemName="ellipsis.circle" />}>
        <Picker
          title="收藏范围"
          value={props.restrict}
          onChanged={(value: string) => props.onRestrictChange(value as Visibility)}
        >
          <Label tag="public" title="公开收藏" systemImage="globe" />
          <Label tag="private" title="私密收藏" systemImage="lock" />
        </Picker>
      </Menu>,
    ],
  }
}

function LibraryKindPicker(props: {
  kind: LibraryKind
  onKindChange: (kind: LibraryKind) => void
}) {
  return (
    <Picker
      title="收藏类型"
      value={props.kind}
      onChanged={(value: string) => props.onKindChange(value as LibraryKind)}
      pickerStyle="segmented"
      padding={{ horizontal: 14 }}
    >
      <Text tag="illustration">插画·漫画</Text>
      <Text tag="novel">小说</Text>
    </Picker>
  )
}

export function BookmarkTags(props: {
  tags: PixivBookmarkTag[]
  activeTag: string | null
  onTagChange: (tag: string | null) => void
}) {
  if (props.tags.length === 0) return null
  return (
    <ScrollView axes="horizontal">
      <HStack spacing={8} padding={{ horizontal: 14 }}>
        {props.activeTag ? (
          <Button
            title={`✕ ${props.activeTag}`}
            buttonStyle="glass"
            controlSize="small"
            action={() => props.onTagChange(null)}
          />
        ) : null}
        {props.tags.slice(0, MAX_TAG_CHIPS).map((tag) => (
          <Button
            key={tag.name}
            title={`${tag.name} (${tag.count})`}
            buttonStyle={props.activeTag === tag.name ? "glassProminent" : "glass"}
            tint={props.activeTag === tag.name ? "#0096FA" : undefined}
            controlSize="small"
            action={() => props.onTagChange(tag.name)}
          />
        ))}
      </HStack>
    </ScrollView>
  )
}

function IllustrationLibraryFeed(props: {
  restrict: Visibility
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const [tags, setTags] = useState<PixivBookmarkTag[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const guard = useAsyncGuard()

  async function loadTags() {
    const userID = session.userID
    if (!userID) return
    const g = guard()
    try {
      const page = await session.call((token) => bookmarkTags(userID, props.restrict, token))
      if (g.isCurrent()) setTags(page.items)
    } catch {
      if (g.isCurrent()) setTags([])
    }
  }

  const paged = usePagedList<PixivIllustration>({
    first: (token) => {
      const userID = session.userID
      if (!userID) throw new Error("未登录")
      return bookmarks(userID, props.restrict, activeTag, token)
    },
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrationBookmarks,
    deps: [props.restrict, activeTag],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  useEffect(() => {
    props.onRegisterRefresh?.(async () => {
      await Promise.all([paged.refresh(), loadTags()])
    })
  }, [paged.refresh, props.onRegisterRefresh])

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])
  useEffect(() => {
    loadTags()
    pagedRef.current.reapplyFilter()
  }, [props.restrict])

  return (
    <VStack alignment="leading" spacing={10}>
      <BookmarkTags tags={tags} activeTag={activeTag} onTagChange={setActiveTag} />
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无收藏作品" systemImage="heart" />
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

function NovelLibraryFeed(props: {
  restrict: Visibility
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const [tags, setTags] = useState<PixivBookmarkTag[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const guard = useAsyncGuard()

  async function loadTags() {
    const g = guard()
    try {
      const page = await session.call((token) => novelBookmarkTags(props.restrict, token))
      if (g.isCurrent()) setTags(page.items)
    } catch {
      if (g.isCurrent()) setTags([])
    }
  }

  const paged = usePagedList<PixivNovel>({
    first: (token) => {
      const userID = session.userID
      if (!userID) throw new Error("未登录")
      return userNovelBookmarks(userID, props.restrict, activeTag, token)
    },
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelBookmarks,
    deps: [props.restrict, activeTag],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  useEffect(() => {
    props.onRegisterRefresh?.(async () => {
      await Promise.all([paged.refresh(), loadTags()])
    })
  }, [paged.refresh, props.onRegisterRefresh])

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])
  useEffect(() => {
    loadTags()
    pagedRef.current.reapplyFilter()
  }, [props.restrict])

  return (
    <VStack alignment="leading" spacing={10}>
      <BookmarkTags tags={tags} activeTag={activeTag} onTagChange={setActiveTag} />
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="还没有收藏小说" systemImage="book" />
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

export function filterIllustrationBookmarks(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isIllustContentVisible(item, settings, settings.libraryFilterExempt)
  )
}

export function filterNovelBookmarks(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isNovelContentVisible(item, settings, settings.libraryFilterExempt)
  )
}
