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
import {
  getCachedIllustBookmark,
  getCachedNovelBookmark,
} from "../store/bookmarkSync"
import { useAsyncGuard, useLatest, usePagedList, currentBatchSize, useExperimentalAmbientPalette } from "./hooks"
import type { PixivBookmarkTag, PixivIllustration, PixivNovel } from "../types"
import {
  EmptyView,
  ErrorView,
  FilteredContentNotice,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"
import { requestPixivRoute } from "./routeNavigation"

type Visibility = "public" | "private"
type LibraryKind = "illustration" | "novel"

const MAX_TAG_CHIPS = 20

export function LibraryView() {
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [kind, setKind] = useState<LibraryKind>("illustration")
  const [restrict, setRestrict] = useState<Visibility>("public")
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(null)
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    return onSettingsChanged(() => {
      const next = loadSettings().hideNovels
      setHideNovels(next)
      if (next && kind === "novel") {
        setKind("illustration")
      }
    })
  }, [kind])

  return (
    <RefreshableScrollView
      navigationTitle="我的收藏"
      navigationBarTitleDisplayMode="inline"
      toolbar={libraryToolbar({ restrict, onRestrictChange: setRestrict })}
      background={ambientBackground}
      refreshable={() => refreshHandlerRef.current()}
    >
      <VStack alignment="leading" spacing={8}>
        {hideNovels ? null : (
          <LibraryKindPicker kind={kind} onKindChange={setKind} />
        )}
        <LibraryFeed
          key={restrict}
          kind={kind}
          restrict={restrict}
          onFirstImageUrlChange={setAmbientImageUrl}
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
        <Button
          title="特辑收藏"
          systemImage="rectangle.stack"
          action={() => {
            requestPixivRoute("pixivisionBookmarks")
          }}
        />
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
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { kind, restrict, onFirstImageUrlChange, onRegisterRefresh } = props

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
          <EmptyView
            text={
              illustPaged.hasFilteredContent
                ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                : "暂无收藏作品"
            }
            systemImage={illustPaged.hasFilteredContent ? "eye.slash" : "heart"}
          />
        ) : (
          <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
            {illustPaged.hasFilteredContent ? <FilteredContentNotice isNovel={false} /> : null}
            <IllustFlowFeed
              items={illustPaged.items}
              onLoadMore={illustPaged.loadMore}
              hasMore={illustPaged.hasMore}
              isLoading={illustPaged.loadingMore}
            />
          </VStack>
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
        <EmptyView
          text={
            novelPaged.hasFilteredContent
              ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
              : "还没有收藏小说"
          }
          systemImage={novelPaged.hasFilteredContent ? "eye.slash" : "book"}
        />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {novelPaged.hasFilteredContent ? <FilteredContentNotice isNovel={true} /> : null}
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
  return items.filter((item) => {
    if (getCachedIllustBookmark(item.id) === false) return false
    return isIllustContentVisible(item, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
    })
  })
}

export function filterNovelBookmarks(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) => {
    if (getCachedNovelBookmark(item.id) === false) return false
    return isNovelContentVisible(item, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
    })
  })
}
