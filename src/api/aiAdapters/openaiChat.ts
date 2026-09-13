/**
 * OpenAI Chat Completions 兼容协议 (/v1/chat/completions) 适配器
 * 严格遵循 OpenAI 官方 Chat Completions 规范及各大通用兼容器标准
 */
import { fetch } from "scripting"
import { cleanAIEndpoint, getEffectiveGeneralEndpoint, type GeneralAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse } from "./types"
import { createLinkedAbortController, parseSSEStream } from "./sseParser"
import { parseOpenAIChatPayload } from "./responseParsers"

export function normalizeChatEndpoint(rawEndpoint: string): string {
  let ep = cleanAIEndpoint(rawEndpoint)
  if (!ep) ep = "https://api.openai.com"

  if (ep.endsWith("/v1")) {
    return `${ep}/chat/completions`
  }
  return `${ep}/v1/chat/completions`
}

function modelRejectsTemperature(model: string): boolean {
  const id = model.toLowerCase().split("/").pop() || ""
  return /^(o1|o3|o4)(?:[-.]|$)/.test(id) || /^gpt-5(?:[-.]|$)/.test(id)
}

export async function requestOpenAIChat(
  config: GeneralAIConfig,
  request: AdapterRequest
): Promise<AdapterResponse> {
  const effectiveEndpoint = getEffectiveGeneralEndpoint(config)
  const url = normalizeChatEndpoint(effectiveEndpoint)

  const messages: any[] = []

  if (request.systemPrompt) {
    messages.push({
      role: "system",
      content: request.systemPrompt,
    })
  }

  for (const msg of request.messages) {
    if (typeof msg.content === "string") {
      messages.push({
        role: msg.role,
        content: msg.content,
      })
    } else if (Array.isArray(msg.content)) {
      const parts: any[] = []
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          parts.push({
            type: "text",
            text: part.text,
          })
        } else if (part.type === "image" && part.imageBase64) {
          const mime = part.mimeType || "image/jpeg"
          const dataUrl = part.imageBase64.startsWith("data:")
            ? part.imageBase64
            : `data:${mime};base64,${part.imageBase64}`
          parts.push({
            type: "image_url",
            image_url: {
              url: dataUrl,
            },
          })
        }
      }
      messages.push({
        role: msg.role,
        content: parts,
      })
    }
  }

  if (request.requestImageOutput) {
    throw new Error("OpenAI Chat Completions 不提供标准图片生成协议，请配置独立生图模型")
  }

  const payload: Record<string, any> = {
    model: config.model,
    messages,
    stream: true,
  }

  if (!modelRejectsTemperature(config.model)) {
    if (typeof request.temperature === "number") {
      payload.temperature = request.temperature
    } else if (typeof config.temperature === "number") {
      payload.temperature = config.temperature
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (config.apiKey && !config.noKeyRequired) {
    headers["Authorization"] = `Bearer ${config.apiKey}`
  }

  if (effectiveEndpoint.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://github.com/Pix-Scripting"
    headers["X-Title"] = "Pix-Scripting"
  }

  const { controller, cleanup } = createLinkedAbortController(request.signal, 600_000)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      let errDetail = ""
      try {
        const errJson = await res.json()
        errDetail = errJson?.error?.message || JSON.stringify(errJson)
      } catch {
        errDetail = await res.text()
      }
      throw new Error(`OpenAI Chat 请求失败 (${res.status}): ${errDetail || res.statusText}`)
    }

    let fullText = ""
    let fullReasoning = ""
    const generatedImages: AdapterResponse["images"] = []
    let protocolError = ""

    await parseSSEStream(
      res,
      (msg) => {
        if (!msg.data || msg.data === "[DONE]") {
          return true
        }

        try {
          const parsed = parseOpenAIChatPayload(JSON.parse(msg.data))
          if (parsed.error) {
            protocolError = parsed.error
            return true
          }
          if (parsed.text) {
            fullText += parsed.text
            request.onChunk?.(parsed.text)
          }
          if (parsed.reasoning) {
            fullReasoning += parsed.reasoning
            request.onReasoning?.(parsed.reasoning)
          }
          for (const image of parsed.images) {
            generatedImages.push(image)
            request.onImage?.(image)
          }
          return parsed.done || undefined
        } catch {
          protocolError = "OpenAI Chat 返回了无法解析的响应数据"
          return true
        }
      },
      controller.signal
    )

    if (protocolError) {
      throw new Error(`OpenAI Chat 请求失败: ${protocolError}`)
    }
    if (!fullText.trim() && !fullReasoning.trim() && generatedImages.length === 0) {
      throw new Error("OpenAI Chat 未返回任何可用内容，请检查模型是否支持当前请求")
    }

    return {
      text: fullText,
      reasoning: fullReasoning,
      images: generatedImages,
    }
  } finally {
    cleanup()
  }
}
