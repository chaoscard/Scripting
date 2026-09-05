import { pixivNovelReaderDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

export type BuiltinFontId = "system" | "songti" | "kaiti" | "yuanti"
export type NovelFontId = BuiltinFontId | "custom"

export type NovelFontWeight = "regular" | "medium" | "bold"
export type NovelLineSpacingLevel = "compact" | "normal" | "loose"
export type NovelLayoutDirection = "horizontal" | "vertical"

export interface NovelReaderSettings {
  fontId: NovelFontId
  customFontPostscriptName: string | null
  fontWeight: NovelFontWeight
  fontSize: number // 14 ~ 32, 默认 17
  lineSpacingLevel: NovelLineSpacingLevel
  layoutDirection: NovelLayoutDirection
}

export const DEFAULT_NOVEL_READER_SETTINGS: NovelReaderSettings = {
  fontId: "system",
  customFontPostscriptName: null,
  fontWeight: "regular",
  fontSize: 17,
  lineSpacingLevel: "normal",
  layoutDirection: "horizontal",
}

const SETTINGS_FILE_NAME = "settings.json"

function getSettingsPath(): string {
  return `${pixivNovelReaderDirectory()}/${SETTINGS_FILE_NAME}`
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

  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<NovelReaderSettings>
        cachedSettings = {
          ...DEFAULT_NOVEL_READER_SETTINGS,
          ...parsed,
        }
        return cachedSettings
      }
    }
  } catch {
    // 读取或解析失败，使用默认值
  }

  cachedSettings = {
    ...DEFAULT_NOVEL_READER_SETTINGS,
  }
  return cachedSettings
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSettingsPersist(settings: NovelReaderSettings) {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const path = getSettingsPath()
      writeTextSafely(path, JSON.stringify(settings, null, 2))
    } catch {
      // 写入异常不阻塞 UI
    }
  }, 150)
}

export function saveNovelReaderSettings(
  partial: Partial<NovelReaderSettings>
): NovelReaderSettings {
  const current = loadNovelReaderSettings()
  const updated: NovelReaderSettings = {
    ...current,
    ...partial,
  }

  cachedSettings = updated
  scheduleSettingsPersist(updated)
  notifySettingsChanged(updated)
  return updated
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

