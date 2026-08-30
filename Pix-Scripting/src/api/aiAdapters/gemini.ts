/**
 * Google Gemini 原生协议 (:streamGenerateContent) 适配器
 * 严格遵循 Google AI Studio / Gemini API 官方 REST 规范：
 * - 官方端点: https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={apiKey}
 */
import { fetch } from "scripting"
import { cleanAIEndpoint, getEffectiveGeneralEndpoint, type GeneralAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse } from "./types"
import { createLinkedAbortController, parseSSEStream } from "./sseParser"
import { parseGeminiPayload } from "./responseParsers"

function usesGoogleAPIKeyQuery(endpoint: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(endpoint)
}

export function normalizeGeminiEndpoint(rawEndpoint: string, model: string, apiKey: string, noKeyRequired?: boolean): string {
  const input = (rawEndpoint || "").trim()
  let ep = cleanAIEndpoint(input)
  if (!ep) ep = "https://generativelanguage.googleapis.com"
  const usesGoogleKey = usesGoogleAPIKeyQuery(input || ep)

  if (!ep.includes("/v1beta") && !ep.includes("/v1")) {
    if (input.includes("/v1") && !input.includes("/v1beta")) {
      ep = `${ep}/v1`
    } else {
      ep = `${ep}/v1beta`
    }
  }

  const cleanModel = (model || "").trim().replace(/^models\//, "")
  const url = `${ep}/models/${encodeURIComponent(cleanModel)}:streamGenerateContent?alt=sse`
  if (!apiKey || noKeyRequired || !usesGoogleKey) return url
  return `${url}&key=${encodeURIComponent(apiKey)}`
}

export async function requestGemini(
  config: GeneralAIConfig,
  request: AdapterRequest
): Promise<AdapterResponse> {
  const effectiveEndpoint = getEffectiveGeneralEndpoint(config)
  const url = normalizeGeminiEndpoint(effectiveEndpoint, config.model, config.apiKey, config.noKeyRequired)

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
            inlineData: {
              mimeType: part.mimeType || "image/jpeg",
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

  if (request.requestImageOutput) {
    payload.generationConfig.responseModalities = ["TEXT", "IMAGE"]
  }

  if (request.systemPrompt) {
    payload.systemInstruction = {
      parts: [{ text: request.systemPrompt }],
    }
  }

  const { controller, cleanup } = createLinkedAbortController(request.signal, 600_000)

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (config.apiKey && !config.noKeyRequired && !usesGoogleAPIKeyQuery(effectiveEndpoint)) {
      headers["Authorization"] = `Bearer ${config.apiKey}`
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
      throw new Error(`Gemini 请求失败 (${res.status}): ${errDetail || res.statusText}`)
    }

    let fullText = ""
    let fullReasoning = ""
    const generatedImages: AdapterResponse["images"] = []
    let protocolError = ""

    await parseSSEStream(
      res,
      (msg) => {
        if (!msg.data || msg.data === "[DONE]") return true
        try {
          const parsed = parseGeminiPayload(JSON.parse(msg.data))
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
          protocolError = "Gemini 返回了无法解析的响应数据"
          return true
        }
      },
      controller.signal
    )

    if (protocolError) {
      throw new Error(`Gemini 请求失败: ${protocolError}`)
    }
    if (!fullText.trim() && !fullReasoning.trim() && generatedImages.length === 0) {
      throw new Error("Gemini 未返回任何可用内容，请检查模型能力和安全设置")
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
