import type { PixivUser } from "../types"

export interface BlockedUser {
  id: number
  name: string
  account: string
  avatarURL?: string
}

export type FeedImageQuality = "medium" | "large"
export type DetailImageQuality = "medium" | "large" | "original"
export type DownloadImageQuality = "large" | "original"
export type CloseButtonAction = "minimize" | "exit"

export interface AppSettings {
  showR18: boolean
  showR18G: boolean
  showAI: boolean
  followFilterExempt: boolean
  blockedTags: string[]
  blockedUsers: BlockedUser[]
  ambientImmersion: boolean
  longPressBookmarkAction: "off" | "follow" | "detail"
  closeButtonAction: CloseButtonAction
  feedImageQuality: FeedImageQuality
  detailImageQuality: DetailImageQuality
  downloadImageQuality: DownloadImageQuality
  prefetchEnabled: boolean
  cacheLimitMB: number | null
  recordHistory: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  showR18: false,
  showR18G: false,
  showAI: true,
  followFilterExempt: false,
  blockedTags: [],
  blockedUsers: [],
  ambientImmersion: true,
  longPressBookmarkAction: "off",
  closeButtonAction: "minimize",
  feedImageQuality: "medium",
  detailImageQuality: "large",
  downloadImageQuality: "original",
  prefetchEnabled: true,
  cacheLimitMB: 300,
  recordHistory: true,
}

const KEY = "pixiv_settings_v1"
const FEED_QUALITY_VALUES: readonly FeedImageQuality[] = ["medium", "large"]
const DETAIL_QUALITY_VALUES: readonly DetailImageQuality[] = ["medium", "large", "original"]
const DOWNLOAD_QUALITY_VALUES: readonly DownloadImageQuality[] = ["large", "original"]
const LONG_PRESS_ACTION_VALUES: readonly AppSettings["longPressBookmarkAction"][] = ["off", "follow", "detail"]
const CLOSE_BUTTON_ACTION_VALUES: readonly CloseButtonAction[] = ["minimize", "exit"]
const CACHE_LIMIT_VALUES = [300, 500, 1000, 2000] as const

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T)
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function cacheLimitOf(value: unknown): number | null {
  if (value == null) return null
  return typeof value === "number" && CACHE_LIMIT_VALUES.includes(value as typeof CACHE_LIMIT_VALUES[number])
    ? value
    : DEFAULT_SETTINGS.cacheLimitMB
}

export function isR18ContentVisible(xRestrict: number, showR18: boolean, showR18G: boolean): boolean {
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
  return updateSettings({ blockedTags: settings.blockedTags.filter((item) => item !== tag) })
}

export function isUserBlocked(userID: number, blockedUsers = loadSettings().blockedUsers): boolean {
  return blockedUsers.some((user) => user.id === userID)
}

export function blockUser(user: PixivUser): AppSettings {
  const settings = loadSettings()
  if (settings.blockedUsers.some((item) => item.id === user.id)) return settings
  return updateSettings({
    blockedUsers: [...settings.blockedUsers, {
      id: user.id,
      name: user.name,
      account: user.account,
      avatarURL: user.profile_image_urls?.medium,
    }],
  })
}

export function unblockUser(userID: number): AppSettings {
  const settings = loadSettings()
  return updateSettings({ blockedUsers: settings.blockedUsers.filter((user) => user.id !== userID) })
}

export function isIllustContentVisible(
  item: { x_restrict: number; illust_ai_type?: number; tags?: { name: string }[]; user?: { id: number } },
  settings = loadSettings(),
  bypassRatingAndAI = false
): boolean {
  return (
    (bypassRatingAndAI || (
      isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G) &&
      (settings.showAI || item.illust_ai_type !== 2)
    )) &&
    !isUserBlocked(item.user?.id ?? 0, settings.blockedUsers) &&
    !(item.tags ?? []).some((tag) => isTagBlocked(tag.name, settings.blockedTags))
  )
}

const listeners = new Set<() => void>()

export function onSettingsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emitChanged(): void {
  for (const fn of listeners) {
    try { fn() } catch {}
  }
}

export function loadSettings(): AppSettings {
  const stored = Storage.get<Partial<AppSettings> & Record<string, unknown>>(KEY)
  const legacyDetailQuality = isOneOf(stored?.imageQuality, DETAIL_QUALITY_VALUES)
    ? stored.imageQuality
    : DEFAULT_SETTINGS.detailImageQuality
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    showR18: boolOr(stored?.showR18, DEFAULT_SETTINGS.showR18),
    showR18G: boolOr(stored?.showR18G, DEFAULT_SETTINGS.showR18G),
    showAI: boolOr(stored?.showAI, DEFAULT_SETTINGS.showAI),
    followFilterExempt: boolOr(stored?.followFilterExempt, DEFAULT_SETTINGS.followFilterExempt),
    blockedTags: Array.isArray(stored?.blockedTags)
      ? stored.blockedTags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
      : DEFAULT_SETTINGS.blockedTags,
    blockedUsers: Array.isArray(stored?.blockedUsers)
      ? (stored.blockedUsers as unknown[])
          .filter((user): user is Record<string, unknown> => typeof user === "object" && user != null)
          .map((user): BlockedUser => ({
            id: typeof user.id === "number" ? user.id : 0,
            name: typeof user.name === "string" ? user.name : "",
            account: typeof user.account === "string" ? user.account : "",
            avatarURL: typeof user.avatarURL === "string" ? user.avatarURL : undefined,
          }))
          .filter((user) => user.id > 0 && user.name.length > 0)
      : DEFAULT_SETTINGS.blockedUsers,
    ambientImmersion: boolOr(stored?.ambientImmersion, DEFAULT_SETTINGS.ambientImmersion),
    longPressBookmarkAction: isOneOf(stored?.longPressBookmarkAction, LONG_PRESS_ACTION_VALUES)
      ? stored.longPressBookmarkAction
      : DEFAULT_SETTINGS.longPressBookmarkAction,
    closeButtonAction: isOneOf(stored?.closeButtonAction, CLOSE_BUTTON_ACTION_VALUES)
      ? stored.closeButtonAction
      : DEFAULT_SETTINGS.closeButtonAction,
    feedImageQuality: isOneOf(stored?.feedImageQuality, FEED_QUALITY_VALUES)
      ? stored.feedImageQuality
      : DEFAULT_SETTINGS.feedImageQuality,
    detailImageQuality: isOneOf(stored?.detailImageQuality, DETAIL_QUALITY_VALUES)
      ? stored.detailImageQuality
      : legacyDetailQuality,
    downloadImageQuality: isOneOf(stored?.downloadImageQuality, DOWNLOAD_QUALITY_VALUES)
      ? stored.downloadImageQuality
      : DEFAULT_SETTINGS.downloadImageQuality,
    prefetchEnabled: boolOr(stored?.prefetchEnabled, DEFAULT_SETTINGS.prefetchEnabled),
    cacheLimitMB: cacheLimitOf(stored?.cacheLimitMB),
    recordHistory: boolOr(stored?.recordHistory, DEFAULT_SETTINGS.recordHistory),
  }
  if (JSON.stringify(stored) !== JSON.stringify(merged)) Storage.set(KEY, merged)
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
