import {
  HStack,
  Text,
  useEffect,
  VStack,
} from "scripting"
import {
  notifications,
  nextNotifications,
  type PixivNotification,
} from "../api/pixiv"
import { thumbUrlOf } from "../image/imageLoader"
import { useLatest, usePagedList } from "./hooks"
import { formatDate, LoadMoreTrigger } from "./components"
import { CachedImage } from "./components"
import { EmptyView, ErrorView, LoadingView, RefreshableScrollView } from "./components"
import {
  isIllustContentVisible,
  isR18ContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"

export function NotificationsView() {
  const paged = usePagedList<PixivNotification>({
    first: (token) => notifications(token),
    more: (nextURL, token) => nextNotifications(nextURL, token),
    filter: filterNotifications,
    deps: [],
  })

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
      pagedRef.current.refresh()
    })
  }, [])

  return (
    <RefreshableScrollView
      navigationTitle="通知"
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
        <VStack alignment="leading" spacing={8} padding={{ horizontal: 10, top: 6 }}>
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
  const settings = loadSettings()
  return items.filter((notification) => {
    if (
      notification.illust &&
      !isIllustContentVisible(notification.illust, settings)
    ) {
      return false
    }
    if (
      notification.novel &&
      !isR18ContentVisible(notification.novel.x_restrict, settings.showR18, settings.showR18G)
    ) {
      return false
    }
    return true
  })
}

function NotificationRow(props: { notification: PixivNotification }) {
  const { notification: n } = props
  const user = n.user
  const illust = n.illust
  const thumb = illust ? thumbUrlOf(illust) : null

  let text = ""
  switch (n.type) {
    case "illust_followed":
      text = "关注了新作品"
      break
    case "bookmark":
      text = "收藏了你的作品"
      break
    case "comment":
      text = "评论了你的作品"
      break
    case "reply":
      text = "回复了你的评论"
      break
    case "follow":
      text = "关注了你"
      break
    default:
      text = n.type
  }

  return (
    <VStack
      alignment="leading"
      spacing={4}
      padding={10}
      glassEffect={{ type: "rect", cornerRadius: 14 }}
      glassEffectTransition="materialize"
      frame={{ maxWidth: "infinity" }}
    >
      <HStack spacing={10} alignment="top">
        {thumb ? (
          // 固定小尺寸缩略图，避免整宽大图撑高行
          <CachedImage
            url={thumb}
            aspectRatioValue={1}
            cornerRadius={8}
            frame={{ width: 56, height: 56 }}
          />
        ) : null}
        <VStack alignment="leading" spacing={3}>
          <Text font="footnote">
            {user?.name ?? "未知用户"} {text}
          </Text>
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {formatDate(n.created_at)}
          </Text>
        </VStack>
      </HStack>
    </VStack>
  )
}
