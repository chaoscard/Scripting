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
import { useAsyncGuard, useLatest, usePagedList } from "./hooks"
import type { PixivIllustration, PixivNovel, PixivUserDetail } from "../types"
import {
  AvatarImage,
  CachedImage,
  EmptyView,
  ErrorView,
  formatNumber,
  htmlToPlainText,
  LoadingView,
  LoadMoreTrigger,
  MasonryIllustFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

type UserWorkKind = "illust" | "manga" | "novel"
type IllustrationKind = Exclude<UserWorkKind, "novel">

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
    void loadDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userID])

  async function toggleFollow() {
    if (followBusy || isOwnProfile) return
    const followStateVersion = ++followStateVersionRef.current
    setFollowBusy(true)
    try {
      if (followed) {
        await session.call((token) => unfollowUser(userID, token))
      } else {
        await session.call((token) => followUser(userID, "public", token))
      }
      if (followStateVersion === followStateVersionRef.current) {
        setFollowed(!followed)
      }
    } catch {
      // Keep the current UI state when the request fails.
    } finally {
      // 让写入期间发起的详情/补查结果失效，避免覆盖刚完成的操作。
      if (followStateVersion === followStateVersionRef.current) {
        followStateVersionRef.current++
      }
      setFollowBusy(false)
    }
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
    <VStack
      alignment="leading"
      spacing={8}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      navigationTitle={detail.user.name}
      navigationBarTitleDisplayMode="inline"
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
            />,
          ] : []),
          <Menu label={<Image systemName="ellipsis.circle" />}>
            <NavigationLink value={`userConnections:following:${userID}`}>
              <Label title="查看关注" systemImage="person.2" />
            </NavigationLink>
            <NavigationLink value={`userConnections:follower:${userID}`}>
              <Label title="查看粉丝" systemImage="person.2.badge.gearshape" />
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
      <UserWorkPicker kind={kind} onChanged={setKind} />
      <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <UserIllustFeed
          detail={detail}
          kind="illust"
          active={kind === "illust"}
          onRefresh={loadDetail}
        />
        <UserIllustFeed
          detail={detail}
          kind="manga"
          active={kind === "manga"}
          onRefresh={loadDetail}
        />
        <UserNovelFeed
          detail={detail}
          active={kind === "novel"}
          onRefresh={loadDetail}
        />
      </ZStack>
    </VStack>
  )
}

function UserIllustFeed(props: {
  detail: PixivUserDetail
  kind: IllustrationKind
  active: boolean
  onRefresh: () => Promise<void>
}) {
  const paged = usePagedList<PixivIllustration>({
    first: (token) => userWorks(props.detail.user.id, props.kind, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterIllustrations,
    deps: [props.detail.user.id, props.kind],
    enabled: props.active,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })
  const pagedRef = useLatest(paged)
  const activeRef = useLatest(props.active)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
      if (activeRef.current) pagedRef.current.refresh()
    })
  }, [])

  return (
    <RefreshableScrollView
      hidden={!props.active}
      navigationBarTitleDisplayMode="inline"
      refreshable={async () => {
        await Promise.all([props.onRefresh(), paged.refresh()])
      }}
    >
      <VStack alignment="leading" spacing={12} padding={{ top: 4, bottom: 20 }}>
        <UserProfileHeader detail={props.detail} />
        {paged.initialLoading ? (
          <LoadingView />
        ) : paged.error && paged.items.length === 0 ? (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        ) : paged.items.length === 0 ? (
          <EmptyView text="暂无投稿作品" />
        ) : (
          <MasonryIllustFeed
            items={paged.items}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function UserNovelFeed(props: {
  detail: PixivUserDetail
  active: boolean
  onRefresh: () => Promise<void>
}) {
  const paged = usePagedList<PixivNovel>({
    first: (token) => userNovels(props.detail.user.id, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterNovels,
    deps: [props.detail.user.id],
    enabled: props.active,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(novelThumbUrlOf)).cancel,
  })
  const pagedRef = useLatest(paged)
  const activeRef = useLatest(props.active)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
      if (activeRef.current) pagedRef.current.refresh()
    })
  }, [])

  return (
    <RefreshableScrollView
      hidden={!props.active}
      navigationBarTitleDisplayMode="inline"
      refreshable={async () => {
        await Promise.all([props.onRefresh(), paged.refresh()])
      }}
    >
      <VStack alignment="leading" spacing={12} padding={{ top: 4, bottom: 20 }}>
        <UserProfileHeader detail={props.detail} />
        {paged.initialLoading ? (
          <LoadingView />
        ) : paged.error && paged.items.length === 0 ? (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        ) : paged.items.length === 0 ? (
          <EmptyView text="暂无小说投稿" systemImage="book" />
        ) : (
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
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function UserProfileHeader(props: { detail: PixivUserDetail }) {
  const { detail } = props
  const { user, profile, workspace } = detail
  const fields = [
    profile.webpage ? ["主页", profile.webpage] : null,
    profile.gender ? ["性别", profile.gender] : null,
    profile.birth ? ["生日", profile.birth] : null,
    profile.region ? ["地区", profile.region] : null,
    profile.job ? ["职业", profile.job] : null,
    profile.twitter_url
      ? ["X", profile.twitter_account ? `@${profile.twitter_account}` : profile.twitter_url]
      : null,
    workspace?.comment ? ["创作环境", workspace.comment] : null,
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

        <VStack alignment="leading" spacing={6}>
          <Text font="subheadline" fontWeight="semibold">
            关于
          </Text>
          {user.comment ? (
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {htmlToPlainText(user.comment)}
            </Text>
          ) : (
            <Text font="footnote" foregroundStyle="secondaryLabel">
              该用户尚未填写简介
            </Text>
          )}
        </VStack>

        {fields.length > 0 ? (
          <VStack alignment="leading" spacing={8}>
            <Divider />
            {fields.map(([label, value]) => (
              <HStack key={label} alignment="top" spacing={10}>
                <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ width: 58, alignment: "leading" }}>
                  {label}
                </Text>
                <Text font="footnote" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  {value}
                </Text>
              </HStack>
            ))}
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
