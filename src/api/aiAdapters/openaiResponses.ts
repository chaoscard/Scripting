/**
 * OpenAI Responses API (/v1/responses) 适配器
 * 严格遵循 OpenAI 官方 Responses API 规范：
 * - 官方端点: https://api.openai.com/v1/responses
 * - 流式事件支持: response.output_text.delta, response.text.delta, response.reasoning_text.delta, response.reasoning.delta
 * - 结束信号支持: response.completed, response.incomplete, response.failed, [DONE]
 */
import { fetch } from "scripting"
import { cleanAIEndpoint, getEffectiveGeneralEndpoint, type GeneralAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse } from "./types"
import { createLinkedAbortController, parseSSEStream } from "./sseParser"
import { parseOpenAIResponsesPayload } from "./responseParsers"

export function normalizeResponsesEndpoint(rawEndpoint: string): string {
  let ep = cleanAIEndpoint(rawEndpoint)
  if (!ep) ep = "https://api.openai.com"

  if (ep.endsWith("/v1")) {
    return `${ep}/responses`
  }
  return `${ep}/v1/responses`
}

function modelRejectsTemperature(model: string): boolean {
  const id = model.toLowerCase().split("/").pop() || ""
  return /^(o1|o3|o4)(?:[-.]|$)/.test(id) || /^gpt-5(?:[-.]|$)/.test(id)
}

export async function requestOpenAIResponses(
  config: GeneralAIConfig,
  request: AdapterRequest
): Promise<AdapterResponse> {
  const effectiveEndpoint = getEffectiveGeneralEndpoint(config)
  const url = normalizeResponsesEndpoint(effectiveEndpoint)

  const inputItems: any[] = []

  for (const msg of request.messages) {
    if (typeof msg.content === "string") {
      inputItems.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: [
          {
            type: "input_text",
            text: msg.content,
          },
        ],
      })
    } else if (Array.isArray(msg.content)) {
      const parts: any[] = []
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          parts.push({
            type: "input_text",
            text: part.text,
          })
        } else if (part.type === "image" && part.imageBase64) {
          const mime = part.mimeType || "image/jpeg"
          const dataUrl = part.imageBase64.startsWith("data:")
            ? part.imageBase64
            : `data:${mime};base64,${part.imageBase64}`
          parts.push({
            type: "input_image",
            image_url: dataUrl,
          })
        }
      }
      inputItems.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: parts,
      })
    }
  }

  const payload: Record<string, any> = {
    model: config.model,
    input: inputItems,
    stream: true,
  }

  if (request.requestImageOutput) {
    payload.tools = [{ type: "image_generation" }]
    payload.tool_choice = "auto"
  }

  if (request.systemPrompt) {
    payload.instructions = request.systemPrompt
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
      throw new Error(`Responses 请求失败 (${res.status}): ${errDetail || res.statusText}`)
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
          const parsed = parseOpenAIResponsesPayload(JSON.parse(msg.data), {
            includeTerminalText: !fullText.trim(),
          })
          if (parsed.error) {
            protocolError = parsed.error
            return true
          }
          const textDelta = parsed.text
          const reasoningDelta = parsed.reasoning
          if (textDelta) {
            fullText += textDelta
            request.onChunk?.(textDelta)
          }
          if (reasoningDelta) {
            fullReasoning += reasoningDelta
            request.onReasoning?.(reasoningDelta)
          }
          for (const image of parsed.images) {
            const duplicate = generatedImages.some(
              (existing) =>
                existing.base64.length === image.base64.length &&
                existing.base64.slice(0, 64) === image.base64.slice(0, 64)
            )
            if (!duplicate) {
              generatedImages.push(image)
              request.onImage?.(image)
            }
          }
          return parsed.done || undefined
        } catch {
          protocolError = "Responses API 返回了无法解析的响应数据"
          return true
        }
      },
      controller.signal
    )

    if (protocolError) {
      throw new Error(`Responses 请求失败: ${protocolError}`)
    }
    if (!fullText.trim() && !fullReasoning.trim() && generatedImages.length === 0) {
      throw new Error("Responses API 未返回任何可用内容，请检查模型与端点协议是否匹配")
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
