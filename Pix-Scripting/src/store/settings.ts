import { pixivSettingsDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

export type FeedImageQuality = "medium" | "large"
export type DetailImageQuality = "large" | "original"
export type DownloadImageQuality = "large" | "original"
export type DownloadStorageMode = "local" | "icloud"
export type DownloadMangaFormat = "cbz" | "epub"
export type CloseButtonAction = "minimize" | "exit"
export type WatchlistSortOrder = "asc" | "desc"
export type AmbientIntensity = "low" | "medium" | "high"
export type LaunchPage = "discovery" | "ranking" | "following"
export type ImageBatchConcurrency = number
export type ImageFadeInDuration = number
export type BlurCrossFadeDuration = number
export type BackgroundPreheatDuration = number
export type LoadingAnimationDuration = number
export type NovelLoadingDuration = number
export type LaunchAnimationDuration = number
export type WidgetDefaultSource =
  | "ranking_day"
  | "ranking_week"
  | "ranking_month"
  | "discovery"
  | "follow"
  | "pixivision"

export interface RankingOptionDef {
  key: string
  title: string
  type: "illust" | "manga" | "novel"
  requiresR18?: boolean
  requiresR18G?: boolean
  requiresAI?: boolean
}

export const ALL_ILLUST_RANKING_OPTIONS: ReadonlyArray<RankingOptionDef> = [
  { key: "day", title: "每日", type: "illust" },
  { key: "day_male", title: "男性向", type: "illust" },
  { key: "day_female", title: "女性向", type: "illust" },
  { key: "week_original", title: "原创", type: "illust" },
  { key: "week_rookie", title: "新人", type: "illust" },
  { key: "week", title: "每周", type: "illust" },
  { key: "month", title: "每月", type: "illust" },
  { key: "day_ai", title: "AI生成", type: "illust", requiresAI: true },
  { key: "day_r18", title: "R-18每日", type: "illust", requiresR18: true },
  { key: "week_r18", title: "R18每周", type: "illust", requiresR18: true },
  { key: "day_male_r18", title: "R18男性向", type: "illust", requiresR18: true },
  { key: "day_female_r18", title: "R18女性向", type: "illust", requiresR18: true },
  { key: "day_r18_ai", title: "R-18 AI生成", type: "illust", requiresR18: true, requiresAI: true },
  { key: "week_r18g", title: "R18G每周", type: "illust", requiresR18: true, requiresR18G: true },
]

export const ALL_MANGA_RANKING_OPTIONS: ReadonlyArray<RankingOptionDef> = [
  { key: "day_manga", title: "每日", type: "manga" },
  { key: "week_manga", title: "每周", type: "manga" },
  { key: "month_manga", title: "每月", type: "manga" },
  { key: "week_rookie_manga", title: "新人", type: "manga" },
  { key: "day_r18_manga", title: "R-18每日", type: "manga", requiresR18: true },
  { key: "week_r18_manga", title: "R18每周", type: "manga", requiresR18: true },
  { key: "week_r18g_manga", title: "R18G每周", type: "manga", requiresR18: true, requiresR18G: true },
]

export const ALL_NOVEL_RANKING_OPTIONS: ReadonlyArray<RankingOptionDef> = [
  { key: "day", title: "每日", type: "novel" },
  { key: "day_male", title: "男性向", type: "novel" },
  { key: "day_female", title: "女性向", type: "novel" },
  { key: "week_rookie", title: "新人", type: "novel" },
  { key: "week", title: "每周", type: "novel" },
  { key: "day_ai", title: "AI生成", type: "novel", requiresAI: true },
  { key: "day_r18", title: "R-18每日", type: "novel", requiresR18: true },
  { key: "day_male_r18", title: "R18男性向", type: "novel", requiresR18: true },
  { key: "day_female_r18", title: "R18女性向", type: "novel", requiresR18: true },
  { key: "week_r18", title: "R18每周", type: "novel", requiresR18: true },
  { key: "day_r18_ai", title: "R-18 AI生成", type: "novel", requiresR18: true, requiresAI: true },
  { key: "week_r18g", title: "R18G每周", type: "novel", requiresR18: true, requiresR18G: true },
]

export interface ActiveCustomRankingTab {
  id: string
  type: "illust" | "manga" | "novel"
  mode: string
  title: string
  fullTitle: string
}

export interface AppSettings {
  launchPage: LaunchPage
  showR18: boolean
  showR18G: boolean
  showAI: boolean
  exemptFilterForPersonal: boolean
  hideNovels: boolean
  ambientImmersion: boolean
  ambientIntensity: AmbientIntensity
  watchlistSortOrder: WatchlistSortOrder
  longPressBookmarkAction: "off" | "follow" | "detail"
  closeButtonAction: CloseButtonAction
  feedImageQuality: FeedImageQuality
  detailImageQuality: DetailImageQuality
  downloadImageQuality: DownloadImageQuality
  downloadStorageMode: DownloadStorageMode
  downloadCustomDirectoryBookmark: string | null
  downloadCustomDirectoryPath: string | null
  downloadPhotoAlbumName: string
  downloadMangaFormat: DownloadMangaFormat
  prefetchEnabled: boolean
  cacheLimitMB: number | null
  recordHistory: boolean
  imageBatchConcurrency: ImageBatchConcurrency
  imageDownloadConcurrencyRatio: number
  imagePrefetchConcurrencyRatio: number
  imageFadeInDuration: ImageFadeInDuration
  blurCrossFadeDuration: BlurCrossFadeDuration
  backgroundPreheatDuration: BackgroundPreheatDuration
  loadingAnimationDuration: LoadingAnimationDuration
  novelLoadingDuration: NovelLoadingDuration
  launchAnimationDuration: LaunchAnimationDuration
  enableLiveActivity: boolean
  enableTaskNotification: boolean
  advancedSettingsUnlocked: boolean
  customRankingEnabled: boolean
  customRankingIllustModes: string[]
  customRankingMangaModes: string[]
  customRankingNovelModes: string[]
  widgetDefaultSource: WidgetDefaultSource
}

const DEFAULT_SETTINGS: AppSettings = {
  launchPage: "discovery",
  showR18: false,
  showR18G: false,
  showAI: false,
  exemptFilterForPersonal: false,
  hideNovels: false,
  ambientImmersion: true,
  ambientIntensity: "medium",
  watchlistSortOrder: "asc",
  longPressBookmarkAction: "off",
  closeButtonAction: "minimize",
  feedImageQuality: "medium",
  detailImageQuality: "large",
  downloadImageQuality: "original",
  downloadStorageMode: "local",
  downloadCustomDirectoryBookmark: null,
  downloadCustomDirectoryPath: null,
  downloadPhotoAlbumName: "Pix-Scripting",
  downloadMangaFormat: "cbz",
  prefetchEnabled: true,
  cacheLimitMB: 300,
  recordHistory: true,
  imageBatchConcurrency: 30,
  imageDownloadConcurrencyRatio: 100,
  imagePrefetchConcurrencyRatio: 100,
  imageFadeInDuration: 150,
  blurCrossFadeDuration: 150,
  backgroundPreheatDuration: 1000,
  loadingAnimationDuration: 400,
  novelLoadingDuration: 1000,
  launchAnimationDuration: 1500,
  enableLiveActivity: true,
  enableTaskNotification: true,
  advancedSettingsUnlocked: false,
  customRankingEnabled: false,
  customRankingIllustModes: ["day", "week", "month", "week_original", "week_rookie"],
  customRankingMangaModes: ["day_manga", "week_manga", "month_manga", "week_rookie_manga"],
  customRankingNovelModes: ["day", "week", "week_rookie"],
  widgetDefaultSource: "ranking_day",
}

const KEY = "pixiv_settings_v1"
const SETTINGS_FILE_NAME = "settings.json"
const WIDGET_DEFAULT_SOURCE_VALUES: readonly WidgetDefaultSource[] = [
  "ranking_day",
  "ranking_week",
  "ranking_month",
  "discovery",
  "follow",
  "pixivision",
]
const LAUNCH_PAGE_VALUES: readonly LaunchPage[] = ["discovery", "ranking", "following"]
const WATCHLIST_SORT_VALUES: readonly WatchlistSortOrder[] = ["asc", "desc"]
const FEED_QUALITY_VALUES: readonly FeedImageQuality[] = ["medium", "large"]
const DETAIL_QUALITY_VALUES: readonly DetailImageQuality[] = ["large", "original"]
const DOWNLOAD_QUALITY_VALUES: readonly DownloadImageQuality[] = ["large", "original"]
const DOWNLOAD_STORAGE_MODE_VALUES: readonly DownloadStorageMode[] = ["local", "icloud"]
const DOWNLOAD_MANGA_FORMAT_VALUES: readonly DownloadMangaFormat[] = ["cbz", "epub"]
const LONG_PRESS_ACTION_VALUES: readonly AppSettings["longPressBookmarkAction"][] = ["off", "follow", "detail"]
const CLOSE_BUTTON_ACTION_VALUES: readonly CloseButtonAction[] = ["minimize", "exit"]
const AMBIENT_INTENSITY_VALUES: readonly AmbientIntensity[] = ["low", "medium", "high"]
const CACHE_LIMIT_VALUES = [300, 500, 1000, 2000] as const

export function getImageBatchSize(level?: number): number {
  if (typeof level === "number" && Number.isFinite(level) && level > 0) {
    return Math.max(1, Math.min(90, Math.round(level)))
  }
  return 30
}

let cachedSettings: AppSettings | null = null
const listeners: Array<() => void> = []

function settingsFilePath(): string {
  return `${pixivSettingsDirectory()}/${SETTINGS_FILE_NAME}`
}

function boolOr(val: any, fallback: boolean): boolean {
  return typeof val === "boolean" ? val : fallback
}

function numberOr(val: any, fallback: number): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback
}

function positiveNumberOr(val: any, fallback: number): number {
  return typeof val === "number" && Number.isFinite(val) && val > 0 ? val : fallback
}

function enumOr<T extends string>(val: any, allowed: readonly T[], fallback: T): T {
  return typeof val === "string" && (allowed as readonly string[]).includes(val)
    ? (val as T)
    : fallback
}

function filterRankModes(val: any, allowedDefs: ReadonlyArray<RankingOptionDef>, fallback: string[]): string[] {
  if (!Array.isArray(val)) return fallback
  const validKeys = new Set(allowedDefs.map((d) => d.key))
  const filtered = val.filter((k) => typeof k === "string" && validKeys.has(k))
  return filtered.length > 0 ? filtered : fallback
}

function sanitizeSettings(stored: any): AppSettings {
  return {
    launchPage: enumOr(stored?.launchPage, LAUNCH_PAGE_VALUES, DEFAULT_SETTINGS.launchPage),
    showR18: boolOr(stored?.showR18, DEFAULT_SETTINGS.showR18),
    showR18G: boolOr(stored?.showR18G, DEFAULT_SETTINGS.showR18G),
    showAI: boolOr(stored?.showAI, DEFAULT_SETTINGS.showAI),
    exemptFilterForPersonal: boolOr(
      stored?.exemptFilterForPersonal,
      DEFAULT_SETTINGS.exemptFilterForPersonal
    ),
    hideNovels: boolOr(stored?.hideNovels, DEFAULT_SETTINGS.hideNovels),
    ambientImmersion: boolOr(stored?.ambientImmersion, DEFAULT_SETTINGS.ambientImmersion),
    ambientIntensity: enumOr(stored?.ambientIntensity, AMBIENT_INTENSITY_VALUES, DEFAULT_SETTINGS.ambientIntensity),
    watchlistSortOrder: enumOr(stored?.watchlistSortOrder, WATCHLIST_SORT_VALUES, DEFAULT_SETTINGS.watchlistSortOrder),
    longPressBookmarkAction: enumOr(stored?.longPressBookmarkAction, LONG_PRESS_ACTION_VALUES, DEFAULT_SETTINGS.longPressBookmarkAction),
    closeButtonAction: enumOr(stored?.closeButtonAction, CLOSE_BUTTON_ACTION_VALUES, DEFAULT_SETTINGS.closeButtonAction),
    feedImageQuality: enumOr(stored?.feedImageQuality, FEED_QUALITY_VALUES, DEFAULT_SETTINGS.feedImageQuality),
    detailImageQuality: enumOr(stored?.detailImageQuality, DETAIL_QUALITY_VALUES, DEFAULT_SETTINGS.detailImageQuality),
    downloadImageQuality: enumOr(stored?.downloadImageQuality, DOWNLOAD_QUALITY_VALUES, DEFAULT_SETTINGS.downloadImageQuality),
    downloadStorageMode: enumOr(stored?.downloadStorageMode, DOWNLOAD_STORAGE_MODE_VALUES, DEFAULT_SETTINGS.downloadStorageMode),
    downloadCustomDirectoryBookmark:
      typeof stored?.downloadCustomDirectoryBookmark === "string" && stored.downloadCustomDirectoryBookmark.length > 0
        ? stored.downloadCustomDirectoryBookmark
        : DEFAULT_SETTINGS.downloadCustomDirectoryBookmark,
    downloadCustomDirectoryPath:
      typeof stored?.downloadCustomDirectoryPath === "string" && stored.downloadCustomDirectoryPath.length > 0
        ? stored.downloadCustomDirectoryPath
        : DEFAULT_SETTINGS.downloadCustomDirectoryPath,
    downloadPhotoAlbumName:
      typeof stored?.downloadPhotoAlbumName === "string" && stored.downloadPhotoAlbumName.trim().length > 0
        ? stored.downloadPhotoAlbumName.trim()
        : DEFAULT_SETTINGS.downloadPhotoAlbumName,
    downloadMangaFormat: enumOr(stored?.downloadMangaFormat, DOWNLOAD_MANGA_FORMAT_VALUES, DEFAULT_SETTINGS.downloadMangaFormat),
    prefetchEnabled: boolOr(stored?.prefetchEnabled, DEFAULT_SETTINGS.prefetchEnabled),
    cacheLimitMB:
      typeof stored?.cacheLimitMB === "number" && (CACHE_LIMIT_VALUES as readonly number[]).includes(stored.cacheLimitMB)
        ? stored.cacheLimitMB
        : stored?.cacheLimitMB === null
          ? null
          : DEFAULT_SETTINGS.cacheLimitMB,
    recordHistory: boolOr(stored?.recordHistory, DEFAULT_SETTINGS.recordHistory),
    imageBatchConcurrency: positiveNumberOr(stored?.imageBatchConcurrency, DEFAULT_SETTINGS.imageBatchConcurrency),
    imageDownloadConcurrencyRatio: positiveNumberOr(stored?.imageDownloadConcurrencyRatio, DEFAULT_SETTINGS.imageDownloadConcurrencyRatio),
    imagePrefetchConcurrencyRatio: positiveNumberOr(stored?.imagePrefetchConcurrencyRatio, DEFAULT_SETTINGS.imagePrefetchConcurrencyRatio),
    imageFadeInDuration: numberOr(stored?.imageFadeInDuration, DEFAULT_SETTINGS.imageFadeInDuration),
    blurCrossFadeDuration: numberOr(stored?.blurCrossFadeDuration, DEFAULT_SETTINGS.blurCrossFadeDuration),
    backgroundPreheatDuration: numberOr(stored?.backgroundPreheatDuration, DEFAULT_SETTINGS.backgroundPreheatDuration),
    loadingAnimationDuration: numberOr(stored?.loadingAnimationDuration, DEFAULT_SETTINGS.loadingAnimationDuration),
    novelLoadingDuration: numberOr(stored?.novelLoadingDuration, DEFAULT_SETTINGS.novelLoadingDuration),
    launchAnimationDuration: numberOr(stored?.launchAnimationDuration, DEFAULT_SETTINGS.launchAnimationDuration),
    enableLiveActivity: boolOr(stored?.enableLiveActivity, DEFAULT_SETTINGS.enableLiveActivity),
    enableTaskNotification: boolOr(stored?.enableTaskNotification, DEFAULT_SETTINGS.enableTaskNotification),
    advancedSettingsUnlocked: boolOr(stored?.advancedSettingsUnlocked, DEFAULT_SETTINGS.advancedSettingsUnlocked),
    customRankingEnabled: boolOr(stored?.customRankingEnabled, DEFAULT_SETTINGS.customRankingEnabled),
    customRankingIllustModes: filterRankModes(stored?.customRankingIllustModes, ALL_ILLUST_RANKING_OPTIONS, DEFAULT_SETTINGS.customRankingIllustModes),
    customRankingMangaModes: filterRankModes(stored?.customRankingMangaModes, ALL_MANGA_RANKING_OPTIONS, DEFAULT_SETTINGS.customRankingMangaModes),
    customRankingNovelModes: filterRankModes(stored?.customRankingNovelModes, ALL_NOVEL_RANKING_OPTIONS, DEFAULT_SETTINGS.customRankingNovelModes),
    widgetDefaultSource: enumOr(stored?.widgetDefaultSource, WIDGET_DEFAULT_SOURCE_VALUES, DEFAULT_SETTINGS.widgetDefaultSource),
  }
}

export function loadSettings(): AppSettings {
  if (cachedSettings) return cachedSettings
  const filePath = settingsFilePath()
  if (FileManager.existsSync(filePath)) {
    try {
      const content = FileManager.readAsStringSync(filePath)
      const parsed = JSON.parse(content)
      cachedSettings = sanitizeSettings(parsed)
      return cachedSettings
    } catch {
      const recovered = recoverFile(filePath)
      if (recovered) {
        try {
          const parsed = JSON.parse(recovered)
          cachedSettings = sanitizeSettings(parsed)
          return cachedSettings
        } catch {}
      }
    }
  }
  cachedSettings = { ...DEFAULT_SETTINGS }
  return cachedSettings
}

export function saveSettings(next: AppSettings): void {
  cachedSettings = sanitizeSettings(next)
  try {
    const text = JSON.stringify(cachedSettings, null, 2)
    writeTextSafely(settingsFilePath(), text)
  } catch {}
  notifyListeners()
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const next: AppSettings = { ...current, ...patch }
  saveSettings(next)
  return cachedSettings || next
}

export function resetSettings(): AppSettings {
  saveSettings({ ...DEFAULT_SETTINGS })
  return loadSettings()
}

export function onSettingsChanged(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    const idx = listeners.indexOf(fn)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

function notifyListeners(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {}
  }
}

export async function prepareSettingsStorage(): Promise<void> {
  loadSettings()
}

export function formatCustomRankingSummary(modes: string[], defs: ReadonlyArray<RankingOptionDef>): string {
  const map = new Map(defs.map((d) => [d.key, d.title]))
  return modes.map((m) => map.get(m) || m).join(" · ")
}
