/**
 * AI 服务核心层：负责文本清洗、语义分块、流式翻译、OCR识别与总结续写
 * 支持优先调度自定义 AI 协议 (OpenAI Responses / Chat, Gemini, Claude, DALL-E, FLUX 等)，
 * 并向下兼容回退原生 Assistant.requestStreaming
 */
import { AbortController } from "scripting"
import { loadImage, imageUrlOf } from "../image/imageLoader"
import type { PixivIllustration } from "../types"
import {
  loadCustomAIProfile,
  isCustomAIConfigured,
  getEffectiveImageGenKey,
  getEffectiveImageGenEndpoint,
  isScriptingPro,
} from "../store/customAI"
import {
  streamCustomChat,
  requestCustomImageGen,
  createLinkedAbortController,
  resolveGeneralAIConfigRoute,
  type AdapterMessage,
  type AdapterMessageContentPart,
  type SignalLike,
} from "./aiAdapters"

const globalAITaskControllers = new Set<AbortController>()

/**
 * 瞬间中止所有全局正在进行的 AI 任务与网络长连接
 */
export function abortAllAITasks(): void {
  for (const controller of globalAITaskControllers) {
    try {
      controller.abort()
    } catch {}
  }
  globalAITaskControllers.clear()
}

/**
 * 检查 AI 服务是否可用：
 * 1. 优先检查自定义 AI 是否有效配置（无需 PRO 会员）
 * 2. 否则检查用户是否具备 Scripting PRO 且原生 Assistant 可用
 */
export function isAIAvailable(): boolean {
  if (isCustomAIConfigured()) {
    return true
  }
  if (isScriptingPro()) {
    try {
      return typeof Assistant !== "undefined" && Boolean(Assistant.isAvailable)
    } catch {
      return false
    }
  }
  return false
}

/**
 * 获取友好的 AI 不可用引导提示
 */
export function getAIUnavailableErrorMessage(): string {
  if (isScriptingPro()) {
    return "Scripting 原生 AI 助手未配置或暂不可用，请在 Scripting App 设置中配置模型，或在 Pix-Scripting「设置 ➔ 智能助手」中开启自定义模型。"
  }
  return "当前未检测到 Scripting PRO 会员。您可以前往「设置 ➔ 智能助手」开启自定义 AI 模型并填入您的 API 密钥（支持 DeepSeek、OpenAI、Gemini、Claude 等），即可免费解锁完整 AI 功能。"
}

/**
 * 清洗简介中的 HTML 标签与实体符号
 */
export function cleanHtmlCaption(caption: string | null | undefined): string {
  if (!caption) return ""
  return caption
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*?>(.*?)<\/a>/gi, "$3")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/**
 * 清洗 Pixiv 小说文本：
 * 1. 去除插图引用标记（例如 [[jumpimage:1]]、[pixivimage:xxx] 等）
 * 2. 将注音 [[rb: 汉字 > 假名]] 转换为标准汉字或注音
 * 3. 规范化连续换行
 */
export function cleanNovelTextForAI(rawText: string | null | undefined): string {
  if (!rawText) return ""
  return rawText
    .replace(/\[\[jumpimage:\s*\d+\s*\]\]/gi, "")
    .replace(/\[pixivimage:\s*\d+(?:-\d+)?\s*\]/gi, "")
    .replace(/\[uploadedimage:\s*\d+\s*\]/gi, "")
    .replace(
      /\[\[rb:\s*([^\r\n>]+?)\s*(?:>|&gt;)\s*([^\r\n\]]+?)\s*\]\]/g,
      (_, kanji: string) => kanji.trim()
    )
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

/**
 * 语义平滑分块算法：
 * 将长文本按段落自然切分为 1500~2200 字左右的安全块，避免模型输出截断与漏译
 */
export function splitNovelChunks(text: string, targetSize = 1800): string[] {
  if (!text) return []
  if (text.length <= targetSize * 1.3) {
    return [text]
  }

  const chunks: string[] = []
  const paragraphs = text.split(/\n+/)
  let currentChunk = ""

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    if (currentChunk.length + trimmed.length + 1 <= targetSize) {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmed
    } else {
      if (currentChunk) {
        chunks.push(currentChunk)
        currentChunk = ""
      }

      if (trimmed.length > targetSize) {
        const sentences = trimmed.split(/(?<=[。！？\n])/)
        let temp = ""
        for (const sent of sentences) {
          if (sent.length > targetSize) {
            if (temp) {
              chunks.push(temp)
              temp = ""
            }
            for (let offset = 0; offset < sent.length; offset += targetSize) {
              const piece = sent.slice(offset, offset + targetSize)
              if (piece.length === targetSize) chunks.push(piece)
              else temp = piece
            }
          } else if (temp.length + sent.length <= targetSize) {
            temp += sent
          } else {
            if (temp) chunks.push(temp)
            temp = sent
          }
        }
        if (temp) {
          currentChunk = temp
        }
      } else {
        currentChunk = trimmed
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks.length > 0 ? chunks : [text]
}

export interface StreamTranslateOptions {
  onChunk: (chunkText: string) => void
  onProgress?: (info: { chunkIndex: number; totalChunks: number; percent: number }) => void
  signal?: { aborted?: boolean }
}

/**
 * 剥离文本中的思维链标签（支持 <think>, <thought>, <thinking>）
 */
export function stripThinkingTags(text: string): string {
  if (!text) return ""
  return text
    .replace(/<(?:think|thought|thinking)>[\s\S]*?<\/(?:think|thought|thinking)>/gi, "")
    .replace(/^<(?:think|thought|thinking)>[\s\S]*$/gi, "")
    .trim()
}

/**
 * 流式文本提取器：实时过滤嵌入在正文流中的 <think>...</think> 思考内容
 */
export class StreamingContentFilter {
  private rawBuffer = ""

  push(chunk: string): { cleanText: string } {
    this.rawBuffer += chunk

    const thinkStartMatch = this.rawBuffer.match(/<(?:think|thought|thinking)>/i)
    if (thinkStartMatch && thinkStartMatch.index !== undefined) {
      const matchTag = thinkStartMatch[0].replace(/[<>]/g, "").toLowerCase()
      const endTag = `</${matchTag}>`
      const endTagIndex = this.rawBuffer.toLowerCase().indexOf(endTag)

      if (endTagIndex !== -1) {
        const afterEnd = this.rawBuffer.slice(endTagIndex + endTag.length)
        const beforeStart = this.rawBuffer.slice(0, thinkStartMatch.index)
        const clean = (beforeStart + afterEnd).trimStart()
        return {
          cleanText: clean,
        }
      } else {
        const beforeStart = this.rawBuffer.slice(0, thinkStartMatch.index)
        return {
          cleanText: beforeStart.trimStart(),
        }
      }
    }

    return {
      cleanText: this.rawBuffer,
    }
  }

  getFinalCleanText(): string {
    return stripThinkingTags(this.rawBuffer)
  }
}

/**
 * 内部统一流式调度执行器（优先自定义 AI，回退原生 Assistant）
 */
async function executeUniversalAI(params: {
  systemPrompt?: string
  messages: AdapterMessage[]
  temperature?: number
  options: {
    onChunk: (chunkText: string) => void
    onReasoning?: (reasoningText: string) => void
    onImage?: (image: { base64: string; mediaType: string }) => void
    signal?: SignalLike
  }
}): Promise<string> {
  const { systemPrompt, messages, temperature, options } = params

  if (options.signal?.aborted) {
    return ""
  }

  const { controller, cleanup } = createLinkedAbortController(options.signal)
  globalAITaskControllers.add(controller)

  try {
    const contentFilter = new StreamingContentFilter()

    if (isCustomAIConfigured()) {
      const profile = loadCustomAIProfile()
      let reasoningOutput = ""

      const res = await streamCustomChat(profile.general, {
        systemPrompt,
        messages,
        temperature,
        signal: controller.signal,
        onChunk: (delta) => {
          if (controller.signal.aborted) return
          const { cleanText } = contentFilter.push(delta)
          if (cleanText) {
            options.onChunk(cleanText)
          }
        },
        onReasoning: (reasoning) => {
          if (controller.signal.aborted) return
          reasoningOutput += reasoning
          options.onReasoning?.(reasoning)
        },
        onImage: (img) => {
          options.onImage?.(img)
        },
        requestImageOutput: Boolean(options.onImage),
      })

      const finalClean = contentFilter.getFinalCleanText() || stripThinkingTags(res.text)
      if (!finalClean && res.images.length === 0) {
        throw new Error("AI 模型未返回可用正文或图片")
      }
      return finalClean
    }

    if (isScriptingPro() && typeof Assistant !== "undefined" && Boolean(Assistant.isAvailable)) {
      let receivedNativeImage = false
      let reasoningOutput = ""

      const assistantMessages = messages.map((m) => {
        if (typeof m.content === "string") {
          return { role: m.role, content: m.content }
        }
        const parts = m.content.map((part) => {
          if (part.type === "text") {
            return { type: "text", content: part.text || "" }
          }
          const mime = part.mimeType || "image/jpeg"
          const dataUri = part.imageBase64?.startsWith("data:")
            ? part.imageBase64
            : `data:${mime};base64,${part.imageBase64 || ""}`
          return { type: "image", content: dataUri }
        })
        return { role: m.role, content: parts }
      })

      const stream = await Assistant.requestStreaming({
        systemPrompt,
        messages: assistantMessages as any,
      })

      for await (const chunk of stream) {
        if (controller.signal.aborted) break

        if (chunk.type === "text" && chunk.content) {
          const { cleanText } = contentFilter.push(chunk.content)
          if (cleanText) {
            options.onChunk(cleanText)
          }
        } else if (chunk.type === "reasoning" && chunk.content) {
          reasoningOutput += chunk.content
          options.onReasoning?.(chunk.content)
        } else if (chunk.type === "image" && chunk.content) {
          receivedNativeImage = true
          options.onImage?.({
            base64: chunk.content.data,
            mediaType: chunk.content.mediaType || "image/png",
          })
        }
      }

      const finalClean = contentFilter.getFinalCleanText()
      if (!finalClean && !receivedNativeImage) {
        throw new Error("Scripting 原生 AI 未返回可用正文或图片")
      }
      return finalClean
    }

    throw new Error(getAIUnavailableErrorMessage())
  } finally {
    globalAITaskControllers.delete(controller)
    cleanup()
  }
}

/**
 * 流式翻译短文本（如简介、标题）
 */
export async function streamTranslateText(
  text: string,
  options: StreamTranslateOptions
): Promise<string> {
  if (!text || !text.trim()) return ""
  if (options.signal?.aborted) return ""
  if (!isAIAvailable()) {
    throw new Error(getAIUnavailableErrorMessage())
  }

  const systemPrompt =
    "你是一位资深且精准的ACG多语言翻译专家。请自动识别用户提供的Pixiv作品简介或文本的源语言（如日文、英文、韩文等），并将其翻译为自然、地道、信达雅的简体中文。\n" +
    "要求：\n" +
    "1. 保持原文的语气、排版、换行与二次元ACG语境。\n" +
    "2. 人名、社团名、展会名等专有名词保留规范称呼。\n" +
    "3. 直接输出翻译后的中文，不要输出任何多余的解释、前缀或开场白。"

  return executeUniversalAI({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: `请翻译以下内容：\n\n${text}`,
      },
    ],
    options: {
      onChunk: options.onChunk,
      signal: options.signal,
    },
  })
}

/**
 * 流式分块翻译长篇小说（自动处理分块和上下文连贯性）
 */
export async function streamTranslateNovel(
  rawText: string,
  options: StreamTranslateOptions
): Promise<string> {
  const cleaned = cleanNovelTextForAI(rawText)
  if (!cleaned) return ""
  if (options.signal?.aborted) return ""
  if (!isAIAvailable()) {
    throw new Error(getAIUnavailableErrorMessage())
  }

  const chunks = splitNovelChunks(cleaned, 1800)
  const totalChunks = chunks.length
  let accumulatedResult = ""
  let previousContextTail = ""

  const baseSystemPrompt =
    "你是一位卓越的二次元轻小说与同人文翻译家。请自动识别以下小说正文的源语言（如日文、英文、韩文等），并将其翻译为流畅优美、人物语气鲜明、符合轻小说阅读习惯的简体中文。\n" +
    "要求：\n" +
    "1. 保留原本的段落换行与对话语气。\n" +
    "2. 保持前后角色称谓、专有名词与人称代词的一致性。\n" +
    "3. 严禁遗漏任何正文细节，直接输出正文译文，严禁包含任何前缀、附注或多余寒暄。"

  for (let i = 0; i < totalChunks; i++) {
    if (options.signal?.aborted) break

    if (options.onProgress) {
      options.onProgress({
        chunkIndex: i + 1,
        totalChunks,
        percent: Math.round(((i + 1) / totalChunks) * 100),
      })
    }

    const currentChunk = chunks[i]
    let userPrompt = ""
    if (previousContextTail) {
      userPrompt += `【前文背景参考（仅用于理解上下文与人称，不要翻译本段）：】\n${previousContextTail}\n\n`
    }
    userPrompt += `【请完整翻译以下正文第 ${i + 1}/${totalChunks} 部分：】\n${currentChunk}`

    let chunkOutput = ""
    const chunkResult = await executeUniversalAI({
      systemPrompt: baseSystemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
      options: {
        onChunk: (text) => {
          chunkOutput = text
          const currentCombined = accumulatedResult
            ? accumulatedResult + "\n\n" + chunkOutput
            : chunkOutput
          options.onChunk(currentCombined)
        },
        signal: options.signal,
      },
    })

    if (options.signal?.aborted) break

    accumulatedResult = accumulatedResult
      ? accumulatedResult + "\n\n" + (chunkOutput || chunkResult)
      : (chunkOutput || chunkResult)

    previousContextTail = currentChunk.slice(-150)
  }

  return accumulatedResult
}

/**
 * 将 Pixiv 小说正文按 [newpage] 分割为各页文本数组
 */
export function splitNovelPages(rawText: string): string[] {
  if (!rawText) return []
  const pages = rawText.split(/\[newpage\]/i)
  return pages.length > 0 ? pages : [rawText]
}

/**
 * 获取 Pixiv 小说指定页码（1-based）的正文文本
 */
export function getNovelPageText(rawText: string, page: number): string {
  const pages = splitNovelPages(rawText)
  const index = Math.max(0, Math.min(page - 1, pages.length - 1))
  return pages[index] || ""
}

/**
 * 结构化总结小说（大纲、角色、看点与避雷，或多页小说中单页剧情提炼）
 */
export async function streamSummarizeNovel(
  rawText: string,
  options: StreamTranslateOptions & { pageInfo?: { current: number; total: number } }
): Promise<string> {
  const cleaned = cleanNovelTextForAI(rawText)
  if (!cleaned) return ""
  if (options.signal?.aborted) return ""
  if (!isAIAvailable()) {
    throw new Error(getAIUnavailableErrorMessage())
  }

  const isSinglePageOfMulti = Boolean(options.pageInfo && options.pageInfo.total > 1)

  let sampleText = cleaned
  if (cleaned.length > 15000) {
    const head = cleaned.slice(0, 6000)
    const mid = cleaned.slice(Math.floor(cleaned.length / 2) - 2500, Math.floor(cleaned.length / 2) + 2500)
    const tail = cleaned.slice(-4000)
    sampleText = `${head}\n\n[...中间情节略...]\n\n${mid}\n\n[...后文情节略...]\n\n${tail}`
  }

  const systemPrompt = isSinglePageOfMulti
    ? "你是一位资深轻小说总编。请阅读提供的Pixiv小说当前页面内容，为读者生成一份清晰、精炼、结构化的中文本页剧情提炼与重点总结。\n" +
      "输出格式请严格遵循以下 Markdown 结构：\n\n" +
      "### 📌 本页核心剧情脉络\n(简练概括本页发生的关键事件与冲突发展)\n\n" +
      "### 👥 本页出场人物与互动\n- **角色名**：本页的关键行为或心理变化\n\n" +
      "### 💡 本页看点与关键信息\n- (提炼出本页的重要看点、伏笔或亮点台词)\n\n" +
      "注意：直接输出Markdown内容，精炼生动，不要添加额外的问候语。"
    : "你是一位资深轻小说总编。请阅读提供的Pixiv小说内容，为读者生成一份清晰、专业、结构化的中文导读与速读总结。\n" +
      "输出格式请严格遵循以下 Markdown 结构：\n\n" +
      "### 📌 核心剧情大纲\n(用200-300字简练概括主线起因、发展与核心冲突/结局)\n\n" +
      "### 👥 登场角色与关系\n- **角色名**：身份背景及与主角的关系\n\n" +
      "### 🏷️ 风格标签与看点\n- (提炼出3-5个核心看点，如：纯爱发糖 / 胃痛胃药 / IF线展开 / 战斗爽快)\n\n" +
      "### ⚠️ 阅读提示与预警\n- (如有虐心、致郁、雷点或特殊癖好请明确标注，若无则注明“全年龄温馨向/无明显雷点”)\n\n" +
      "注意：直接输出Markdown内容，语言生动精练，不要添加额外的问候语。"

  return executeUniversalAI({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: isSinglePageOfMulti
          ? `请为以下小说第 ${options.pageInfo!.current}/${options.pageInfo!.total} 页内容生成提炼总结：\n\n${sampleText}`
          : `请为以下小说生成导读总结：\n\n${sampleText}`,
      },
    ],
    options: {
      onChunk: options.onChunk,
      signal: options.signal,
    },
  })
}

/**
 * 续写小说
 */
export async function streamContinueNovel(
  rawText: string,
  userInstruction: string,
  options: StreamTranslateOptions
): Promise<string> {
  const cleaned = cleanNovelTextForAI(rawText)
  if (!cleaned) return ""
  if (options.signal?.aborted) return ""
  if (!isAIAvailable()) {
    throw new Error(getAIUnavailableErrorMessage())
  }

  const contextTail = cleaned.slice(-3000)

  const systemPrompt =
    "你是一位富有想象力的同人轻小说作家。请基于用户提供的前文剧情、人物性格和世界观设定，续写一段生动精彩的后续内容或番外篇章。\n" +
    "要求：\n" +
    "1. 严格契合前文人物的人设口吻、情感羁绊与世界观。\n" +
    "2. 语言生动、描写细腻，符合日系轻小说的叙事节奏。\n" +
    "3. 如果用户提供了特定的续写指导，需严格遵循其指令展开。\n" +
    "4. 直接输出续写的中文小说正文。"

  let userPrompt = `【前文结尾内容如下：】\n${contextTail}\n\n`
  if (userInstruction && userInstruction.trim()) {
    userPrompt += `【用户特定续写要求：】\n${userInstruction.trim()}\n\n`
  }
  userPrompt += "请基于以上内容开始续写后续篇章："

  return executeUniversalAI({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
    options: {
      onChunk: options.onChunk,
      signal: options.signal,
    },
  })
}

export interface OCRBubble {
  box_2d: [number, number, number, number] // [ymin, xmin, ymax, xmax] 范围 0~1000
  shape?: "ellipse" | "round_rect" | "rectangle" | "transparent"
  original?: string
  translation: string
}

function isOCRBubbleArray(value: unknown[]): boolean {
  return value.some((item: any) => item && typeof item === "object" && Array.isArray(item.box_2d))
}

function parseJSONArrayFromText(text: string): unknown[] | null {
  const cleanText = stripThinkingTags(text).trim()
  const fenced = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidates = fenced?.[1] ? [fenced[1].trim(), cleanText] : [cleanText]

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed) && isOCRBubbleArray(parsed)) return parsed
    } catch {}

    let searchFrom = 0
    while (searchFrom < candidate.length) {
      const start = candidate.indexOf("[", searchFrom)
      if (start < 0) break
      let depth = 0
      let inString = false
      let escaped = false
      for (let i = start; i < candidate.length; i++) {
        const char = candidate[i]
        if (inString) {
          if (escaped) escaped = false
          else if (char === "\\") escaped = true
          else if (char === '"') inString = false
          continue
        }
        if (char === '"') inString = true
        else if (char === "[") depth++
        else if (char === "]") {
          depth--
          if (depth === 0) {
            try {
              const parsed = JSON.parse(candidate.slice(start, i + 1))
              if (Array.isArray(parsed) && isOCRBubbleArray(parsed)) return parsed
            } catch {}
            break
          }
        }
      }
      searchFrom = start + 1
    }
  }
  return null
}

export function extractOCRBubbles(text: string): OCRBubble[] {
  if (!text) return []
  const parsed = parseJSONArrayFromText(text)
  if (!parsed) return []

  return parsed.filter((b: any): b is OCRBubble => {
    if (
      !Array.isArray(b?.box_2d) ||
      b.box_2d.length !== 4 ||
      !b.box_2d.every((value: any) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000) ||
      typeof b?.translation !== "string" ||
      !b.translation.trim()
    ) {
      return false
    }
    const [ymin, xmin, ymax, xmax] = b.box_2d
    return ymin < ymax && xmin < xmax
  })
}

export function cleanOCRDisplayMarkdown(text: string): string {
  if (!text) return ""
  const cleanText = stripThinkingTags(text)
  return cleanText.replace(/```(?:json)?\s*[\s\S]*?\s*```/gi, (block) => {
    return parseJSONArrayFromText(block) ? "" : block
  }).trim()
}

export interface StreamVisionTranslateOptions extends StreamTranslateOptions {
  onImageReady?: (filePath: string) => void
  onBubblesParsed?: (bubbles: OCRBubble[]) => void
}

/**
 * 多模态大模型视觉深度解析与气泡翻译（精准识别竖排日文、对话气泡与拟声词）
 */
export async function streamVisionTranslateImage(
  illust: PixivIllustration,
  pageIndex: number,
  options: StreamVisionTranslateOptions
): Promise<string> {
  const url = imageUrlOf(illust, pageIndex, "large")
  if (!url) {
    throw new Error("无法获取图片地址")
  }

  if (options.signal?.aborted) {
    throw new Error("AI 任务已取消")
  }

  const filePath = await loadImage(url)
  if (options.signal?.aborted) {
    throw new Error("AI 任务已取消")
  }

  if (!filePath) {
    throw new Error("图片下载失败，请检查网络后重试")
  }

  if (options.onImageReady) {
    options.onImageReady(filePath)
  }

  const uiImage = UIImage.fromFile(filePath)
  if (!uiImage) {
    throw new Error("无法解码图片数据")
  }

  if (options.signal?.aborted) {
    throw new Error("AI 任务已取消")
  }

  const base64 = uiImage.toJPEGBase64String(0.85)
  if (!base64) {
    throw new Error("图片 Base64 编码失败")
  }

  if (options.signal?.aborted) {
    throw new Error("AI 任务已取消")
  }

  if (!isAIAvailable()) {
    throw new Error(getAIUnavailableErrorMessage())
  }

  if (isCustomAIConfigured()) {
    const profile = loadCustomAIProfile()
    const routedGeneral = resolveGeneralAIConfigRoute(profile.general)
    if (!routedGeneral.supportsVision) {
      throw new Error("当前通用模型未启用视觉识别，请选择支持图片输入的模型并打开“支持视觉识别”")
    }
  }

  const systemPrompt =
    "你是一位卓越的二次元漫画汉化组翻译与视觉定位专家。请仔细观察用户提供的插画/漫画页面（支持日文、英文、韩文等多种语言）：\n" +
    "1. 识别画面中所有的对话气泡（竖排与横排）、分镜旁白框、手写小字和拟声词。\n" +
    "2. 提取气泡紧贴原图边界的归一化 2D 矩形坐标 [ymin, xmin, ymax, xmax]（整数范围 0 到 1000，务必精确贴合原始气泡的真实边界，不要过大也不要过小）。\n" +
    "3. 判断气泡的真实形态 shape：\n" +
    '   - "ellipse": 常见的圆形、椭圆形或胶囊状对话气泡（绝大多数漫画人物对话气泡）\n' +
    '   - "round_rect": 圆角矩形气泡或带弧度的说明框\n' +
    '   - "rectangle": 矩形分镜旁白框、方形对话框\n' +
    '   - "transparent": 无白色底框的画面悬浮字、手写小字、拟声词（需保留原图背景）\n' +
    "4. 提取原文并翻译为自然、生动、契合角色语气的简体中文。\n\n" +
    "请务必在回复最前面输出格式化的 JSON 坐标块：\n" +
    "```json\n" +
    "[\n" +
    '  {"box_2d": [ymin, xmin, ymax, xmax], "shape": "ellipse", "original": "日文原文", "translation": "中文翻译"}\n' +
    "]\n" +
    "```\n\n" +
    "在 JSON 块之后，请输出带序号的 Markdown 对照列表：\n" +
    "**[气泡 1]** (位置/说话者)\n" +
    "- **原文**：原文台词\n" +
    "- **译文**：中文翻译"

  let streamedOCRText = ""
  let lastParsedJsonBlock = ""
  let hasParsedClosedJson = false

  const contentParts: AdapterMessageContentPart[] = [
    {
      type: "text",
      text: "请识别并定位这张漫画/插画中的所有气泡与文字，返回坐标 JSON 和中文汉化翻译：",
    },
    {
      type: "image",
      imageBase64: base64,
      mimeType: "image/jpeg",
    },
  ]

  const fullOutput = await executeUniversalAI({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: contentParts,
      },
    ],
    options: {
      onChunk: (text) => {
        streamedOCRText = text
        options.onChunk(text)

        if (options.onBubblesParsed && !hasParsedClosedJson) {
          const bubbles = extractOCRBubbles(streamedOCRText)
          if (bubbles.length > 0) {
            const parsedBlock = JSON.stringify(bubbles)
            if (parsedBlock !== lastParsedJsonBlock) {
              lastParsedJsonBlock = parsedBlock
              hasParsedClosedJson = true
              options.onBubblesParsed(bubbles)
            }
          }
        }
      },
      signal: options.signal,
    },
  })

  if (!fullOutput.trim()) {
    throw new Error("视觉模型未返回 OCR 文本，请确认所选模型支持图片输入")
  }

  const bubbles = extractOCRBubbles(fullOutput)
  if (!hasParsedClosedJson && options.onBubblesParsed) {
    options.onBubblesParsed(bubbles)
  }
  if (bubbles.length === 0) {
    throw new Error("视觉模型未返回可用的气泡坐标 JSON，请检查模型是否支持视觉识别或结构化输出")
  }

  return fullOutput
}

export interface StreamImageGenerateOptions extends StreamTranslateOptions {
  onImageGenerated?: (imageData: { base64: string; mediaType: string }) => void
}

/**
 * 生图汉化模式：调用具备图像生成能力的多模态模型生成汉化版图片或重绘图像
 */
export async function streamGenerateTranslatedImage(
  illust: PixivIllustration,
  pageIndex: number,
  options: StreamImageGenerateOptions
): Promise<string> {
  const url = imageUrlOf(illust, pageIndex, "large")
  if (!url) {
    throw new Error("无法获取图片地址")
  }

  if (options.signal?.aborted) {
    throw new Error("AI 任务已取消")
  }

  const filePath = await loadImage(url)
  if (options.signal?.aborted) {
    throw new Error("AI 任务已取消")
  }

  if (!filePath) {
    throw new Error("图片下载失败，请检查网络后重试")
  }

  const uiImage = UIImage.fromFile(filePath)
  if (!uiImage) {
    throw new Error("无法解码图片数据")
  }

  if (options.signal?.aborted) {
    throw new Error("AI 任务已取消")
  }

  const base64 = uiImage.toJPEGBase64String(0.85)
  if (!base64) {
    throw new Error("图片 Base64 编码失败")
  }

  if (options.signal?.aborted) {
    throw new Error("AI 任务已取消")
  }

  const profile = loadCustomAIProfile()
  const imageGenKey = getEffectiveImageGenKey(profile)
  const hasCustomImageGen = Boolean(
    profile.enabled &&
    profile.imageGen.enabled &&
    getEffectiveImageGenEndpoint(profile.imageGen) &&
    profile.imageGen.model &&
    (profile.general.noKeyRequired || imageGenKey)
  )
  if (profile.enabled && profile.imageGen.enabled && !hasCustomImageGen) {
    throw new Error("独立生图模型配置不完整，请检查模型名称、端点和 API 密钥")
  }
  if (!isAIAvailable() && !hasCustomImageGen) {
    throw new Error(getAIUnavailableErrorMessage())
  }

  if (hasCustomImageGen) {
    options.onChunk("正在使用自定义生图模型生成汉化图片...\n")
    const effectiveKey = imageGenKey
    const prompt =
      "Fully translate and typeset all comic speech bubbles and text into Simplified Chinese, keeping original art, screentones, and style intact."

    const { controller, cleanup } = createLinkedAbortController(options.signal)
    globalAITaskControllers.add(controller)

    try {
      const genResult = await requestCustomImageGen(profile.imageGen, effectiveKey, {
        prompt,
        referenceImageBase64: base64,
        referenceImageMimeType: "image/jpeg",
        signal: controller.signal,
      })

      if (!genResult.base64) {
        throw new Error("自定义生图模型未返回有效图片")
      }

      if (options.onImageGenerated) {
        options.onImageGenerated({
          base64: genResult.base64,
          mediaType: genResult.mediaType || "image/png",
        })
      }

      const finishMsg = "汉化生图已完成！"
      options.onChunk(finishMsg)
      return finishMsg
    } finally {
      globalAITaskControllers.delete(controller)
      cleanup()
    }
  }

  const systemPrompt =
    "You are an expert AI manga localization and inpainting artist. Your task is to directly generate and output the fully translated manga page image where speech bubbles and text (in Japanese, English, Korean, or other languages) are seamlessly translated and typeset into Simplified Chinese, keeping the original artwork, screentones, characters, and panels intact."

  const contentParts: AdapterMessageContentPart[] = [
    {
      type: "text",
      text: "Please generate and output the translated image with all dialogue and text translated and typeset into Simplified Chinese:",
    },
    {
      type: "image",
      imageBase64: base64,
      mimeType: "image/jpeg",
    },
  ]

  const emittedImageHashes = new Set<string>()

  const generatedResult = await executeUniversalAI({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: contentParts,
      },
    ],
    options: {
      onChunk: (text) => {
        if (options.onImageGenerated && text.includes("data:image/")) {
          const regex = /data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]{100,})/g
          let match: RegExpExecArray | null
          while ((match = regex.exec(text)) !== null) {
            const mediaType = match[1] || "image/png"
            const imgBase64 = match[2]
            const quickHash = `${imgBase64.length}:${imgBase64.slice(0, 30)}:${imgBase64.slice(-30)}`
            if (!emittedImageHashes.has(quickHash)) {
              emittedImageHashes.add(quickHash)
              options.onImageGenerated({
                base64: imgBase64,
                mediaType,
              })
            }
          }
        }
        options.onChunk(text)
      },
      onImage: (img) => {
        if (options.onImageGenerated) {
          const quickHash = `chunk_img:${img.base64.length}:${img.base64.slice(0, 30)}`
          if (!emittedImageHashes.has(quickHash)) {
            emittedImageHashes.add(quickHash)
            options.onImageGenerated(img)
          }
        }
      },
      signal: options.signal,
    },
  })

  if (emittedImageHashes.size === 0) {
    throw new Error("当前模型未返回图片，请配置支持图片输出的独立生图模型")
  }
  return generatedResult
}
