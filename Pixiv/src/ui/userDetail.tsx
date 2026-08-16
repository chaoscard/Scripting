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
  Spacer,
  Text,
  useColorScheme,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import {
  extractUserAmbientPalette,
  getCachedUserAmbientPalette,
  type UserAmbientPalette,
} from "../image/colorExtractor"
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
  blockUser,
  isIllustContentVisible,
  isR18ContentVisible,
  isUserBlocked,
  loadSettings,
  onSettingsChanged,
  unblockUser,
} from "../store/settings"
import { onUserFollowChanged } from "../store/userFollow"
import { renderDestination } from "./routes"
import { useAsyncGuard, useLatest, usePagedList } from "./hooks"
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
  htmlToPlainText,
  LinkedDescription,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

type UserWorkKind = "illust" | "manga" | "novel"

export function UserDetailView(props: { userID: number }) {
  const { userID } = props
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const [detail, setDetail] = useState<PixivUserDetail | null>(null)
  const [webDetail, setWebDetail] = useState<PixivWebUserDetail | null>(null)
  const [followed, setFollowed] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  const [kind, setKind] = useState<UserWorkKind>("illust")
  const [ambientPalette, setAmbientPalette] = useState<UserAmbientPalette | null>(
    null
  )

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
      if (bgUrl && !cachedFileExists(bgUrl)) {
        await Promise.race([
          loadImage(bgUrl, 0),
          new Promise((resolve) => setTimeout(() => resolve(null), 800)),
        ])
      }

      if (!g.isCurrent()) return
      setDetail(result)
      setWebDetail(webResult)
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
    const bgUrl = detail?.profile.background_image_url
    if (!bgUrl) {
      setAmbientPalette(null)
      return
    }
    let active = true
    const cached = getCachedUserAmbientPalette(bgUrl, isDark)
    if (cached) {
      setAmbientPalette(cached)
    }
    void extractUserAmbientPalette(bgUrl).then((result) => {
      if (!active || !result) return
      setAmbientPalette(isDark ? result.dark : result.light)
    })
    return () => {
      active = false
    }
  }, [detail?.profile.background_image_url, isDark])

  useEffect(() => {
    return onUserFollowChanged((changedUserID, nextFollowed) => {
      if (changedUserID !== userID) return
      followStateVersionRef.current++
      setFollowed(nextFollowed)
    })
  }, [userID])

  useEffect(() => {
    void loadDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userID])

  async function followWithVisibility(restrict: "public" | "private") {
    if (followBusy || isOwnProfile) return
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
      ignoresSafeArea={{ edges: "top" }}
      refreshable={handleRefresh}
      background={
        ambientPalette
          ? {
              colors: [
                ambientPalette.topColor,
                ambientPalette.midColor,
                ambientPalette.worksColor,
                ambientPalette.worksColor,
              ],
              startPoint: "top",
              endPoint: "bottom",
            }
          : undefined
      }
      toolbar={{
        topBarTrailing: [
          ...(!isOwnProfile ? [
            <Button
              title={followed ? "已关注" : "关注"}
              systemImage={followed ? "person.fill.checkmark" : "person.badge.plus"}
              buttonStyle="glass"
              disabled={followBusy}
              frame={{ width: 32, height: 32 }}
              clipShape={{ type: "rect", cornerRadius: 16 }}
              contentShape="rect"
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
            />,
          ] : []),
          <Button
            title="分享"
            systemImage="square.and.arrow.up"
            buttonStyle="glass"
            frame={{ width: 32, height: 32 }}
            clipShape={{ type: "rect", cornerRadius: 16 }}
            contentShape="rect"
            action={() => {
              void ShareSheet.present([`https://www.pixiv.net/users/${userID}`])
            }}
          />,
          <Menu label={<Image systemName="ellipsis.circle" />}>
            <NavigationLink value={`userConnections:following:${userID}`}>
              <Label title="查看关注" systemImage="person.2" />
            </NavigationLink>
            <NavigationLink value={`userConnections:follower:${userID}`}>
              <Label title="查看粉丝" systemImage="person.2.badge.plus" />
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
        background={
          ambientPalette
            ? {
                colors: [
                  ambientPalette.topColor,
                  ambientPalette.midColor,
                  ambientPalette.worksColor,
                  ambientPalette.worksColor,
                ],
                startPoint: "top",
                endPoint: "bottom",
              }
            : undefined
        }
      >
        {/* 单一常驻的个人资料头部 */}
        <UserProfileHeader
          detail={detail}
          webDetail={webDetail}
          ambientPalette={ambientPalette}
        />

        {/* 位于个人资料和作品列表之间的分段选择器 */}
        <UserWorkPicker kind={kind} onChanged={setKind} />

        {/* 按需加载与销毁的作品分类流（切换时销毁非当前分类，避免常驻内存） */}
        {kind === "illust" ? (
          <UserIllustFeed
            key={`illust:${userID}`}
            userID={userID}
            kind="illust"
            emptyText="暂无插画投稿"
            onRegisterRefresh={(fn) => {
              worksRefreshRef.current = fn
            }}
          />
        ) : kind === "manga" ? (
          <UserIllustFeed
            key={`manga:${userID}`}
            userID={userID}
            kind="manga"
            emptyText="暂无漫画投稿"
            onRegisterRefresh={(fn) => {
              worksRefreshRef.current = fn
            }}
          />
        ) : (
          <UserNovelFeed
            key={`novel:${userID}`}
            userID={userID}
            onRegisterRefresh={(fn) => {
              worksRefreshRef.current = fn
            }}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function UserIllustFeed(props: {
  userID: number
  kind: "illust" | "manga"
  emptyText: string
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, kind, emptyText, onRegisterRefresh } = props

  const paged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(userID, kind, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrations,
    deps: [userID, kind],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
      pagedRef.current.refresh()
    })
  }, [])

  if (paged.initialLoading) {
    return <LoadingView />
  }
  if (paged.error && paged.items.length === 0) {
    return <ErrorView message={paged.error} onRetry={paged.refresh} />
  }
  if (paged.items.length === 0) {
    return <EmptyView text={emptyText} />
  }
  return (
    <IllustFlowFeed
      items={paged.items}
      onLoadMore={paged.loadMore}
      hasMore={paged.hasMore}
      isLoading={paged.loadingMore}
    />
  )
}

function UserNovelFeed(props: {
  userID: number
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { userID, onRegisterRefresh } = props

  const paged = usePagedList<PixivNovel>({
    first: (token) => userNovels(userID, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovels,
    deps: [userID],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel,
  })

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
      pagedRef.current.refresh()
    })
  }, [])

  if (paged.initialLoading) {
    return <LoadingView />
  }
  if (paged.error && paged.items.length === 0) {
    return <ErrorView message={paged.error} onRetry={paged.refresh} />
  }
  if (paged.items.length === 0) {
    return <EmptyView text="暂无小说投稿" systemImage="book" />
  }
  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
      {paged.items.map((novel, index) => (
        <NovelCard key={novel.id} novel={novel} priority={index} />
      ))}
      <LoadMoreTrigger
        anchor={paged.items[paged.items.length - 1].id}
        onLoadMore={paged.loadMore}
        hasMore={paged.hasMore}
        isLoading={paged.loadingMore}
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

function ExpandableIntroduction(props: {
  commentHtml: string
  rawComment: string
  routeDestination: (route: string) => any
}) {
  const [expanded, setExpanded] = useState(false)
  const plainText = useMemo(
    () => htmlToPlainText(props.rawComment || props.commentHtml).trim(),
    [props.rawComment, props.commentHtml]
  )

  const lines = useMemo(() => plainText.split(/\r?\n/), [plainText])
  const exceedsFiveLines = lines.length > 5 || plainText.length > 220

  if (!plainText) return null

  const collapsedText = useMemo(() => {
    if (!exceedsFiveLines) return plainText
    return lines.slice(0, 5).join("\n")
  }, [lines, exceedsFiveLines, plainText])

  return (
    <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
      <Text
        font="subheadline"
        fontWeight="semibold"
        foregroundStyle="secondaryLabel"
      >
        简介
      </Text>
      <VStack
        alignment="leading"
        spacing={8}
        padding={12}
        glassEffect={{ type: "rect", cornerRadius: 14 }}
        frame={{ maxWidth: "infinity" }}
        contentShape="rect"
        onTapGesture={
          exceedsFiveLines
            ? () => {
                setExpanded((prev) => !prev)
              }
            : undefined
        }
      >
        {expanded || !exceedsFiveLines ? (
          <LinkedDescription
            html={props.commentHtml || props.rawComment}
            routeDestination={props.routeDestination}
            nativePlainText
          />
        ) : (
          <Text
            font="footnote"
            multilineTextAlignment="leading"
            lineLimit={5}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {collapsedText}
          </Text>
        )}

        {exceedsFiveLines ? (
          <HStack
            alignment="center"
            spacing={4}
            frame={{ maxWidth: "infinity", alignment: "center" }}
            padding={{ top: 2 }}
          >
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {expanded ? "点击收起" : "点击展开全文"}
            </Text>
            <Image
              systemName={expanded ? "chevron.up" : "chevron.down"}
              font="caption2"
              foregroundStyle="secondaryLabel"
            />
          </HStack>
        ) : null}
      </VStack>
    </VStack>
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
  kind: UserWorkKind
  onChanged: (kind: UserWorkKind) => void
}) {
  return (
    <Picker
      title="投稿类型"
      value={props.kind}
      onChanged={(value: string) => props.onChanged(value as UserWorkKind)}
      pickerStyle="segmented"
      padding={{ horizontal: 14 }}
    >
      <Text tag="illust">插画</Text>
      <Text tag="manga">漫画</Text>
      <Text tag="novel">小说</Text>
    </Picker>
  )
}

function filterIllustrations(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterNovels(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter(
    (item) =>
      isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G) &&
      (settings.showAI || item.novel_ai_type !== 2)
  )
}
