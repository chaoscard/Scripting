import {
  Button,
  Divider,
  Group,
  HStack,
  Image,
  Label,
  Menu,
  NavigationLink,
  ScrollView,
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
  fetchUserWorkTags,
  fetchWebUserDetail,
  followDetail,
  followUser,
  unfollowUser,
  userDetail,
} from "../api/pixiv"
import { session } from "../api/session"
import {
  cachedFileExists,
  loadImage,
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
  isUserFollowed,
  onUserFollowChanged,
  recordUserFollowed,
} from "../store/userFollow"
import { useAsyncGuard, useUserAmbientPalette } from "./hooks"
import type {
  PixivUserDetail,
  PixivWebUserDetail,
  PixivWebUserTag,
} from "../types"
import {
  EmptyView,
  ErrorView,
  LoadingView,
  RefreshableScrollView,
} from "./components"
import { UserProfileHeader } from "./UserProfileHeader"
import { UserWorkTagFilterBar } from "./UserWorkTagFilterBar"
import { UserWorksFeedSection, UserWorkPicker, type UserWorkKind } from "./UserWorksFeedSection"

export function UserDetailView(props: { userID: number }) {
  const { userID } = props

  const [detail, setDetail] = useState<PixivUserDetail | null>(null)
  const [webDetail, setWebDetail] = useState<PixivWebUserDetail | null>(null)
  const [followed, setFollowed] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  const [kind, setKind] = useState<UserWorkKind>("illust")
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [tagsByKind, setTagsByKind] = useState<Partial<Record<UserWorkKind, PixivWebUserTag[]>>>({})
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
    return baseKinds.filter((k: UserWorkKind) => !emptyKinds[k])
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

  useEffect(() => {
    setSelectedTag(null)
    if (!tagsByKind[activeKind]) {
      fetchUserWorkTags(userID, activeKind, 20)
        .then((tags) => {
          setTagsByKind((prev) => ({ ...prev, [activeKind]: tags }))
        })
        .catch(() => {})
    }
  }, [userID, activeKind])

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
      const [result, webResult, currentTags] = await Promise.all([
        session.call((token) => userDetail(userID, token)),
        fetchWebUserDetail(userID),
        fetchUserWorkTags(userID, activeKind, 20),
      ])
      if (!g.isCurrent()) return
      setTagsByKind((prev) => ({ ...prev, [activeKind]: currentTags }))

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

        {/* 标签筛选栏（位于关于下方，Picker上方） */}
        <UserWorkTagFilterBar
          tags={tagsByKind[activeKind] ?? []}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
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
          onChanged={(k) => {
            setSelectedTag(null)
            setKind(k)
          }}
        />

        {availableKinds.length === 0 ? (
          <EmptyView text="暂无作品投稿" systemImage="photo.on.rectangle.angled" />
        ) : (
          <UserWorksFeedSection
            userID={userID}
            kind={activeKind}
            selectedTag={selectedTag}
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
