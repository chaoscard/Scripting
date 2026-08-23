import { pixivSettingsDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

export type FeedImageQuality = "medium" | "large"
export type DetailImageQuality = "large" | "original"
export type DownloadImageQuality = "large" | "original"
export type DownloadStorageMode = "local" | "icloud"
export type DownloadMangaFormat = "cbz" | "epub"
export type DownloadIllustMultiAction = "album" | "zip" | "ask"
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
  downloadIllustMultiAction: DownloadIllustMultiAction
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
  advancedSettingsUnlocked: boolean
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
  downloadIllustMultiAction: "ask",
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
  advancedSettingsUnlocked: false,
}

const KEY = "pixiv_settings_v1"
const SETTINGS_FILE_NAME = "settings.json"
const LAUNCH_PAGE_VALUES: readonly LaunchPage[] = ["discovery", "ranking", "following"]
const WATCHLIST_SORT_VALUES: readonly WatchlistSortOrder[] = ["asc", "desc"]
const FEED_QUALITY_VALUES: readonly FeedImageQuality[] = ["medium", "large"]
const DETAIL_QUALITY_VALUES: readonly DetailImageQuality[] = ["large", "original"]
const DOWNLOAD_QUALITY_VALUES: readonly DownloadImageQuality[] = ["large", "original"]
const DOWNLOAD_STORAGE_MODE_VALUES: readonly DownloadStorageMode[] = ["local", "icloud"]
const DOWNLOAD_MANGA_FORMAT_VALUES: readonly DownloadMangaFormat[] = ["cbz", "epub"]
const DOWNLOAD_ILLUST_MULTI_ACTION_VALUES: readonly DownloadIllustMultiAction[] = ["album", "zip", "ask"]
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

function parseSettings(stored: Partial<AppSettings> & Record<string, unknown>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    launchPage: isOneOf(stored?.launchPage, LAUNCH_PAGE_VALUES)
      ? stored.launchPage
      : DEFAULT_SETTINGS.launchPage,
    showR18: boolOr(stored?.showR18, DEFAULT_SETTINGS.showR18),
    showR18G: boolOr(stored?.showR18G, DEFAULT_SETTINGS.showR18G),
    showAI: boolOr(stored?.showAI, DEFAULT_SETTINGS.showAI),
    exemptFilterForPersonal: boolOr(
      stored?.exemptFilterForPersonal,
      DEFAULT_SETTINGS.exemptFilterForPersonal
    ),
    hideNovels: boolOr(stored?.hideNovels, DEFAULT_SETTINGS.hideNovels),
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
      : DEFAULT_SETTINGS.detailImageQuality,
    downloadImageQuality: isOneOf(stored?.downloadImageQuality, DOWNLOAD_QUALITY_VALUES)
      ? stored.downloadImageQuality
      : DEFAULT_SETTINGS.downloadImageQuality,
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
    downloadMangaFormat: isOneOf(stored?.downloadMangaFormat, DOWNLOAD_MANGA_FORMAT_VALUES)
      ? stored.downloadMangaFormat
      : DEFAULT_SETTINGS.downloadMangaFormat,
    downloadIllustMultiAction: isOneOf(stored?.downloadIllustMultiAction, DOWNLOAD_ILLUST_MULTI_ACTION_VALUES)
      ? stored.downloadIllustMultiAction
      : DEFAULT_SETTINGS.downloadIllustMultiAction,
    prefetchEnabled: boolOr(stored?.prefetchEnabled, DEFAULT_SETTINGS.prefetchEnabled),
    cacheLimitMB: cacheLimitOf(stored?.cacheLimitMB),
    recordHistory: boolOr(stored?.recordHistory, DEFAULT_SETTINGS.recordHistory),
    imageBatchConcurrency: parseImageConcurrency(stored?.imageBatchConcurrency),
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
    advancedSettingsUnlocked: boolOr(stored?.advancedSettingsUnlocked, DEFAULT_SETTINGS.advancedSettingsUnlocked),
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
  const next = { ...loadSettings(), ...patch }
  cachedSettings = next
  persistSettings(next)
  emitChanged()
  return next
}

