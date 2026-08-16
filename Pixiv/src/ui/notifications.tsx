import {
  HStack,
  Image,
  NavigationLink,
  Spacer,
  Text,
  VStack,
} from "scripting"
import {
  notificationViewMore,
  notifications,
  nextNotifications,
  type PixivNotification,
} from "../api/pixiv"
import { usePagedList } from "./hooks"
import {
  AvatarImage,
  CachedImage,
  EmptyView,
  ErrorView,
  formatDate,
  htmlToPlainText,
  LoadMoreTrigger,
  LoadingView,
  RefreshableScrollView,
} from "./components"

export function NotificationsView() {
  return (
    <NotificationList
      title="通知"
      first={(token) => notifications(token)}
    />
  )
}

export function NotificationViewMoreView(props: { notificationID: number }) {
  return (
    <NotificationList
      title="通知详情"
      first={(token) => notificationViewMore(props.notificationID, token)}
    />
  )
}

function NotificationList(props: {
  title: string
  first: (token: string) => Promise<{
    items: PixivNotification[]
    nextURL: string | null
  }>
}) {
  const paged = usePagedList<PixivNotification>({
    first: props.first,
    more: (nextURL, token) => nextNotifications(nextURL, token),
    filter: filterNotifications,
    deps: [],
  })

  return (
    <RefreshableScrollView
      navigationTitle={props.title}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无通知" systemImage="bell" />
      ) : (
        <VStack alignment="leading" spacing={8} padding={{ horizontal: 10 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          {paged.items.map((n) => (
            <NotificationRow key={n.id} notification={n} />
          ))}
          <LoadMoreTrigger
            anchor={paged.items[paged.items.length - 1].id}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        </VStack>
      )}
    </RefreshableScrollView>
  )
}

function filterNotifications(items: PixivNotification[]): PixivNotification[] {
  // 公告和外部跳转没有可用的站内目标，因此不展示。
  return items.filter(
    (notification) => notificationRoute(notification.target_url) != null
  )
}

function NotificationRow(props: { notification: PixivNotification }) {
  const { notification: n } = props
  const target = n.view_more
    ? `notificationsMore:${n.id}`
    : notificationRoute(n.target_url)
  const leadingIcon = n.content.left_icon
  const leadingImage = n.content.left_image
  const trailingImage = n.content.right_image ?? n.content.right_icon

  const isNovel =
    n.target_url.includes("/novels/") ||
    n.target_url.includes("novels") ||
    (target != null && target.startsWith("novel:"))

  const content = (
    <HStack
      spacing={10}
      alignment="top"
      padding={10}
      glassEffect={{ type: "rect", cornerRadius: 8 }}
      glassEffectTransition="materialize"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      {leadingIcon ? (
        <AvatarImage url={leadingIcon} size={42} />
      ) : leadingImage ? (
        <CachedImage
          url={leadingImage}
          aspectRatioValue={1}
          contentMode={isNovel ? "fit" : "fill"}
          useIntrinsicAspectRatio={isNovel}
          cornerRadius={6}
          frame={isNovel ? { maxWidth: 42, maxHeight: 42 } : { width: 42, height: 42 }}
        />
      ) : (
        <Image
          systemName="bell"
          font="title3"
          foregroundStyle="secondaryLabel"
          frame={{ width: 42, height: 42 }}
        />
      )}
      <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text
          font="footnote"
          lineLimit={2}
          multilineTextAlignment="leading"
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {htmlToPlainText(n.content.text)}
        </Text>
        {n.view_more?.title ? (
          <Text
            font="caption"
            foregroundStyle="secondaryLabel"
            lineLimit={1}
            multilineTextAlignment="leading"
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {n.view_more.title}
          </Text>
        ) : null}
        <Text
          font="caption2"
          foregroundStyle="secondaryLabel"
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {formatDate(n.created_datetime)}
        </Text>
      </VStack>
      {trailingImage ? (
        <CachedImage
          url={trailingImage}
          aspectRatioValue={1}
          contentMode={isNovel ? "fit" : "fill"}
          useIntrinsicAspectRatio={isNovel}
          cornerRadius={6}
          frame={isNovel ? { maxWidth: 56, maxHeight: 56 } : { width: 56, height: 56 }}
        />
      ) : n.view_more ? (
        <Image
          systemName="chevron.right"
          font="caption"
          foregroundStyle="tertiaryLabel"
        />
      ) : (
        <Spacer frame={{ minWidth: 0 }} />
      )}
    </HStack>
  )

  return target ? (
    <NavigationLink value={target}>{content}</NavigationLink>
  ) : (
    content
  )
}

function notificationRoute(targetURL: string): string | null {
  const match = targetURL.match(/^pixiv:\/\/(users|artworks|illusts|novels)\/(\d+)$/)
  if (!match) return null
  const id = Number(match[2])
  if (!Number.isFinite(id) || id <= 0) return null
  if (match[1] === "users") return `user:${id}`
  if (match[1] === "novels") return `novel:${id}`
  if (match[1] === "artworks" || match[1] === "illusts") return `illust:${id}`
  return null
}
