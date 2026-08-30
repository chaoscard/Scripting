/**
 * Anthropic Claude (/v1/messages) 适配器
 * 严格遵循 Anthropic 官方 Messages API 规范：
 * - 官方端点: https://api.anthropic.com/v1/messages
 */
import { fetch } from "scripting"
import { cleanAIEndpoint, getEffectiveGeneralEndpoint, type GeneralAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse } from "./types"
import { createLinkedAbortController, parseSSEStream } from "./sseParser"
import { parseAnthropicPayload } from "./responseParsers"

export function normalizeAnthropicEndpoint(rawEndpoint: string): string {
  let ep = cleanAIEndpoint(rawEndpoint)
  if (!ep) ep = "https://api.anthropic.com"

  if (ep.endsWith("/v1")) {
    return `${ep}/messages`
  }
  return `${ep}/v1/messages`
}

function claudeRejectsTemperature(model: string): boolean {
  const match = model.toLowerCase().match(/claude[^0-9]*(\d+)(?:[-.](\d+))?/)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2] || 0)
  return major > 4 || (major === 4 && minor >= 6)
}

export async function requestAnthropic(
  config: GeneralAIConfig,
  request: AdapterRequest
): Promise<AdapterResponse> {
  const effectiveEndpoint = getEffectiveGeneralEndpoint(config)
  const url = normalizeAnthropicEndpoint(effectiveEndpoint)

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

  if (request.requestImageOutput) {
    throw new Error("Anthropic Messages API 不支持图片输出，请配置独立生图模型")
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

  if (!claudeRejectsTemperature(config.model)) {
    if (typeof request.temperature === "number") {
      payload.temperature = request.temperature
    } else if (typeof config.temperature === "number") {
      payload.temperature = config.temperature
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  }
  if (config.apiKey && !config.noKeyRequired) {
    headers["x-api-key"] = config.apiKey
    if (effectiveEndpoint.includes("opencode.ai")) {
      headers["Authorization"] = `Bearer ${config.apiKey}`
    }
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
      throw new Error(`Anthropic 请求失败 (${res.status}): ${errDetail || res.statusText}`)
    }

    let fullText = ""
    let fullReasoning = ""
    let protocolError = ""

    await parseSSEStream(
      res,
      (msg) => {
        if (!msg.data || msg.data === "[DONE]") return true
        try {
          const parsed = parseAnthropicPayload(JSON.parse(msg.data), msg.event)
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
          return parsed.done || undefined
        } catch {
          protocolError = "Anthropic 返回了无法解析的响应数据"
          return true
        }
      },
      controller.signal
    )

    if (protocolError) {
      throw new Error(`Anthropic 请求失败: ${protocolError}`)
    }
    if (!fullText.trim() && !fullReasoning.trim()) {
      throw new Error("Anthropic 未返回任何可用内容，请检查模型与端点协议是否匹配")
    }

    return {
      text: fullText,
      reasoning: fullReasoning,
      images: [],
    }
  } finally {
    cleanup()
  }
}
