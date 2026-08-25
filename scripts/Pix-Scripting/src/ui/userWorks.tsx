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
  nextIllustrations,
  nextNovels,
  userDetail,
  userNovels,
  userWorks,
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
import { isUserFollowed, onUserFollowChanged } from "../store/userFollow"
import { useAsyncGuard, useLatest, usePagedList, currentBatchSize } from "./hooks"
import type { PixivIllustration, PixivNovel, PixivUserDetail } from "../types"
import {
  EmptyView,
  ErrorView,
  FilteredContentNotice,
  IllustFlowFeed,
  LoadingView,
  LoadMoreTrigger,
  NovelCard,
  RefreshableScrollView,
} from "./components"

export type WorkTab = "illust" | "manga" | "novel"

export function UserWorksView(props: { userID?: number; title?: string }) {
  const currentUserID = props.userID ?? session.userID ?? null
  const [detail, setDetail] = useState<PixivUserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [tab, setTab] = useState<WorkTab>("illust")
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [emptyKinds, setEmptyKinds] = useState<Partial<Record<WorkTab, boolean>>>({})
  const guard = useAsyncGuard()
  const worksRefreshRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    return onSettingsChanged(() => {
      setHideNovels(loadSettings().hideNovels)
      setEmptyKinds({})
    })
  }, [])

  const loadDetail = useCallback(async () => {
    if (currentUserID == null) return
    const g = guard()
    setDetailError(null)
    try {
      const result = await session.call((token) => userDetail(currentUserID, token))
      if (!g.isCurrent()) return
      setDetail(result)
    } catch (e) {
      if (!g.isCurrent()) return
      setDetailError(e instanceof Error ? e.message : "获取用户信息失败")
    } finally {
      if (g.isCurrent()) setDetailLoading(false)
    }
  }, [currentUserID, guard])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  const baseKinds = useMemo<WorkTab[]>(() => {
    if (!detail) return []
    const kinds: WorkTab[] = []
    if ((detail.profile.total_illusts ?? 0) > 0) kinds.push("illust")
    if ((detail.profile.total_manga ?? 0) > 0) kinds.push("manga")
    if (!hideNovels && (detail.profile.total_novels ?? 0) > 0) kinds.push("novel")
    return kinds
  }, [
    detail?.profile.total_illusts,
    detail?.profile.total_manga,
    detail?.profile.total_novels,
    hideNovels,
  ])

  const availableKinds = useMemo<WorkTab[]>(() => {
    return baseKinds.filter((k) => !emptyKinds[k])
  }, [baseKinds, emptyKinds])

  const activeTab: WorkTab = useMemo(() => {
    if (availableKinds.length === 0) return baseKinds[0] ?? "illust"
    if (availableKinds.includes(tab)) return tab
    return availableKinds[0]
  }, [availableKinds, baseKinds, tab])

  useEffect(() => {
    if (availableKinds.length > 0 && !availableKinds.includes(tab)) {
      setTab(availableKinds[0])
    }
  }, [availableKinds, tab])

  const handleKindEmpty = useCallback((targetKind: WorkTab, isEmpty: boolean) => {
    setEmptyKinds((prev) => {
      if (prev[targetKind] === isEmpty) return prev
      return { ...prev, [targetKind]: isEmpty }
    })
  }, [])

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

  if (detailLoading && !detail) {
    return (
      <RefreshableScrollView
        navigationTitle={props.title ?? "作品"}
        navigationBarTitleDisplayMode="inline"
        refreshable={loadDetail}
      >
        <LoadingView />
      </RefreshableScrollView>
    )
  }

  if (detailError && !detail) {
    return (
      <RefreshableScrollView
        navigationTitle={props.title ?? "作品"}
        navigationBarTitleDisplayMode="inline"
        refreshable={loadDetail}
      >
        <ErrorView message={detailError} onRetry={loadDetail} />
      </RefreshableScrollView>
    )
  }

  return (
    <RefreshableScrollView
      navigationTitle={props.title ?? "作品"}
      navigationBarTitleDisplayMode="inline"
      refreshable={async () => {
        await Promise.all([loadDetail(), worksRefreshRef.current()])
      }}
    >
      <VStack alignment="leading" spacing={8}>
        <UserWorkPicker
          availableKinds={availableKinds}
          kind={activeTab}
          onChanged={setTab}
        />

        {availableKinds.length === 0 ? (
          <EmptyView text="暂无作品投稿" systemImage="photo.on.rectangle.angled" />
        ) : (
          <UserWorksFeed
            userID={currentUserID}
            tab={activeTab}
            onKindEmpty={handleKindEmpty}
            onRegisterRefresh={(fn) => {
              worksRefreshRef.current = fn
            }}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function UserWorkPicker(props: {
  availableKinds: WorkTab[]
  kind: WorkTab
  onChanged: (kind: WorkTab) => void
}) {
  const { availableKinds, kind, onChanged } = props
  if (availableKinds.length <= 1) return null

  return (
    <Picker
      title="作品类型"
      value={kind}
      onChanged={(value: string) => onChanged(value as WorkTab)}
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

function UserWorksFeed(props: {
  userID: number
  tab: WorkTab
  onKindEmpty?: (kind: WorkTab, isEmpty: boolean) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, tab, onKindEmpty, onRegisterRefresh } = props
  const [isFollowed, setIsFollowed] = useState(() => isUserFollowed(userID) ?? false)

  useEffect(() => {
    return onUserFollowChanged((changedUserID, followed) => {
      if (changedUserID === userID) {
        setIsFollowed(followed)
      }
    })
  }, [userID])

  // 1. 插画
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(userID, "illust", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const isOwn = userID === session.userID
      const exempt =
        settings.exemptFilterForPersonal &&
        (isFollowed || isOwn || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isIllustContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
        })
      )
    },
    deps: [userID, "illust", isFollowed],
    enabled: tab === "illust",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 漫画
  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(userID, "manga", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const isOwn = userID === session.userID
      const exempt =
        settings.exemptFilterForPersonal &&
        (isFollowed || isOwn || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isIllustContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
        })
      )
    },
    deps: [userID, "manga", isFollowed],
    enabled: tab === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 小说
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => userNovels(userID, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const isOwn = userID === session.userID
      const exempt =
        settings.exemptFilterForPersonal &&
        (isFollowed || isOwn || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isNovelContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
        })
      )
    },
    deps: [userID, isFollowed],
    enabled: tab === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const illustPagedRef = useLatest(illustPaged)
  const mangaPagedRef = useLatest(mangaPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    if (
      tab === "illust" &&
      illustPaged.hasLoaded &&
      !illustPaged.initialLoading &&
      !illustPaged.loadingMore &&
      !illustPaged.error
    ) {
      onKindEmpty?.("illust", illustPaged.items.length === 0 && !illustPaged.hasFilteredContent)
    }
  }, [
    tab,
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
      tab === "manga" &&
      mangaPaged.hasLoaded &&
      !mangaPaged.initialLoading &&
      !mangaPaged.loadingMore &&
      !mangaPaged.error
    ) {
      onKindEmpty?.("manga", mangaPaged.items.length === 0 && !mangaPaged.hasFilteredContent)
    }
  }, [
    tab,
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
      tab === "novel" &&
      novelPaged.hasLoaded &&
      !novelPaged.initialLoading &&
      !novelPaged.loadingMore &&
      !novelPaged.error
    ) {
      onKindEmpty?.("novel", novelPaged.items.length === 0 && !novelPaged.hasFilteredContent)
    }
  }, [
    tab,
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
      illustPagedRef.current.reapplyFilter()
      mangaPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
    })
  }, [])

  useEffect(() => {
    illustPagedRef.current.reapplyFilter()
    mangaPagedRef.current.reapplyFilter()
    novelPagedRef.current.reapplyFilter()
  }, [isFollowed])

  const activeRefresh =
    tab === "illust"
      ? illustPaged.refresh
      : tab === "manga"
        ? mangaPaged.refresh
        : novelPaged.refresh

  useEffect(() => {
    onRegisterRefresh?.(activeRefresh)
  }, [activeRefresh, onRegisterRefresh])

  if (tab === "illust") {
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

  if (tab === "manga") {
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
