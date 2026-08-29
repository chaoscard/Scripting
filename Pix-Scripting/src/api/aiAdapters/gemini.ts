/**
 * Google Gemini 原生协议 (:streamGenerateContent) 适配器
 * 严格遵循 Google AI Studio / Gemini API 官方 REST 规范：
 * - 官方端点: https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={apiKey}
 */
import { fetch, AbortController } from "scripting"
import { getEffectiveGeneralEndpoint, type GeneralAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse } from "./types"
import { parseSSEStream } from "./sseParser"

export function normalizeGeminiEndpoint(rawEndpoint: string, model: string, apiKey: string): string {
  let ep = (rawEndpoint || "").trim().replace(/\/+$/, "")
  if (!ep) ep = "https://generativelanguage.googleapis.com"

  if (ep.includes(":streamGenerateContent") || ep.includes(":generateContent")) {
    if (!ep.includes("key=") && apiKey) {
      const sep = ep.includes("?") ? "&" : "?"
      return `${ep}${sep}key=${encodeURIComponent(apiKey)}`
    }
    return ep
  }

  if (!ep.includes("/v1beta") && !ep.includes("/v1")) {
    ep = `${ep}/v1beta`
  }

  return `${ep}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`
}

export async function requestGemini(
  config: GeneralAIConfig,
  request: AdapterRequest
): Promise<AdapterResponse> {
  const effectiveEndpoint = getEffectiveGeneralEndpoint(config)
  const url = normalizeGeminiEndpoint(effectiveEndpoint, config.model, config.apiKey)

  const contents: any[] = []

  for (const msg of request.messages) {
    const parts: any[] = []
    if (typeof msg.content === "string") {
      parts.push({ text: msg.content })
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          parts.push({ text: part.text })
        } else if (part.type === "image" && part.imageBase64) {
          const rawBase64 = part.imageBase64.replace(/^data:[^;]+;base64,/, "")
          parts.push({
            inline_data: {
              mime_type: part.mimeType || "image/jpeg",
              data: rawBase64,
            },
          })
        }
      }
    }
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts,
    })
  }

  const payload: Record<string, any> = {
    contents,
    generationConfig: {
      temperature: typeof request.temperature === "number" ? request.temperature : config.temperature ?? 0.7,
    },
  }

  if (request.systemPrompt) {
    payload.system_instruction = {
      parts: [{ text: request.systemPrompt }],
    }
  }

  // 使用真实 AbortController，不传自定义 SignalLike 给 fetch
  const controller = new AbortController()
  if (request.signal?.aborted) {
    controller.abort()
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
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
    throw new Error(`Gemini 请求失败 (${res.status}): ${errDetail || res.statusText}`)
  }

  let fullText = ""
  let fullReasoning = ""

  await parseSSEStream(
    res,
    (msg) => {
      if (!msg.data || msg.data === "[DONE]") return true

      try {
        const json = JSON.parse(msg.data)
        const candidate = json.candidates?.[0]
        if (candidate) {
          const parts = candidate.content?.parts
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (part.text) {
                if (part.thought) {
                  fullReasoning += part.text
                  request.onReasoning?.(part.text)
                } else {
                  fullText += part.text
                  request.onChunk?.(part.text)
                }
              }
            }
          }
          if (candidate.finishReason) {
            return true
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
