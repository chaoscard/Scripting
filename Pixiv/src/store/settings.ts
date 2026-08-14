import type { PixivUser } from "../types"

export interface BlockedUser {
  id: number
  name: string
  account: string
  avatarURL?: string
}

export interface AppSettings {
  // 内容显示
  showR18: boolean
  showR18G: boolean
  showAI: boolean
  blockedTags: string[]
  blockedUsers: BlockedUser[]
  // 收藏交互
  longPressBookmarkAction: "off" | "follow" | "detail"
  // 图片
  imageQuality: "medium" | "large" | "original"
  prefetchEnabled: boolean
  cacheLimitMB: number
  // 浏览记录
  recordHistory: boolean
  historyLimit: number
}

const DEFAULT_SETTINGS: AppSettings = {
  // 内容显示
  showR18: false,
  showR18G: false,
  showAI: true,
  blockedTags: [],
  blockedUsers: [],
  // 收藏交互
  longPressBookmarkAction: "off",
  // 图片
  imageQuality: "large",
  prefetchEnabled: true,
  cacheLimitMB: 300,
  // 浏览记录
  recordHistory: true,
  historyLimit: 300,
}

const KEY = "pixiv_settings_v1"

// Pixiv x_restrict：0=全年龄、1=R18、2=R18G。
// 两个成人分级独立控制，未知等级采用默认拒绝策略。
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

export function isTagBlocked(tag: string, blockedTags = loadSettings().blockedTags): boolean {
  return blockedTags.includes(tag)
}

export function blockTag(tag: string): AppSettings {
  const name = tag.trim()
  if (!name) return loadSettings()
  const settings = loadSettings()
  if (settings.blockedTags.includes(name)) return settings
  return updateSettings({ blockedTags: [...settings.blockedTags, name] })
}

export function unblockTag(tag: string): AppSettings {
  const settings = loadSettings()
  return updateSettings({
    blockedTags: settings.blockedTags.filter((item) => item !== tag),
  })
}

export function isUserBlocked(
  userID: number,
  blockedUsers = loadSettings().blockedUsers
): boolean {
  return blockedUsers.some((user) => user.id === userID)
}

export function blockUser(user: PixivUser): AppSettings {
  const settings = loadSettings()
  if (settings.blockedUsers.some((item) => item.id === user.id)) return settings
  return updateSettings({
    blockedUsers: [
      ...settings.blockedUsers,
      {
        id: user.id,
        name: user.name,
        account: user.account,
        avatarURL: user.profile_image_urls?.medium,
      },
    ],
  })
}

export function unblockUser(userID: number): AppSettings {
  const settings = loadSettings()
  return updateSettings({
    blockedUsers: settings.blockedUsers.filter((user) => user.id !== userID),
  })
}

export function isIllustContentVisible(
  item: {
    x_restrict: number
    illust_ai_type?: number
    tags?: { name: string }[]
    user?: { id: number }
  },
  settings = loadSettings()
): boolean {
  return (
    isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G) &&
    (settings.showAI || item.illust_ai_type !== 2) &&
    !isUserBlocked(item.user?.id ?? 0, settings.blockedUsers) &&
    !(item.tags ?? []).some((tag) => isTagBlocked(tag.name, settings.blockedTags))
  )
}

// 设置变更订阅：列表页监听后立即重新加载过滤
const listeners = new Set<() => void>()

export function onSettingsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function emitChanged(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // 单个监听器异常不影响其他
    }
  }
}

export function loadSettings(): AppSettings {
  const stored = Storage.get<Partial<AppSettings> & Record<string, unknown>>(KEY)
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    showR18: stored?.showR18 ?? DEFAULT_SETTINGS.showR18,
    showR18G: stored?.showR18G ?? DEFAULT_SETTINGS.showR18G,
    showAI: stored?.showAI ?? DEFAULT_SETTINGS.showAI,
    blockedTags: Array.isArray(stored?.blockedTags)
      ? stored.blockedTags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
      : DEFAULT_SETTINGS.blockedTags,
    blockedUsers: Array.isArray(stored?.blockedUsers)
      ? (stored.blockedUsers as unknown[])
          .filter(
            (user): user is Record<string, unknown> =>
              typeof user === "object" && user != null
          )
          .map((user): BlockedUser => ({
            id: typeof user.id === "number" ? user.id : 0,
            name: typeof user.name === "string" ? user.name : "",
            account: typeof user.account === "string" ? user.account : "",
            avatarURL: typeof user.avatarURL === "string" ? user.avatarURL : undefined,
          }))
          .filter((user) => user.id > 0 && user.name.length > 0)
      : DEFAULT_SETTINGS.blockedUsers,
    longPressBookmarkAction:
      stored?.longPressBookmarkAction ?? DEFAULT_SETTINGS.longPressBookmarkAction,
    imageQuality: stored?.imageQuality ?? DEFAULT_SETTINGS.imageQuality,
    prefetchEnabled: stored?.prefetchEnabled ?? DEFAULT_SETTINGS.prefetchEnabled,
    cacheLimitMB: stored?.cacheLimitMB ?? DEFAULT_SETTINGS.cacheLimitMB,
    recordHistory: stored?.recordHistory ?? DEFAULT_SETTINGS.recordHistory,
    historyLimit: stored?.historyLimit ?? DEFAULT_SETTINGS.historyLimit,
  }
  // 读取时规范化存储，移除旧版和未知键，同时保持当前值不变。
  if (JSON.stringify(stored) !== JSON.stringify(merged)) {
    Storage.set(KEY, merged)
  }
  return merged
}

export function saveSettings(settings: AppSettings): void {
  Storage.set(KEY, settings)
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch }
  saveSettings(next)
  emitChanged()
  return next
}
