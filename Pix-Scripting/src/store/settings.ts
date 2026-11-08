import { Device } from "scripting"
import { migrateLocalToCloudIfNeeded, pixivSettingsDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

export type FeedImageQuality = "medium" | "large"
export type DetailImageQuality = "large" | "original"
export type DownloadImageQuality = "large" | "original"
export type ImageSourceMode = "pixiv_re" | "official" | "custom"
export type ApiGatewayMode = "official" | "custom"
export type UgoiraExportFormat = "mp4" | "gif"
export type DownloadStorageMode = "local" | "icloud"
export type QuickActionButtonAction = "bookmark" | "follow" | "download"
export type QuickActionButtonPosition = "trailing" | "leading"
export type PageLayout = "classic" | "appleMusic"
export const PAGE_LAYOUT_VALUES: ReadonlyArray<PageLayout> = ["appleMusic", "classic"]
export type ColorSchemeMode = "system" | "light" | "dark"
export const COLOR_SCHEME_MODE_VALUES: ReadonlyArray<ColorSchemeMode> = [
  "system",
  "light",
  "dark",
]
export type NavigationTransitionStyle = "push" | "zoom"
export const NAVIGATION_TRANSITION_VALUES: ReadonlyArray<NavigationTransitionStyle> = [
  "push",
  "zoom",
]

/** 顶栏过渡：导航栏与滚动内容交界处的处理方式，详见 ui/components/pageChrome.ts
 *  与设置项「玻璃效果」**共用同一套强度轴命名**：system=系统 / clear=透明 / soft=柔和 / tinted=色调
 *  实际映射：system→automatic、clear→关闭边缘效果、soft→soft、tinted→hard
 *  ⚠️ 这里的 soft 就是系统 scrollEdgeEffectStyle 的 soft；而「玻璃效果」那边的 soft 映射到的是
 *     UIGlass.regular() —— **同名不同源，别当成同一个常量**（详见 ui/components/glass.ts）。 */
export type TopBarEffect = "system" | "clear" | "soft" | "tinted"
export const TOP_BAR_EFFECT_VALUES: ReadonlyArray<TopBarEffect> = [
  "system",
  "clear",
  "soft",
  "tinted",
]

export type CloseButtonAction = "minimize" | "exit"
export type WatchlistSortOrder = "asc" | "desc"
export type AmbientIntensity = "low" | "medium" | "high"
export type BaseAmbientAlgorithm = "classic" | "explore" | "ultimate"
export type ExperimentalAmbientAlgorithm = "transcend" | "geminiA" | "geminiB"
export type AmbientAlgorithm = BaseAmbientAlgorithm | ExperimentalAmbientAlgorithm
export type GeminiMotionSpeed = "fast" | "official" | "calm"
export type LaunchPage = "discovery" | "ranking" | "following"
export type HapticFeedbackPreference = "full" | "compact" | "off"
export const HAPTIC_FEEDBACK_PREFERENCE_VALUES: ReadonlyArray<HapticFeedbackPreference> = [
  "full",
  "compact",
  "off",
]
export type ImageBatchConcurrency = number
export type AITranslateConcurrency = number
export type ImageFadeInDuration = number
export type BlurCrossFadeDuration = number
export type BlurCrossFadeRadius = number
export type SharpenFadeDuration = number
export type SharpenBlurRadius = number
export type BackgroundPreheatDuration = number
export type LoadingAnimationDuration = number
export type NovelLoadingDuration = number
export type LaunchAnimationDuration = number
export type FeedBottomInset = number
export type WidgetPoolCapacity = number
export type WidgetReloadIntervalMinutes = number
export type WidgetDefaultSource =
  | "ranking_day"
  | "ranking_week"
  | "ranking_month"
  | "recommend"
  | "follow"
  | "pixivision"

export type PrivacyShieldMaterial = "ultraThinMaterial" | "thinMaterial" | "regularMaterial"

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

export const DEFAULT_ILLUST_RANKING_MODES = ["day", "week", "month"]
export const DEFAULT_MANGA_RANKING_MODES = ["day_manga", "week_manga", "month_manga"]
export const DEFAULT_NOVEL_RANKING_MODES = ["day", "week", "week_rookie"]
export const DEFAULT_ILLUST_RANKING_MODES_IPAD = ["day", "week", "month", "week_original", "week_rookie"]
export const DEFAULT_MANGA_RANKING_MODES_IPAD = ["day_manga", "week_manga", "month_manga", "week_rookie_manga"]
export const DEFAULT_NOVEL_RANKING_MODES_IPAD = ["day", "week", "week_rookie"]


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
  pageLayout: PageLayout
  colorScheme: ColorSchemeMode
  navigationTransition: NavigationTransitionStyle
  topBarEffect: TopBarEffect
  glassCustomTintEnabled: boolean
  glassTintColor: string
  glassTintStrength: number
  glassInteractive: boolean
  splitViewEnabledLandscape: boolean
  splitViewEnabledPortrait: boolean
  splitRatioPortrait: number
  splitRatioLandscape: number
  heroFirstFeedCard: boolean
  compactIllustCard: boolean
  minimizeTabBarOnScroll: boolean
  ambientImmersion: boolean
  ambientIntensity: AmbientIntensity
  ambientAlgorithm: BaseAmbientAlgorithm
  novelReaderImmersion: boolean
  experimentalImmersion: boolean
  experimentalImmersionAlgorithm: ExperimentalAmbientAlgorithm
  geminiMotionSpeed: GeminiMotionSpeed
  geminiCustomParamsEnabled: boolean
  geminiTransitionIntervalMs: number
  geminiTransitionDurationMs: number
  geminiRotationPeriodSec: number
  geminiSwingDurationMs: number
  geminiCenterOffsetY: number
  geminiWingOffsetX: number
  geminiSwingDistance: number
  geminiBlurRadius: number
  geminiLuminousBoostRatio: number
  geminiLightModeAlphaRatio: number
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
  privacyShieldEnabled: boolean
  privacyShieldMaterial: PrivacyShieldMaterial
  cacheLimitMB: number | null
  recordHistory: boolean
  imageBatchConcurrency: ImageBatchConcurrency
  imageForegroundConcurrency: number
  imagePrefetchConcurrency: number
  enableViewportPreemption: boolean
  aiTranslateConcurrency: AITranslateConcurrency
  imageFadeInDuration: ImageFadeInDuration
  blurCrossFadeDuration: BlurCrossFadeDuration
  blurCrossFadeRadius: BlurCrossFadeRadius
  sharpenFadeDuration: SharpenFadeDuration
  sharpenBlurRadius: SharpenBlurRadius
  backgroundPreheatDuration: BackgroundPreheatDuration
  loadingAnimationDuration: LoadingAnimationDuration
  novelLoadingDuration: NovelLoadingDuration
  launchAnimationDuration: LaunchAnimationDuration
  feedBottomInset: FeedBottomInset
  enableLiveActivity: boolean
  enableTaskNotification: boolean
  advancedSettingsUnlocked: boolean
  mockFreeUser: boolean
  hasSeenFeatureHighlights: boolean
  hasSeenIpadSplitViewNotice: boolean
  dismissDownloadManagerNotice: boolean
  dismissHistoryNotice: boolean
  customRankingEnabled: boolean
  customRankingIllustModes: string[]
  customRankingMangaModes: string[]
  customRankingNovelModes: string[]
  customRankingIllustModesIpad: string[]
  customRankingMangaModesIpad: string[]
  customRankingNovelModesIpad: string[]
  widgetSourceSmallIos: WidgetDefaultSource
  widgetSourceMediumIos: WidgetDefaultSource
  widgetSourceLargeIos: WidgetDefaultSource
  widgetSourceSmallIpad: WidgetDefaultSource
  widgetSourceMediumIpad: WidgetDefaultSource
  widgetSourceLargeIpad: WidgetDefaultSource
  widgetSourceExtraLargeIpad: WidgetDefaultSource
  widgetSourceExtraLargePortraitIos: WidgetDefaultSource
  widgetSourceExtraLargePortraitIpad: WidgetDefaultSource
  widgetPoolCapacity: WidgetPoolCapacity
  widgetReloadIntervalMinutes: WidgetReloadIntervalMinutes
  quickActionButtonEnabled: boolean
  quickActionButtonAction: QuickActionButtonAction
  quickActionButtonPosition: QuickActionButtonPosition
  hapticFeedbackPreference: HapticFeedbackPreference
  novelImmersiveReaderEnabled: boolean
  imageSourceMode: ImageSourceMode
  customImageBaseUrl: string
  apiGatewayMode: ApiGatewayMode
  customApiBaseUrl: string
  customOauthBaseUrl: string
  customAccountBaseUrl: string
  customWebBaseUrl: string
}

const DEFAULT_SETTINGS: AppSettings = {
  launchPage: "discovery",
  showR18: false,
  showR18G: false,
  showAI: false,
  showRelatedUsersOnFollow: true,
  exemptFilterForPersonal: true,
  hideNovels: false,
  pageLayout: "appleMusic",
  colorScheme: "system",
  navigationTransition: "push",
  topBarEffect: "soft",
  glassCustomTintEnabled: false,
  glassTintColor: "#007aff",
  glassTintStrength: 10,
  glassInteractive: false,
  splitViewEnabledLandscape: false,
  splitViewEnabledPortrait: false,
  splitRatioPortrait: 45,
  splitRatioLandscape: 38,
  heroFirstFeedCard: true,
  compactIllustCard: true,
  minimizeTabBarOnScroll: true,
  ambientImmersion: true,
  ambientIntensity: "medium",
  ambientAlgorithm: "classic",
  novelReaderImmersion: false,
  experimentalImmersion: false,
  experimentalImmersionAlgorithm: "transcend",
  geminiMotionSpeed: "official",
  geminiCustomParamsEnabled: false,
  geminiTransitionIntervalMs: 2000,
  geminiTransitionDurationMs: 1800,
  geminiRotationPeriodSec: 7,
  geminiSwingDurationMs: 3800,
  geminiCenterOffsetY: -200,
  geminiWingOffsetX: 95,
  geminiSwingDistance: 40,
  geminiBlurRadius: 100,
  geminiLuminousBoostRatio: 25,
  geminiLightModeAlphaRatio: 52,
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
  privacyShieldEnabled: false,
  privacyShieldMaterial: "ultraThinMaterial",
  cacheLimitMB: 300,
  recordHistory: true,
  imageBatchConcurrency: 30,
  imageForegroundConcurrency: 10,
  imagePrefetchConcurrency: 15,
  enableViewportPreemption: true,
  aiTranslateConcurrency: 4,
  imageFadeInDuration: 80,
  blurCrossFadeDuration: 80,
  blurCrossFadeRadius: 2,
  sharpenFadeDuration: 80,
  sharpenBlurRadius: 0.3,
  backgroundPreheatDuration: 1000,
  loadingAnimationDuration: 400,
  novelLoadingDuration: 1000,
  launchAnimationDuration: 1500,
  feedBottomInset: 96,
  enableLiveActivity: true,
  enableTaskNotification: true,
  advancedSettingsUnlocked: false,
  mockFreeUser: false,
  hasSeenFeatureHighlights: false,
  hasSeenIpadSplitViewNotice: false,
  dismissDownloadManagerNotice: false,
  dismissHistoryNotice: false,
  customRankingEnabled: false,
  customRankingIllustModes: DEFAULT_ILLUST_RANKING_MODES,
  customRankingMangaModes: DEFAULT_MANGA_RANKING_MODES,
  customRankingNovelModes: DEFAULT_NOVEL_RANKING_MODES,
  customRankingIllustModesIpad: DEFAULT_ILLUST_RANKING_MODES_IPAD,
  customRankingMangaModesIpad: DEFAULT_MANGA_RANKING_MODES_IPAD,
  customRankingNovelModesIpad: DEFAULT_NOVEL_RANKING_MODES_IPAD,
  widgetSourceSmallIos: "ranking_day",
  widgetSourceMediumIos: "pixivision",
  widgetSourceLargeIos: "ranking_week",
  widgetSourceSmallIpad: "ranking_day",
  widgetSourceMediumIpad: "pixivision",
  widgetSourceLargeIpad: "ranking_week",
  widgetSourceExtraLargeIpad: "pixivision",
  widgetSourceExtraLargePortraitIos: "ranking_month",
  widgetSourceExtraLargePortraitIpad: "ranking_month",
  widgetPoolCapacity: 30,
  widgetReloadIntervalMinutes: 60,
  quickActionButtonEnabled: true,
  quickActionButtonAction: "bookmark",
  quickActionButtonPosition: "leading",
  hapticFeedbackPreference: "full",
  novelImmersiveReaderEnabled: false,
  imageSourceMode: "official",
  customImageBaseUrl: "",
  apiGatewayMode: "official",
  customApiBaseUrl: "",
  customOauthBaseUrl: "",
  customAccountBaseUrl: "",
  customWebBaseUrl: "",
}

const LEGACY_STORAGE_KEY = "pixiv_settings_v1"
const SETTINGS_FILE_NAME = "settings.json"
const WIDGET_DEFAULT_SOURCE_VALUES: readonly WidgetDefaultSource[] = [
  "ranking_day",
  "ranking_week",
  "ranking_month",
  "recommend",
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
const QUICK_ACTION_BUTTON_ACTION_VALUES: readonly QuickActionButtonAction[] = [
  "bookmark",
  "follow",
  "download",
]
const QUICK_ACTION_BUTTON_POSITION_VALUES: readonly QuickActionButtonPosition[] = [
  "leading",
  "trailing",
]
const PRIVACY_SHIELD_MATERIAL_VALUES: readonly PrivacyShieldMaterial[] = [
  "ultraThinMaterial",
  "thinMaterial",
  "regularMaterial",
]
const AMBIENT_INTENSITY_VALUES: readonly AmbientIntensity[] = ["low", "medium", "high"]
const BASE_AMBIENT_ALGORITHM_VALUES: readonly BaseAmbientAlgorithm[] = [
  "classic",
  "explore",
  "ultimate",
]
const EXPERIMENTAL_AMBIENT_ALGORITHM_VALUES: readonly ExperimentalAmbientAlgorithm[] = [
  "transcend",
  "geminiA",
  "geminiB",
]
const GEMINI_MOTION_SPEED_VALUES: readonly GeminiMotionSpeed[] = [
  "fast",
  "official",
  "calm",
]
const CACHE_LIMIT_VALUES = [300, 500, 1000, 2000] as const
const IMAGE_SOURCE_MODE_VALUES: readonly ImageSourceMode[] = [
  "official",
  "pixiv_re",
  "custom",
]
const API_GATEWAY_MODE_VALUES: readonly ApiGatewayMode[] = [
  "official",
  "custom",
]


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
  migrateLocalToCloudIfNeeded(path)
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

function enumOr<T extends string>(val: unknown, values: readonly T[], fallback: T): T {
  return isOneOf(val, values) ? val : fallback
}

function qualityOr<T extends string>(val: unknown, legacy: unknown, allowed: readonly T[], fallback: T): T {
  if (isOneOf(val, allowed)) return val
  if (isOneOf(legacy, allowed)) return legacy
  return fallback
}

function trimmedOrNull(val: unknown): string | null {
  return typeof val === "string" && val.trim().length > 0 ? val : null
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

function clampNum(value: unknown, min: number, max: number, fallback: number, step = 1): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const v = step === 1 ? Math.round(value) : Number((Math.round(value / step) * step).toFixed(4))
    return Math.max(min, Math.min(max, v))
  }
  return fallback
}

function parseStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  }
  return fallback
}

function widgetSourceOr(val: unknown, fallback: WidgetDefaultSource): WidgetDefaultSource {
  return isOneOf(val, WIDGET_DEFAULT_SOURCE_VALUES) ? val : fallback
}

function parseCustomBaseUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  if (!trimmed) return ""
  // 严格限制为 http:// 或 https:// 协议开头的合法 URL，禁止 javascript: 或本地协议注入
  if (!/^https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+$/i.test(trimmed)) {
    return fallback
  }
  return trimmed.replace(/\/+$/, "")
}

function parseSettings(stored: Partial<AppSettings> & Record<string, unknown>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    launchPage: enumOr(stored?.launchPage, LAUNCH_PAGE_VALUES, DEFAULT_SETTINGS.launchPage),
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
    pageLayout: enumOr(stored?.pageLayout, PAGE_LAYOUT_VALUES, DEFAULT_SETTINGS.pageLayout),
    colorScheme: enumOr(stored?.colorScheme, COLOR_SCHEME_MODE_VALUES, DEFAULT_SETTINGS.colorScheme),
    navigationTransition: enumOr(
      stored?.navigationTransition,
      NAVIGATION_TRANSITION_VALUES,
      DEFAULT_SETTINGS.navigationTransition
    ),
    topBarEffect: enumOr(stored?.topBarEffect, TOP_BAR_EFFECT_VALUES, DEFAULT_SETTINGS.topBarEffect),
    glassCustomTintEnabled: boolOr(
      stored?.glassCustomTintEnabled,
      DEFAULT_SETTINGS.glassCustomTintEnabled
    ),
    glassTintColor:
      typeof stored?.glassTintColor === "string" && stored.glassTintColor.trim().length > 0
        ? stored.glassTintColor
        : DEFAULT_SETTINGS.glassTintColor,
    glassTintStrength: clampNum(stored?.glassTintStrength, 0, 100, DEFAULT_SETTINGS.glassTintStrength),
    glassInteractive: boolOr(stored?.glassInteractive, DEFAULT_SETTINGS.glassInteractive),
    splitViewEnabledLandscape: boolOr(stored?.splitViewEnabledLandscape, DEFAULT_SETTINGS.splitViewEnabledLandscape),
    splitViewEnabledPortrait: boolOr(stored?.splitViewEnabledPortrait, DEFAULT_SETTINGS.splitViewEnabledPortrait),
    splitRatioPortrait: clampNum(
      stored?.splitRatioPortrait,
      20,
      70,
      DEFAULT_SETTINGS.splitRatioPortrait
    ),
    splitRatioLandscape: clampNum(
      stored?.splitRatioLandscape,
      20,
      70,
      DEFAULT_SETTINGS.splitRatioLandscape
    ),
    heroFirstFeedCard: boolOr(stored?.heroFirstFeedCard, DEFAULT_SETTINGS.heroFirstFeedCard),
    compactIllustCard: boolOr(stored?.compactIllustCard, DEFAULT_SETTINGS.compactIllustCard),
    minimizeTabBarOnScroll: boolOr(
      stored?.minimizeTabBarOnScroll,
      DEFAULT_SETTINGS.minimizeTabBarOnScroll
    ),
    ambientImmersion: boolOr(stored?.ambientImmersion, DEFAULT_SETTINGS.ambientImmersion),
    ambientIntensity: enumOr(stored?.ambientIntensity, AMBIENT_INTENSITY_VALUES, DEFAULT_SETTINGS.ambientIntensity),
    ambientAlgorithm: enumOr(stored?.ambientAlgorithm, BASE_AMBIENT_ALGORITHM_VALUES, DEFAULT_SETTINGS.ambientAlgorithm),
    novelReaderImmersion: boolOr(
      stored?.novelReaderImmersion,
      DEFAULT_SETTINGS.novelReaderImmersion
    ),
    experimentalImmersion: boolOr(
      stored?.experimentalImmersion,
      DEFAULT_SETTINGS.experimentalImmersion
    ),
    experimentalImmersionAlgorithm: enumOr(
      stored?.experimentalImmersionAlgorithm,
      EXPERIMENTAL_AMBIENT_ALGORITHM_VALUES,
      DEFAULT_SETTINGS.experimentalImmersionAlgorithm
    ),
    geminiMotionSpeed: enumOr(stored?.geminiMotionSpeed, GEMINI_MOTION_SPEED_VALUES, DEFAULT_SETTINGS.geminiMotionSpeed),
    geminiCustomParamsEnabled: boolOr(stored?.geminiCustomParamsEnabled, DEFAULT_SETTINGS.geminiCustomParamsEnabled),
    geminiTransitionIntervalMs: clampNum(stored?.geminiTransitionIntervalMs, 500, 10000, DEFAULT_SETTINGS.geminiTransitionIntervalMs),
    geminiTransitionDurationMs: clampNum(stored?.geminiTransitionDurationMs, 300, 9000, DEFAULT_SETTINGS.geminiTransitionDurationMs),
    geminiRotationPeriodSec: clampNum(stored?.geminiRotationPeriodSec, 0, 60, DEFAULT_SETTINGS.geminiRotationPeriodSec, 0.1),
    geminiSwingDurationMs: clampNum(stored?.geminiSwingDurationMs, 1000, 15000, DEFAULT_SETTINGS.geminiSwingDurationMs),
    geminiCenterOffsetY: clampNum(stored?.geminiCenterOffsetY, -350, -50, DEFAULT_SETTINGS.geminiCenterOffsetY),
    geminiWingOffsetX: clampNum(stored?.geminiWingOffsetX, 30, 200, DEFAULT_SETTINGS.geminiWingOffsetX),
    geminiSwingDistance: clampNum(stored?.geminiSwingDistance, 5, 120, DEFAULT_SETTINGS.geminiSwingDistance),
    geminiBlurRadius: clampNum(stored?.geminiBlurRadius, 30, 200, DEFAULT_SETTINGS.geminiBlurRadius),
    geminiLuminousBoostRatio: clampNum(stored?.geminiLuminousBoostRatio, 0, 100, DEFAULT_SETTINGS.geminiLuminousBoostRatio),
    geminiLightModeAlphaRatio: clampNum(stored?.geminiLightModeAlphaRatio, 10, 100, DEFAULT_SETTINGS.geminiLightModeAlphaRatio),
    watchlistSortOrder: enumOr(stored?.watchlistSortOrder, WATCHLIST_SORT_VALUES, DEFAULT_SETTINGS.watchlistSortOrder),
    longPressBookmarkAction: enumOr(stored?.longPressBookmarkAction, LONG_PRESS_ACTION_VALUES, DEFAULT_SETTINGS.longPressBookmarkAction),
    closeButtonAction: enumOr(stored?.closeButtonAction, CLOSE_BUTTON_ACTION_VALUES, DEFAULT_SETTINGS.closeButtonAction),
    feedImageQualityIos: isOneOf(stored?.feedImageQualityIos, FEED_QUALITY_VALUES)
      ? stored.feedImageQualityIos
      : isOneOf(stored?.feedImageQuality, FEED_QUALITY_VALUES)
      ? stored.feedImageQuality
      : DEFAULT_SETTINGS.feedImageQualityIos,
    feedImageQualityIpad: qualityOr(stored?.feedImageQualityIpad, stored?.feedImageQuality, FEED_QUALITY_VALUES, DEFAULT_SETTINGS.feedImageQualityIpad),
    detailImageQualityIos: qualityOr(stored?.detailImageQualityIos, stored?.detailImageQuality, DETAIL_QUALITY_VALUES, DEFAULT_SETTINGS.detailImageQualityIos),
    detailImageQualityIpad: qualityOr(stored?.detailImageQualityIpad, stored?.detailImageQuality, DETAIL_QUALITY_VALUES, DEFAULT_SETTINGS.detailImageQualityIpad),
    downloadImageQualityIos: qualityOr(stored?.downloadImageQualityIos, stored?.downloadImageQuality, DOWNLOAD_QUALITY_VALUES, DEFAULT_SETTINGS.downloadImageQualityIos),
    downloadImageQualityIpad: qualityOr(stored?.downloadImageQualityIpad, stored?.downloadImageQuality, DOWNLOAD_QUALITY_VALUES, DEFAULT_SETTINGS.downloadImageQualityIpad),
    ugoiraExportFormat: enumOr(stored?.ugoiraExportFormat, UGOIRA_EXPORT_FORMAT_VALUES, DEFAULT_SETTINGS.ugoiraExportFormat),
    downloadStorageMode: enumOr(stored?.downloadStorageMode, DOWNLOAD_STORAGE_MODE_VALUES, DEFAULT_SETTINGS.downloadStorageMode),
    downloadCustomDirectoryBookmark: trimmedOrNull(stored?.downloadCustomDirectoryBookmark),
    downloadCustomDirectoryPath: trimmedOrNull(stored?.downloadCustomDirectoryPath),
    downloadPhotoAlbumName:
      typeof stored?.downloadPhotoAlbumName === "string" && stored.downloadPhotoAlbumName.trim().length > 0
        ? stored.downloadPhotoAlbumName.trim()
        : DEFAULT_SETTINGS.downloadPhotoAlbumName,
    prefetchEnabled: boolOr(stored?.prefetchEnabled, DEFAULT_SETTINGS.prefetchEnabled),
    privacyShieldEnabled: boolOr(stored?.privacyShieldEnabled, DEFAULT_SETTINGS.privacyShieldEnabled),
    privacyShieldMaterial: enumOr(stored?.privacyShieldMaterial, PRIVACY_SHIELD_MATERIAL_VALUES, DEFAULT_SETTINGS.privacyShieldMaterial),
    cacheLimitMB: cacheLimitOf(stored?.cacheLimitMB),
    recordHistory: boolOr(stored?.recordHistory, DEFAULT_SETTINGS.recordHistory),
    imageBatchConcurrency: clampNum(stored?.imageBatchConcurrency, 1, 90, DEFAULT_SETTINGS.imageBatchConcurrency),
    imageForegroundConcurrency: clampNum(stored?.imageForegroundConcurrency, 1, 30, DEFAULT_SETTINGS.imageForegroundConcurrency),
    imagePrefetchConcurrency: clampNum(stored?.imagePrefetchConcurrency, 0, 30, DEFAULT_SETTINGS.imagePrefetchConcurrency),
    enableViewportPreemption: boolOr(
      stored?.enableViewportPreemption,
      DEFAULT_SETTINGS.enableViewportPreemption
    ),
    aiTranslateConcurrency: clampNum(stored?.aiTranslateConcurrency, 1, 6, DEFAULT_SETTINGS.aiTranslateConcurrency),
    imageFadeInDuration: clampNum(stored?.imageFadeInDuration, 1, 500, DEFAULT_SETTINGS.imageFadeInDuration),
    blurCrossFadeDuration: clampNum(stored?.blurCrossFadeDuration, 0, 250, DEFAULT_SETTINGS.blurCrossFadeDuration),
    blurCrossFadeRadius: clampNum(stored?.blurCrossFadeRadius, 0, 30, DEFAULT_SETTINGS.blurCrossFadeRadius, 0.1),
    sharpenFadeDuration: clampNum(stored?.sharpenFadeDuration, 0, 250, DEFAULT_SETTINGS.sharpenFadeDuration),
    sharpenBlurRadius: clampNum(stored?.sharpenBlurRadius, 0, 8, DEFAULT_SETTINGS.sharpenBlurRadius, 0.1),
    backgroundPreheatDuration: clampNum(stored?.backgroundPreheatDuration, 0, 2000, DEFAULT_SETTINGS.backgroundPreheatDuration),
    loadingAnimationDuration: clampNum(stored?.loadingAnimationDuration, 0, 30000, DEFAULT_SETTINGS.loadingAnimationDuration),
    novelLoadingDuration: clampNum(stored?.novelLoadingDuration, 0, 5000, DEFAULT_SETTINGS.novelLoadingDuration),
    launchAnimationDuration: clampNum(stored?.launchAnimationDuration, 0, 30000, DEFAULT_SETTINGS.launchAnimationDuration),
    feedBottomInset: clampNum(stored?.feedBottomInset, 0, 500, DEFAULT_SETTINGS.feedBottomInset),
    enableLiveActivity: boolOr(stored?.enableLiveActivity, DEFAULT_SETTINGS.enableLiveActivity),
    enableTaskNotification: boolOr(
      stored?.enableTaskNotification,
      DEFAULT_SETTINGS.enableTaskNotification
    ),
    advancedSettingsUnlocked: boolOr(stored?.advancedSettingsUnlocked, DEFAULT_SETTINGS.advancedSettingsUnlocked),
    mockFreeUser: boolOr(stored?.mockFreeUser, DEFAULT_SETTINGS.mockFreeUser),
    hasSeenFeatureHighlights: boolOr(
      stored?.hasSeenFeatureHighlights,
      DEFAULT_SETTINGS.hasSeenFeatureHighlights
    ),
    hasSeenIpadSplitViewNotice: boolOr(
      stored?.hasSeenIpadSplitViewNotice,
      DEFAULT_SETTINGS.hasSeenIpadSplitViewNotice
    ),
    dismissDownloadManagerNotice: boolOr(
      stored?.dismissDownloadManagerNotice,
      DEFAULT_SETTINGS.dismissDownloadManagerNotice
    ),
    dismissHistoryNotice: boolOr(
      stored?.dismissHistoryNotice,
      DEFAULT_SETTINGS.dismissHistoryNotice
    ),
    customRankingEnabled: boolOr(stored?.customRankingEnabled, DEFAULT_SETTINGS.customRankingEnabled),
    customRankingIllustModes: parseStringArray(stored?.customRankingIllustModes, DEFAULT_SETTINGS.customRankingIllustModes),
    customRankingMangaModes: parseStringArray(stored?.customRankingMangaModes, DEFAULT_SETTINGS.customRankingMangaModes),
    customRankingNovelModes: parseStringArray(stored?.customRankingNovelModes, DEFAULT_SETTINGS.customRankingNovelModes),
    customRankingIllustModesIpad: parseStringArray(
      stored?.customRankingIllustModesIpad,
      DEFAULT_SETTINGS.customRankingIllustModesIpad
    ),
    customRankingMangaModesIpad: parseStringArray(
      stored?.customRankingMangaModesIpad,
      DEFAULT_SETTINGS.customRankingMangaModesIpad
    ),
    customRankingNovelModesIpad: parseStringArray(
      stored?.customRankingNovelModesIpad,
      DEFAULT_SETTINGS.customRankingNovelModesIpad
    ),
    widgetSourceSmallIos: widgetSourceOr(stored?.widgetSourceSmallIos, DEFAULT_SETTINGS.widgetSourceSmallIos),
    widgetSourceMediumIos: widgetSourceOr(stored?.widgetSourceMediumIos, DEFAULT_SETTINGS.widgetSourceMediumIos),
    widgetSourceLargeIos: widgetSourceOr(stored?.widgetSourceLargeIos, DEFAULT_SETTINGS.widgetSourceLargeIos),
    widgetSourceSmallIpad: widgetSourceOr(stored?.widgetSourceSmallIpad, DEFAULT_SETTINGS.widgetSourceSmallIpad),
    widgetSourceMediumIpad: widgetSourceOr(stored?.widgetSourceMediumIpad, DEFAULT_SETTINGS.widgetSourceMediumIpad),
    widgetSourceLargeIpad: widgetSourceOr(stored?.widgetSourceLargeIpad, DEFAULT_SETTINGS.widgetSourceLargeIpad),
    widgetSourceExtraLargeIpad: widgetSourceOr(stored?.widgetSourceExtraLargeIpad, DEFAULT_SETTINGS.widgetSourceExtraLargeIpad),
    widgetSourceExtraLargePortraitIos: widgetSourceOr(stored?.widgetSourceExtraLargePortraitIos, DEFAULT_SETTINGS.widgetSourceExtraLargePortraitIos),
    widgetSourceExtraLargePortraitIpad: widgetSourceOr(stored?.widgetSourceExtraLargePortraitIpad, DEFAULT_SETTINGS.widgetSourceExtraLargePortraitIpad),
    widgetPoolCapacity: clampNum(stored?.widgetPoolCapacity, 10, 30, DEFAULT_SETTINGS.widgetPoolCapacity),
    widgetReloadIntervalMinutes: clampNum(stored?.widgetReloadIntervalMinutes, 1, 1440, DEFAULT_SETTINGS.widgetReloadIntervalMinutes),
    quickActionButtonEnabled: boolOr(
      stored?.quickActionButtonEnabled,
      DEFAULT_SETTINGS.quickActionButtonEnabled
    ),
    quickActionButtonAction: enumOr(stored?.quickActionButtonAction, QUICK_ACTION_BUTTON_ACTION_VALUES, DEFAULT_SETTINGS.quickActionButtonAction),
    quickActionButtonPosition: enumOr(stored?.quickActionButtonPosition, QUICK_ACTION_BUTTON_POSITION_VALUES, DEFAULT_SETTINGS.quickActionButtonPosition),
    hapticFeedbackPreference: enumOr(stored?.hapticFeedbackPreference, HAPTIC_FEEDBACK_PREFERENCE_VALUES, DEFAULT_SETTINGS.hapticFeedbackPreference),
    novelImmersiveReaderEnabled: stored?.novelImmersiveReaderEnabled === true,
    imageSourceMode: enumOr(stored?.imageSourceMode, IMAGE_SOURCE_MODE_VALUES, DEFAULT_SETTINGS.imageSourceMode),
    customImageBaseUrl: parseCustomBaseUrl(
      stored?.customImageBaseUrl,
      DEFAULT_SETTINGS.customImageBaseUrl
    ),
    apiGatewayMode: enumOr(stored?.apiGatewayMode, API_GATEWAY_MODE_VALUES, DEFAULT_SETTINGS.apiGatewayMode),
    customApiBaseUrl: parseCustomBaseUrl(
      stored?.customApiBaseUrl,
      DEFAULT_SETTINGS.customApiBaseUrl
    ),
    customOauthBaseUrl: parseCustomBaseUrl(
      stored?.customOauthBaseUrl,
      DEFAULT_SETTINGS.customOauthBaseUrl
    ),
    customAccountBaseUrl: parseCustomBaseUrl(
      stored?.customAccountBaseUrl,
      DEFAULT_SETTINGS.customAccountBaseUrl
    ),
    customWebBaseUrl: parseCustomBaseUrl(
      stored?.customWebBaseUrl,
      DEFAULT_SETTINGS.customWebBaseUrl
    ),
  }
}

function cleanupLegacyStorage(): void {
  try {
    if (typeof Storage !== "undefined" && Storage.contains(LEGACY_STORAGE_KEY)) {
      Storage.remove(LEGACY_STORAGE_KEY)
    }
  } catch {}
}

function persistSettings(settings: AppSettings): boolean {
  try {
    writeTextSafely(settingsFilePath(), JSON.stringify(settings, null, 2), (raw) => {
      const parsed = JSON.parse(raw)
      if (typeof parsed !== "object" || parsed === null) throw new Error("设置格式错误")
    })
    cleanupLegacyStorage()
    return true
  } catch (error: any) {
    console.log("settings file persist error:", error?.message ?? error)
    return false
  }
}

export function resetSettings(): AppSettings {
  const next = { ...DEFAULT_SETTINGS }
  const success = persistSettings(next)
  if (success) {
    cachedSettings = next
    emitChanged()
  }
  return cachedSettings || next
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
  migrateLocalToCloudIfNeeded(path)
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
    try {
      if (typeof Storage !== "undefined") {
        stored = Storage.get<Partial<AppSettings> & Record<string, unknown>>(LEGACY_STORAGE_KEY) ?? null
      }
    } catch {}
    needPersist = true
  }

  const merged = parseSettings(stored ?? {})
  cachedSettings = merged
  if (needPersist || !FileManager.existsSync(path)) {
    persistSettings(merged)
  } else {
    cleanupLegacyStorage()
  }
  return merged
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const raw = { ...current, ...patch }
  const next = parseSettings(raw)
  const success = persistSettings(next)
  if (success) {
    cachedSettings = next
    emitChanged()
    return next
  }
  console.log("updateSettings: failed to persist to disk, retaining current settings.")
  return current
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
  const pad = Device.isiPad
  if (family === "systemExtraLargePortrait") return pad ? settings.widgetSourceExtraLargePortraitIpad : settings.widgetSourceExtraLargePortraitIos
  if (family === "systemExtraLarge") return settings.widgetSourceExtraLargeIpad
  if (family === "systemLarge") return pad ? settings.widgetSourceLargeIpad : settings.widgetSourceLargeIos
  if (family === "systemMedium") return pad ? settings.widgetSourceMediumIpad : settings.widgetSourceMediumIos
  return pad ? settings.widgetSourceSmallIpad : settings.widgetSourceSmallIos
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

export interface CustomRankingTabItem {
  value: string
  title: string
}

export function resetCustomRankingKind(kind: "illust" | "manga" | "novel"): AppSettings {
  const pad = Device.isiPad
  const key = pad
    ? kind === "illust" ? "customRankingIllustModesIpad" : kind === "manga" ? "customRankingMangaModesIpad" : "customRankingNovelModesIpad"
    : kind === "illust" ? "customRankingIllustModes" : kind === "manga" ? "customRankingMangaModes" : "customRankingNovelModes"
  const val = pad
    ? kind === "illust" ? DEFAULT_ILLUST_RANKING_MODES_IPAD : kind === "manga" ? DEFAULT_MANGA_RANKING_MODES_IPAD : DEFAULT_NOVEL_RANKING_MODES_IPAD
    : kind === "illust" ? DEFAULT_ILLUST_RANKING_MODES : kind === "manga" ? DEFAULT_MANGA_RANKING_MODES : DEFAULT_NOVEL_RANKING_MODES
  return updateSettings({ [key]: [...val] })
}

export function getCustomRankingModesForKind(
  kind: "illustration" | "manga" | "novel",
  settings: AppSettings
): CustomRankingTabItem[] {
  const isiPad = Device.isiPad
  const options =
    kind === "illustration"
      ? ALL_ILLUST_RANKING_OPTIONS
      : kind === "manga"
        ? ALL_MANGA_RANKING_OPTIONS
        : ALL_NOVEL_RANKING_OPTIONS

  const defaultModes = isiPad
    ? kind === "illustration"
      ? DEFAULT_ILLUST_RANKING_MODES_IPAD
      : kind === "manga"
        ? DEFAULT_MANGA_RANKING_MODES_IPAD
        : DEFAULT_NOVEL_RANKING_MODES_IPAD
    : kind === "illustration"
      ? DEFAULT_ILLUST_RANKING_MODES
      : kind === "manga"
        ? DEFAULT_MANGA_RANKING_MODES
        : DEFAULT_NOVEL_RANKING_MODES

  const visible = getVisibleRankingOptions(options, settings)

  // 如果用户未开启自定义榜单，直接按照设备默认预设榜单（受内容显示过滤联动）呈现
  if (!settings.customRankingEnabled) {
    const list: CustomRankingTabItem[] = []
    for (const mode of defaultModes) {
      const found = visible.find((o) => o.key === mode)
      if (found) {
        list.push({ value: found.key, title: found.title })
      }
    }
    if (list.length > 0) return list
    if (visible.length > 0) {
      return [{ value: visible[0].key, title: visible[0].title }]
    }
    return []
  }

  // 用户开启了自定义榜单：读取设备对应的自定义选择
  const selectedModes = isiPad
    ? kind === "illustration"
      ? settings.customRankingIllustModesIpad
      : kind === "manga"
        ? settings.customRankingMangaModesIpad
        : settings.customRankingNovelModesIpad
    : kind === "illustration"
      ? settings.customRankingIllustModes
      : kind === "manga"
        ? settings.customRankingMangaModes
        : settings.customRankingNovelModes

  const active: CustomRankingTabItem[] = []

  for (const mode of selectedModes) {
    const found = visible.find((o) => o.key === mode)
    if (found) {
      active.push({ value: found.key, title: found.title })
    }
  }

  // iPad 最多截取 5 项，iPhone 最多截取 3 项
  const maxItems = isiPad ? 5 : 3
  const limited = active.slice(0, maxItems)
  if (limited.length > 0) return limited

  // 如果用户开启了自定义但未选任何有效项（如全部取消），回退到该类别的设备默认初始有效榜单列表
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
  const isiPad = Device.isiPad
  const options =
    kind === "illust"
      ? ALL_ILLUST_RANKING_OPTIONS
      : kind === "manga"
        ? ALL_MANGA_RANKING_OPTIONS
        : ALL_NOVEL_RANKING_OPTIONS
  const selectedModes = isiPad
    ? kind === "illust"
      ? settings.customRankingIllustModesIpad
      : kind === "manga"
        ? settings.customRankingMangaModesIpad
        : settings.customRankingNovelModesIpad
    : kind === "illust"
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

export function resolveImageUrl(
  url: string,
  settings: AppSettings = loadSettings()
): string {
  if (!url || typeof url !== "string") return url
  const mode = settings.imageSourceMode || "official"
  if (mode === "official") return url
  let targetBase = "https://i.pixiv.re"
  if (mode === "custom") {
    const custom = parseCustomBaseUrl(settings.customImageBaseUrl, "")
    if (!custom) {
      // 自定义未输入或协议不合法时静默回退官方原源
      return url
    }
    targetBase = custom
  }
  // 替换官方图片域名 i.pximg.net 与静态资源 s.pximg.net
  return url
    .replace(/^https?:\/\/i\.pximg\.net/, targetBase)
    .replace(/^https?:\/\/s\.pximg\.net/, targetBase)
}

export function getApiBaseUrl(settings: AppSettings = loadSettings()): string {
  if (settings.apiGatewayMode === "custom") {
    const custom = parseCustomBaseUrl(settings.customApiBaseUrl, "")
    if (custom) return custom
  }
  return "https://app-api.pixiv.net"
}

export function getOauthBaseUrl(
  settings: AppSettings = loadSettings()
): string {
  if (settings.apiGatewayMode === "custom") {
    const customOauth = parseCustomBaseUrl(settings.customOauthBaseUrl, "")
    if (customOauth) return customOauth
    const customApi = parseCustomBaseUrl(settings.customApiBaseUrl, "")
    if (customApi) return customApi
  }
  return "https://oauth.secure.pixiv.net"
}

export function getAccountBaseUrl(
  settings: AppSettings = loadSettings()
): string {
  if (settings.apiGatewayMode === "custom") {
    const customAccount = parseCustomBaseUrl(settings.customAccountBaseUrl, "")
    if (customAccount) return customAccount
    const customApi = parseCustomBaseUrl(settings.customApiBaseUrl, "")
    if (customApi) return customApi
  }
  return "https://accounts.pixiv.net"
}

export function getWebBaseUrl(
  settings: AppSettings = loadSettings()
): string {
  if (settings.apiGatewayMode === "custom") {
    const customWeb = parseCustomBaseUrl(settings.customWebBaseUrl, "")
    if (customWeb) return customWeb
  }
  return "https://www.pixiv.net"
}

export function resetNetworkSettings(): AppSettings {
  return updateSettings({
    imageSourceMode: "official",
    customImageBaseUrl: "",
    apiGatewayMode: "official",
    customApiBaseUrl: "",
    customOauthBaseUrl: "",
    customAccountBaseUrl: "",
    customWebBaseUrl: "",
  })
}

/** 供 preferredColorScheme 属性消费：system 返回 undefined，light/dark 返回对应值 */
export function getPreferredColorScheme(
  settings: AppSettings = loadSettings()
): "light" | "dark" | undefined {
  return settings.colorScheme === "system" ? undefined : settings.colorScheme
}

/** 供小说 WebView 与自绘图表消费：计算当前实质上的深浅模式（若设置是 system 则 fallback 到系统） */
export function getEffectiveIsDark(
  settings: AppSettings = loadSettings(),
  systemColorScheme?: string
): boolean {
  if (settings.colorScheme === "dark") return true
  if (settings.colorScheme === "light") return false
  return (systemColorScheme ?? Device.colorScheme) === "dark"
}




