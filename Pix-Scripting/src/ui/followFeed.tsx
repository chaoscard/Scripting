import {
  Button,
  Device,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  Text,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { useIsCurrentTab } from "./routeNavigation"
import {
  followingFeed,
  followingNovels,
  myPixivFeed,
  myPixivNovels,
  nextIllustrations,
  nextNovels,
  nextWatchlist,
  watchlistManga,
  watchlistNovels,
} from "../api/pixiv"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import { onWatchlistChanged } from "../store/bookmarkSync"
import { recordWorkSeriesAssociation } from "../store/seriesCache"
import { destinationElement } from "./routes"
import { setActiveTabKind } from "./routeNavigation"
import { DockSegmentedBar, useRegisterBottomAccessory } from "./bottomAccessory"
import { useLatest, usePagedList, currentBatchSize, useExperimentalAmbientPalette } from "./hooks"
import type {
  PixivIllustration,
  PixivNovel,
  PixivWatchlistSeries,
} from "../types"
import {
  appToolbar,
  EmptyView,
  ErrorView,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RecommendedUsersSheet,
  RefreshableScrollView,
  WatchlistSeriesCard,
} from "./components"

type FollowMode = "following" | "watchlist" | "friends"
type FollowScope = "all" | "private"
type WorkKind = "illust" | "novel"
type WatchKind = "manga" | "novel"

export function FollowFeedView(props: {
  initialMode?: FollowMode
  onClose: () => void
}) {
  useEffect(() => {
    setActiveTabKind("following")
  }, [])

  const isLaunchTab = useRef(loadSettings().launchPage === "following").current
  const [activated, setActivated] = useState(isLaunchTab)
  const [mode, setMode] = useState<FollowMode>(props.initialMode ?? "following")
  const [scope, setScope] = useState<FollowScope>("all")
  const [followingKind, setFollowingKind] = useState<WorkKind>("illust")
  const [watchKind, setWatchKind] = useState<WatchKind>("manga")
  const [friendKind, setFriendKind] = useState<WorkKind>("illust")
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"
  const [showRecommendedUsers, setShowRecommendedUsers] = useState(false)
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(null)
  const isTabActive = useIsCurrentTab("following")
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl, isTabActive)
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const [visitedModes, setVisitedModes] = useState<Set<FollowMode>>(() => new Set([mode]))
  useEffect(() => {
    setVisitedModes((prev) => {
      if (prev.has(mode)) return prev
      const next = new Set(prev)
      next.add(mode)
      return next
    })
  }, [mode])

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      setHideNovels(nextSettings.hideNovels)
      setPageLayout(nextSettings.pageLayout)
      if (nextSettings.hideNovels) {
        setFollowingKind("illust")
        setWatchKind("manga")
        setFriendKind("illust")
      }
    })
  }, [])

  const segmentedValue =
    mode === "following"
      ? followingKind
      : mode === "watchlist"
        ? watchKind
        : friendKind
  function selectSegmentedKind(value: string) {
    if (mode === "following") setFollowingKind(value as WorkKind)
    else if (mode === "watchlist") setWatchKind(value as WatchKind)
    else setFriendKind(value as WorkKind)
  }

  const followItems = useMemo<Array<{ tag: string; label: string }>>(() => {
    if (mode === "watchlist") {
      return [
        { tag: "manga", label: "漫画" },
        ...(hideNovels ? [] : [{ tag: "novel", label: "小说" }]),
      ]
    }
    return [
      { tag: "illust", label: "插画·漫画" },
      ...(hideNovels ? [] : [{ tag: "novel", label: "小说" }]),
    ]
  }, [mode, hideNovels])

  useRegisterBottomAccessory(
    "following",
    hideNovels || followItems.length <= 1 ? null : (
      <DockSegmentedBar
        items={followItems}
        value={segmentedValue}
        onChanged={selectSegmentedKind}
      />
    ),
    isAppleMusic
  )

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      background={ambientBackground}
      toolbar={followToolbar({
        mode,
        scope,
        followingKind,
        watchKind,
        friendKind,
        hideNovels,
        isAppleMusic,
        onModeChange: setMode,
        onScopeChange: setScope,
        onKindChange: selectSegmentedKind,
        onOpenRecommendedUsers: () => setShowRecommendedUsers(true),
        onClose: props.onClose,
      })}
      onAppear={() => {
        if (!activated) setActivated(true)
      }}
    >
      {/* 1. 关注动态模式保活 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        opacity={mode === "following" ? 1 : 0}
        hidden={mode !== "following"}
        zIndex={mode === "following" ? 1 : 0}
        allowsHitTesting={mode === "following"}
      >
        <FollowingFeed
          enabled={activated && mode === "following"}
          kind={followingKind}
          scope={scope}
          hideNovels={hideNovels}
          isAppleMusic={isAppleMusic}
          onKindChange={setFollowingKind}
          onFirstImageUrlChange={(url) => {
            if (mode === "following") setAmbientImageUrl(url)
          }}
        />
      </VStack>

      {/* 2. 追更列表模式保活 */}
      {visitedModes.has("watchlist") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={mode === "watchlist" ? 1 : 0}
          hidden={mode !== "watchlist"}
          zIndex={mode === "watchlist" ? 1 : 0}
          allowsHitTesting={mode === "watchlist"}
        >
          <WatchlistFeed
            enabled={activated && mode === "watchlist"}
            kind={watchKind}
            hideNovels={hideNovels}
            isAppleMusic={isAppleMusic}
            onKindChange={setWatchKind}
            onFirstImageUrlChange={(url) => {
              if (mode === "watchlist") setAmbientImageUrl(url)
            }}
          />
        </VStack>
      ) : null}

      {/* 3. 好友动态模式保活 */}
      {visitedModes.has("friends") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={mode === "friends" ? 1 : 0}
          hidden={mode !== "friends"}
          zIndex={mode === "friends" ? 1 : 0}
          allowsHitTesting={mode === "friends"}
        >
          <FriendsFeed
            enabled={activated && mode === "friends"}
            kind={friendKind}
            hideNovels={hideNovels}
            isAppleMusic={isAppleMusic}
            onKindChange={setFriendKind}
            onFirstImageUrlChange={(url) => {
              if (mode === "friends") setAmbientImageUrl(url)
            }}
          />
        </VStack>
      ) : null}

      <VStack
        sheet={{
          content: (
            <RecommendedUsersSheet
              onClose={() => setShowRecommendedUsers(false)}
            />
          ),
          isPresented: showRecommendedUsers,
          onChanged: setShowRecommendedUsers,
        }}
      />
    </ZStack>
  )
}

function followToolbar(props: {
  mode: FollowMode
  scope: FollowScope
  followingKind: WorkKind
  watchKind: WatchKind
  friendKind: WorkKind
  hideNovels?: boolean
  isAppleMusic?: boolean
  onModeChange: (mode: FollowMode) => void
  onScopeChange: (scope: FollowScope) => void
  onKindChange: (kind: string) => void
  onOpenRecommendedUsers: () => void
  onClose: () => void
}) {
  const isiPad = Device.isiPad
  const isClassic = !props.isAppleMusic
  const baseTitle =
    props.mode === "following"
      ? "关注"
      : props.mode === "watchlist"
        ? "追更"
        : "好友"

  const currentKind =
    props.mode === "following"
      ? props.followingKind
      : props.mode === "watchlist"
        ? props.watchKind
        : props.friendKind

  const kindLabel =
    currentKind === "illust" ? "插画·漫画" : currentKind === "manga" ? "漫画" : "小说"

  let titleNode: any
  if (isiPad) {
    const promptText =
      props.mode === "friends" ? "好友动态" : `${baseTitle} · ${kindLabel}`
    titleNode = (
      <Text font="headline" fontWeight="bold">
        {promptText}
      </Text>
    )
  } else if (isClassic) {
    titleNode = (
      <Menu
        label={
          <HStack alignment="center" spacing={4}>
            <Text font="title2" fontWeight="bold">
              {baseTitle} · {kindLabel}
            </Text>
            <Image
              systemName="chevron.down.circle.fill"
              font="caption"
              foregroundStyle="secondaryLabel"
            />
          </HStack>
        }
      >
        {props.mode === "watchlist" ? (
          <>
            <Button
              title="漫画"
              systemImage={currentKind === "manga" ? "checkmark" : undefined}
              action={() => props.onKindChange("manga")}
            />
            {!props.hideNovels && (
              <Button
                title="小说"
                systemImage={currentKind === "novel" ? "checkmark" : undefined}
                action={() => props.onKindChange("novel")}
              />
            )}
          </>
        ) : (
          <>
            <Button
              title="插画·漫画"
              systemImage={currentKind === "illust" ? "checkmark" : undefined}
              action={() => props.onKindChange("illust")}
            />
            {!props.hideNovels && (
              <Button
                title="小说"
                systemImage={currentKind === "novel" ? "checkmark" : undefined}
                action={() => props.onKindChange("novel")}
              />
            )}
          </>
        )}
      </Menu>
    )
  } else {
    titleNode = baseTitle
  }

  const trailingMenuLabel = isiPad ? (
    <HStack alignment="center" spacing={4}>
      <Text font="subheadline" fontWeight="semibold">
        {props.mode === "friends" ? "好友动态" : `${baseTitle} · ${kindLabel}`}
      </Text>
      <Image
        systemName="chevron.down"
        font="caption2"
        foregroundStyle="secondaryLabel"
      />
    </HStack>
  ) : (
    <Image systemName="ellipsis.circle" />
  )

  return appToolbar(
    props.onClose,
    titleNode,
    <Menu label={trailingMenuLabel}>
      <Menu title="关注" systemImage="person.2">
        <Button
          title="公开"
          systemImage="globe"
          action={() => {
            props.onModeChange("following")
            props.onScopeChange("all")
          }}
        />
        <Button
          title="私密"
          systemImage="lock"
          action={() => {
            props.onModeChange("following")
            props.onScopeChange("private")
          }}
        />
      </Menu>
      <Button
        title="追更"
        systemImage="bookmark"
        action={() => props.onModeChange("watchlist")}
      />
      <Button
        title="好友"
        systemImage="person.2.badge.gearshape"
        action={() => props.onModeChange("friends")}
      />
      <Button
        title="推荐"
        systemImage="sparkles"
        action={props.onOpenRecommendedUsers}
      />
      {props.mode === "watchlist" ? (
        <Picker
          title="媒体类型"
          value={currentKind}
          onChanged={(v: string) => props.onKindChange(v)}
        >
          <Label tag="manga" title="漫画" systemImage="photo.on.rectangle" />
          {!props.hideNovels && (
            <Label tag="novel" title="小说" systemImage="book" />
          )}
        </Picker>
      ) : props.mode === "following" ? (
        <Picker
          title="媒体类型"
          value={currentKind}
          onChanged={(v: string) => props.onKindChange(v)}
        >
          <Label tag="illust" title="插画·漫画" systemImage="photo" />
          {!props.hideNovels && (
            <Label tag="novel" title="小说" systemImage="book" />
          )}
        </Picker>
      ) : null}
    </Menu>
  )
}

function FollowingFeed(props: {
  enabled?: boolean
  kind: WorkKind
  scope: FollowScope
  hideNovels?: boolean
  isAppleMusic?: boolean
  onKindChange?: (kind: WorkKind) => void
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const {
    enabled = true,
    kind,
    scope,
    hideNovels,
    isAppleMusic,
    onKindChange,
    onFirstImageUrlChange,
  } = props

  const [visitedKinds, setVisitedKinds] = useState<Set<WorkKind>>(() => new Set([kind]))

  useEffect(() => {
    setVisitedKinds((prev) => {
      if (prev.has(kind)) return prev
      const next = new Set(prev)
      next.add(kind)
      return next
    })
  }, [kind])

  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => followingFeed(scope, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterFollowingIllustrationItems,
    deps: ["following", "illust", scope],
    enabled: enabled && visitedKinds.has("illust"),
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => followingNovels(scope, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterFollowingNovelItems,
    deps: ["following", "novel", scope],
    enabled: enabled && visitedKinds.has("novel"),
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const activeRefresh = kind === "illust" ? illustPaged.refresh : novelPaged.refresh
  const illustPagedRef = useLatest(illustPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    if (kind === "illust") {
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

  useEffect(() => {
    return onSettingsChanged(() => {
      illustPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
    })
  }, [])

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 1. 插画·漫画独立容器 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        opacity={kind === "illust" ? 1 : 0}
        hidden={kind !== "illust"}
        zIndex={kind === "illust" ? 1 : 0}
        allowsHitTesting={kind === "illust"}
      >
        <RefreshableScrollView refreshable={illustPaged.refresh}>
          <VStack alignment="leading" spacing={10}>
            {illustPaged.initialLoading ? (
              <LoadingView />
            ) : illustPaged.error && illustPaged.items.length === 0 ? (
              <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
            ) : illustPaged.items.length === 0 ? (
              <EmptyView
                text={
                  illustPaged.hasFilteredContent
                    ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                    : "关注的人还没有新作品"
                }
                systemImage={illustPaged.hasFilteredContent ? "eye.slash" : "person.2"}
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
        </RefreshableScrollView>
      </VStack>

      {/* 2. 小说独立容器 */}
      {visitedKinds.has("novel") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={kind === "novel" ? 1 : 0}
          hidden={kind !== "novel"}
          zIndex={kind === "novel" ? 1 : 0}
          allowsHitTesting={kind === "novel"}
        >
          <RefreshableScrollView refreshable={novelPaged.refresh}>
            <VStack alignment="leading" spacing={10}>
              {novelPaged.initialLoading ? (
                <LoadingView />
              ) : novelPaged.error && novelPaged.items.length === 0 ? (
                <ErrorView message={novelPaged.error} onRetry={novelPaged.refresh} />
              ) : novelPaged.items.length === 0 ? (
                <EmptyView
                  text={
                    novelPaged.hasFilteredContent
                      ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
                      : "关注的人还没有新小说"
                  }
                  systemImage={novelPaged.hasFilteredContent ? "eye.slash" : "book"}
                />
              ) : (
                <NovelFeedItems
                  items={novelPaged.items}
                  onLoadMore={novelPaged.loadMore}
                  hasMore={novelPaged.hasMore}
                  isLoading={novelPaged.loadingMore}
                />
              )}
            </VStack>
          </RefreshableScrollView>
        </VStack>
      ) : null}
    </ZStack>
  )
}

function WatchlistFeed(props: {
  enabled?: boolean
  kind: WatchKind
  hideNovels?: boolean
  isAppleMusic?: boolean
  onKindChange?: (kind: WatchKind) => void
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const {
    enabled = true,
    kind,
    hideNovels,
    isAppleMusic,
    onKindChange,
    onFirstImageUrlChange,
  } = props

  const [visitedKinds, setVisitedKinds] = useState<Set<WatchKind>>(() => new Set([kind]))

  useEffect(() => {
    setVisitedKinds((prev) => {
      if (prev.has(kind)) return prev
      const next = new Set(prev)
      next.add(kind)
      return next
    })
  }, [kind])

  const mangaPaged = usePagedList<PixivWatchlistSeries>({
    first: (token) => watchlistManga(token),
    more: (nextURL, token) => nextWatchlist(nextURL, token),
    filter: filterWatchlistItems,
    deps: ["watchlist", "manga"],
    enabled: enabled && visitedKinds.has("manga"),
    onBatchPublished: (_, pendingItems) => {
      for (const it of pendingItems) {
        if (it.latest_content_id) {
          recordWorkSeriesAssociation(it.latest_content_id, "manga", it.id, it.title, it.published_content_count)
        }
      }
      return prefetch(pendingItems.slice(0, currentBatchSize()).map(watchlistThumbUrlOf)).cancel
    },
  })

  const novelPaged = usePagedList<PixivWatchlistSeries>({
    first: (token) => watchlistNovels(token),
    more: (nextURL, token) => nextWatchlist(nextURL, token),
    filter: filterWatchlistItems,
    deps: ["watchlist", "novel"],
    enabled: enabled && visitedKinds.has("novel"),
    onBatchPublished: (_, pendingItems) => {
      for (const it of pendingItems) {
        if (it.latest_content_id) {
          recordWorkSeriesAssociation(it.latest_content_id, "novel", it.id, it.title, it.published_content_count)
        }
      }
      return prefetch(pendingItems.slice(0, currentBatchSize()).map(watchlistThumbUrlOf)).cancel
    },
  })

  useEffect(() => {
    const currentPaged = kind === "manga" ? mangaPaged : novelPaged
    const first = currentPaged.items[0]
    if (first) {
      onFirstImageUrlChange?.(watchlistThumbUrlOf(first))
    } else if (!currentPaged.initialLoading && currentPaged.items.length === 0) {
      onFirstImageUrlChange?.(null)
    }
  }, [
    kind,
    mangaPaged.items[0]?.id,
    mangaPaged.initialLoading,
    mangaPaged.items.length,
    novelPaged.items[0]?.id,
    novelPaged.initialLoading,
    novelPaged.items.length,
    onFirstImageUrlChange,
  ])

  useEffect(() => {
    return onWatchlistChanged((_, changedKind) => {
      if (changedKind === "manga") {
        mangaPaged.refresh()
      } else if (changedKind === "novel") {
        novelPaged.refresh()
      }
    })
  }, [mangaPaged, novelPaged])

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 1. 漫画追更独立容器 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        opacity={kind === "manga" ? 1 : 0}
        hidden={kind !== "manga"}
        zIndex={kind === "manga" ? 1 : 0}
        allowsHitTesting={kind === "manga"}
      >
        <RefreshableScrollView refreshable={mangaPaged.refresh}>
          <VStack alignment="leading" spacing={10}>
            {mangaPaged.initialLoading ? (
              <LoadingView />
            ) : mangaPaged.error && mangaPaged.items.length === 0 ? (
              <ErrorView message={mangaPaged.error} onRetry={mangaPaged.refresh} />
            ) : mangaPaged.items.length === 0 ? (
              <EmptyView text="暂无追更漫画，下拉刷新试试" systemImage="bookmark" />
            ) : (
              <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
                {mangaPaged.items.map((item, index) => (
                  <WatchlistSeriesCard key={item.id} item={item} kind="manga" priority={index} />
                ))}
                <LoadMoreTrigger
                  anchor={mangaPaged.items[mangaPaged.items.length - 1].id}
                  onLoadMore={mangaPaged.loadMore}
                  hasMore={mangaPaged.hasMore}
                  isLoading={mangaPaged.loadingMore}
                />
              </LazyVStack>
            )}
          </VStack>
        </RefreshableScrollView>
      </VStack>

      {/* 2. 小说追更独立容器 */}
      {visitedKinds.has("novel") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={kind === "novel" ? 1 : 0}
          hidden={kind !== "novel"}
          zIndex={kind === "novel" ? 1 : 0}
          allowsHitTesting={kind === "novel"}
        >
          <RefreshableScrollView refreshable={novelPaged.refresh}>
            <VStack alignment="leading" spacing={10}>
              {novelPaged.initialLoading ? (
                <LoadingView />
              ) : novelPaged.error && novelPaged.items.length === 0 ? (
                <ErrorView message={novelPaged.error} onRetry={novelPaged.refresh} />
              ) : novelPaged.items.length === 0 ? (
                <EmptyView text="暂无追更小说，下拉刷新试试" systemImage="bookmark" />
              ) : (
                <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
                  {novelPaged.items.map((item, index) => (
                    <WatchlistSeriesCard key={item.id} item={item} kind="novel" priority={index} />
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
        </VStack>
      ) : null}
    </ZStack>
  )
}

function FriendsFeed(props: {
  enabled?: boolean
  kind: WorkKind
  hideNovels?: boolean
  isAppleMusic?: boolean
  onKindChange?: (kind: WorkKind) => void
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const {
    enabled = true,
    kind,
    hideNovels,
    isAppleMusic,
    onKindChange,
    onFirstImageUrlChange,
  } = props

  const [visitedKinds, setVisitedKinds] = useState<Set<WorkKind>>(() => new Set([kind]))

  useEffect(() => {
    setVisitedKinds((prev) => {
      if (prev.has(kind)) return prev
      const next = new Set(prev)
      next.add(kind)
      return next
    })
  }, [kind])

  const illustPaged = usePagedList<PixivIllustration>({
    first: myPixivFeed,
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterFollowingIllustrationItems,
    deps: ["friends", "illust"],
    enabled: enabled && visitedKinds.has("illust"),
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const novelPaged = usePagedList<PixivNovel>({
    first: myPixivNovels,
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterFollowingNovelItems,
    deps: ["friends", "novel"],
    enabled: enabled && visitedKinds.has("novel"),
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const activeRefresh = kind === "illust" ? illustPaged.refresh : novelPaged.refresh
  const illustPagedRef = useLatest(illustPaged)
  const novelPagedRef = useLatest(novelPaged)

  useEffect(() => {
    if (kind === "illust") {
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

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 1. 好友插画独立容器 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        opacity={kind === "illust" ? 1 : 0}
        hidden={kind !== "illust"}
        zIndex={kind === "illust" ? 1 : 0}
        allowsHitTesting={kind === "illust"}
      >
        <RefreshableScrollView refreshable={illustPaged.refresh}>
          <VStack alignment="leading" spacing={10}>
            {illustPaged.initialLoading ? (
              <LoadingView />
            ) : illustPaged.error && illustPaged.items.length === 0 ? (
              <ErrorView message={illustPaged.error} onRetry={illustPaged.refresh} />
            ) : illustPaged.items.length === 0 ? (
              <EmptyView
                text={
                  illustPaged.hasFilteredContent
                    ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                    : "好友还没有新作品"
                }
                systemImage={illustPaged.hasFilteredContent ? "eye.slash" : "person.2"}
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
        </RefreshableScrollView>
      </VStack>

      {/* 2. 好友小说独立容器 */}
      {visitedKinds.has("novel") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={kind === "novel" ? 1 : 0}
          hidden={kind !== "novel"}
          zIndex={kind === "novel" ? 1 : 0}
          allowsHitTesting={kind === "novel"}
        >
          <RefreshableScrollView refreshable={novelPaged.refresh}>
            <VStack alignment="leading" spacing={10}>
              {novelPaged.initialLoading ? (
                <LoadingView />
              ) : novelPaged.error && novelPaged.items.length === 0 ? (
                <ErrorView message={novelPaged.error} onRetry={novelPaged.refresh} />
              ) : novelPaged.items.length === 0 ? (
                <EmptyView
                  text={
                    novelPaged.hasFilteredContent
                      ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
                      : "好友还没有新小说"
                  }
                  systemImage={novelPaged.hasFilteredContent ? "eye.slash" : "book"}
                />
              ) : (
                <NovelFeedItems
                  items={novelPaged.items}
                  onLoadMore={novelPaged.loadMore}
                  hasMore={novelPaged.hasMore}
                  isLoading={novelPaged.loadingMore}
                />
              )}
            </VStack>
          </RefreshableScrollView>
        </VStack>
      ) : null}
    </ZStack>
  )
}

function NovelFeedItems(props: {
  items: PixivNovel[]
  onLoadMore: (anchor: number | string) => void
  hasMore: boolean
  isLoading: boolean
}) {
  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
      {props.items.map((novel, index) => (
        <NovelCard key={novel.id} novel={novel} priority={index} />
      ))}
      <LoadMoreTrigger
        anchor={props.items[props.items.length - 1].id}
        onLoadMore={props.onLoadMore}
        hasMore={props.hasMore}
        isLoading={props.isLoading}
      />
    </LazyVStack>
  )
}

function filterFollowingIllustrationItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isIllustContentVisible(item, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
    })
  )
}

function filterFollowingNovelItems(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((novel) =>
    isNovelContentVisible(novel, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
    })
  )
}

function filterWatchlistItems(
  items: PixivWatchlistSeries[]
): PixivWatchlistSeries[] {
  return items.filter((item) => !item.mask_text)
}

function watchlistThumbUrlOf(item: PixivWatchlistSeries): string | null {
  return item.url ?? null
}
