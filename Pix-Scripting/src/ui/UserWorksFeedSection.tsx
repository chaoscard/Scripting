import {
  Button,
  Group,
  LazyVStack,
  Picker,
  Text,
  useCallback,
  useEffect,
  VStack,
} from "scripting"
import {
  deleteIllust,
  deleteNovel,
  fetchTagFilteredNovelsByUrl,
  fetchTagFilteredWorksByUrl,
  fetchUserTagFilteredNovels,
  fetchUserTagFilteredWorks,
  nextIllustrations,
  nextNovels,
  userNovels,
  userWorks,
} from "../api/pixiv"
import { session } from "../api/session"
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
  selectedTag?: string | null
  isAuthorFollowed?: boolean
  onKindEmpty?: (kind: UserWorkKind, isEmpty: boolean) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, kind, selectedTag = null, isAuthorFollowed = false, onKindEmpty, onRegisterRefresh } = props
  const isOwn = Boolean(
    userID && session.userID && String(userID) === String(session.userID)
  )

  // 1. 插画
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) =>
      selectedTag
        ? fetchUserTagFilteredWorks(userID, "illust", selectedTag, 0)
        : userWorks(userID, "illust", token),
    more: (nextURL, token) =>
      nextURL.startsWith("web-tag://")
        ? fetchTagFilteredWorksByUrl(nextURL)
        : nextIllustrations(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const exempt =
        settings.exemptFilterForPersonal &&
        (isAuthorFollowed || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isIllustContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
          exemptBlockedUser: true,
        })
      )
    },
    deps: [userID, "illust", isAuthorFollowed, selectedTag],
    enabled: kind === "illust",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 漫画
  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) =>
      selectedTag
        ? fetchUserTagFilteredWorks(userID, "manga", selectedTag, 0)
        : userWorks(userID, "manga", token),
    more: (nextURL, token) =>
      nextURL.startsWith("web-tag://")
        ? fetchTagFilteredWorksByUrl(nextURL)
        : nextIllustrations(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const exempt =
        settings.exemptFilterForPersonal &&
        (isAuthorFollowed || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isIllustContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
          exemptBlockedUser: true,
        })
      )
    },
    deps: [userID, "manga", isAuthorFollowed, selectedTag],
    enabled: kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 3. 小说
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) =>
      selectedTag
        ? fetchUserTagFilteredNovels(userID, selectedTag, 0)
        : userNovels(userID, token),
    more: (nextURL, token) =>
      nextURL.startsWith("web-tag://")
        ? fetchTagFilteredNovelsByUrl(nextURL)
        : nextNovels(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const exempt =
        settings.exemptFilterForPersonal &&
        (isAuthorFollowed || isUserFollowed(userID) === true)
      return items.filter((item) =>
        isNovelContentVisible(item, settings, undefined, {
          exemptRestrictions: exempt,
          exemptBlockedUser: true,
        })
      )
    },
    deps: [userID, isAuthorFollowed, selectedTag],
    enabled: kind === "novel",
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
      void Haptics.transient()
      if (kind === "illust") {
        illustPagedRef.current.removeItem(illust.id)
      } else if (kind === "manga") {
        mangaPagedRef.current.removeItem(illust.id)
      }
    } catch (err: any) {
      void Dialog.alert({
        title: "删除失败",
        message: err?.message ?? "删除作品时发生错误，请重试",
      })
    }
  }, [kind])

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
      void Haptics.transient()
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
              const isManga = illust.type === "manga" || kind === "manga"
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
              : selectedTag
                ? `暂无「${selectedTag}」相关插画`
                : "暂无插画投稿"
          }
          systemImage={
            illustPaged.hasFilteredContent ? "eye.slash" : selectedTag ? "tag" : "photo"
          }
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
              : selectedTag
                ? `暂无「${selectedTag}」相关漫画`
                : "暂无漫画投稿"
          }
          systemImage={
            mangaPaged.hasFilteredContent
              ? "eye.slash"
              : selectedTag
                ? "tag"
                : "photo.on.rectangle"
          }
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
            : selectedTag
              ? `暂无「${selectedTag}」相关小说`
              : "暂无小说投稿"
        }
        systemImage={
          novelPaged.hasFilteredContent ? "eye.slash" : selectedTag ? "tag" : "book"
        }
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

export function UserWorkPicker(props: {
  availableKinds: UserWorkKind[]
  kind: UserWorkKind
  onChanged: (kind: UserWorkKind) => void
}) {
  const { availableKinds, kind, onChanged } = props
  if (availableKinds.length <= 1) return null

  return (
    <Picker
      title="作品类型"
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
