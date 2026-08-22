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
  blocklist: BlocklistData = loadBlocklist()
): boolean {
  if (item.user?.id && isUserBlocked(item.user.id, blocklist.blockedUsers)) {
    return false
  }
  if (
    Array.isArray(item.tags) &&
    item.tags.some((tag) => isTagBlocked(tag.name, blocklist.blockedTags))
  ) {
    return false
  }
  if (item.x_restrict === 1 && !settings.showR18) {
    return false
  }
  if (item.x_restrict === 2 && !settings.showR18G) {
    return false
  }
  if (item.illust_ai_type === 2 && !settings.showAI) {
    return false
  }
  return true
}

/**
 * 判断小说内容是否可见。
 */
export function isNovelContentVisible(
  item: FilterableNovel,
  settings: AppSettings = loadSettings(),
  blocklist: BlocklistData = loadBlocklist()
): boolean {
  if (item.user?.id && isUserBlocked(item.user.id, blocklist.blockedUsers)) {
    return false
  }
  if (
    Array.isArray(item.tags) &&
    item.tags.some((tag) => isTagBlocked(tag.name, blocklist.blockedTags))
  ) {
    return false
  }
  if (item.x_restrict === 1 && !settings.showR18) {
    return false
  }
  if (item.x_restrict === 2 && !settings.showR18G) {
    return false
  }
  if (item.novel_ai_type === 2 && !settings.showAI) {
    return false
  }
  return true
}
