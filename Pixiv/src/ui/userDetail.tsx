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
  useEffect,
  useRef,
  useState,
  VStack,
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
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
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
  formatNumber,
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

  // 插画、漫画、小说三条作品流分别维护独立的分页状态机，
  // 仅在当前分类被激活时触发网络请求，切换时保留已加载数据。
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(userID, "illust", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrations,
    deps: [userID, "illust"],
    enabled: kind === "illust",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })

  const mangaPaged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(userID, "manga", token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrations,
    deps: [userID, "manga"],
    enabled: kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })

  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => userNovels(userID, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovels,
    deps: [userID],
    enabled: kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel,
  })

  const illustRef = useLatest(illustPaged)
  const mangaRef = useLatest(mangaPaged)
  const novelRef = useLatest(novelPaged)
  const kindRef = useLatest(kind)

  async function loadDetail() {
    const g = guard()
    const followStateVersion = followStateVersionRef.current
    setDetailError(null)
    try {
      const result = await session.call((token) => userDetail(userID, token))
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

  useEffect(() => {
    return onSettingsChanged(() => {
      illustRef.current.reapplyFilter()
      mangaRef.current.reapplyFilter()
      novelRef.current.reapplyFilter()
      if (kindRef.current === "illust") {
        illustRef.current.refresh()
      } else if (kindRef.current === "manga") {
        mangaRef.current.refresh()
      } else {
        novelRef.current.refresh()
      }
    })
  }, [])

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
    const refreshWorks =
      kind === "illust"
        ? illustPaged.refresh()
        : kind === "manga"
          ? mangaPaged.refresh()
          : novelPaged.refresh()
    await Promise.all([loadDetail(), refreshWorks])
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
            <NavigationLink value={`userConnections:mypixiv:${userID}`}>
              <Label title="查看好友" systemImage="person.2.badge.gearshape" />
            </NavigationLink>
            <NavigationLink value={`userBookmarks:${userID}`}>
              <Label title="查看收藏" systemImage="heart" />
            </NavigationLink>
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
      <VStack alignment="leading" spacing={12} padding={{ top: 4, bottom: 20 }}>
        {/* 单一常驻的个人资料头部，切换投稿类型时不重载或重建 */}
        <UserProfileHeader detail={detail} />

        {/* 位于个人资料和作品列表之间的分段选择器 */}
        <UserWorkPicker kind={kind} onChanged={setKind} />

        {/* 当前激活的作品分类流 */}
        {kind === "illust" ? (
          <UserIllustSection paged={illustPaged} emptyText="暂无插画投稿" />
        ) : kind === "manga" ? (
          <UserIllustSection paged={mangaPaged} emptyText="暂无漫画投稿" />
        ) : (
          <UserNovelSection paged={novelPaged} />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function UserIllustSection(props: {
  paged: ReturnType<typeof usePagedList<PixivIllustration>>
  emptyText: string
}) {
  const { paged, emptyText } = props

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

function UserNovelSection(props: {
  paged: ReturnType<typeof usePagedList<PixivNovel>>
}) {
  const { paged } = props

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
      {paged.items.map((novel) => (
        <NovelCard key={novel.id} novel={novel} />
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

  return (
    <VStack
      alignment="leading"
      spacing={12}
      frame={{ maxWidth: "infinity" }}
    >
      {profile.background_image_url ? (
        <CachedImage
          url={profile.background_image_url}
          aspectRatioValue={2.4}
          contentMode="fit"
          cornerRadius={0}
          frame={{ maxWidth: "infinity" }}
        />
      ) : null}

      <VStack alignment="leading" spacing={12} padding={{ horizontal: 16 }}>
        <HStack spacing={14} alignment="top">
          <AvatarImage url={user.profile_image_urls?.medium ?? null} size={56} />
          <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
            <Text font="title3" fontWeight="bold" lineLimit={1}>
              {user.name}
            </Text>
            <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>
              @{user.account}
            </Text>
            {profile.is_premium ? (
              <Text font="caption2" fontWeight="bold" foregroundStyle="#FFD700">
                Premium
              </Text>
            ) : null}
            <HStack spacing={10} padding={{ top: 2 }}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                插画 {formatNumber(profile.total_illusts)}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                漫画 {formatNumber(profile.total_manga)}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                小说 {formatNumber(profile.total_novels)}
              </Text>
            </HStack>
          </VStack>
        </HStack>

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
