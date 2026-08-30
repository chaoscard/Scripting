/**
 * OpenAI Chat Completions 兼容协议 (/v1/chat/completions) 适配器
 * 严格遵循 OpenAI 官方 Chat Completions 规范及各大通用兼容器标准
 */
import { fetch } from "scripting"
import { getEffectiveGeneralEndpoint, type GeneralAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse } from "./types"
import { createLinkedAbortController, parseSSEStream } from "./sseParser"

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

  if (effectiveEndpoint.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://github.com/Pix-Scripting"
    headers["X-Title"] = "Pix-Scripting"
  }

  const { controller, cleanup } = createLinkedAbortController(request.signal)

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
              if (typeof delta.content === "string" && delta.content) {
                fullText += delta.content
                request.onChunk?.(delta.content)
              }

              const reasoning = delta.reasoning_content || delta.reasoning || delta.thought
              if (typeof reasoning === "string" && reasoning) {
                fullReasoning += reasoning
                request.onReasoning?.(reasoning)
              }
            }

            if (choice.finish_reason) {
              return true
            }
          } else if (json.output_text) {
            fullText = json.output_text
            request.onChunk?.(json.output_text)
            return true
          }
        } catch (e) {}
      },
      controller.signal
    )

    return {
      text: fullText,
      reasoning: fullReasoning,
      images: [],
    }
  } finally {
    cleanup()
  }
}
