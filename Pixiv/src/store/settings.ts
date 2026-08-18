import type { PixivUser } from "../types"
import { pixivSettingsDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

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
export type WatchlistSortOrder = "asc" | "desc"
export type AmbientIntensity = "low" | "medium" | "high"
export type LaunchPage = "discovery" | "ranking" | "following"
export type ImageBatchConcurrency = "low" | "medium" | "high"

export interface AppSettings {
  launchPage: LaunchPage
  showR18: boolean
  showR18G: boolean
  showAI: boolean
  followFilterExempt: boolean
  libraryFilterExempt: boolean
  blockedTags: string[]
  blockedUsers: BlockedUser[]
  ambientImmersion: boolean
  ambientIntensity: AmbientIntensity
  watchlistSortOrder: WatchlistSortOrder
  longPressBookmarkAction: "off" | "follow" | "detail"
  closeButtonAction: CloseButtonAction
  feedImageQuality: FeedImageQuality
  detailImageQuality: DetailImageQuality
  downloadImageQuality: DownloadImageQuality
  prefetchEnabled: boolean
  cacheLimitMB: number | null
  recordHistory: boolean
  imageBatchConcurrency: ImageBatchConcurrency
}

const DEFAULT_SETTINGS: AppSettings = {
  launchPage: "discovery",
  showR18: false,
  showR18G: false,
  showAI: false,
  followFilterExempt: false,
  libraryFilterExempt: false,
  blockedTags: [],
  blockedUsers: [],
  ambientImmersion: true,
  ambientIntensity: "medium",
  watchlistSortOrder: "asc",
  longPressBookmarkAction: "off",
  closeButtonAction: "minimize",
  feedImageQuality: "medium",
  detailImageQuality: "large",
  downloadImageQuality: "original",
  prefetchEnabled: true,
  cacheLimitMB: 300,
  recordHistory: true,
  imageBatchConcurrency: "low",
}

const KEY = "pixiv_settings_v1"
const SETTINGS_FILE_NAME = "settings.json"
const LAUNCH_PAGE_VALUES: readonly LaunchPage[] = ["discovery", "ranking", "following"]
const WATCHLIST_SORT_VALUES: readonly WatchlistSortOrder[] = ["asc", "desc"]
const FEED_QUALITY_VALUES: readonly FeedImageQuality[] = ["medium", "large"]
const DETAIL_QUALITY_VALUES: readonly DetailImageQuality[] = ["medium", "large", "original"]
const DOWNLOAD_QUALITY_VALUES: readonly DownloadImageQuality[] = ["large", "original"]
const LONG_PRESS_ACTION_VALUES: readonly AppSettings["longPressBookmarkAction"][] = ["off", "follow", "detail"]
const CLOSE_BUTTON_ACTION_VALUES: readonly CloseButtonAction[] = ["minimize", "exit"]
const AMBIENT_INTENSITY_VALUES: readonly AmbientIntensity[] = ["low", "medium", "high"]
const IMAGE_CONCURRENCY_VALUES: readonly ImageBatchConcurrency[] = ["low", "medium", "high"]
const CACHE_LIMIT_VALUES = [300, 500, 1000, 2000] as const

export function getImageBatchSize(level: ImageBatchConcurrency = "low"): number {
  switch (level) {
    case "low":
      return 6
    case "medium":
      return 8
    case "high":
      return 10
    default:
      return 6
  }
}

let cachedSettings: AppSettings | null = null
const listeners = new Set<() => void>()

function settingsFilePath(): string {
  return `${pixivSettingsDirectory()}/${SETTINGS_FILE_NAME}`
}

export async function prepareSettingsStorage(): Promise<void> {
  if (!FileManager.isiCloudEnabled) return
  const path = settingsFilePath()
  if (
    !FileManager.existsSync(path) ||
    !FileManager.isFileStoredIniCloud(path) ||
    FileManager.isiCloudFileDownloaded(path)
  ) {
    return
  }
  try {
    await FileManager.downloadFileFromiCloud(path)
  } catch {
    // 云端文件暂不可下载时在下次启动或刷新时重试。
  }
}

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

function parseSettings(stored: Partial<AppSettings> & Record<string, unknown>): AppSettings {
  const legacyDetailQuality = isOneOf(stored?.imageQuality, DETAIL_QUALITY_VALUES)
    ? stored.imageQuality
    : DEFAULT_SETTINGS.detailImageQuality
  return {
    ...DEFAULT_SETTINGS,
    launchPage: isOneOf(stored?.launchPage, LAUNCH_PAGE_VALUES)
      ? stored.launchPage
      : DEFAULT_SETTINGS.launchPage,
    showR18: boolOr(stored?.showR18, DEFAULT_SETTINGS.showR18),
    showR18G: boolOr(stored?.showR18G, DEFAULT_SETTINGS.showR18G),
    showAI: boolOr(stored?.showAI, DEFAULT_SETTINGS.showAI),
    followFilterExempt: boolOr(stored?.followFilterExempt, DEFAULT_SETTINGS.followFilterExempt),
    libraryFilterExempt: boolOr(
      stored?.libraryFilterExempt ?? stored?.bookmarkFilterExempt ?? stored?.historyFilterExempt,
      DEFAULT_SETTINGS.libraryFilterExempt
    ),
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
    ambientIntensity: isOneOf(stored?.ambientIntensity, AMBIENT_INTENSITY_VALUES)
      ? stored.ambientIntensity
      : DEFAULT_SETTINGS.ambientIntensity,
    watchlistSortOrder: isOneOf(stored?.watchlistSortOrder, WATCHLIST_SORT_VALUES)
      ? stored.watchlistSortOrder
      : DEFAULT_SETTINGS.watchlistSortOrder,
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
    imageBatchConcurrency: isOneOf(stored?.imageBatchConcurrency, IMAGE_CONCURRENCY_VALUES)
      ? stored.imageBatchConcurrency
      : DEFAULT_SETTINGS.imageBatchConcurrency,
  }
}

function persistSettings(settings: AppSettings): boolean {
  try {
    writeTextSafely(settingsFilePath(), JSON.stringify(settings, null, 2), (raw) => {
      const parsed = JSON.parse(raw)
      if (typeof parsed !== "object" || parsed === null) throw new Error("设置格式错误")
    })
  } catch (error: any) {
    console.log("settings persist error:", error?.message ?? error)
  }
  Storage.set(KEY, settings)
  return true
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

export function isNovelContentVisible(
  item: { x_restrict: number; novel_ai_type?: number; tags?: { name: string }[]; user?: { id: number } },
  settings = loadSettings(),
  bypassRatingAndAI = false
): boolean {
  return (
    (bypassRatingAndAI || (
      isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G) &&
      (settings.showAI || item.novel_ai_type !== 2)
    )) &&
    !isUserBlocked(item.user?.id ?? 0, settings.blockedUsers) &&
    !(item.tags ?? []).some((tag) => isTagBlocked(tag.name, settings.blockedTags))
  )
}

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
  if (cachedSettings) return cachedSettings

  const path = settingsFilePath()
  let stored: (Partial<AppSettings> & Record<string, unknown>) | null = null

  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      const decoded = JSON.parse(raw)
      if (typeof decoded === "object" && decoded !== null) {
        stored = decoded as Partial<AppSettings> & Record<string, unknown>
      }
    }
  } catch {
    // 读取文件异常
  }

  let needPersist = false
  if (!stored) {
    stored = Storage.get<Partial<AppSettings> & Record<string, unknown>>(KEY) ?? null
    needPersist = true
  }

  const merged = parseSettings(stored ?? {})
  cachedSettings = merged
  if (needPersist || !FileManager.existsSync(path)) {
    persistSettings(merged)
  }
  return merged
}

export function saveSettings(settings: AppSettings): void {
  cachedSettings = settings
  persistSettings(settings)
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch }
  cachedSettings = next
  persistSettings(next)
  emitChanged()
  return next
}

export async function refreshSettingsFromCloud(): Promise<void> {
  await prepareSettingsStorage()
  cachedSettings = null
  loadSettings()
  emitChanged()
}
