import {
  Button,
  Group,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  Text,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import {
  deleteIllust,
  deleteNovel,
  nextIllustrations,
  nextNovels,
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
import { useExperimentalAmbientPalette, getLastActiveAmbientImageUrl } from "./ambient"
import type { PixivIllustration, PixivNovel } from "../types"
import { triggerHaptic } from "../platform/haptics"
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
import {
  DockSegmentedBar,
  useRegisterBottomAccessory,
} from "./bottomAccessory"

export type WorkTab = "illust" | "manga" | "novel"

export function UserWorksView(props: { userID?: number; title?: string }) {
  const currentUserID = props.userID ?? session.userID ?? null
  const isOwn = Boolean(
    currentUserID && session.userID && String(currentUserID) === String(session.userID)
  )
  const [tab, setTab] = useState<WorkTab>("illust")
  const [visitedTabs, setVisitedTabs] = useState<Set<WorkTab>>(() => new Set([tab]))

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
  }, [tab])

  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(
    () => getLastActiveAmbientImageUrl()
  )
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)
  const refreshHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    return onSettingsChanged(() => {
      const next = loadSettings()
      setHideNovels(next.hideNovels)
      setPageLayout(next.pageLayout)
      if (next.hideNovels && tab === "novel") {
        setTab("illust")
      }
    })
  }, [tab])

  const userWorkItems = useMemo<Array<{ tag: WorkTab; label: string }>>(() => {
    const items: Array<{ tag: WorkTab; label: string }> = [
      { tag: "illust", label: "插画" },
      { tag: "manga", label: "漫画" },
    ]
    if (!hideNovels) {
      items.push({ tag: "novel", label: "小说" })
    }
    return items
  }, [hideNovels])

  useRegisterBottomAccessory(
    "userWorks",
    userWorkItems.length <= 1 ? null : (
      <DockSegmentedBar
        items={userWorkItems}
        value={tab}
        onChanged={setTab}
      />
    ),
    isAppleMusic
  )

  const toolbar = useMemo(() => {
    const baseTitle = props.title ?? (isOwn ? "我的作品" : "作品")
    const isClassic = !isAppleMusic
    const tabName = tab === "illust" ? "插画" : tab === "manga" ? "漫画" : "小说"
    const fullTitle = isClassic ? `${baseTitle} · ${tabName}` : baseTitle

    const principalNode = (
      <Text font="title2" fontWeight="bold">
        {fullTitle}
      </Text>
    )

    const trailingButtons: any[] = []

    if (isClassic) {
      trailingButtons.push(
        <Menu key="more-menu" label={<Image systemName="ellipsis.circle" />}>
          <Picker
            title="作品类型"
            value={tab}
            onChanged={(k: string) => setTab(k as WorkTab)}
          >
            <Label tag="illust" title="插画" systemImage="photo" />
            <Label tag="manga" title="漫画" systemImage="photo.on.rectangle" />
            {!hideNovels && <Label tag="novel" title="小说" systemImage="book" />}
          </Picker>
          {isOwn && (
            <Menu title="投稿" systemImage="square.and.pencil">
              <Button
                title="插画投稿"
                systemImage="photo"
                action={() => {
                  void Safari.present("https://www.pixiv.net/upload.php", false)
                }}
              />
              <Button
                title="漫画投稿"
                systemImage="photo.on.rectangle"
                action={() => {
                  void Safari.present("https://www.pixiv.net/upload.php?uptype=manga", false)
                }}
              />
              <Button
                title="小说投稿"
                systemImage="book"
                action={() => {
                  void Safari.present("https://www.pixiv.net/novel/upload.php", false)
                }}
              />
            </Menu>
          )}
        </Menu>
      )
    } else if (isOwn) {
      trailingButtons.push(
        <Menu key="upload-menu" label={<Image systemName="square.and.pencil" />}>
          <Button
            title="插画投稿"
            systemImage="photo"
            action={() => {
              void Safari.present("https://www.pixiv.net/upload.php", false)
            }}
          />
          <Button
            title="漫画投稿"
            systemImage="photo.on.rectangle"
            action={() => {
              void Safari.present("https://www.pixiv.net/upload.php?uptype=manga", false)
            }}
          />
          <Button
            title="小说投稿"
            systemImage="book"
            action={() => {
              void Safari.present("https://www.pixiv.net/novel/upload.php", false)
            }}
          />
        </Menu>
      )
    }

    return {
      principal: principalNode,
      topBarTrailing: trailingButtons.length > 0 ? trailingButtons : undefined,
    }
  }, [isOwn, isAppleMusic, tab, hideNovels, props.title])

  if (currentUserID == null) {
    return (
      <ZStack
        navigationBarTitleDisplayMode="inline"
        toolbarBackground="clear"
        toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
        toolbar={toolbar}
        background={ambientBackground}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <RefreshableScrollView
          navigationTitle={props.title ?? "作品"}
          navigationBarTitleDisplayMode="inline"
          refreshable={() => Promise.resolve()}
        >
          <EmptyView text="请先登录以查看作品" systemImage="person.crop.circle.badge.exclamationmark" />
        </RefreshableScrollView>
      </ZStack>
    )
  }

  return (
    <ZStack
      navigationBarTitleDisplayMode="inline"
      toolbarBackground="clear"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      toolbar={toolbar}
      background={ambientBackground}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      {/* 1. 插画作品保活容器 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        opacity={tab === "illust" ? 1 : 0}
        zIndex={tab === "illust" ? 1 : 0}
        allowsHitTesting={tab === "illust"}
      >
        <RefreshableScrollView refreshable={() => refreshHandlerRef.current()}>
          <VStack alignment="leading" spacing={8}>
            <UserWorksFeed
              userID={currentUserID}
              tab="illust"
              onFirstImageUrlChange={(url) => {
                if (url && tab === "illust") setAmbientImageUrl(url)
              }}
              onRegisterRefresh={(fn) => {
                if (tab === "illust") refreshHandlerRef.current = fn
              }}
            />
          </VStack>
        </RefreshableScrollView>
      </VStack>

      {/* 2. 漫画作品保活容器 */}
      {visitedTabs.has("manga") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={tab === "manga" ? 1 : 0}
          zIndex={tab === "manga" ? 1 : 0}
          allowsHitTesting={tab === "manga"}
        >
          <RefreshableScrollView refreshable={() => refreshHandlerRef.current()}>
            <VStack alignment="leading" spacing={8}>
              <UserWorksFeed
                userID={currentUserID}
                tab="manga"
                onFirstImageUrlChange={(url) => {
                  if (url && tab === "manga") setAmbientImageUrl(url)
                }}
                onRegisterRefresh={(fn) => {
                  if (tab === "manga") refreshHandlerRef.current = fn
                }}
              />
            </VStack>
          </RefreshableScrollView>
        </VStack>
      ) : null}

      {/* 3. 小说作品保活容器 */}
      {!hideNovels && visitedTabs.has("novel") ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={tab === "novel" ? 1 : 0}
          zIndex={tab === "novel" ? 1 : 0}
          allowsHitTesting={tab === "novel"}
        >
          <RefreshableScrollView refreshable={() => refreshHandlerRef.current()}>
            <VStack alignment="leading" spacing={8}>
              <UserWorksFeed
                userID={currentUserID}
                tab="novel"
                onFirstImageUrlChange={(url) => {
                  if (url && tab === "novel") setAmbientImageUrl(url)
                }}
                onRegisterRefresh={(fn) => {
                  if (tab === "novel") refreshHandlerRef.current = fn
                }}
              />
            </VStack>
          </RefreshableScrollView>
        </VStack>
      ) : null}
    </ZStack>
  )
}



function UserWorksFeed(props: {
  userID: number
  tab: WorkTab
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, tab, onFirstImageUrlChange, onRegisterRefresh } = props
  const [isFollowed, setIsFollowed] = useState(() => isUserFollowed(userID) ?? false)
  const isOwn = Boolean(
    userID && session.userID && String(userID) === String(session.userID)
  )

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
      const exempt =
        settings.exemptFilterForPersonal &&
        (isFollowed || isOwn || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isIllustContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
          exemptBlockedUser: true,
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
      const exempt =
        settings.exemptFilterForPersonal &&
        (isFollowed || isOwn || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isIllustContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
          exemptBlockedUser: true,
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
      const exempt =
        settings.exemptFilterForPersonal &&
        (isFollowed || isOwn || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isNovelContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
          exemptBlockedUser: true,
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

  const handleDeleteIllust = useCallback(async (illust: PixivIllustration) => {
    const title = illust.title?.trim() || "未命名作品"
    const confirmed = await Dialog.confirm({
      title: "删除作品",
      message: `确定要删除作品「${title}」吗？此操作不可撤销。`,
      cancelLabel: "取消",
      confirmLabel: "删除",
    })
    if (!confirmed) return

    try {
      await session.call((token) => deleteIllust(illust.id, token))
      triggerHaptic("medium")
      if (tab === "illust") {
        illustPagedRef.current.removeItem(illust.id)
      } else if (tab === "manga") {
        mangaPagedRef.current.removeItem(illust.id)
      }
    } catch (err: any) {
      void Dialog.alert({
        title: "删除失败",
        message: err?.message ?? "删除作品时发生错误，请重试",
      })
    }
  }, [tab])

  const handleDeleteNovel = useCallback(async (novel: PixivNovel) => {
    const title = novel.title?.trim() || "未命名作品"
    const confirmed = await Dialog.confirm({
      title: "删除作品",
      message: `确定要删除作品「${title}」吗？此操作不可撤销。`,
      cancelLabel: "取消",
      confirmLabel: "删除",
    })
    if (!confirmed) return

    try {
      await session.call((token) => deleteNovel(novel.id, token))
      triggerHaptic("medium")
      novelPagedRef.current.removeItem(novel.id)
    } catch (err: any) {
      void Dialog.alert({
        title: "删除失败",
        message: err?.message ?? "删除作品时发生错误，请重试",
      })
    }
  }, [])

  const illustContextMenuOf = useCallback((illust: PixivIllustration) => {
    if (!isOwn) return undefined
    return {
      override: true,
      menuItems: (
        <Group>
          <Button
            title="分享作品"
            systemImage="square.and.arrow.up"
            action={() => {
              void ShareSheet.present([`https://www.pixiv.net/artworks/${illust.id}`])
            }}
          />
          <Button
            title="编辑作品"
            systemImage="square.and.pencil"
            action={() => {
              const isManga = illust.type === "manga" || tab === "manga"
              const url = isManga
                ? `https://www.pixiv.net/upload.php?mode=mod&id=${illust.id}&uptype=manga`
                : `https://www.pixiv.net/upload.php?mode=mod&id=${illust.id}`
              void Safari.present(url, false)
            }}
          />
          <Button
            title="删除作品"
            systemImage="trash"
            role="destructive"
            action={() => void handleDeleteIllust(illust)}
          />
        </Group>
      ),
    }
  }, [isOwn, handleDeleteIllust])

  const novelContextMenuOf = useCallback((novel: PixivNovel) => {
    if (!isOwn) return undefined
    return {
      menuItems: (
        <Group>
          <Button
            title="分享作品"
            systemImage="square.and.arrow.up"
            action={() => {
              void ShareSheet.present([`https://www.pixiv.net/novel/show.php?id=${novel.id}`])
            }}
          />
          <Button
            title="编辑作品"
            systemImage="square.and.pencil"
            action={() => {
              void Safari.present(
                `https://www.pixiv.net/novel/upload.php?mode=mod&id=${novel.id}`,
                false
              )
            }}
          />
          <Button
            title="删除作品"
            systemImage="trash"
            role="destructive"
            action={() => void handleDeleteNovel(novel)}
          />
        </Group>
      ),
    }
  }, [isOwn, handleDeleteNovel])

  useEffect(() => {
    let url: string | null = null
    if (tab === "illust" && illustPaged.items[0]) {
      url = cardThumbUrlOf(illustPaged.items[0])
    } else if (tab === "manga" && mangaPaged.items[0]) {
      url = cardThumbUrlOf(mangaPaged.items[0])
    } else if (tab === "novel" && novelPaged.items[0]) {
      url = novelThumbUrlOf(novelPaged.items[0])
    }
    if (url) {
      onFirstImageUrlChange?.(url)
    }
  }, [
    tab,
    illustPaged.items[0]?.id,
    mangaPaged.items[0]?.id,
    novelPaged.items[0]?.id,
    onFirstImageUrlChange,
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
          contextMenuOf={illustContextMenuOf}
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
          contextMenuOf={illustContextMenuOf}
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
        <NovelCard
          key={novel.id}
          novel={novel}
          priority={index}
          contextMenu={novelContextMenuOf(novel)}
        />
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
