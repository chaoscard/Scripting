import { hasHistory } from "./history"
import { isSeriesWatched } from "./watchlist"
import { isUserFollowed } from "./userFollow"
import {
  loadSettings,
  isTagBlocked,
  isUserBlocked,
  type AppSettings,
} from "./settings"

export interface ContentVisibilityContext {
  isAuthorFollowed?: boolean
  isAuthorFriend?: boolean
  isSeriesWatched?: boolean
  isBookmarked?: boolean
  hasHistory?: boolean
}

/**
 * 判断 R18 / R18G 分级内容是否可见。
 * x_restrict: 0 = 全年龄, 1 = R-18, 2 = R-18G
 * Pixiv 官方体系中 R-18 (x_restrict=1) 与 R-18G (x_restrict=2) 互斥。
 */
export function isR18ContentVisible(
  xRestrict: number,
  showR18: boolean,
  showR18G: boolean
): boolean {
  if (xRestrict === 0) return true
  if (xRestrict === 1) return showR18
  if (xRestrict === 2) return showR18G
  return false
}

/**
 * 判定插画作品是否符合豁免规则。
 * 豁免规则：
 * 1. 关注、好友与追更豁免 (settings.followFilterExempt):
 *    - 作者处于已关注或好友状态 (item.user.is_followed / item.user.is_mypixiv 或 context.isAuthorFollowed / context.isAuthorFriend 或 关注缓存)
 *    - 作品所属系列处于追更状态 (item.series.id 追更 或 context.isSeriesWatched)
 * 2. 收藏与记录豁免 (settings.libraryFilterExempt):
 *    - 作品处于收藏状态 (item.is_bookmarked 或 context.isBookmarked)
 *    - 作品存在于本地浏览历史中 (hasHistory 或 context.hasHistory)
 */
export function isIllustExempt(
  item: {
    id?: number
    user?: { id?: number; is_followed?: boolean; is_mypixiv?: boolean }
    series?: { id?: number } | null
    is_bookmarked?: boolean
  },
  settings: AppSettings = loadSettings(),
  context?: boolean | ContentVisibilityContext
): boolean {
  if (typeof context === "boolean") {
    if (context) return true
  } else if (context && typeof context === "object") {
    if (
      settings.followFilterExempt &&
      (context.isAuthorFollowed || context.isAuthorFriend || context.isSeriesWatched)
    ) {
      return true
    }
    if (
      settings.libraryFilterExempt &&
      (context.isBookmarked || context.hasHistory)
    ) {
      return true
    }
  }

  if (settings.followFilterExempt) {
    if (
      item.user?.is_followed ||
      item.user?.is_mypixiv ||
      (item.user?.id != null && isUserFollowed(item.user.id) === true)
    ) {
      return true
    }
    if (item.series?.id != null && isSeriesWatched(item.series.id)) {
      return true
    }
  }

  if (settings.libraryFilterExempt) {
    if (item.is_bookmarked) {
      return true
    }
    if (item.id != null && hasHistory(item.id, "illust")) {
      return true
    }
  }

  return false
}

/**
 * 判定小说作品是否符合豁免规则。
 */
export function isNovelExempt(
  item: {
    id?: number
    user?: { id?: number; is_followed?: boolean; is_mypixiv?: boolean }
    series?: { id?: number } | null
    is_bookmarked?: boolean
  },
  settings: AppSettings = loadSettings(),
  context?: boolean | ContentVisibilityContext
): boolean {
  if (typeof context === "boolean") {
    if (context) return true
  } else if (context && typeof context === "object") {
    if (
      settings.followFilterExempt &&
      (context.isAuthorFollowed || context.isAuthorFriend || context.isSeriesWatched)
    ) {
      return true
    }
    if (
      settings.libraryFilterExempt &&
      (context.isBookmarked || context.hasHistory)
    ) {
      return true
    }
  }

  if (settings.followFilterExempt) {
    if (
      item.user?.is_followed ||
      item.user?.is_mypixiv ||
      (item.user?.id != null && isUserFollowed(item.user.id) === true)
    ) {
      return true
    }
    if (item.series?.id != null && isSeriesWatched(item.series.id)) {
      return true
    }
  }

  if (settings.libraryFilterExempt) {
    if (item.is_bookmarked) {
      return true
    }
    if (item.id != null && hasHistory(item.id, "novel")) {
      return true
    }
  }

  return false
}

/**
 * 判断插画内容是否可见（综合分级、AI、黑名单、豁免）。
 */
export function isIllustContentVisible(
  item: {
    id?: number
    x_restrict: number
    illust_ai_type?: number
    tags?: { name: string }[]
    user?: { id?: number; is_followed?: boolean; is_mypixiv?: boolean }
    is_bookmarked?: boolean
    series?: { id?: number } | null
  },
  settings: AppSettings = loadSettings(),
  bypassOrContext?: boolean | ContentVisibilityContext
): boolean {
  // 1. 黑名单过滤（用户屏蔽、标签屏蔽），优先级最高，不可豁免
  if (item.user?.id && isUserBlocked(item.user.id, settings.blockedUsers)) {
    return false
  }
  if (
    Array.isArray(item.tags) &&
    item.tags.some((tag) => isTagBlocked(tag.name, settings.blockedTags))
  ) {
    return false
  }

  // 2. 检查是否豁免
  const exempt = isIllustExempt(item, settings, bypassOrContext)
  if (exempt) {
    return true
  }

  // 3. 分级检查 (0: 全年龄, 1: R-18, 2: R-18G)
  if (!isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G)) {
    return false
  }

  // 4. AI 检查 (illust_ai_type: 2 表示 AI 作品)
  if (!settings.showAI && item.illust_ai_type === 2) {
    return false
  }

  return true
}

/**
 * 判断小说内容是否可见（综合分级、AI、黑名单、豁免）。
 */
export function isNovelContentVisible(
  item: {
    id?: number
    x_restrict: number
    novel_ai_type?: number
    tags?: { name: string }[]
    user?: { id?: number; is_followed?: boolean; is_mypixiv?: boolean }
    is_bookmarked?: boolean
    series?: { id?: number } | null
  },
  settings: AppSettings = loadSettings(),
  bypassOrContext?: boolean | ContentVisibilityContext
): boolean {
  // 1. 黑名单过滤（用户屏蔽、标签屏蔽），优先级最高，不可豁免
  if (item.user?.id && isUserBlocked(item.user.id, settings.blockedUsers)) {
    return false
  }
  if (
    Array.isArray(item.tags) &&
    item.tags.some((tag) => isTagBlocked(tag.name, settings.blockedTags))
  ) {
    return false
  }

  // 2. 检查是否豁免
  const exempt = isNovelExempt(item, settings, bypassOrContext)
  if (exempt) {
    return true
  }

  // 3. 分级检查 (0: 全年龄, 1: R-18, 2: R-18G)
  if (!isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G)) {
    return false
  }

  // 4. AI 检查 (novel_ai_type: 2 表示 AI 作品)
  if (!settings.showAI && item.novel_ai_type === 2) {
    return false
  }

  return true
}
