import type { Color } from "scripting"
import { pixivNovelReaderDirectory } from "./dataDirectory"
import { recoverFile, writeDataSafely, writeTextSafely } from "./safeFile"

export type NovelThemeId =
  | "default"
  | "parchment"
  | "green"
  | "tea"
  | "dark"
  | "oled"
  | "custom"

export type BuiltinFontId = "system" | "songti" | "kaiti" | "yuanti"
export type NovelFontId = BuiltinFontId | "custom"

export type NovelFontWeight = "regular" | "medium" | "bold"
export type NovelLineSpacingLevel = "compact" | "normal" | "loose"
export type NovelLayoutDirection = "horizontal" | "vertical"

export interface NovelThemePalette {
  id: NovelThemeId
  name: string
  previewColor: Color
  backgroundColor: Color | null // null 表示系统自适应
  textColor: Color | null // null 表示系统自适应
  secondaryTextColor: Color | null
  dividerColor: Color
  isDark: boolean
}

export const NOVEL_THEME_PALETTES: Record<NovelThemeId, NovelThemePalette> = {
  default: {
    id: "default",
    name: "系统自适应",
    previewColor: "#FFFFFF",
    backgroundColor: null,
    textColor: null,
    secondaryTextColor: null,
    dividerColor: "rgba(128, 128, 128, 0.2)",
    isDark: false,
  },
  parchment: {
    id: "parchment",
    name: "羊皮暖纸",
    previewColor: "#F7F2E8",
    backgroundColor: "#F7F2E8",
    textColor: "#2F2721",
    secondaryTextColor: "#7D7268",
    dividerColor: "rgba(125, 114, 104, 0.25)",
    isDark: false,
  },
  green: {
    id: "green",
    name: "豆沙护眼",
    previewColor: "#E4EDE2",
    backgroundColor: "#E4EDE2",
    textColor: "#1C2C1E",
    secondaryTextColor: "#5E7260",
    dividerColor: "rgba(94, 114, 96, 0.25)",
    isDark: false,
  },
  tea: {
    id: "tea",
    name: "复古暖茶",
    previewColor: "#EEE6DA",
    backgroundColor: "#EEE6DA",
    textColor: "#362C27",
    secondaryTextColor: "#80756F",
    dividerColor: "rgba(128, 117, 111, 0.25)",
    isDark: false,
  },
  dark: {
    id: "dark",
    name: "雅致深灰",
    previewColor: "#202022",
    backgroundColor: "#202022",
    textColor: "#B8B8BD",
    secondaryTextColor: "#68686C",
    dividerColor: "rgba(255, 255, 255, 0.12)",
    isDark: true,
  },
  oled: {
    id: "oled",
    name: "极黑 OLED",
    previewColor: "#000000",
    backgroundColor: "#000000",
    textColor: "#8E8E93",
    secondaryTextColor: "#48484A",
    dividerColor: "rgba(255, 255, 255, 0.08)",
    isDark: true,
  },
  custom: {
    id: "custom",
    name: "相册壁纸",
    previewColor: "#8E8E93",
    backgroundColor: null,
    textColor: null,
    secondaryTextColor: null,
    dividerColor: "rgba(128, 128, 128, 0.3)",
    isDark: false,
  },
}

export interface NovelReaderSettings {
  themeId: NovelThemeId
  customBgExists: boolean
  customBgMaskOpacity: number // 0.0 ~ 0.8, 默认 0.35
  customBgMaskColor: "black" | "white"
  fontId: NovelFontId
  customFontPostscriptName: string | null
  fontWeight: NovelFontWeight
  fontSize: number // 14 ~ 32, 默认 17
  lineSpacingLevel: NovelLineSpacingLevel
  layoutDirection: NovelLayoutDirection
}

export const DEFAULT_NOVEL_READER_SETTINGS: NovelReaderSettings = {
  themeId: "default",
  customBgExists: false,
  customBgMaskOpacity: 0.35,
  customBgMaskColor: "black",
  fontId: "system",
  customFontPostscriptName: null,
  fontWeight: "regular",
  fontSize: 17,
  lineSpacingLevel: "normal",
  layoutDirection: "horizontal",
}

const SETTINGS_FILE_NAME = "settings.json"
const CUSTOM_BG_FILE_NAME = "custom_bg.jpg"

function getSettingsPath(): string {
  return `${pixivNovelReaderDirectory()}/${SETTINGS_FILE_NAME}`
}

export function getCustomBgPath(): string {
  return `${pixivNovelReaderDirectory()}/${CUSTOM_BG_FILE_NAME}`
}

let cachedSettings: NovelReaderSettings | null = null
const listeners = new Set<(settings: NovelReaderSettings) => void>()

export function onNovelReaderSettingsChanged(
  listener: (settings: NovelReaderSettings) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifySettingsChanged(settings: NovelReaderSettings) {
  for (const listener of listeners) {
    try {
      listener(settings)
    } catch {
      // 忽略单个监听器内部异常
    }
  }
}

export function loadNovelReaderSettings(): NovelReaderSettings {
  if (cachedSettings) {
    return cachedSettings
  }

  const path = getSettingsPath()
  const customBgFile = getCustomBgPath()
  const hasCustomBg = FileManager.existsSync(customBgFile)

  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<NovelReaderSettings>
        cachedSettings = {
          ...DEFAULT_NOVEL_READER_SETTINGS,
          ...parsed,
          customBgExists: hasCustomBg,
        }
        return cachedSettings
      }
    }
  } catch {
    // 读取或解析失败，使用默认值
  }

  cachedSettings = {
    ...DEFAULT_NOVEL_READER_SETTINGS,
    customBgExists: hasCustomBg,
  }
  return cachedSettings
}

export function saveNovelReaderSettings(
  partial: Partial<NovelReaderSettings>
): NovelReaderSettings {
  const current = loadNovelReaderSettings()
  const updated: NovelReaderSettings = {
    ...current,
    ...partial,
    customBgExists: FileManager.existsSync(getCustomBgPath()),
  }

  cachedSettings = updated

  try {
    const path = getSettingsPath()
    writeTextSafely(path, JSON.stringify(updated, null, 2))
  } catch {
    // 写入异常不阻塞 UI
  }

  notifySettingsChanged(updated)
  return updated
}

/**
 * 将用户选取的图片保存为 iCloud 同步的小说阅读器背景壁纸
 */
export async function saveCustomBackground(image: UIImage): Promise<boolean> {
  try {
    const data = image.toJPEGData(0.9)
    if (!data) return false
    const path = getCustomBgPath()
    writeDataSafely(path, data)
    saveNovelReaderSettings({ customBgExists: true, themeId: "custom" })
    return true
  } catch {
    return false
  }
}

/**
 * 移除自定义背景壁纸
 */
export function removeCustomBackground(): void {
  try {
    const path = getCustomBgPath()
    if (FileManager.existsSync(path)) {
      FileManager.removeSync(path)
    }
  } catch {
    // 忽略删除异常
  }
  const current = loadNovelReaderSettings()
  const nextTheme: NovelThemeId = current.themeId === "custom" ? "default" : current.themeId
  saveNovelReaderSettings({ customBgExists: false, themeId: nextTheme })
}

/**
 * 根据字体 ID 和 PostScript 名字解析系统 Font
 */
export function resolveFontName(
  fontId: NovelFontId,
  customPostscriptName: string | null
): string | undefined {
  if (fontId === "custom" && customPostscriptName && customPostscriptName.trim().length > 0) {
    return customPostscriptName.trim()
  }
  switch (fontId) {
    case "songti":
      return "Songti SC"
    case "kaiti":
      return "Kaiti SC"
    case "yuanti":
      return "Yuanti SC"
    case "system":
    default:
      return undefined // 使用系统默认字体
  }
}

/**
 * 根据字号与行距级别计算像素行间距
 */
export function calculateLineSpacing(fontSize: number, level: NovelLineSpacingLevel): number {
  switch (level) {
    case "compact":
      return Math.round(fontSize * 0.45)
    case "loose":
      return Math.round(fontSize * 0.85)
    case "normal":
    default:
      return Math.round(fontSize * 0.65)
  }
}
