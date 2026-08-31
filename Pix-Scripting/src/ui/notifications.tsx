import {
  HStack,
  Image,
  LazyVStack,
  NavigationLink,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import {
  notificationViewMore,
  notifications,
  nextNotifications,
  type PixivNotification,
} from "../api/pixiv"
import { currentBatchSize, useExperimentalAmbientPalette, usePagedList } from "./hooks"
import { prefetch } from "../image/imageLoader"
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
      title="我的通知"
      first={(token) => notifications(token)}
    />
  )
}

export function NotificationViewMoreView(props: { notificationID: number }) {
  return (
    <NotificationList
      title="通知详情"
      notificationID={props.notificationID}
      first={(token) => notificationViewMore(props.notificationID, token)}
    />
  )
}

function notificationThumbUrlOf(n: PixivNotification): string | null {
  return (
    n.content.right_image ??
    n.content.right_icon ??
    n.content.left_image ??
    n.content.left_icon ??
    null
  )
}

function NotificationList(props: {
  title: string
  notificationID?: number
  first: (token: string) => Promise<{
    items: PixivNotification[]
    nextURL: string | null
  }>
}) {
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(null)
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)

  const paged = usePagedList<PixivNotification>({
    first: props.first,
    more: (nextURL, token) => nextNotifications(nextURL, token),
    filter: filterNotifications,
    deps: [props.notificationID ?? "root"],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(notificationThumbUrlOf)).cancel,
  })

  const firstImageUrl = useMemo(() => {
    if (paged.items.length === 0) return null
    for (const item of paged.items) {
      const url = notificationThumbUrlOf(item)
      if (url) return url
    }
    return null
  }, [paged.items])

  useEffect(() => {
    if (paged.initialLoading) return
    setAmbientImageUrl(firstImageUrl)
  }, [paged.initialLoading, firstImageUrl])

  return (
    <RefreshableScrollView
      navigationTitle={props.title}
      navigationBarTitleDisplayMode="inline"
      background={ambientBackground}
      refreshable={paged.refresh}
    >
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无通知" systemImage="bell" />
      ) : (
        <LazyVStack
          alignment="leading"
          spacing={8}
          padding={{ horizontal: 10 }}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {paged.items.map((n, index) => (
            <NotificationRow key={n.id} notification={n} priority={index} />
          ))}
          <LoadMoreTrigger
            anchor={paged.items[paged.items.length - 1].id}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        </LazyVStack>
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

function NotificationRow(props: {
  notification: PixivNotification
  priority?: number
}) {
  const { notification: n, priority } = props
  const target = n.view_more
    ? `notificationsMore:${n.id}`
    : notificationRoute(n.target_url)

  const coverURL =
    n.content.right_image ?? n.content.right_icon ?? n.content.left_image
  const leadingIcon = n.content.left_icon

  const content = (
    <HStack
      spacing={10}
      alignment="top"
      padding={10}
      glassEffect={{ type: "rect", cornerRadius: 14 }}
      shadow={{ color: "#0000000F", radius: 18, y: 8 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      {/* 封面：复用小说卡片封面规范（68×96 竖版 0.71 比例，8px 圆角） */}
      {coverURL ? (
        <ZStack
          frame={{ width: 68, height: 96 }}
          clipShape={{ type: "rect", cornerRadius: 8 }}
        >
          <CachedImage
            url={coverURL}
            aspectRatioValue={0.71}
            centerCropAspect={0.71}
            cornerRadius={0}
            contentMode="fill"
            priority={priority}
            frame={{ width: 68, height: 96 }}
          />
        </ZStack>
      ) : leadingIcon ? (
        <ZStack
          frame={{ width: 68, height: 96 }}
          alignment="center"
        >
          <AvatarImage url={leadingIcon} size={48} priority={priority} />
        </ZStack>
      ) : (
        <ZStack
          frame={{ width: 68, height: 96 }}
          alignment="center"
        >
          <Image
            systemName="bell"
            font="title2"
            foregroundStyle="secondaryLabel"
          />
        </ZStack>
      )}

      {/* 右侧信息区：时间始终位于最底部 */}
      <VStack
        alignment="leading"
        spacing={4}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        {coverURL && leadingIcon ? (
          <HStack spacing={6} alignment="center">
            <AvatarImage url={leadingIcon} size={18} priority={priority} />
            <Text
              font="subheadline"
              fontWeight="semibold"
              lineLimit={2}
              multilineTextAlignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {htmlToPlainText(n.content.text)}
            </Text>
          </HStack>
        ) : (
          <Text
            font="subheadline"
            fontWeight="semibold"
            lineLimit={3}
            multilineTextAlignment="leading"
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {htmlToPlainText(n.content.text)}
          </Text>
        )}

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

        <Spacer />

        {/* 时间始终位于最底部 */}
        <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
          <Text
            font="caption2"
            foregroundStyle="secondaryLabel"
            lineLimit={1}
          >
            {formatDate(n.created_datetime)}
          </Text>
          <Spacer />
          {n.view_more ? (
            <HStack spacing={2} alignment="center">
              <Text font="caption2" foregroundStyle="tertiaryLabel">
                查看更多
              </Text>
              <Image
                systemName="chevron.right"
                font="caption2"
                foregroundStyle="tertiaryLabel"
              />
            </HStack>
          ) : null}
        </HStack>
      </VStack>
    </HStack>
  )

  return target ? (
    <NavigationLink value={target}>{content}</NavigationLink>
  ) : (
    content
  )
}

function notificationRoute(targetURL: string): string | null {
  const match = targetURL.match(
    /^pixiv:\/\/(users|artworks|illusts|novels)\/(\d+)$/
  )
  if (!match) return null
  const id = Number(match[2])
  if (!Number.isFinite(id) || id <= 0) return null
  if (match[1] === "users") return `user:${id}`
  if (match[1] === "novels") return `novel:${id}`
  if (match[1] === "artworks" || match[1] === "illusts") return `illust:${id}`
  return null
}
