/**
 * OpenAI Responses API (/v1/responses) 适配器
 * 严格遵循 OpenAI 官方 Responses API 规范：
 * - 官方端点: https://api.openai.com/v1/responses
 * - 流式事件支持: response.output_text.delta, response.text.delta, response.reasoning_text.delta, response.reasoning.delta
 * - 结束信号支持: response.completed, response.incomplete, response.failed, [DONE]
 */
import { fetch, AbortController } from "scripting"
import { getEffectiveGeneralEndpoint, type GeneralAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse } from "./types"
import { parseSSEStream } from "./sseParser"

export function normalizeResponsesEndpoint(rawEndpoint: string): string {
  let ep = (rawEndpoint || "").trim().replace(/\/+$/, "")
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
  const effectiveEndpoint = getEffectiveGeneralEndpoint(config)
  const url = normalizeResponsesEndpoint(effectiveEndpoint)

  // 构造 input items（支持纯文本与多模态图文输入）
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
  }
  if (config.apiKey && !config.noKeyRequired) {
    headers["Authorization"] = `Bearer ${config.apiKey}`
  }

  // 使用真实 AbortController，不传自定义 SignalLike 给 fetch
  const controller = new AbortController()
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
    throw new Error(`Responses 请求失败 (${res.status}): ${errDetail || res.statusText}`)
  }

  let fullText = ""
  let fullReasoning = ""
  const generatedImages: Array<{ base64: string; mediaType: string }> = []

  await parseSSEStream(
    res,
    (msg) => {
      if (!msg.data || msg.data === "[DONE]") {
        return true
      }

      try {
        const json = JSON.parse(msg.data)
        const eventType = msg.event || json.type

        // 1. 结束事件（Responses 规范：response.completed / incomplete / failed，无 [DONE] 消息）
        if (
          eventType === "response.completed" ||
          eventType === "response.done" ||
          eventType === "response.incomplete" ||
          eventType === "response.failed" ||
          json.status === "completed"
        ) {
          if (Array.isArray(json.response?.output)) {
            for (const item of json.response.output) {
              if (item.type === "message" && Array.isArray(item.content)) {
                for (const c of item.content) {
                  if (c.type === "output_text" && c.text && !fullText) {
                    fullText = c.text
                    request.onChunk?.(c.text)
                  }
                }
              }
            }
          }
          return true
        }

        // 2. 文本增量（支持 response.output_text.delta / response.text.delta / response.output_item.delta）
        if (
          eventType === "response.output_text.delta" ||
          eventType === "response.text.delta" ||
          eventType === "response.output_item.delta"
        ) {
          const delta = typeof json.delta === "string" ? json.delta : json.delta?.text || json.text || ""
          if (typeof delta === "string" && delta) {
            fullText += delta
            request.onChunk?.(delta)
          }
        }
        // 3. 思维链/推理增量（支持 response.reasoning_text.delta / response.reasoning.delta / response.thought.delta）
        else if (
          eventType === "response.reasoning_text.delta" ||
          eventType === "response.reasoning.delta" ||
          eventType === "response.thought.delta"
        ) {
          const delta = typeof json.delta === "string" ? json.delta : json.delta?.text || json.text || ""
          if (typeof delta === "string" && delta) {
            fullReasoning += delta
            request.onReasoning?.(delta)
          }
        }
        // 4. 输出完成 / 图片项
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
        // 5. 兼容 choices 风格（部分中转服务可能包装成通用格式）
        else if (json.choices && Array.isArray(json.choices)) {
          const choice = json.choices[0]
          const deltaObj = choice?.delta || choice?.message
          if (deltaObj?.content) {
            fullText += deltaObj.content
            request.onChunk?.(deltaObj.content)
          }
          if (deltaObj?.reasoning_content || deltaObj?.reasoning) {
            const r = deltaObj.reasoning_content || deltaObj.reasoning
            fullReasoning += r
            request.onReasoning?.(r)
          }
          if (choice?.finish_reason) {
            return true
          }
        }
        // 6. 兼容普通非流式 output_text
        else if (json.output_text) {
          fullText = json.output_text
          request.onChunk?.(json.output_text)
          return true
        }
      } catch {
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
