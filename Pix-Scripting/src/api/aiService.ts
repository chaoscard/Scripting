/**
 * AI 服务核心层：负责文本清洗、语义分块、流式翻译、OCR识别与总结续写
 */
import { loadImage, imageUrlOf } from "../image/imageLoader"
import type { PixivIllustration, PixivNovel } from "../types"

export function isAIAvailable(): boolean {
  try {
    return typeof Assistant !== "undefined" && Boolean(Assistant.isAvailable)
  } catch {
    return false
  }
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
    // 移除插图标记
    .replace(/\[\[jumpimage:\s*\d+\s*\]\]/gi, "")
    .replace(/\[pixivimage:\s*\d+(?:-\d+)?\s*\]/gi, "")
    .replace(/\[uploadedimage:\s*\d+\s*\]/gi, "")
    // 转换注音为标准汉字（保留汉字）
    .replace(
      /\[\[rb:\s*([^\r\n>]+?)\s*(?:>|&gt;)\s*([^\r\n\]]+?)\s*\]\]/g,
      (_, kanji: string) => kanji.trim()
    )
    // 规范化多余空行
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

      // 如果单段本身超长（例如长达数千字没有分段），按句末标点强制切分
      if (trimmed.length > targetSize) {
        const sentences = trimmed.split(/(?<=[。！？\n])/)
        let temp = ""
        for (const sent of sentences) {
          if (temp.length + sent.length <= targetSize) {
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
  signal?: { aborted: boolean }
}

/**
 * 流式翻译短文本（如简介、标题）
 */
export async function streamTranslateText(
  text: string,
  options: StreamTranslateOptions
): Promise<string> {
  if (!text || !text.trim()) return ""
  if (!isAIAvailable()) {
    throw new Error("Scripting 助手未配置或不可用，请在设置中配置 AI 模型。")
  }

  const systemPrompt =
    "你是一位资深且精准的ACG多语言翻译专家。请自动识别用户提供的Pixiv作品简介或文本的源语言（如日文、英文、韩文等），并将其翻译为自然、地道、信达雅的简体中文。\n" +
    "要求：\n" +
    "1. 保持原文的语气、排版、换行与二次元ACG语境。\n" +
    "2. 人名、社团名、展会名等专有名词保留规范称呼。\n" +
    "3. 直接输出翻译后的中文，不要输出任何多余的解释、前缀或开场白。"

  let fullOutput = ""
  const stream = await Assistant.requestStreaming({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: `请翻译以下内容：\n\n${text}`,
      },
    ],
  })

  for await (const chunk of stream) {
    if (options.signal?.aborted) {
      break
    }
    if (chunk.type === "text" && chunk.content) {
      fullOutput += chunk.content
      options.onChunk(fullOutput)
    }
  }

  return fullOutput
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
  if (!isAIAvailable()) {
    throw new Error("Scripting 助手未配置或不可用，请在设置中配置 AI 模型。")
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
    if (options.signal?.aborted) {
      break
    }

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
    const stream = await Assistant.requestStreaming({
      systemPrompt: baseSystemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    })

    for await (const chunk of stream) {
      if (options.signal?.aborted) {
        break
      }
      if (chunk.type === "text" && chunk.content) {
        chunkOutput += chunk.content
        const currentCombined = accumulatedResult
          ? accumulatedResult + "\n\n" + chunkOutput
          : chunkOutput
        options.onChunk(currentCombined)
      }
    }

    if (options.signal?.aborted) {
      break
    }

    accumulatedResult = accumulatedResult
      ? accumulatedResult + "\n\n" + chunkOutput
      : chunkOutput

    // 提取当前 chunk 结尾 150 字作为下一个 chunk 的上下文提示
    previousContextTail = currentChunk.slice(-150)
  }

  return accumulatedResult
}

/**
 * 结构化总结小说（大纲、角色、看点与避雷）
 */
export async function streamSummarizeNovel(
  rawText: string,
  options: StreamTranslateOptions
): Promise<string> {
  const cleaned = cleanNovelTextForAI(rawText)
  if (!cleaned) return ""
  if (!isAIAvailable()) {
    throw new Error("Scripting 助手未配置或不可用，请在设置中配置 AI 模型。")
  }

  // 若文本极长（超过 15,000 字），为了保证总结质量且不超上下文，进行安全采样（开头+中间段+结尾）
  let sampleText = cleaned
  if (cleaned.length > 15000) {
    const head = cleaned.slice(0, 6000)
    const mid = cleaned.slice(Math.floor(cleaned.length / 2) - 2500, Math.floor(cleaned.length / 2) + 2500)
    const tail = cleaned.slice(-4000)
    sampleText = `${head}\n\n[...中间情节略...]\n\n${mid}\n\n[...后文情节略...]\n\n${tail}`
  }

  const systemPrompt =
    "你是一位资深轻小说总编。请阅读提供的Pixiv小说内容，为读者生成一份清晰、专业、结构化的中文导读与速读总结。\n" +
    "输出格式请严格遵循以下 Markdown 结构：\n\n" +
    "### 📌 核心剧情大纲\n(用200-300字简练概括主线起因、发展与核心冲突/结局)\n\n" +
    "### 👥 登场角色与关系\n- **角色名**：身份背景及与主角的关系\n\n" +
    "### 🏷️ 风格标签与看点\n- (提炼出3-5个核心看点，如：纯爱发糖 / 胃痛胃药 / IF线展开 / 战斗爽快)\n\n" +
    "### ⚠️ 阅读提示与预警\n- (如有虐心、致郁、雷点或特殊癖好请明确标注，若无则注明“全年龄温馨向/无明显雷点”)\n\n" +
    "注意：直接输出Markdown内容，语言生动精练，不要添加额外的问候语。"

  let fullOutput = ""
  const stream = await Assistant.requestStreaming({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: `请为以下小说生成导读总结：\n\n${sampleText}`,
      },
    ],
  })

  for await (const chunk of stream) {
    if (options.signal?.aborted) {
      break
    }
    if (chunk.type === "text" && chunk.content) {
      fullOutput += chunk.content
      options.onChunk(fullOutput)
    }
  }

  return fullOutput
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
  if (!isAIAvailable()) {
    throw new Error("Scripting 助手未配置或不可用，请在设置中配置 AI 模型。")
  }

  // 提取小说末尾 3000 字作为续写上下文基底
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

  let fullOutput = ""
  const stream = await Assistant.requestStreaming({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  })

  for await (const chunk of stream) {
    if (options.signal?.aborted) {
      break
    }
    if (chunk.type === "text" && chunk.content) {
      fullOutput += chunk.content
      options.onChunk(fullOutput)
    }
  }

  return fullOutput
}

/**
 * 多模态大模型视觉深度解析与气泡翻译（替代简单本地OCR，精准识别竖排日文、对话气泡与拟声词）
 */
export async function streamVisionTranslateImage(
  illust: PixivIllustration,
  pageIndex: number,
  options: StreamTranslateOptions
): Promise<string> {
  const url = imageUrlOf(illust, pageIndex, "large")
  if (!url) {
    throw new Error("无法获取图片地址")
  }

  const filePath = await loadImage(url)
  if (!filePath) {
    throw new Error("图片下载失败，请检查网络后重试")
  }

  const uiImage = UIImage.fromFile(filePath)
  if (!uiImage) {
    throw new Error("无法解码图片数据")
  }

  const base64 = uiImage.toJPEGBase64String(0.85)
  if (!base64) {
    throw new Error("图片 Base64 编码失败")
  }

  if (!isAIAvailable()) {
    throw new Error("Scripting 助手未配置或不可用，请在设置中配置 AI 模型。")
  }

  const systemPrompt =
    "你是一位卓越的二次元漫画汉化组翻译与视觉分析专家。请仔细观察用户提供的插画/漫画页面（支持日文、英文、韩文等多种语言）：\n" +
    "1. 定位画面中所有的对话气泡（包括竖排与横排）、背景招牌、手写旁白和拟声词。\n" +
    "2. 按照读者阅读顺序，逐一提取【原文台词】并翻译为生动地道的【简体中文】。\n" +
    "3. 简要标注每个气泡所在的大致位置或说话角色。\n\n" +
    "输出格式规范：\n" +
    "**[气泡 1]** (位置/说话者)\n" +
    "- **原文**：原文台词\n" +
    "- **译文**：中文翻译\n\n" +
    "**[拟声词/旁白]**\n" +
    "- **原文**：原文拟声词/旁白\n" +
    "- **译文**：中文解释/翻译\n\n" +
    "注意：直接输出结构清晰的 Markdown 对照文本，绝对不要调用任何外部工具或函数。"

  let fullOutput = ""
  let reasoningOutput = ""
  const stream = await Assistant.requestStreaming({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            content: "请识别这张漫画/插画中的所有日文气泡与文字，并给出精准的中文汉化翻译对照：",
          },
          {
            type: "image",
            content: `data:image/jpeg;base64,${base64}`,
          },
        ],
      },
    ],
  })

  for await (const chunk of stream) {
    if (options.signal?.aborted) {
      break
    }
    if (chunk.type === "text" && chunk.content) {
      fullOutput += chunk.content
      options.onChunk(fullOutput)
    } else if (chunk.type === "reasoning" && chunk.content) {
      reasoningOutput += chunk.content
      if (!fullOutput) {
        options.onChunk(reasoningOutput)
      }
    }
  }

  if (!fullOutput && reasoningOutput) {
    fullOutput = reasoningOutput
    options.onChunk(fullOutput)
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

  const filePath = await loadImage(url)
  if (!filePath) {
    throw new Error("图片下载失败，请检查网络后重试")
  }

  const uiImage = UIImage.fromFile(filePath)
  if (!uiImage) {
    throw new Error("无法解码图片数据")
  }

  const base64 = uiImage.toJPEGBase64String(0.85)
  if (!base64) {
    throw new Error("图片 Base64 编码失败")
  }

  if (!isAIAvailable()) {
    throw new Error("Scripting 助手未配置或不可用，请在设置中配置 AI 模型。")
  }

  const systemPrompt =
    "You are an expert AI manga localization and inpainting artist. Your task is to directly generate and output the fully translated manga page image where speech bubbles and text (in Japanese, English, Korean, or other languages) are seamlessly translated and typeset into Simplified Chinese, keeping the original artwork, screentones, characters, and panels intact."

  let fullTextOutput = ""
  let reasoningOutput = ""
  const stream = await Assistant.requestStreaming({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            content: "Please generate and output the translated image with all dialogue and text translated and typeset into Simplified Chinese:",
          },
          {
            type: "image",
            content: `data:image/jpeg;base64,${base64}`,
          },
        ],
      },
    ],
  })

  for await (const chunk of stream) {
    if (options.signal?.aborted) {
      break
    }
    if (chunk.type === "text" && chunk.content) {
      fullTextOutput += chunk.content
      
      // 检查文本中是否包含 markdown 嵌入的 base64 图片
      const base64Match = fullTextOutput.match(/data:image\/[a-zA-Z0-9+]+;base64,([A-Za-z0-9+/=]+)/)
      if (base64Match && base64Match[1] && options.onImageGenerated) {
        options.onImageGenerated({
          base64: base64Match[1],
          mediaType: "image/png",
        })
      }

      options.onChunk(fullTextOutput)
    } else if (chunk.type === "reasoning" && chunk.content) {
      reasoningOutput += chunk.content
      if (!fullTextOutput) {
        options.onChunk(reasoningOutput)
      }
    } else if (chunk.type === "image" && chunk.content) {
      if (options.onImageGenerated) {
        options.onImageGenerated({
          base64: chunk.content.data,
          mediaType: chunk.content.mediaType || "image/png",
        })
      }
    }
  }

  // 兜底：如果正文为空但有思考分析内容，输出思考内容
  if (!fullTextOutput && reasoningOutput) {
    fullTextOutput = reasoningOutput
    options.onChunk(fullTextOutput)
  }

  return fullTextOutput
}
