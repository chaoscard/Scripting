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
  useEffect,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import {
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
import type { PixivIllustration, PixivNovel, PixivUserDetail } from "../types"
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
  const [detail, setDetail] = useState<PixivUserDetail | null>(null)
  const [followed, setFollowed] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  const [kind, setKind] = useState<UserWorkKind>("illust")

  const guard = useAsyncGuard()
  const followStateVersionRef = useRef(0)
  const isOwnProfile = session.userID === userID
  const worksRefreshRef = useRef<() => Promise<void>>(() => Promise.resolve())

  async function loadDetail() {
    const g = guard()
    const followStateVersion = followStateVersionRef.current
    setDetailError(null)
    try {
      const result = await session.call((token) => userDetail(userID, token))
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
      <VStack alignment="leading" spacing={12} padding={{ top: 0, bottom: 20 }} frame={{ maxWidth: "infinity" }}>
        {/* 单一常驻的个人资料头部 */}
        <UserProfileHeader detail={detail} />

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

function UserProfileHeader(props: { detail: PixivUserDetail }) {
  const { detail } = props
  const { user, profile, workspace } = detail
  const introduction = htmlToPlainText(user.comment).trim()
  const fields = [
    profile.webpage?.trim() ? ["主页", profile.webpage.trim()] : null,
    profile.gender?.trim() ? ["性别", profile.gender.trim()] : null,
    profile.birth?.trim() ? ["生日", profile.birth.trim()] : null,
    profile.region?.trim() ? ["地区", profile.region.trim()] : null,
    profile.job?.trim() ? ["职业", profile.job.trim()] : null,
    profile.twitter_url?.trim()
      ? [
          "X",
          profile.twitter_account?.trim()
            ? `@${profile.twitter_account.trim()}`
            : profile.twitter_url.trim(),
        ]
      : null,
    workspace?.comment?.trim() ? ["创作环境", workspace.comment.trim()] : null,
  ].filter((field): field is [string, string] => field != null)

  const avatarSize = 74
  const ringSize = avatarSize + 4

  return (
    <VStack
      alignment="leading"
      spacing={12}
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

      <VStack alignment="leading" spacing={12} padding={{ top: ringSize / 2 + 4, horizontal: 16 }} frame={{ maxWidth: "infinity" }}>
        {/* 简介 */}
        {introduction ? (
          <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
            <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
              简介
            </Text>
            <VStack
              alignment="leading"
              spacing={6}
              padding={12}
              glassEffect={{ type: "rect", cornerRadius: 14 }}
              frame={{ maxWidth: "infinity" }}
            >
              <LinkedDescription
                html={user.comment ?? ""}
                routeDestination={renderDestination}
                nativePlainText
              />
            </VStack>
          </VStack>
        ) : null}

        {/* 关于信息 */}
        {fields.length > 0 ? (
          <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
            <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
              关于
            </Text>
            <VStack
              alignment="leading"
              spacing={8}
              padding={12}
              glassEffect={{ type: "rect", cornerRadius: 14 }}
              frame={{ maxWidth: "infinity" }}
            >
              {fields.map(([label, value]) => (
                <HStack key={label} alignment="top" spacing={10}>
                  <Text
                    font="footnote"
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
