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
  useCallback,
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
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
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
        <LibraryFeed
          key={restrict}
          kind={kind}
          restrict={restrict}
          onRegisterRefresh={(fn) => { refreshHandlerRef.current = fn }}
        />
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



function LibraryFeed(props: {
  kind: LibraryKind
  restrict: Visibility
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, restrict, onRegisterRefresh } = props

  const [illustTags, setIllustTags] = useState<PixivBookmarkTag[]>([])
  const [illustActiveTag, setIllustActiveTag] = useState<string | null>(null)
  const illustGuard = useAsyncGuard()

  const [novelTags, setNovelTags] = useState<PixivBookmarkTag[]>([])
  const [novelActiveTag, setNovelActiveTag] = useState<string | null>(null)
  const novelGuard = useAsyncGuard()

  async function loadIllustTags(curRestrict: Visibility) {
    const userID = session.userID
    if (!userID) return
    const g = illustGuard()
    try {
      const page = await session.call((token) => bookmarkTags(userID, curRestrict, token))
      if (g.isCurrent()) setIllustTags(page.items)
    } catch {
      if (g.isCurrent()) setIllustTags([])
    }
  }

  async function loadNovelTags(curRestrict: Visibility) {
    const userID = session.userID
    if (!userID) return
    const g = novelGuard()
    try {
      const page = await session.call((token) => novelBookmarkTags(curRestrict, token))
      if (g.isCurrent()) setNovelTags(page.items)
    } catch {
      if (g.isCurrent()) setNovelTags([])
    }
  }

  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => {
      const userID = session.userID
      if (!userID) throw new Error("未登录")
      return bookmarks(userID, restrict, illustActiveTag, token)
    },
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrationBookmarks,
    deps: [restrict, illustActiveTag],
    enabled: kind === "illustration",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => {
      const userID = session.userID
      if (!userID) throw new Error("未登录")
      return userNovelBookmarks(userID, restrict, novelActiveTag, token)
    },
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovelBookmarks,
    deps: [restrict, novelActiveTag],
    enabled: kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const illustPagedRef = useLatest(illustPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    return onSettingsChanged(() => {
      illustPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
    })
  }, [])

  useEffect(() => {
    if (kind === "illustration") {
      void loadIllustTags(restrict)
    } else {
      void loadNovelTags(restrict)
    }
  }, [kind, restrict])

  const activeRefresh = useCallback(async () => {
    if (kind === "illustration") {
      await Promise.all([illustPaged.refresh(), loadIllustTags(restrict)])
    } else {
      await Promise.all([novelPaged.refresh(), loadNovelTags(restrict)])
    }
  }, [kind, restrict, illustPaged.refresh, novelPaged.refresh])

  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  if (kind === "illustration") {
    return (
      <VStack alignment="leading" spacing={10}>
        <BookmarkTags tags={illustTags} activeTag={illustActiveTag} onTagChange={setIllustActiveTag} />
        {illustPaged.initialLoading ? (
          <LoadingView />
        ) : illustPaged.error && illustPaged.items.length === 0 ? (
          <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
        ) : illustPaged.items.length === 0 ? (
          <EmptyView text="暂无收藏作品" systemImage="heart" />
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
      <BookmarkTags tags={novelTags} activeTag={novelActiveTag} onTagChange={setNovelActiveTag} />
      {novelPaged.initialLoading ? (
        <LoadingView />
      ) : novelPaged.error && novelPaged.items.length === 0 ? (
        <ErrorView message={novelPaged.error} onRetry={novelPaged.refresh} />
      ) : novelPaged.items.length === 0 ? (
        <EmptyView text="还没有收藏小说" systemImage="book" />
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

export function filterIllustrationBookmarks(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isIllustContentVisible(item, settings, { isBookmarked: true })
  )
}

export function filterNovelBookmarks(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isNovelContentVisible(item, settings, { isBookmarked: true })
  )
}
