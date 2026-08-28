// 全局路由表：各 Tab 根视图的 navigationDestination 共用
// 注意：navigationDestination 必须挂在根视图属性上（不能作为 NavigationStack 子元素）
import { NavigationDestination, VStack } from "scripting"
import { session } from "../api/session"
import { IllustDetailView } from "./illustDetail"
import { PixivisionDetailView } from "./pixivisionDetail"
import { UserDetailView } from "./userDetail"
import { NovelDetailView } from "./novelDetail"
import { TagFeedView } from "./tagFeed"
import { RelatedIllustFeedView } from "./relatedIllustFeed"
import { NovelLibraryView } from "./novelLibrary"
import { LibraryView } from "./library"
import { HistoryView } from "./history"
import { NotificationViewMoreView, NotificationsView } from "./notifications"
import { BlockedSettingsView } from "./blockedSettings"
import { SettingsView } from "./settings"
import { CustomAISettingsView } from "./customAISettings"
import { SeriesView } from "./seriesView"
import { UserBookmarksView } from "./userBookmarks"
import { UserConnectionsView, type ConnectionRouteKind } from "./userConnections"
import { UserWorksView } from "./userWorks"
import { AboutView } from "./about"
import { RankingCustomPickerView, type CustomRankingPickerKind } from "./rankingCustomPicker"
import { seedIllustFromWidgetPool, seedPixivisionFromWidgetPool } from "../store/widgetStore"

// 解析与规范化各类路由格式（支持 URL 编码如 %3A、纯数字 ID、Pixiv 网页链接等）
export function normalizeRoute(rawRoute: string): string {
  if (!rawRoute || typeof rawRoute !== "string") return ""
  let decoded = rawRoute.trim()
  try {
    decoded = decodeURIComponent(decoded)
  } catch {}
  if (
    decoded.includes("%3A") ||
    decoded.includes("%3a") ||
    decoded.includes("%2F") ||
    decoded.includes("%2f")
  ) {
    try {
      decoded = decodeURIComponent(decoded)
    } catch {}
  }
  decoded = decoded.replace(/^["']|["']$/g, "").trim()
  if (!decoded) return ""

  // 纯数字当作插画/漫画 ID
  if (/^\d+$/.test(decoded)) {
    return `illust:${decoded}`
  }
  // 网页链接匹配 https://www.pixiv.net/artworks/123456
  const artworkMatch = decoded.match(/artworks\/(\d+)/)
  if (artworkMatch) {
    return `illust:${artworkMatch[1]}`
  }
  const novelMatch = decoded.match(/novel\/(?:show|series)\.php\?id=(\d+)/)
  if (novelMatch) {
    return `novel:${novelMatch[1]}`
  }
  const userMatch = decoded.match(/users\/(\d+)/)
  if (userMatch) {
    return `user:${userMatch[1]}`
  }
  return decoded
}

// 解析 "xxx:123" 形式的数值 id；非法输入返回 null（避免 NaN 传给详情页）
function parseID(value: string, prefix: string): number | null {
  const normalized = normalizeRoute(value)
  if (normalized.startsWith(prefix)) {
    const id = Number(normalized.slice(prefix.length))
    return Number.isFinite(id) && id > 0 ? id : null
  }
  if (prefix === "illust:" && /^\d+$/.test(normalized)) {
    const id = Number(normalized)
    return Number.isFinite(id) && id > 0 ? id : null
  }
  return null
}

// 解析 URL 编码的标签名；畸形百分号编码抛异常时回退原始文本
function decodeTag(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

let routeNavigationSeq = 0

export function renderDestination(rawPage: string) {
  const page = normalizeRoute(rawPage)
  if (page.startsWith("illust:")) {
    const id = parseID(page, "illust:")
    if (id != null) {
      seedIllustFromWidgetPool(id)
      return <IllustDetailView key={`illust-${id}-${++routeNavigationSeq}`} illustID={id} />
    }
  }
  if (page.startsWith("pixivision:")) {
    const id = parseID(page, "pixivision:")
    if (id != null) {
      seedPixivisionFromWidgetPool(id)
      return <PixivisionDetailView articleID={id} />
    }
  }
  if (page.startsWith("user:")) {
    const id = parseID(page, "user:")
    if (id != null) return <UserDetailView userID={id} />
  }
  if (page.startsWith("novel:")) {
    const id = parseID(page, "novel:")
    if (id != null) return <NovelDetailView key={`novel-${id}`} novelID={id} />
  }
  if (page.startsWith("mangaSeries:")) {
    const id = parseID(page, "mangaSeries:")
    if (id != null) return <SeriesView kind="manga" seriesID={id} />
  }
  if (page.startsWith("novelSeries:")) {
    const id = parseID(page, "novelSeries:")
    if (id != null) return <SeriesView kind="novel" seriesID={id} />
  }
  if (page.startsWith("relatedIllust:")) {
    const id = parseID(page, "relatedIllust:")
    if (id != null) return <RelatedIllustFeedView illustID={id} />
  }
  if (page.startsWith("tag:")) {
    return <TagFeedView tag={decodeTag(page.slice("tag:".length))} kind="illust" />
  }
  if (page.startsWith("novelTag:")) {
    return <TagFeedView tag={decodeTag(page.slice("novelTag:".length))} kind="novel" />
  }
  if (page === "novelBookmarks") return <NovelLibraryView />
  if (page === "library") return <LibraryView />
  if (page === "history") return <HistoryView />
  if (page === "notifications") return <NotificationsView />
  if (page.startsWith("notificationsMore:")) {
    const id = parseID(page, "notificationsMore:")
    if (id != null) return <NotificationViewMoreView notificationID={id} />
  }
  if (page.startsWith("userBookmarks:")) {
    const id = parseID(page, "userBookmarks:")
    if (id != null) return <UserBookmarksView userID={id} />
  }
  if (page.startsWith("userConnections:")) {
    const parts = page.split(":")
    const kind = parts[1]
    const id = parts.length === 3 ? Number(parts[2]) : null
    if (
      (kind === "following" || kind === "follower" || kind === "mypixiv") &&
      Number.isFinite(id) &&
      (id as number) > 0
    ) {
      return (
        <UserConnectionsView
          kind={kind as ConnectionRouteKind}
          userID={id as number}
          title={kind === "mypixiv" ? "好友" : kind === "follower" ? "粉丝" : "关注"}
        />
      )
    }
  }
  if (page === "connections:following") return <UserConnectionsView kind="following" />
  if (page === "connections:follower") return <UserConnectionsView kind="follower" />
  if (page === "friends") {
    return (
      <UserConnectionsView
        kind="mypixiv"
        userID={session.userID ?? undefined}
        title="我的好友"
      />
    )
  }
  if (page === "myWorks") {
    return <UserWorksView title="我的作品" />
  }
  if (page.startsWith("userWorks:")) {
    const id = parseID(page, "userWorks:")
    if (id != null) return <UserWorksView userID={id} title="作品" />
  }
  if (page.startsWith("rankingCustomPicker:")) {
    const kind = page.slice("rankingCustomPicker:".length) as CustomRankingPickerKind
    if (kind === "illust" || kind === "manga" || kind === "novel") {
      return <RankingCustomPickerView kind={kind} />
    }
  }
  if (page === "blockedSettings") return <BlockedSettingsView />
  if (page === "customAISettings") return <CustomAISettingsView />
  if (page === "settings") return <SettingsView />
  if (page === "about") return <AboutView />
  // 未知路由静默兜底（内部路由表固定，正常不会走到）
  return <VStack />
}

// 每个 Tab 根视图通过 navigationDestination 属性挂载路由
// 用法：<ScrollView navigationDestination={destinationElement} ...>
export const destinationElement = (
  <NavigationDestination>
    {(path: string) => renderDestination(path)}
  </NavigationDestination>
)
