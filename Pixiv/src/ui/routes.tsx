// 全局路由表：各 Tab 根视图的 navigationDestination 共用
// 注意：navigationDestination 必须挂在根视图属性上（不能作为 NavigationStack 子元素）
import { NavigationDestination, VStack } from "scripting"
import { session } from "../api/session"
import { IllustDetailView } from "./illustDetail"
import { VisionDetailView } from "./visionDetail"
import { UserDetailView } from "./userDetail"
import { NovelDetailView } from "./novelDetail"
import { TagFeedView } from "./tagFeed"
import { NovelLibraryView } from "./novelLibrary"
import { LibraryView } from "./library"
import { HistoryView } from "./history"
import { NotificationsView } from "./notifications"
import { BlockedSettingsView } from "./blockedSettings"
import { SettingsView } from "./settings"
import { SeriesView } from "./seriesView"
import { UserBookmarksView } from "./userBookmarks"
import { UserConnectionsView } from "./userConnections"
import { AboutView } from "./about"

// 解析 "xxx:123" 形式的数值 id；非法输入返回 null（避免 NaN 传给详情页）
function parseID(value: string, prefix: string): number | null {
  const id = Number(value.slice(prefix.length))
  return Number.isFinite(id) && id > 0 ? id : null
}

// 解析 URL 编码的标签名；畸形百分号编码抛异常时回退原始文本
function decodeTag(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function renderDestination(page: string) {
  if (page.startsWith("illust:")) {
    const id = parseID(page, "illust:")
    if (id != null) return <IllustDetailView illustID={id} />
  }
  if (page.startsWith("vision:")) {
    const id = parseID(page, "vision:")
    if (id != null) return <VisionDetailView articleID={id} />
  }
  if (page.startsWith("user:")) {
    const id = parseID(page, "user:")
    if (id != null) return <UserDetailView userID={id} />
  }
  if (page.startsWith("novel:")) {
    const id = parseID(page, "novel:")
    if (id != null) return <NovelDetailView novelID={id} />
  }
  if (page.startsWith("mangaSeries:")) {
    const id = parseID(page, "mangaSeries:")
    if (id != null) return <SeriesView kind="manga" seriesID={id} />
  }
  if (page.startsWith("novelSeries:")) {
    const id = parseID(page, "novelSeries:")
    if (id != null) return <SeriesView kind="novel" seriesID={id} />
  }
  if (page.startsWith("tag:")) {
    return <TagFeedView tag={decodeTag(page.slice("tag:".length))} />
  }
  if (page === "novelBookmarks") return <NovelLibraryView />
  if (page === "library") return <LibraryView />
  if (page === "history") return <HistoryView />
  if (page === "notifications") return <NotificationsView />
  if (page.startsWith("userBookmarks:")) {
    const id = parseID(page, "userBookmarks:")
    if (id != null) return <UserBookmarksView userID={id} />
  }
  if (page.startsWith("userConnections:")) {
    const parts = page.split(":")
    const kind = parts[1]
    const id = parts.length === 3 ? Number(parts[2]) : null
    if (
      (kind === "following" || kind === "follower") &&
      Number.isFinite(id) &&
      (id as number) > 0
    ) {
      return <UserConnectionsView kind={kind} userID={id as number} />
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
  if (page === "blockedSettings") return <BlockedSettingsView />
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
