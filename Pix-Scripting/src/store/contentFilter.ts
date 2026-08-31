import { loadSettings, type AppSettings } from "./settings"
import {
  isTagBlocked,
  isUserBlocked,
  loadBlocklist,
  type BlocklistData,
} from "./blocklist"

export interface FilterableIllust {
  id?: number
  user?: { id?: number; name?: string } | null
  tags?: { name: string }[] | null
  x_restrict?: number
  illust_ai_type?: number
}

export interface FilterableNovel {
  id?: number
  user?: { id?: number; name?: string } | null
  tags?: { name: string }[] | null
  x_restrict?: number
  novel_ai_type?: number
}

export interface ContentFilterOptions {
  /**
   * 是否豁免 R18/R18G/AI 作品过滤限制（黑名单用户与标签仍然生效）
   */
  exemptRestrictions?: boolean
  /**
   * 是否豁免用户黑名单过滤（例如进入该用户个人主页查看作品时，不因作者被屏蔽而隐藏作品）
   */
  exemptBlockedUser?: boolean
}

export type ContentFilterBlockReason = "blocklist" | "restriction" | null

/**
 * 获取插画/漫画内容的拦截原因。
 * 返回 null 表示完全可见；
 * 返回 "blocklist" 表示被用户黑名单或标签黑名单拦截；
 * 返回 "restriction" 表示被 R18/R18G/AI 设置项过滤。
 */
export function getIllustContentBlockReason(
  item: FilterableIllust,
  settings: AppSettings = loadSettings(),
  blocklist: BlocklistData = loadBlocklist(),
  options?: ContentFilterOptions
): ContentFilterBlockReason {
  if (!options?.exemptBlockedUser && item.user?.id && isUserBlocked(item.user.id, blocklist.blockedUsers)) {
    return "blocklist"
  }
  if (
    Array.isArray(item.tags) &&
    item.tags.some((tag) => isTagBlocked(tag.name, blocklist.blockedTags))
  ) {
    return "blocklist"
  }
  if (options?.exemptRestrictions) {
    return null
  }
  if (item.x_restrict === 1 && !settings.showR18) {
    return "restriction"
  }
  if (item.x_restrict === 2 && !settings.showR18G) {
    return "restriction"
  }
  if (item.illust_ai_type === 2 && !settings.showAI) {
    return "restriction"
  }
  return null
}

/**
 * 获取小说内容的拦截原因。
 */
export function getNovelContentBlockReason(
  item: FilterableNovel,
  settings: AppSettings = loadSettings(),
  blocklist: BlocklistData = loadBlocklist(),
  options?: ContentFilterOptions
): ContentFilterBlockReason {
  if (!options?.exemptBlockedUser && item.user?.id && isUserBlocked(item.user.id, blocklist.blockedUsers)) {
    return "blocklist"
  }
  if (
    Array.isArray(item.tags) &&
    item.tags.some((tag) => isTagBlocked(tag.name, blocklist.blockedTags))
  ) {
    return "blocklist"
  }
  if (options?.exemptRestrictions) {
    return null
  }
  if (item.x_restrict === 1 && !settings.showR18) {
    return "restriction"
  }
  if (item.x_restrict === 2 && !settings.showR18G) {
    return "restriction"
  }
  if (item.novel_ai_type === 2 && !settings.showAI) {
    return "restriction"
  }
  return null
}

/**
 * 判断插画/漫画内容是否可见。
 * 结合独立黑名单与设置项：
 * 1. 独立黑名单文件的标签/用户黑名单拦截；
 * 2. R18 / R18G 开关控制；
 * 3. AI 作品开关控制。
 */
export function isIllustContentVisible(
  item: FilterableIllust,
  settings: AppSettings = loadSettings(),
  blocklist: BlocklistData = loadBlocklist(),
  options?: ContentFilterOptions
): boolean {
  return getIllustContentBlockReason(item, settings, blocklist, options) === null
}

/**
 * 判断小说内容是否可见。
 */
export function isNovelContentVisible(
  item: FilterableNovel,
  settings: AppSettings = loadSettings(),
  blocklist: BlocklistData = loadBlocklist(),
  options?: ContentFilterOptions
): boolean {
  return getNovelContentBlockReason(item, settings, blocklist, options) === null
}
