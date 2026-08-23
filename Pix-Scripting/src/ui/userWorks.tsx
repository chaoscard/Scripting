import {
  Button,
  HStack,
  Image,
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
  downloadAuthorIllustrationsToAlbum,
  exportAuthorIllustrationsToZip,
  exportAuthorManga,
  exportAuthorNovels,
  fetchAllUserIllustrations,
  fetchAllUserNovels,
} from "../downloader"
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

  const [downloading, setDownloading] = useState(false)
  const [downloadStatusText, setDownloadStatusText] = useState("")

  const handleDownloadClick = async () => {
    if (!detail || currentUserID == null) return
    if (downloading) {
      void Dialog.alert({
        title: "下载正在进行中",
        message: "当前已有批量下载任务正在执行，请稍候完成。",
      })
      return
    }

    const totalIllusts = detail.profile.total_illusts ?? 0
    const totalManga = detail.profile.total_manga ?? 0
    const totalNovels = hideNovels ? 0 : (detail.profile.total_novels ?? 0)

    if (totalIllusts === 0 && totalManga === 0 && totalNovels === 0) {
      void Dialog.alert({
        title: "提示",
        message: "该创作者暂无作品投稿。",
      })
      return
    }

    const categories: { key: "illust" | "manga" | "novel"; label: string }[] = []
    if (totalIllusts > 0) {
      categories.push({ key: "illust", label: `下载全部插画 (${totalIllusts} 部)` })
    }
    if (totalManga > 0) {
      categories.push({ key: "manga", label: `下载全部漫画 (${totalManga} 部)` })
    }
    if (totalNovels > 0) {
      categories.push({ key: "novel", label: `下载全部小说 (${totalNovels} 部)` })
    }

    let selectedCatKey: "illust" | "manga" | "novel" = categories[0].key

    if (categories.length > 1) {
      const choice = await Dialog.actionSheet({
        title: "下载创作者作品",
        message: `用户：${detail.user.name}`,
        actions: categories.map((c) => ({ label: c.label })),
      })
      if (choice == null || choice < 0 || choice >= categories.length) {
        return
      }
      selectedCatKey = categories[choice].key
    }

    if (selectedCatKey === "illust") {
      const choice = await Dialog.actionSheet({
        title: "插画下载方式",
        message: `共 ${totalIllusts} 部插画作品`,
        actions: [
          { label: "下载至相簿" },
          { label: "打包为 ZIP 归档" },
        ],
      })
      if (choice !== 0 && choice !== 1) return

      if (choice === 0) {
        const albumName = loadSettings().downloadPhotoAlbumName || "Pix-Scripting"
        const confirmed = await Dialog.confirm({
          title: "确认下载全部插画？",
          message: `将拉取用户「${detail.user.name}」全部插画并保存至专属相簿「${albumName}」。`,
          confirmLabel: "开始下载",
          cancelLabel: "取消",
        })
        if (!confirmed) return

        setDownloading(true)
        try {
          const list = await fetchAllUserIllustrations(currentUserID, "illust", (msg) => setDownloadStatusText(msg))
          if (list.length === 0) {
            void Dialog.alert({ title: "提示", message: "未获取到插画作品" })
            return
          }
          const result = await downloadAuthorIllustrationsToAlbum(detail.user.name, list, (msg) => setDownloadStatusText(msg))
          void Dialog.alert({
            title: "下载完成",
            message: `已成功将 ${result.successCount} 部插画保存至相簿「${albumName}」。`,
          })
        } catch (e: any) {
          void Dialog.alert({ title: "下载失败", message: e?.message ?? "下载插画时发生错误" })
        } finally {
          setDownloading(false)
          setDownloadStatusText("")
        }
      } else {
        const confirmed = await Dialog.confirm({
          title: "确认打包全部插画？",
          message: `将拉取用户「${detail.user.name}」全部插画原图并打包为 ZIP 归档，多页插画将归入独立子文件夹，请在“文件”App 查看。`,
          confirmLabel: "开始下载",
          cancelLabel: "取消",
        })
        if (!confirmed) return

        setDownloading(true)
        try {
          const list = await fetchAllUserIllustrations(currentUserID, "illust", (msg) => setDownloadStatusText(msg))
          if (list.length === 0) {
            void Dialog.alert({ title: "提示", message: "未获取到插画作品" })
            return
          }
          const zipPath = await exportAuthorIllustrationsToZip(detail.user.name, currentUserID, list, (msg) => setDownloadStatusText(msg))
          if (zipPath) {
            void Dialog.alert({
              title: "打包完成",
              message: "插画全集 ZIP 归档已保存，请在“文件”App 查看。",
            })
          } else {
            void Dialog.alert({ title: "打包失败", message: "生成插画 ZIP 归档包失败" })
          }
        } catch (e: any) {
          void Dialog.alert({ title: "打包失败", message: e?.message ?? "打包插画时发生错误" })
        } finally {
          setDownloading(false)
          setDownloadStatusText("")
        }
      }
    } else if (selectedCatKey === "manga") {
      const choice = await Dialog.actionSheet({
        title: "漫画下载格式",
        message: `共 ${totalManga} 部漫画作品`,
        actions: [
          { label: "打包为 CBZ 漫画包" },
          { label: "打包为 EPUB 电子书" },
        ],
      })
      if (choice !== 0 && choice !== 1) return
      const format: "cbz" | "epub" = choice === 0 ? "cbz" : "epub"
      const formatLabel = format === "cbz" ? "CBZ 漫画包" : "EPUB 电子书"

      const confirmed = await Dialog.confirm({
        title: "确认下载全部漫画？",
        message: `将拉取用户「${detail.user.name}」全部漫画（共 ${totalManga} 部），连载系列将自动合并为全集卷，短篇将独立导出为单本，格式为 ${formatLabel}，请在“文件”App 查看。`,
        confirmLabel: "开始下载",
        cancelLabel: "取消",
      })
      if (!confirmed) return

      setDownloading(true)
      try {
        const mangaList = await fetchAllUserIllustrations(currentUserID, "manga", (msg) => setDownloadStatusText(msg))
        if (mangaList.length === 0) {
          void Dialog.alert({ title: "提示", message: "未获取到漫画作品" })
          return
        }
        const res = await exportAuthorManga(detail.user.name, currentUserID, mangaList, format, (msg) => setDownloadStatusText(msg))
        void Dialog.alert({
          title: "导出完成",
          message: `已成功导出 ${res.totalExported} 本漫画文件，请在“文件”App 查看。`,
        })
      } catch (e: any) {
        void Dialog.alert({ title: "导出失败", message: e?.message ?? "导出漫画时发生错误" })
      } finally {
        setDownloading(false)
        setDownloadStatusText("")
      }
    } else if (selectedCatKey === "novel") {
      const confirmed = await Dialog.confirm({
        title: "确认下载全部小说？",
        message: `将拉取用户「${detail.user.name}」全部小说（共 ${totalNovels} 部），连载系列将自动合并为多章节整本电子书，短篇将独立导出为单本，请在“文件”App 查看。`,
        confirmLabel: "开始下载",
        cancelLabel: "取消",
      })
      if (!confirmed) return

      setDownloading(true)
      try {
        const novelList = await fetchAllUserNovels(currentUserID, (msg) => setDownloadStatusText(msg))
        if (novelList.length === 0) {
          void Dialog.alert({ title: "提示", message: "未获取到小说作品" })
          return
        }
        const res = await exportAuthorNovels(detail.user.name, currentUserID, novelList, (msg) => setDownloadStatusText(msg))
        void Dialog.alert({
          title: "导出完成",
          message: `已成功导出 ${res.totalExported} 本 EPUB 电子书，请在“文件”App 查看。`,
        })
      } catch (e: any) {
        void Dialog.alert({ title: "导出失败", message: e?.message ?? "导出小说时发生错误" })
      } finally {
        setDownloading(false)
        setDownloadStatusText("")
      }
    }
  }

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
      toolbar={{
        topBarTrailing: [
          <Button
            disabled={downloading}
            action={() => {
              void Haptics.transient()
              void handleDownloadClick()
            }}
          >
            <Image systemName={downloading ? "arrow.down.circle.fill" : "square.and.arrow.down"} />
          </Button>,
        ],
      }}
    >
      <VStack alignment="leading" spacing={8}>
        {downloading ? (
          <HStack
            spacing={8}
            padding={{ horizontal: 16, vertical: 10 }}
            background="systemGray6"
            clipShape={{ type: "rect", cornerRadius: 10 }}
            frame={{ maxWidth: "infinity" }}
            alignment="center"
          >
            <Image systemName="arrow.down.circle.fill" foregroundStyle="tintColor" />
            <Text
              font="footnote"
              foregroundStyle="secondaryLabel"
              lineLimit={1}
            >
              {downloadStatusText || "正在下载作品…"}
            </Text>
          </HStack>
        ) : null}
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

function filterIllustrations(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterNovels(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) => isNovelContentVisible(item, settings))
}
