/**
 * OpenAI Responses API (/v1/responses) 适配器
 * 支持 OpenAI 最新 Responses 标准：独立 instructions、input 结构、原生推理流与多模态
 */
import { fetch } from "scripting"
import type { GeneralAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse } from "./types"
import { parseSSEStream } from "./sseParser"

export function normalizeResponsesEndpoint(rawEndpoint: string): string {
  let ep = rawEndpoint.trim().replace(/\/+$/, "")
  if (!ep) ep = "https://api.openai.com"
  if (ep.endsWith("/responses")) {
    return ep
  }
  if (ep.endsWith("/v1")) {
    return `${ep}/responses`
  }
  return `${ep}/v1/responses`
}

export async function requestOpenAIResponses(
  config: GeneralAIConfig,
  request: AdapterRequest
): Promise<AdapterResponse> {
  const url = normalizeResponsesEndpoint(config.endpoint)

  // 构造 input items
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

  if (request.systemPrompt) {
    payload.instructions = request.systemPrompt
  }

  if (typeof request.temperature === "number") {
    payload.temperature = request.temperature
  } else if (typeof config.temperature === "number") {
    payload.temperature = config.temperature
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
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
    throw new Error(`OpenAI Responses 请求失败 (${res.status}): ${errDetail || res.statusText}`)
  }

  let fullText = ""
  let fullReasoning = ""
  const generatedImages: Array<{ base64: string; mediaType: string }> = []

  await parseSSEStream(
    res,
    (msg) => {
      if (!msg.data || msg.data === "[DONE]") return

      try {
        const json = JSON.parse(msg.data)
        const eventType = msg.event || json.type

        // 1. 文本增量
        if (eventType === "response.text.delta" || eventType === "response.output_item.delta") {
          const delta = json.delta || json.delta?.text || ""
          if (typeof delta === "string" && delta) {
            fullText += delta
            request.onChunk?.(delta)
          }
        }
        // 2. 推理增量
        else if (eventType === "response.reasoning.delta" || eventType === "response.thought.delta") {
          const delta = json.delta || ""
          if (typeof delta === "string" && delta) {
            fullReasoning += delta
            request.onReasoning?.(delta)
          }
        }
        // 3. 输出完成 / 图片项
        else if (eventType === "response.output_item.done") {
          const item = json.item
          if (item?.type === "image" && item.image_base64) {
            const img = {
              base64: item.image_base64,
              mediaType: "image/png",
            }
            generatedImages.push(img)
            request.onImage?.(img)
          }
        }
        // 4. 兼容 choices 风格（部分中转服务可能包装成通用格式）
        else if (json.choices && Array.isArray(json.choices)) {
          const deltaObj = json.choices[0]?.delta
          if (deltaObj?.content) {
            fullText += deltaObj.content
            request.onChunk?.(deltaObj.content)
          }
          if (deltaObj?.reasoning_content) {
            fullReasoning += deltaObj.reasoning_content
            request.onReasoning?.(deltaObj.reasoning_content)
          }
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
    images: generatedImages,
  }
}
