import {
  Button,
  Divider,
  Group,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  NavigationLink,
  Picker,
  ScrollView,
  Text,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import type { UserAmbientPalette } from "../image/colorExtractor"
import {
  downloadAuthorIllustrationsToAlbum,
  exportAuthorIllustrationsToZip,
  exportAuthorManga,
  exportAuthorNovels,
  fetchAllUserIllustrations,
  fetchAllUserNovels,
} from "../downloader"
import {
  fetchWebUserDetail,
  followDetail,
  followUser,
  nextIllustrations,
  nextNovels,
  unfollowUser,
  userDetail,
  userNovels,
  userWorks,
} from "../api/pixiv"
import { session } from "../api/session"
import {
  cachedFileExists,
  cardThumbUrlOf,
  loadImage,
  novelThumbUrlOf,
  prefetch,
} from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  blockUser,
  isUserBlocked,
  unblockUser,
} from "../store/blocklist"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import {
  isUserFollowed,
  onUserFollowChanged,
  recordUserFollowed,
} from "../store/userFollow"
import { renderDestination } from "./routes"
import { useAsyncGuard, useLatest, usePagedList, useUserAmbientPalette, currentBatchSize } from "./hooks"
import type {
  PixivIllustration,
  PixivNovel,
  PixivUserDetail,
  PixivWebUserDetail,
} from "../types"
import {
  AvatarImage,
  CachedImage,
  EmptyView,
  ErrorView,
  ExpandableIntroduction,
  FilteredContentNotice,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

type UserWorkKind = "illust" | "manga" | "novel"

export function UserDetailView(props: { userID: number }) {
  const { userID } = props

  const [detail, setDetail] = useState<PixivUserDetail | null>(null)
  const [webDetail, setWebDetail] = useState<PixivWebUserDetail | null>(null)
  const [followed, setFollowed] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  const [kind, setKind] = useState<UserWorkKind>("illust")
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [emptyKinds, setEmptyKinds] = useState<Partial<Record<UserWorkKind, boolean>>>({})
  const { ambientBackground } = useUserAmbientPalette(detail?.profile.background_image_url)

  const baseKinds = useMemo<UserWorkKind[]>(() => {
    if (!detail) return []
    const kinds: UserWorkKind[] = []
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

  const availableKinds = useMemo<UserWorkKind[]>(() => {
    return baseKinds.filter((k) => !emptyKinds[k])
  }, [baseKinds, emptyKinds])

  const activeKind: UserWorkKind = useMemo(() => {
    if (availableKinds.length === 0) return baseKinds[0] ?? "illust"
    if (availableKinds.includes(kind)) return kind
    return availableKinds[0]
  }, [availableKinds, baseKinds, kind])

  useEffect(() => {
    if (availableKinds.length > 0 && !availableKinds.includes(kind)) {
      setKind(availableKinds[0])
    }
  }, [availableKinds, kind])

  const handleKindEmpty = useCallback((targetKind: UserWorkKind, isEmpty: boolean) => {
    setEmptyKinds((prev) => {
      if (prev[targetKind] === isEmpty) return prev
      return { ...prev, [targetKind]: isEmpty }
    })
  }, [])

  const guard = useAsyncGuard()
  const followStateVersionRef = useRef(0)
  const isOwnProfile = session.userID === userID
  const worksRefreshRef = useRef<() => Promise<void>>(() => Promise.resolve())

  async function loadDetail() {
    const g = guard()
    const followStateVersion = followStateVersionRef.current
    setDetailError(null)
    try {
      const [result, webResult] = await Promise.all([
        session.call((token) => userDetail(userID, token)),
        fetchWebUserDetail(userID),
      ])
      if (!g.isCurrent()) return

      // 优先预热背景图与头像，确保首次渲染即获得真实比例，防止头像位置跳动
      const bgUrl = result.profile.background_image_url
      const preheatDuration = loadSettings().backgroundPreheatDuration ?? 1000
      if (bgUrl && !cachedFileExists(bgUrl) && preheatDuration > 0) {
        await Promise.race([
          loadImage(bgUrl, 0),
          new Promise((resolve) => setTimeout(() => resolve(null), preheatDuration)),
        ])
      }

      if (!g.isCurrent()) return
      setDetail(result)
      setWebDetail(webResult)
      if (result.user?.id) {
        recordUserFollowed(result.user.id, result.user.is_followed ?? false)
      }
      if (followStateVersion === followStateVersionRef.current) {
        setFollowed(result.user.is_followed ?? false)
      }
      if (result.user.is_followed == null && !isOwnProfile) {
        session
          .call((token) => followDetail(userID, token))
          .then((followDetail) => {
            if (
              g.isCurrent() &&
              followStateVersion === followStateVersionRef.current
            ) {
              setFollowed(followDetail.is_followed)
            }
          })
          .catch(() => {})
      }
    } catch (error: any) {
      if (g.isCurrent()) setDetailError(error?.message ?? "加载失败")
    }
  }


  useEffect(() => {
    return onUserFollowChanged((changedUserID, nextFollowed) => {
      if (changedUserID !== userID) return
      followStateVersionRef.current++
      setFollowed(nextFollowed)
      setEmptyKinds({})
      if (nextFollowed && baseKinds.length > 0) {
        setKind(baseKinds[0])
      }
    })
  }, [userID, baseKinds])

  useEffect(() => {
    return onSettingsChanged(() => {
      setHideNovels(loadSettings().hideNovels)
      setEmptyKinds({})
    })
  }, [])

  useEffect(() => {
    void loadDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userID])

  async function followWithVisibility(restrict: "public" | "private") {
    if (followBusy || isOwnProfile) return
    void Haptics.transient()
    const followStateVersion = ++followStateVersionRef.current
    setFollowBusy(true)
    try {
      await session.call((token) => followUser(userID, restrict, token))
      if (followStateVersion === followStateVersionRef.current) {
        setFollowed(true)
      }
    } catch {
      // Keep the current UI state when the request fails.
    } finally {
      if (followStateVersion === followStateVersionRef.current) {
        followStateVersionRef.current++
      }
      setFollowBusy(false)
    }
  }

  async function toggleFollow() {
    if (followBusy || isOwnProfile) return
    if (!followed) {
      await followWithVisibility("public")
      return
    }
    void Haptics.transient()
    const followStateVersion = ++followStateVersionRef.current
    setFollowBusy(true)
    try {
      await session.call((token) => unfollowUser(userID, token))
      if (followStateVersion === followStateVersionRef.current) {
        setFollowed(false)
      }
    } catch {
      // Keep the current UI state when the request fails.
    } finally {
      if (followStateVersion === followStateVersionRef.current) {
        followStateVersionRef.current++
      }
      setFollowBusy(false)
    }
  }

  const [downloading, setDownloading] = useState(false)
  const [downloadStatusText, setDownloadStatusText] = useState("")

  const handleDownloadClick = async () => {
    if (!detail) return
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

    // 构造可选作品类别列表
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

    // 分类下载处理
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
          const list = await fetchAllUserIllustrations(userID, "illust", (msg) => setDownloadStatusText(msg))
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
          const list = await fetchAllUserIllustrations(userID, "illust", (msg) => setDownloadStatusText(msg))
          if (list.length === 0) {
            void Dialog.alert({ title: "提示", message: "未获取到插画作品" })
            return
          }
          const zipPath = await exportAuthorIllustrationsToZip(detail.user.name, userID, list, (msg) => setDownloadStatusText(msg))
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
        const mangaList = await fetchAllUserIllustrations(userID, "manga", (msg) => setDownloadStatusText(msg))
        if (mangaList.length === 0) {
          void Dialog.alert({ title: "提示", message: "未获取到漫画作品" })
          return
        }
        const res = await exportAuthorManga(detail.user.name, userID, mangaList, format, (msg) => setDownloadStatusText(msg))
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
        const novelList = await fetchAllUserNovels(userID, (msg) => setDownloadStatusText(msg))
        if (novelList.length === 0) {
          void Dialog.alert({ title: "提示", message: "未获取到小说作品" })
          return
        }
        const res = await exportAuthorNovels(detail.user.name, userID, novelList, (msg) => setDownloadStatusText(msg))
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

  async function handleRefresh() {
    await Promise.all([loadDetail(), worksRefreshRef.current()])
  }

  if (!detail) {
    if (detailError) {
      return (
        <ScrollView navigationTitle="用户主页" navigationBarTitleDisplayMode="inline">
          <ErrorView message={detailError} onRetry={loadDetail} />
        </ScrollView>
      )
    }
    return (
      <ScrollView navigationTitle="用户主页" navigationBarTitleDisplayMode="inline">
        <LoadingView />
      </ScrollView>
    )
  }

  return (
    <RefreshableScrollView
      navigationTitle={detail.user.name}
      navigationBarTitleDisplayMode="inline"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      ignoresSafeArea={{ edges: ["top", "bottom"] }}
      refreshable={handleRefresh}
      background={ambientBackground}
      toolbar={{
        topBarTrailing: [
          ...(!isOwnProfile ? [
            <Button
              disabled={followBusy}
              action={toggleFollow}
              contextMenu={{
                menuItems: (
                  <Group>
                    <Button
                      title={followed ? "设为私密关注" : "私密关注"}
                      systemImage="lock"
                      disabled={followBusy}
                      action={() => void followWithVisibility("private")}
                    />
                  </Group>
                ),
              }}
            >
              <Image
                systemName={followed ? "person.fill.checkmark" : "person.badge.plus"}
              />
            </Button>,
          ] : []),
          <Button
            action={() => {
              void Haptics.transient()
              void ShareSheet.present([`https://www.pixiv.net/users/${userID}`])
            }}
          >
            <Image systemName="square.and.arrow.up" />
          </Button>,
          <Button
            disabled={downloading}
            action={() => {
              void Haptics.transient()
              void handleDownloadClick()
            }}
          >
            <Image systemName={downloading ? "arrow.down.circle.fill" : "square.and.arrow.down"} />
          </Button>,
          <Menu label={<Image systemName="ellipsis.circle" />}>
            <NavigationLink value={`userConnections:following:${userID}`}>
              <Label title="查看关注" systemImage="person.2" />
            </NavigationLink>
            <NavigationLink value={`userConnections:mypixiv:${userID}`}>
              <Label title="查看好友" systemImage="person.2.badge.gearshape" />
            </NavigationLink>
            <NavigationLink value={`userBookmarks:${userID}`}>
              <Label title="查看收藏" systemImage="heart" />
            </NavigationLink>
            <Menu title="查看信息" systemImage="info.circle">
              <Button
                title={`用户：${detail.user.name}`}
                action={() => void Pasteboard.setString(detail.user.name)}
              />
              <Button
                title={`账户：@${detail.user.account}`}
                action={() => void Pasteboard.setString(detail.user.account)}
              />
              <Button
                title={`UID：${detail.user.id}`}
                action={() => void Pasteboard.setString(String(detail.user.id))}
              />
            </Menu>
            {!isOwnProfile ? (
              <Group>
                <Divider />
                <Button
                  title={followed ? "设为私密关注" : "私密关注"}
                  systemImage="lock"
                  disabled={followBusy}
                  action={() => void followWithVisibility("private")}
                />
                <Button
                  title={isUserBlocked(detail.user.id) ? "解除屏蔽用户" : "屏蔽用户"}
                  systemImage={
                    isUserBlocked(detail.user.id)
                      ? "person.badge.plus"
                      : "person.crop.circle.badge.xmark"
                  }
                  role={isUserBlocked(detail.user.id) ? undefined : "destructive"}
                  action={() => {
                    if (isUserBlocked(detail.user.id)) {
                      unblockUser(detail.user.id)
                    } else {
                      blockUser(detail.user)
                    }
                  }}
                />
              </Group>
            ) : null}
          </Menu>,
        ],
      }}
    >
      <VStack
        alignment="leading"
        spacing={12}
        padding={{ top: 0, bottom: 20 }}
        frame={{ maxWidth: "infinity" }}
      >
        {/* 单一常驻的个人资料头部 */}
        <UserProfileHeader
          detail={detail}
          webDetail={webDetail}
        />

        {/* 批量下载进度提示栏 */}
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

        {/* 位于个人资料和作品列表之间的分段选择器（仅显示有投稿项，<=1 项时自动隐藏） */}
        <UserWorkPicker
          availableKinds={availableKinds}
          kind={activeKind}
          onChanged={setKind}
        />

        {availableKinds.length === 0 ? (
          <EmptyView text="暂无作品投稿" systemImage="photo.on.rectangle.angled" />
        ) : (
          <UserWorksFeedSection
            userID={userID}
            kind={activeKind}
            isAuthorFollowed={followed || isOwnProfile}
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

function UserWorksFeedSection(props: {
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

interface SocialLinkItem {
  id: string
  name: string
  url: string
  systemImage: string
}

function extractSocialLinks(
  detail: PixivUserDetail,
  webDetail: PixivWebUserDetail | null
): SocialLinkItem[] {
  const links: SocialLinkItem[] = []
  const seenUrls = new Set<string>()

  function addLink(
    id: string,
    name: string,
    rawUrl: string | undefined | null,
    systemImage: string
  ) {
    if (!rawUrl) return
    const trimmed = rawUrl.trim()
    if (
      !trimmed ||
      (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))
    ) {
      return
    }
    if (seenUrls.has(trimmed)) return
    seenUrls.add(trimmed)
    links.push({ id, name, url: trimmed, systemImage })
  }

  // 1. 从网页端提取 social 对象 / 列表
  if (webDetail?.social) {
    if (Array.isArray(webDetail.social)) {
      webDetail.social.forEach((item, index) => {
        if (item?.url) {
          const meta = inferSocialMeta(item.url, `social_${index}`)
          addLink(meta.id, meta.name, item.url, meta.systemImage)
        }
      })
    } else if (typeof webDetail.social === "object") {
      for (const [key, item] of Object.entries(webDetail.social)) {
        if (item?.url) {
          const meta = socialMetaForKey(key, item.url)
          addLink(meta.id, meta.name, item.url, meta.systemImage)
        }
      }
    }
  }

  // 2. 从网页端提取 webpage（个人主页）
  if (webDetail?.webpage) {
    addLink("webpage", "主页", webDetail.webpage, "globe")
  }

  // 3. Fallback: App API twitter
  if (detail.profile.twitter_url) {
    addLink("twitter_app", "X", detail.profile.twitter_url, "xmark")
  }

  // 4. Fallback: App API webpage
  if (detail.profile.webpage) {
    addLink("webpage_app", "主页", detail.profile.webpage, "globe")
  }

  return links
}

function socialMetaForKey(
  key: string,
  url: string
): { id: string; name: string; systemImage: string } {
  const lowerKey = key.toLowerCase()
  if (lowerKey === "twitter" || lowerKey === "x") {
    return { id: "twitter", name: "X", systemImage: "xmark" }
  }
  if (lowerKey === "pawoo") {
    return {
      id: "pawoo",
      name: "Pawoo",
      systemImage: "antenna.radiowaves.left.and.right",
    }
  }
  if (lowerKey === "circlems") {
    return {
      id: "circlems",
      name: "Circle.ms",
      systemImage: "circle.grid.2x2.fill",
    }
  }
  if (lowerKey === "instagram") {
    return { id: "instagram", name: "Instagram", systemImage: "camera.fill" }
  }
  if (lowerKey === "bluesky") {
    return { id: "bluesky", name: "Bluesky", systemImage: "cloud.fill" }
  }
  return inferSocialMeta(url, key)
}

function inferSocialMeta(
  url: string,
  defaultId: string
): { id: string; name: string; systemImage: string } {
  const lower = url.toLowerCase()
  if (lower.includes("twitter.com") || lower.includes("x.com")) {
    return { id: "twitter", name: "X", systemImage: "xmark" }
  }
  if (lower.includes("pawoo.net")) {
    return {
      id: "pawoo",
      name: "Pawoo",
      systemImage: "antenna.radiowaves.left.and.right",
    }
  }
  if (lower.includes("circle.ms")) {
    return {
      id: "circlems",
      name: "Circle.ms",
      systemImage: "circle.grid.2x2.fill",
    }
  }
  if (lower.includes("instagram.com")) {
    return { id: "instagram", name: "Instagram", systemImage: "camera.fill" }
  }
  if (lower.includes("bsky.app") || lower.includes("bluesky")) {
    return { id: "bluesky", name: "Bluesky", systemImage: "cloud.fill" }
  }
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    return {
      id: "youtube",
      name: "YouTube",
      systemImage: "play.rectangle.fill",
    }
  }
  if (lower.includes("github.com")) {
    return { id: "github", name: "GitHub", systemImage: "curlybraces" }
  }
  if (lower.includes("weibo.com") || lower.includes("weibo.cn")) {
    return { id: "weibo", name: "微博", systemImage: "eye.fill" }
  }
  return { id: defaultId, name: "主页", systemImage: "link" }
}

function UserSocialBar(props: { socials: SocialLinkItem[] }) {
  if (props.socials.length === 0) return null
  return (
    <HStack
      alignment="center"
      spacing={10}
      frame={{ maxWidth: "infinity", alignment: "center" }}
      padding={{ vertical: 2 }}
    >
      {props.socials.map((item) => (
        <Button
          key={item.id}
          buttonStyle="plain"
          action={() => {
            void Safari.present(item.url, false)
          }}
          contextMenu={{
            menuItems: (
              <Group>
                <Button
                  title={`在浏览器中打开 ${item.name}`}
                  systemImage="safari"
                  action={() => void Safari.openURL(item.url)}
                />
                <Button
                  title="复制链接"
                  systemImage="doc.on.doc"
                  action={() => void Pasteboard.setString(item.url)}
                />
              </Group>
            ),
          }}
        >
          <ZStack
            alignment="center"
            frame={{ width: 30, height: 30 }}
            glassEffect="circle"
          >
            <Image
              systemName={item.systemImage}
              font="subheadline"
              frame={{ alignment: "center" }}
            />
          </ZStack>
        </Button>
      ))}
    </HStack>
  )
}

function buildAboutFields(
  detail: PixivUserDetail,
  webDetail: PixivWebUserDetail | null
): Array<[string, string]> {
  const fields: Array<[string, string]> = []

  // 地区
  const region =
    webDetail?.region?.name?.trim() || detail.profile.region?.trim()
  if (region) {
    fields.push(["地区", region])
  }

  // 年龄
  const age = webDetail?.age?.name?.trim()
  if (age) {
    fields.push(["年龄", age])
  }

  // 生日
  const birth =
    webDetail?.birthDay?.name?.trim() || detail.profile.birth?.trim()
  if (birth) {
    fields.push(["生日", birth])
  }

  // 性别
  const gender =
    webDetail?.gender?.name?.trim() || detail.profile.gender?.trim()
  if (gender) {
    fields.push(["性别", gender])
  }

  // 职业
  const job = webDetail?.job?.name?.trim() || detail.profile.job?.trim()
  if (job) {
    fields.push(["职业", job])
  }

  // 创作环境（Workspace）
  const ws = webDetail?.workspace
  if (ws && typeof ws === "object") {
    if (ws.userWorkspacePc?.trim()) {
      fields.push(["电脑", ws.userWorkspacePc.trim()])
    }
    if (ws.userWorkspaceMonitor?.trim()) {
      fields.push(["显示器", ws.userWorkspaceMonitor.trim()])
    }
    if (ws.userWorkspaceTool?.trim()) {
      fields.push(["软件", ws.userWorkspaceTool.trim()])
    }
    if (ws.userWorkspaceTablet?.trim()) {
      fields.push(["数位板", ws.userWorkspaceTablet.trim()])
    }
    if (ws.userWorkspaceMouse?.trim()) {
      fields.push(["鼠标", ws.userWorkspaceMouse.trim()])
    }
    if (ws.userWorkspaceScanner?.trim()) {
      fields.push(["扫描仪", ws.userWorkspaceScanner.trim()])
    }
    if (ws.userWorkspacePrinter?.trim()) {
      fields.push(["打印机", ws.userWorkspacePrinter.trim()])
    }
    if (ws.userWorkspaceDesktop?.trim()) {
      fields.push(["桌面物品", ws.userWorkspaceDesktop.trim()])
    }
    if (ws.userWorkspaceMusic?.trim()) {
      fields.push(["绘图音乐", ws.userWorkspaceMusic.trim()])
    }
    if (ws.userWorkspaceDesk?.trim()) {
      fields.push(["桌子", ws.userWorkspaceDesk.trim()])
    }
    if (ws.userWorkspaceChair?.trim()) {
      fields.push(["椅子", ws.userWorkspaceChair.trim()])
    }
    if (ws.userWorkspaceComment?.trim()) {
      fields.push(["其他", ws.userWorkspaceComment.trim()])
    }
  } else if (detail.workspace) {
    const appWs = detail.workspace
    if (appWs.pc?.trim()) fields.push(["电脑", appWs.pc.trim()])
    if (appWs.monitor?.trim()) fields.push(["显示器", appWs.monitor.trim()])
    if (appWs.tool?.trim()) fields.push(["软件", appWs.tool.trim()])
    if (appWs.tablet?.trim()) fields.push(["数位板", appWs.tablet.trim()])
    if (appWs.music?.trim()) fields.push(["绘图音乐", appWs.music.trim()])
    if (appWs.desk?.trim()) fields.push(["桌子", appWs.desk.trim()])
    if (appWs.chair?.trim()) fields.push(["椅子", appWs.chair.trim()])
    if (appWs.comment?.trim()) fields.push(["创作环境", appWs.comment.trim()])
  }

  return fields
}

function UserProfileHeader(props: {
  detail: PixivUserDetail
  webDetail: PixivWebUserDetail | null
  ambientPalette?: UserAmbientPalette | null
}) {
  const { detail, webDetail, ambientPalette } = props
  const { user, profile } = detail

  const socialLinks = useMemo(
    () => extractSocialLinks(detail, webDetail),
    [detail, webDetail]
  )
  const aboutFields = useMemo(
    () => buildAboutFields(detail, webDetail),
    [detail, webDetail]
  )

  const commentHtml =
    webDetail?.commentHtml || webDetail?.comment || user.comment || ""
  const rawComment = webDetail?.comment || user.comment || ""

  const avatarSize = 74
  const ringSize = avatarSize + 4

  return (
    <VStack
      alignment="leading"
      spacing={0}
      frame={{ maxWidth: "infinity" }}
    >
      {/* 沉浸式顶部背景图与居中悬浮头像 */}
      <ZStack alignment="bottom" frame={{ maxWidth: "infinity" }}>
        {profile.background_image_url ? (
          <CachedImage
            url={profile.background_image_url}
            useIntrinsicAspectRatio={true}
            aspectRatioValue={2.4}
            contentMode="fill"
            cornerRadius={0}
            priority={0}
            frame={{ maxWidth: "infinity" }}
          />
        ) : (
          <VStack
            frame={{ maxWidth: "infinity", height: 160 }}
            background={{
              colors: ["rgba(0, 150, 250, 0.18)", "rgba(0, 150, 250, 0.04)"],
              startPoint: "topLeading",
              endPoint: "bottomTrailing",
            }}
          />
        )}

        {/* 居中头像：垂直中心线对齐背景图底边 */}
        <ZStack
          alignment="center"
          frame={{ width: ringSize, height: ringSize }}
          background="systemBackground"
          clipShape={{ type: "rect", cornerRadius: ringSize / 2 }}
          shadow={{ color: "#00000028", radius: 8, y: 4 }}
          offset={{ x: 0, y: ringSize / 2 }}
        >
          <AvatarImage
            url={user.profile_image_urls?.medium ?? null}
            size={avatarSize}
            priority={1}
          />
        </ZStack>
      </ZStack>

      <VStack
        alignment="leading"
        spacing={12}
        padding={{ top: ringSize / 2 + 14, horizontal: 16, bottom: 8 }}
        frame={{ maxWidth: "infinity" }}
      >
        {/* 社媒图标栏：居中展示，距离头像有段呼吸空间 */}
        <UserSocialBar socials={socialLinks} />

        {/* 简介：从网页端取，默认展示五行，超过五行点击文本框下拉展示 */}
        <ExpandableIntroduction
          title="简介"
          commentHtml={commentHtml}
          rawComment={rawComment}
          routeDestination={renderDestination}
        />

        {/* 关于信息：地区，年龄，生日，性别，职业，创作环境各字段 */}
        {aboutFields.length > 0 ? (
          <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
            <Text
              font="subheadline"
              fontWeight="semibold"
              foregroundStyle="secondaryLabel"
            >
              关于
            </Text>
            <VStack
              alignment="leading"
              spacing={8}
              padding={12}
              glassEffect={{ type: "rect", cornerRadius: 14 }}
              frame={{ maxWidth: "infinity" }}
            >
              {aboutFields.map(([label, value]) => (
                <HStack key={label} alignment="top" spacing={10}>
                  <Text
                    font="footnote"
                    foregroundStyle="secondaryLabel"
                    frame={{ width: 58, alignment: "leading" }}
                  >
                    {label}
                  </Text>
                  <Text
                    font="footnote"
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    {value}
                  </Text>
                </HStack>
              ))}
            </VStack>
          </VStack>
        ) : null}
      </VStack>
    </VStack>
  )
}

function UserWorkPicker(props: {
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

function filterIllustrations(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterNovels(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) => isNovelContentVisible(item, settings))
}
