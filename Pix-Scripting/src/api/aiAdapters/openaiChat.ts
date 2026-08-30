/**
 * OpenAI Chat Completions 兼容协议 (/v1/chat/completions) 适配器
 * 严格遵循 OpenAI 官方 Chat Completions 规范及各大通用兼容器标准
 */
import { fetch, AbortController } from "scripting"
import { getEffectiveGeneralEndpoint, type GeneralAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse } from "./types"
import { parseSSEStream } from "./sseParser"

export function normalizeChatEndpoint(rawEndpoint: string): string {
  let ep = (rawEndpoint || "").trim().replace(/\/+$/, "")
  if (!ep) ep = "https://api.openai.com"

  if (ep.endsWith("/chat/completions")) {
    return ep
  }
  if (ep.endsWith("/v1")) {
    return `${ep}/chat/completions`
  }
  return `${ep}/v1/chat/completions`
}

export async function requestOpenAIChat(
  config: GeneralAIConfig,
  request: AdapterRequest
): Promise<AdapterResponse> {
  const effectiveEndpoint = getEffectiveGeneralEndpoint(config)
  const url = normalizeChatEndpoint(effectiveEndpoint)

  const messages: any[] = []

  // 1. 系统提示词
  if (request.systemPrompt) {
    messages.push({
      role: "system",
      content: request.systemPrompt,
    })
  }

  // 2. 转换用户/助手消息
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

  const payload: Record<string, any> = {
    model: config.model,
    messages,
    stream: true,
  }

  if (typeof request.temperature === "number") {
    payload.temperature = request.temperature
  } else if (typeof config.temperature === "number") {
    payload.temperature = config.temperature
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (config.apiKey && !config.noKeyRequired) {
    headers["Authorization"] = `Bearer ${config.apiKey}`
  }

  // OpenRouter 特殊 Headers 优化
  if (effectiveEndpoint.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://github.com/Pix-Scripting"
    headers["X-Title"] = "Pix-Scripting"
  }

  // 使用真实 AbortController，不传自定义 SignalLike 给 fetch
  const controller = new AbortController()
  // 若外部已标记中止，则立即abort
  if (request.signal?.aborted) {
    controller.abort()
  }

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

  await parseSSEStream(
    res,
    (msg) => {
      if (!msg.data || msg.data === "[DONE]") {
        return true
      }

      try {
        const json = JSON.parse(msg.data)
        const choice = json.choices?.[0]
        if (choice) {
          const delta = choice.delta || choice.message
          if (delta) {
            // 1. 文本内容增量
            if (typeof delta.content === "string" && delta.content) {
              fullText += delta.content
              request.onChunk?.(delta.content)
            }

            // 2. 深度思考增量（思考流 reasoning_content / reasoning / thought）
            const reasoning = delta.reasoning_content || delta.reasoning || delta.thought
            if (typeof reasoning === "string" && reasoning) {
              fullReasoning += reasoning
              request.onReasoning?.(reasoning)
            }
          }

          // 遇到结束标志提前终止
          if (choice.finish_reason) {
            return true
          }
        } else if (json.output_text) {
          fullText = json.output_text
          request.onChunk?.(json.output_text)
          return true
        }
      } catch (e) {
        // 非 JSON 行，忽略
      }
    },
    request.signal
  )

  return {
    text: fullText,
    reasoning: fullReasoning,
    images: [],
  }
}
