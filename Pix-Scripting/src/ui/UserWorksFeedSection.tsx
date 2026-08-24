import {
  LazyVStack,
  Picker,
  Text,
  useEffect,
  VStack,
} from "scripting"
import {
  nextIllustrations,
  nextNovels,
  userNovels,
  userWorks,
} from "../api/pixiv"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import { loadSettings, onSettingsChanged } from "../store/settings"
import { isIllustContentVisible, isNovelContentVisible } from "../store/contentFilter"
import { isUserFollowed, onUserFollowChanged } from "../store/userFollow"
import { currentBatchSize, useLatest, usePagedList } from "./hooks"
import {
  EmptyView,
  ErrorView,
  FilteredContentNotice,
  IllustFlowFeed,
  LoadingView,
  LoadMoreTrigger,
  NovelCard,
} from "./components"
import type { PixivIllustration, PixivNovel } from "../types"

export type UserWorkKind = "illust" | "manga" | "novel"

export function UserWorksFeedSection(props: {
  userID: number
  kind: "illust" | "manga" | "novel"
  isAuthorFollowed?: boolean
  onKindEmpty?: (kind: UserWorkKind, isEmpty: boolean) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, kind, isAuthorFollowed = false, onKindEmpty, onRegisterRefresh } = props

  // 1. 插画
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(userID, "illust", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const exempt =
        settings.exemptFilterForPersonal &&
        (isAuthorFollowed || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isIllustContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
        })
      )
    },
    deps: [userID, "illust", isAuthorFollowed],
    enabled: kind === "illust",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 漫画
  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(userID, "manga", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const exempt =
        settings.exemptFilterForPersonal &&
        (isAuthorFollowed || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isIllustContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
        })
      )
    },
    deps: [userID, "manga", isAuthorFollowed],
    enabled: kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 小说
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => userNovels(userID, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const exempt =
        settings.exemptFilterForPersonal &&
        (isAuthorFollowed || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isNovelContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
        })
      )
    },
    deps: [userID, isAuthorFollowed],
    enabled: kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const illustPagedRef = useLatest(illustPaged)
  const mangaPagedRef = useLatest(mangaPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    const handleFollow = (changedUserID: number) => {
      if (changedUserID === userID) {
        illustPagedRef.current.reapplyFilter()
        mangaPagedRef.current.reapplyFilter()
        novelPagedRef.current.reapplyFilter()
      }
    }
    const handleSettings = () => {
      illustPagedRef.current.reapplyFilter()
      mangaPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
    }
    const unsubFollow = onUserFollowChanged(handleFollow)
    const unsubSettings = onSettingsChanged(handleSettings)
    return () => {
      unsubFollow()
      unsubSettings()
    }
  }, [userID])

  useEffect(() => {
    if (
      kind === "illust" &&
      illustPaged.hasLoaded &&
      !illustPaged.initialLoading &&
      !illustPaged.loadingMore &&
      !illustPaged.error
    ) {
      onKindEmpty?.("illust", illustPaged.items.length === 0 && !illustPaged.hasFilteredContent)
    }
  }, [
    kind,
    illustPaged.hasLoaded,
    illustPaged.initialLoading,
    illustPaged.loadingMore,
    illustPaged.error,
    illustPaged.items.length,
    illustPaged.hasFilteredContent,
    onKindEmpty,
  ])

  useEffect(() => {
    if (
      kind === "manga" &&
      mangaPaged.hasLoaded &&
      !mangaPaged.initialLoading &&
      !mangaPaged.loadingMore &&
      !mangaPaged.error
    ) {
      onKindEmpty?.("manga", mangaPaged.items.length === 0 && !mangaPaged.hasFilteredContent)
    }
  }, [
    kind,
    mangaPaged.hasLoaded,
    mangaPaged.initialLoading,
    mangaPaged.loadingMore,
    mangaPaged.error,
    mangaPaged.items.length,
    mangaPaged.hasFilteredContent,
    onKindEmpty,
  ])

  useEffect(() => {
    if (
      kind === "novel" &&
      novelPaged.hasLoaded &&
      !novelPaged.initialLoading &&
      !novelPaged.loadingMore &&
      !novelPaged.error
    ) {
      onKindEmpty?.("novel", novelPaged.items.length === 0 && !novelPaged.hasFilteredContent)
    }
  }, [
    kind,
    novelPaged.hasLoaded,
    novelPaged.initialLoading,
    novelPaged.loadingMore,
    novelPaged.error,
    novelPaged.items.length,
    novelPaged.hasFilteredContent,
    onKindEmpty,
  ])

  useEffect(() => {
    return onSettingsChanged(() => {
      illustPagedRef.current.refresh()
      mangaPagedRef.current.refresh()
      novelPagedRef.current.refresh()
    })
  }, [])

  useEffect(() => {
    return onUserFollowChanged((changedUserID) => {
      if (changedUserID === userID) {
        illustPagedRef.current.refresh()
        mangaPagedRef.current.refresh()
        novelPagedRef.current.refresh()
      }
    })
  }, [userID])

  const activeRefresh =
    kind === "illust"
      ? illustPaged.refresh
      : kind === "manga"
        ? mangaPaged.refresh
        : novelPaged.refresh

  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  if (kind === "illust") {
    if (illustPaged.initialLoading) return <LoadingView />
    if (illustPaged.error && illustPaged.items.length === 0) {
      return <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
    }
    if (illustPaged.items.length === 0) {
      return (
        <EmptyView
          text={
            illustPaged.hasFilteredContent
              ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
              : "暂无插画投稿"
          }
          systemImage={illustPaged.hasFilteredContent ? "eye.slash" : "photo"}
        />
      )
    }
    return (
      <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
        {illustPaged.hasFilteredContent ? <FilteredContentNotice isNovel={false} /> : null}
        <IllustFlowFeed
          items={illustPaged.items}
          onLoadMore={illustPaged.loadMore}
          hasMore={illustPaged.hasMore}
          isLoading={illustPaged.loadingMore}
        />
      </VStack>
    )
  }

  if (kind === "manga") {
    if (mangaPaged.initialLoading) return <LoadingView />
    if (mangaPaged.error && mangaPaged.items.length === 0) {
      return <ErrorView message={mangaPaged.error} onRetry={mangaPaged.refresh} />
    }
    if (mangaPaged.items.length === 0) {
      return (
        <EmptyView
          text={
            mangaPaged.hasFilteredContent
              ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
              : "暂无漫画投稿"
          }
          systemImage={mangaPaged.hasFilteredContent ? "eye.slash" : "photo.on.rectangle"}
        />
      )
    }
    return (
      <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
        {mangaPaged.hasFilteredContent ? <FilteredContentNotice isNovel={false} /> : null}
        <IllustFlowFeed
          items={mangaPaged.items}
          onLoadMore={mangaPaged.loadMore}
          hasMore={mangaPaged.hasMore}
          isLoading={mangaPaged.loadingMore}
        />
      </VStack>
    )
  }

  if (novelPaged.initialLoading) return <LoadingView />
  if (novelPaged.error && novelPaged.items.length === 0) {
    return <ErrorView message={novelPaged.error} onRetry={novelPaged.refresh} />
  }
  if (novelPaged.items.length === 0) {
    return (
      <EmptyView
        text={
          novelPaged.hasFilteredContent
            ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
            : "暂无小说投稿"
        }
        systemImage={novelPaged.hasFilteredContent ? "eye.slash" : "book"}
      />
    )
  }
  return (
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
  )
}


export function UserWorkPicker(props: {
  availableKinds: UserWorkKind[]
  kind: UserWorkKind
  onChanged: (kind: UserWorkKind) => void
}) {
  const { availableKinds, kind, onChanged } = props
  if (availableKinds.length <= 1) return null

  return (
    <Picker
      title="投稿类型"
      value={kind}
      onChanged={(value: string) => onChanged(value as UserWorkKind)}
      pickerStyle="segmented"
      padding={{ horizontal: 14 }}
    >
      {availableKinds.map((k) => (
        <Text key={k} tag={k}>
          {k === "illust" ? "插画" : k === "manga" ? "漫画" : "小说"}
        </Text>
      ))}
    </Picker>
  )
}
