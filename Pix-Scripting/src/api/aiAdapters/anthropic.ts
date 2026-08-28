/**
 * Anthropic Claude (/v1/messages) 适配器
 */
import { fetch } from "scripting"
import type { GeneralAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse } from "./types"
import { parseSSEStream } from "./sseParser"

export function normalizeAnthropicEndpoint(rawEndpoint: string): string {
  let ep = rawEndpoint.trim().replace(/\/+$/, "")
  if (!ep) ep = "https://api.anthropic.com"
  if (ep.endsWith("/messages")) {
    return ep
  }
  if (ep.endsWith("/v1")) {
    return `${ep}/messages`
  }
  return `${ep}/v1/messages`
}

export async function requestAnthropic(
  config: GeneralAIConfig,
  request: AdapterRequest
): Promise<AdapterResponse> {
  const url = normalizeAnthropicEndpoint(config.endpoint)

  const messages: any[] = []

  for (const msg of request.messages) {
    if (typeof msg.content === "string") {
      messages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
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
          const rawBase64 = part.imageBase64.replace(/^data:[^;]+;base64,/, "")
          parts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: part.mimeType || "image/jpeg",
              data: rawBase64,
            },
          })
        }
      }
      messages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: parts,
      })
    }
  }

  const payload: Record<string, any> = {
    model: config.model,
    messages,
    max_tokens: 4096,
    stream: true,
  }

  if (request.systemPrompt) {
    payload.system = request.systemPrompt
  }

  if (typeof request.temperature === "number") {
    payload.temperature = request.temperature
  } else if (typeof config.temperature === "number") {
    payload.temperature = config.temperature
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": config.apiKey,
    "anthropic-version": "2023-06-01",
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: request.signal as any,
  })

  if (!res.ok) {
    let errDetail = ""
    try {
      const errJson = await res.json()
      errDetail = errJson?.error?.message || JSON.stringify(errJson)
    } catch {
      errDetail = await res.text()
    }
    throw new Error(`Anthropic 请求失败 (${res.status}): ${errDetail || res.statusText}`)
  }

  let fullText = ""
  let fullReasoning = ""

  await parseSSEStream(
    res,
    (msg) => {
      if (!msg.data || msg.data === "[DONE]") return

      try {
        const json = JSON.parse(msg.data)
        const eventType = msg.event || json.type

        if (eventType === "content_block_delta") {
          const delta = json.delta
          if (delta?.type === "text_delta" && delta.text) {
            fullText += delta.text
            request.onChunk?.(delta.text)
          } else if (delta?.type === "thinking_delta" && delta.thinking) {
            fullReasoning += delta.thinking
            request.onReasoning?.(delta.thinking)
          }
        }
      } catch (e) {
        // 忽略非 JSON
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
