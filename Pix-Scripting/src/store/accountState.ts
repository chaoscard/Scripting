import { clearBookmarkMemoryCache } from "./bookmarkSync"
import { clearFollowMemoryCache } from "./userFollow"
import { clearIllustMemoryCache } from "./illustCache"
import { clearHistoryMemoryCache } from "./history"
import { clearSearchHistoryMemoryCache } from "./searchHistory"
import { clearNovelProgressMemoryCache } from "./novelProgress"

/**
 * 当用户注销、切换账号或登录态变更时，集中清空内存中所有账号态缓存，
 * 防止旧账号的收藏、关注、追更、历史、搜索和阅读进度污染新账号。
 */
export function clearAllAccountStateCaches(): void {
  try {
    clearBookmarkMemoryCache()
  } catch {}
  try {
    clearFollowMemoryCache()
  } catch {}
  try {
    clearIllustMemoryCache()
  } catch {}
  try {
    clearHistoryMemoryCache()
  } catch {}
  try {
    clearSearchHistoryMemoryCache()
  } catch {}
  try {
    clearNovelProgressMemoryCache()
  } catch {}
}
