import type { OCRBubble } from "../../api/aiService"

export type IllustAIMode = "caption" | "ocr" | "vision"
export type NovelAIMode = "caption" | "translate" | "summary" | "continue"

export interface ScreenshotMaker {
  screenshot(): UIImage | null
}

export const PRESET_CONTINUE_PROMPTS = [
  "续写一个温馨甜蜜的日常结局",
  "续写一个意想不到的高能剧情反转",
  "以女主角的第一人称心理活动续写",
  "续写一段战斗高潮与破局时刻",
  "续写若干年后的后日谈与重逢",
]

export interface PageTranslationCache {
  resultText: string
  generatedImageBase64?: string | null
  error?: string | null
  imageFilePath?: string | null
  bubbles?: OCRBubble[]
  showOverlay?: boolean
  hiddenBubbleIndices?: number[]
  loading?: boolean
}

export interface NovelPageCache {
  translateText?: string
  summaryText?: string
  continueText?: string
  error?: string | null
}
