import { Device } from "scripting"
import { pixivSettingsDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

export type FeedImageQuality = "medium" | "large"
export type DetailImageQuality = "large" | "original"
export type DownloadImageQuality = "large" | "original"
export type UgoiraExportFormat = "mp4" | "gif"
export type DownloadStorageMode = "local" | "icloud"
export type CloseButtonAction = "minimize" | "exit"
export type WatchlistSortOrder = "asc" | "desc"
export type AmbientIntensity = "low" | "medium" | "high"
export type AmbientAlgorithm = "classic" | "explore" | "ultimate" | "transcend"
export type NovelReaderExperimentalAlgorithm = "off" | "classic" | "explore" | "ultimate" | "transcend"
export type LaunchPage = "discovery" | "ranking" | "following"
export type ImageBatchConcurrency = number
export type AITranslateConcurrency = number
export type ImageFadeInDuration = number
export type BlurCrossFadeDuration = number
export type BackgroundPreheatDuration = number
export type LoadingAnimationDuration = number
export type NovelLoadingDuration = number
export type LaunchAnimationDuration = number
export type WidgetPoolCapacity = number
export type WidgetReloadIntervalMinutes = number
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
  showRelatedUsersOnFollow: boolean
  exemptFilterForPersonal: boolean
  hideNovels: boolean
  heroFirstFeedCard: boolean
  ambientImmersion: boolean
  ambientIntensity: AmbientIntensity
  experimentalImmersion: boolean
  experimentalImmersionIntensity: AmbientIntensity
  experimentalImmersionAlgorithm: AmbientAlgorithm
  novelReaderExperimentalAlgorithm: NovelReaderExperimentalAlgorithm
  watchlistSortOrder: WatchlistSortOrder
  longPressBookmarkAction: "off" | "follow" | "detail"
  closeButtonAction: CloseButtonAction
  feedImageQualityIos: FeedImageQuality
  feedImageQualityIpad: FeedImageQuality
  detailImageQualityIos: DetailImageQuality
  detailImageQualityIpad: DetailImageQuality
  downloadImageQualityIos: DownloadImageQuality
  downloadImageQualityIpad: DownloadImageQuality
  ugoiraExportFormat: UgoiraExportFormat
  downloadStorageMode: DownloadStorageMode
  downloadCustomDirectoryBookmark: string | null
  downloadCustomDirectoryPath: string | null
  downloadPhotoAlbumName: string
  prefetchEnabled: boolean
  cacheLimitMB: number | null
  recordHistory: boolean
  imageBatchConcurrency: ImageBatchConcurrency
  aiTranslateConcurrency: AITranslateConcurrency
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
  widgetSourceSmallIos: WidgetDefaultSource
  widgetSourceMediumIos: WidgetDefaultSource
  widgetSourceLargeIos: WidgetDefaultSource
  widgetSourceSmallIpad: WidgetDefaultSource
  widgetSourceMediumIpad: WidgetDefaultSource
  widgetSourceLargeIpad: WidgetDefaultSource
  widgetSourceExtraLargeIpad: WidgetDefaultSource
  widgetPoolCapacity: WidgetPoolCapacity
  widgetReloadIntervalMinutes: WidgetReloadIntervalMinutes
}

const DEFAULT_SETTINGS: AppSettings = {
  launchPage: "discovery",
  showR18: false,
  showR18G: false,
  showAI: false,
  showRelatedUsersOnFollow: true,
  exemptFilterForPersonal: false,
  hideNovels: false,
  heroFirstFeedCard: true,
  ambientImmersion: true,
  ambientIntensity: "medium",
  experimentalImmersion: false,
  experimentalImmersionIntensity: "medium",
  experimentalImmersionAlgorithm: "classic",
  novelReaderExperimentalAlgorithm: "off",
  watchlistSortOrder: "asc",
  longPressBookmarkAction: "off",
  closeButtonAction: "minimize",
  feedImageQualityIos: "medium",
  feedImageQualityIpad: "medium",
  detailImageQualityIos: "large",
  detailImageQualityIpad: "large",
  downloadImageQualityIos: "original",
  downloadImageQualityIpad: "original",
  ugoiraExportFormat: "mp4",
  downloadStorageMode: "local",
  downloadCustomDirectoryBookmark: null,
  downloadCustomDirectoryPath: null,
  downloadPhotoAlbumName: "Pix-Scripting",
  prefetchEnabled: true,
  cacheLimitMB: 300,
  recordHistory: true,
  imageBatchConcurrency: 30,
  aiTranslateConcurrency: 4,
  imageDownloadConcurrencyRatio: 100,
  imagePrefetchConcurrencyRatio: 100,
  imageFadeInDuration: 100,
  blurCrossFadeDuration: 100,
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
  widgetSourceSmallIos: "ranking_day",
  widgetSourceMediumIos: "pixivision",
  widgetSourceLargeIos: "ranking_week",
  widgetSourceSmallIpad: "ranking_day",
  widgetSourceMediumIpad: "pixivision",
  widgetSourceLargeIpad: "ranking_week",
  widgetSourceExtraLargeIpad: "pixivision",
  widgetPoolCapacity: 30,
  widgetReloadIntervalMinutes: 60,
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
const UGOIRA_EXPORT_FORMAT_VALUES: readonly UgoiraExportFormat[] = ["mp4", "gif"]
const DOWNLOAD_STORAGE_MODE_VALUES: readonly DownloadStorageMode[] = ["local", "icloud"]
const LONG_PRESS_ACTION_VALUES: readonly AppSettings["longPressBookmarkAction"][] = ["off", "follow", "detail"]
const CLOSE_BUTTON_ACTION_VALUES: readonly CloseButtonAction[] = ["minimize", "exit"]
const AMBIENT_INTENSITY_VALUES: readonly AmbientIntensity[] = ["low", "medium", "high"]
const AMBIENT_ALGORITHM_VALUES: readonly AmbientAlgorithm[] = ["classic", "explore", "ultimate", "transcend"]
const NOVEL_READER_EXPERIMENTAL_ALGORITHM_VALUES: readonly NovelReaderExperimentalAlgorithm[] = [
  "off",
  "classic",
  "explore",
  "ultimate",
  "transcend",
]
const CACHE_LIMIT_VALUES = [300, 500, 1000, 2000] as const

export function getImageBatchSize(level?: number): number {
  if (typeof level === "number" && Number.isFinite(level) && level > 0) {
    return Math.max(1, Math.min(90, Math.round(level)))
  }
  return 30
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

function parseConcurrencyRatio(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) {
    return Math.max(0, Math.min(100, Math.round(value)))
  }
  return fallback
}

function parseImageConcurrency(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.min(90, Math.round(value)))
  }
  return DEFAULT_SETTINGS.imageBatchConcurrency
}

function parseAITranslateConcurrency(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.max(1, Math.min(6, Math.round(value)))
  }
  return DEFAULT_SETTINGS.aiTranslateConcurrency
}

function parseFadeInDuration(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.max(1, Math.min(500, Math.round(value)))
  }
  return DEFAULT_SETTINGS.imageFadeInDuration
}

function parseBlurCrossFadeDuration(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.max(0, Math.min(250, Math.round(value)))
  }
  return DEFAULT_SETTINGS.blurCrossFadeDuration
}

function parseBackgroundPreheatDuration(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.max(0, Math.min(2000, Math.round(value)))
  }
  return DEFAULT_SETTINGS.backgroundPreheatDuration
}

function parseLoadingDuration(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.max(0, Math.min(30000, Math.round(value)))
  }
  return DEFAULT_SETTINGS.loadingAnimationDuration
}

function parseNovelLoadingDuration(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.max(0, Math.min(5000, Math.round(value)))
  }
  return DEFAULT_SETTINGS.novelLoadingDuration
}

function parseLaunchDuration(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.max(0, Math.min(30000, Math.round(value)))
  }
  return DEFAULT_SETTINGS.launchAnimationDuration
}

function parseWidgetPoolCapacity(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(10, Math.min(30, Math.round(value)))
  }
  return DEFAULT_SETTINGS.widgetPoolCapacity
}

function parseWidgetReloadInterval(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(30, Math.min(1440, Math.round(value)))
  }
  return DEFAULT_SETTINGS.widgetReloadIntervalMinutes
}

function parseStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  }
  return fallback
}

function parseSettings(stored: Partial<AppSettings> & Record<string, unknown>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    launchPage: isOneOf(stored?.launchPage, LAUNCH_PAGE_VALUES)
      ? stored.launchPage
      : DEFAULT_SETTINGS.launchPage,
    showR18: boolOr(stored?.showR18, DEFAULT_SETTINGS.showR18),
    showR18G: boolOr(stored?.showR18G, DEFAULT_SETTINGS.showR18G),
    showAI: boolOr(stored?.showAI, DEFAULT_SETTINGS.showAI),
    showRelatedUsersOnFollow: boolOr(
      stored?.showRelatedUsersOnFollow,
      DEFAULT_SETTINGS.showRelatedUsersOnFollow
    ),
    exemptFilterForPersonal: boolOr(
      stored?.exemptFilterForPersonal,
      DEFAULT_SETTINGS.exemptFilterForPersonal
    ),
    hideNovels: boolOr(stored?.hideNovels, DEFAULT_SETTINGS.hideNovels),
    heroFirstFeedCard: boolOr(stored?.heroFirstFeedCard, DEFAULT_SETTINGS.heroFirstFeedCard),
    ambientImmersion: boolOr(stored?.ambientImmersion, DEFAULT_SETTINGS.ambientImmersion),
    ambientIntensity: isOneOf(stored?.ambientIntensity, AMBIENT_INTENSITY_VALUES)
      ? stored.ambientIntensity
      : DEFAULT_SETTINGS.ambientIntensity,
    experimentalImmersion: boolOr(stored?.ambientImmersion, DEFAULT_SETTINGS.ambientImmersion)
      ? boolOr(
          stored?.experimentalImmersion,
          DEFAULT_SETTINGS.experimentalImmersion
        )
      : false,
    experimentalImmersionIntensity: isOneOf(
      stored?.experimentalImmersionIntensity,
      AMBIENT_INTENSITY_VALUES
    )
      ? stored.experimentalImmersionIntensity
      : DEFAULT_SETTINGS.experimentalImmersionIntensity,
    experimentalImmersionAlgorithm: isOneOf(
      stored?.experimentalImmersionAlgorithm,
      AMBIENT_ALGORITHM_VALUES
    )
      ? stored.experimentalImmersionAlgorithm
      : DEFAULT_SETTINGS.experimentalImmersionAlgorithm,
    novelReaderExperimentalAlgorithm: isOneOf(
      stored?.novelReaderExperimentalAlgorithm,
      NOVEL_READER_EXPERIMENTAL_ALGORITHM_VALUES
    )
      ? stored.novelReaderExperimentalAlgorithm
      : DEFAULT_SETTINGS.novelReaderExperimentalAlgorithm,
    watchlistSortOrder: isOneOf(stored?.watchlistSortOrder, WATCHLIST_SORT_VALUES)
      ? stored.watchlistSortOrder
      : DEFAULT_SETTINGS.watchlistSortOrder,
    longPressBookmarkAction: isOneOf(stored?.longPressBookmarkAction, LONG_PRESS_ACTION_VALUES)
      ? stored.longPressBookmarkAction
      : DEFAULT_SETTINGS.longPressBookmarkAction,
    closeButtonAction: isOneOf(stored?.closeButtonAction, CLOSE_BUTTON_ACTION_VALUES)
      ? stored.closeButtonAction
      : DEFAULT_SETTINGS.closeButtonAction,
    feedImageQualityIos: isOneOf(stored?.feedImageQualityIos, FEED_QUALITY_VALUES)
      ? stored.feedImageQualityIos
      : isOneOf(stored?.feedImageQuality, FEED_QUALITY_VALUES)
      ? stored.feedImageQuality
      : DEFAULT_SETTINGS.feedImageQualityIos,
    feedImageQualityIpad: isOneOf(stored?.feedImageQualityIpad, FEED_QUALITY_VALUES)
      ? stored.feedImageQualityIpad
      : isOneOf(stored?.feedImageQuality, FEED_QUALITY_VALUES)
      ? stored.feedImageQuality
      : DEFAULT_SETTINGS.feedImageQualityIpad,
    detailImageQualityIos: isOneOf(stored?.detailImageQualityIos, DETAIL_QUALITY_VALUES)
      ? stored.detailImageQualityIos
      : isOneOf(stored?.detailImageQuality, DETAIL_QUALITY_VALUES)
      ? stored.detailImageQuality
      : DEFAULT_SETTINGS.detailImageQualityIos,
    detailImageQualityIpad: isOneOf(stored?.detailImageQualityIpad, DETAIL_QUALITY_VALUES)
      ? stored.detailImageQualityIpad
      : isOneOf(stored?.detailImageQuality, DETAIL_QUALITY_VALUES)
      ? stored.detailImageQuality
      : DEFAULT_SETTINGS.detailImageQualityIpad,
    downloadImageQualityIos: isOneOf(stored?.downloadImageQualityIos, DOWNLOAD_QUALITY_VALUES)
      ? stored.downloadImageQualityIos
      : isOneOf(stored?.downloadImageQuality, DOWNLOAD_QUALITY_VALUES)
      ? stored.downloadImageQuality
      : DEFAULT_SETTINGS.downloadImageQualityIos,
    downloadImageQualityIpad: isOneOf(stored?.downloadImageQualityIpad, DOWNLOAD_QUALITY_VALUES)
      ? stored.downloadImageQualityIpad
      : isOneOf(stored?.downloadImageQuality, DOWNLOAD_QUALITY_VALUES)
      ? stored.downloadImageQuality
      : DEFAULT_SETTINGS.downloadImageQualityIpad,
    ugoiraExportFormat: isOneOf(stored?.ugoiraExportFormat, UGOIRA_EXPORT_FORMAT_VALUES)
      ? stored.ugoiraExportFormat
      : DEFAULT_SETTINGS.ugoiraExportFormat,
    downloadStorageMode: isOneOf(stored?.downloadStorageMode, DOWNLOAD_STORAGE_MODE_VALUES)
      ? stored.downloadStorageMode
      : DEFAULT_SETTINGS.downloadStorageMode,
    downloadCustomDirectoryBookmark:
      typeof stored?.downloadCustomDirectoryBookmark === "string" && stored.downloadCustomDirectoryBookmark.trim().length > 0
        ? stored.downloadCustomDirectoryBookmark
        : null,
    downloadCustomDirectoryPath:
      typeof stored?.downloadCustomDirectoryPath === "string" && stored.downloadCustomDirectoryPath.trim().length > 0
        ? stored.downloadCustomDirectoryPath
        : null,
    downloadPhotoAlbumName:
      typeof stored?.downloadPhotoAlbumName === "string" && stored.downloadPhotoAlbumName.trim().length > 0
        ? stored.downloadPhotoAlbumName.trim()
        : DEFAULT_SETTINGS.downloadPhotoAlbumName,
    prefetchEnabled: boolOr(stored?.prefetchEnabled, DEFAULT_SETTINGS.prefetchEnabled),
    cacheLimitMB: cacheLimitOf(stored?.cacheLimitMB),
    recordHistory: boolOr(stored?.recordHistory, DEFAULT_SETTINGS.recordHistory),
    imageBatchConcurrency: parseImageConcurrency(stored?.imageBatchConcurrency),
    aiTranslateConcurrency: parseAITranslateConcurrency(stored?.aiTranslateConcurrency),
    imageDownloadConcurrencyRatio: parseConcurrencyRatio(
      stored?.imageDownloadConcurrencyRatio,
      DEFAULT_SETTINGS.imageDownloadConcurrencyRatio
    ),
    imagePrefetchConcurrencyRatio: parseConcurrencyRatio(
      stored?.imagePrefetchConcurrencyRatio,
      DEFAULT_SETTINGS.imagePrefetchConcurrencyRatio
    ),
    imageFadeInDuration: parseFadeInDuration(stored?.imageFadeInDuration),
    blurCrossFadeDuration: parseBlurCrossFadeDuration(stored?.blurCrossFadeDuration),
    backgroundPreheatDuration: parseBackgroundPreheatDuration(stored?.backgroundPreheatDuration),
    loadingAnimationDuration: parseLoadingDuration(stored?.loadingAnimationDuration),
    novelLoadingDuration: parseNovelLoadingDuration(stored?.novelLoadingDuration),
    launchAnimationDuration: parseLaunchDuration(stored?.launchAnimationDuration),
    enableLiveActivity: boolOr(stored?.enableLiveActivity, DEFAULT_SETTINGS.enableLiveActivity),
    enableTaskNotification: boolOr(
      stored?.enableTaskNotification,
      DEFAULT_SETTINGS.enableTaskNotification
    ),
    advancedSettingsUnlocked: boolOr(stored?.advancedSettingsUnlocked, DEFAULT_SETTINGS.advancedSettingsUnlocked),
    customRankingEnabled: boolOr(stored?.customRankingEnabled, DEFAULT_SETTINGS.customRankingEnabled),
    customRankingIllustModes: parseStringArray(stored?.customRankingIllustModes, DEFAULT_SETTINGS.customRankingIllustModes),
    customRankingMangaModes: parseStringArray(stored?.customRankingMangaModes, DEFAULT_SETTINGS.customRankingMangaModes),
    customRankingNovelModes: parseStringArray(stored?.customRankingNovelModes, DEFAULT_SETTINGS.customRankingNovelModes),
    widgetSourceSmallIos: isOneOf(stored?.widgetSourceSmallIos, WIDGET_DEFAULT_SOURCE_VALUES)
      ? stored.widgetSourceSmallIos
      : DEFAULT_SETTINGS.widgetSourceSmallIos,
    widgetSourceMediumIos: isOneOf(stored?.widgetSourceMediumIos, WIDGET_DEFAULT_SOURCE_VALUES)
      ? stored.widgetSourceMediumIos
      : DEFAULT_SETTINGS.widgetSourceMediumIos,
    widgetSourceLargeIos: isOneOf(stored?.widgetSourceLargeIos, WIDGET_DEFAULT_SOURCE_VALUES)
      ? stored.widgetSourceLargeIos
      : DEFAULT_SETTINGS.widgetSourceLargeIos,
    widgetSourceSmallIpad: isOneOf(stored?.widgetSourceSmallIpad, WIDGET_DEFAULT_SOURCE_VALUES)
      ? stored.widgetSourceSmallIpad
      : DEFAULT_SETTINGS.widgetSourceSmallIpad,
    widgetSourceMediumIpad: isOneOf(stored?.widgetSourceMediumIpad, WIDGET_DEFAULT_SOURCE_VALUES)
      ? stored.widgetSourceMediumIpad
      : DEFAULT_SETTINGS.widgetSourceMediumIpad,
    widgetSourceLargeIpad: isOneOf(stored?.widgetSourceLargeIpad, WIDGET_DEFAULT_SOURCE_VALUES)
      ? stored.widgetSourceLargeIpad
      : DEFAULT_SETTINGS.widgetSourceLargeIpad,
    widgetSourceExtraLargeIpad: isOneOf(stored?.widgetSourceExtraLargeIpad, WIDGET_DEFAULT_SOURCE_VALUES)
      ? stored.widgetSourceExtraLargeIpad
      : DEFAULT_SETTINGS.widgetSourceExtraLargeIpad,
    widgetPoolCapacity: parseWidgetPoolCapacity(stored?.widgetPoolCapacity),
    widgetReloadIntervalMinutes: parseWidgetReloadInterval(stored?.widgetReloadIntervalMinutes),
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

export function resetSettings(): AppSettings {
  const next = { ...DEFAULT_SETTINGS }
  persistSettings(next)
  cachedSettings = next
  emitChanged()
  return next
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

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const raw = { ...current, ...patch }
  const next = parseSettings(raw)
  cachedSettings = next
  persistSettings(next)
  emitChanged()
  return next
}

export function getFeedImageQuality(settings: AppSettings = loadSettings()): FeedImageQuality {
  return Device.isiPad ? settings.feedImageQualityIpad : settings.feedImageQualityIos
}

export function getHeroImageQuality(settings: AppSettings = loadSettings()): "large" | "original" {
  const feedQuality = getFeedImageQuality(settings)
  return feedQuality === "medium" ? "large" : "original"
}

export function getDetailImageQuality(settings: AppSettings = loadSettings()): DetailImageQuality {
  return Device.isiPad ? settings.detailImageQualityIpad : settings.detailImageQualityIos
}

export function getDownloadImageQuality(settings: AppSettings = loadSettings()): DownloadImageQuality {
  return Device.isiPad ? settings.downloadImageQualityIpad : settings.downloadImageQualityIos
}

export function getWidgetSourceForFamily(
  family?: string,
  settings: AppSettings = loadSettings()
): WidgetDefaultSource {
  if (family === "systemExtraLarge") {
    return settings.widgetSourceExtraLargeIpad
  }
  if (family === "systemLarge") {
    return Device.isiPad ? settings.widgetSourceLargeIpad : settings.widgetSourceLargeIos
  }
  if (family === "systemMedium") {
    return Device.isiPad ? settings.widgetSourceMediumIpad : settings.widgetSourceMediumIos
  }
  if (family === "systemSmall") {
    return Device.isiPad ? settings.widgetSourceSmallIpad : settings.widgetSourceSmallIos
  }
  return Device.isiPad ? settings.widgetSourceSmallIpad : settings.widgetSourceSmallIos
}

export function isRankingOptionVisible(option: RankingOptionDef, settings: AppSettings): boolean {
  if (option.requiresR18 && !settings.showR18) return false
  if (option.requiresR18G && (!settings.showR18 || !settings.showR18G)) return false
  if (option.requiresAI && !settings.showAI) return false
  if (option.type === "novel" && settings.hideNovels) return false
  return true
}

export function getVisibleRankingOptions(
  options: ReadonlyArray<RankingOptionDef>,
  settings: AppSettings
): RankingOptionDef[] {
  return options.filter((opt) => isRankingOptionVisible(opt, settings))
}

export const DEFAULT_ILLUST_RANKING_MODES = [
  "day",
  "week",
  "month",
  "week_original",
  "week_rookie",
]

export const DEFAULT_MANGA_RANKING_MODES = [
  "day_manga",
  "week_manga",
  "month_manga",
  "week_rookie_manga",
]

export const DEFAULT_NOVEL_RANKING_MODES = [
  "day",
  "week",
  "week_rookie",
]

export interface CustomRankingTabItem {
  value: string
  title: string
}

export function resetCustomRankingKind(
  kind: "illust" | "manga" | "novel"
): AppSettings {
  if (kind === "illust") {
    return updateSettings({
      customRankingIllustModes: [...DEFAULT_ILLUST_RANKING_MODES],
    })
  } else if (kind === "manga") {
    return updateSettings({
      customRankingMangaModes: [...DEFAULT_MANGA_RANKING_MODES],
    })
  } else {
    return updateSettings({
      customRankingNovelModes: [...DEFAULT_NOVEL_RANKING_MODES],
    })
  }
}

export function getCustomRankingModesForKind(
  kind: "illustration" | "manga" | "novel",
  settings: AppSettings
): CustomRankingTabItem[] {
  const options =
    kind === "illustration"
      ? ALL_ILLUST_RANKING_OPTIONS
      : kind === "manga"
        ? ALL_MANGA_RANKING_OPTIONS
        : ALL_NOVEL_RANKING_OPTIONS
  const selectedModes =
    kind === "illustration"
      ? settings.customRankingIllustModes
      : kind === "manga"
        ? settings.customRankingMangaModes
        : settings.customRankingNovelModes

  const visible = getVisibleRankingOptions(options, settings)
  const active: CustomRankingTabItem[] = []

  for (const mode of selectedModes) {
    const found = visible.find((o) => o.key === mode)
    if (found) {
      active.push({ value: found.key, title: found.title })
    }
  }

  // 每个类别最多截取 5 项
  const limited = active.slice(0, 5)
  if (limited.length > 0) return limited

  // 如果用户未选任何有效项（如全部取消），回退到该类别的默认初始有效榜单列表
  const defaultModes =
    kind === "illustration"
      ? DEFAULT_ILLUST_RANKING_MODES
      : kind === "manga"
        ? DEFAULT_MANGA_RANKING_MODES
        : DEFAULT_NOVEL_RANKING_MODES

  const fallbackList: CustomRankingTabItem[] = []
  for (const mode of defaultModes) {
    const found = visible.find((o) => o.key === mode)
    if (found) {
      fallbackList.push({ value: found.key, title: found.title })
    }
  }

  if (fallbackList.length > 0) return fallbackList

  if (visible.length > 0) {
    return [{ value: visible[0].key, title: visible[0].title }]
  }
  return []
}

export function formatCustomRankingSummary(
  kind: "illust" | "manga" | "novel",
  settings: AppSettings
): string {
  const options =
    kind === "illust"
      ? ALL_ILLUST_RANKING_OPTIONS
      : kind === "manga"
        ? ALL_MANGA_RANKING_OPTIONS
        : ALL_NOVEL_RANKING_OPTIONS
  const selectedModes =
    kind === "illust"
      ? settings.customRankingIllustModes
      : kind === "manga"
        ? settings.customRankingMangaModes
        : settings.customRankingNovelModes
  const visible = getVisibleRankingOptions(options, settings)
  const activeTitles = selectedModes
    .map((m) => visible.find((o) => o.key === m)?.title)
    .filter(Boolean) as string[]

  if (activeTitles.length === 0) return "未选择"
  if (activeTitles.length <= 2) return activeTitles.join("、")
  return `已选 ${activeTitles.length} 项`
}


