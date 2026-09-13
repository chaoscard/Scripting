/**
 * Pure provider response parsers shared by streaming and non-streaming adapters.
 * Keep wire-format handling here so contract tests do not need live API keys.
 */
import type { AdapterResponse } from "./types"

export interface ParsedProviderPayload {
  text: string
  reasoning: string
  images: AdapterResponse["images"]
  done: boolean
  error?: string
}

function emptyPayload(): ParsedProviderPayload {
  return { text: "", reasoning: "", images: [], done: false }
}

function errorMessage(value: any): string {
  if (!value) return ""
  if (typeof value === "string") return value
  if (typeof value.message === "string") return value.message
  if (typeof value.detail === "string") return value.detail
  if (typeof value.error === "string") return value.error
  if (value.error) return errorMessage(value.error)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseDataURL(value: unknown): { base64: string; mediaType: string } | null {
  if (typeof value !== "string" || !value.startsWith("data:")) return null
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/)
  if (!match) return null
  return {
    mediaType: match[1] || "image/png",
    base64: match[2].replace(/\s/g, ""),
  }
}

export function detectImageMime(base64: string, fallback: string): string {
  if (base64.startsWith("iVBOR")) return "image/png"
  if (base64.startsWith("/9j/")) return "image/jpeg"
  if (base64.startsWith("UklGR")) return "image/webp"
  if (base64.startsWith("R0lGOD")) return "image/gif"
  return fallback
}

function imageFromObject(value: any): { base64: string; mediaType: string } | null {
  if (!value || typeof value !== "object") return null
  const mediaType = value.media_type || value.mime_type || value.mimeType || "image/png"
  const direct = value.image_base64 || value.b64_json || value.base64 || value.result || value.data
  if (typeof direct === "string" && direct) {
    const dataURL = parseDataURL(direct)
    const normalized = direct.replace(/^data:[^;]+;base64,/, "")
    return dataURL || { base64: normalized, mediaType: detectImageMime(normalized, mediaType) }
  }
  const imageURL = typeof value.image_url === "string" ? value.image_url : value.image_url?.url
  return parseDataURL(imageURL)
}

function appendContentBlocks(payload: ParsedProviderPayload, content: any): void {
  if (typeof content === "string") {
    payload.text += content
    return
  }
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (!block || typeof block !== "object") continue
    const type = block.type || ""
    if ((type === "text" || type === "output_text") && typeof block.text === "string") {
      payload.text += block.text
    } else if (type === "reasoning" && typeof block.text === "string") {
      payload.reasoning += block.text
    } else {
      const image = imageFromObject(block)
      if (image) payload.images.push(image)
    }
  }
}

export function parseOpenAIChatPayload(json: any): ParsedProviderPayload {
  const payload = emptyPayload()
  if (!json || typeof json !== "object") return payload
  if (json.error) {
    payload.error = errorMessage(json.error) || "服务返回未知错误"
    return payload
  }

  const choice = Array.isArray(json.choices) ? json.choices[0] : undefined
  if (!choice) {
    if (typeof json.output_text === "string") payload.text = json.output_text
    return payload
  }

  const message = choice.delta || choice.message || {}
  appendContentBlocks(payload, message.content)
  const reasoning = message.reasoning_content || message.reasoning || message.thought
  if (typeof reasoning === "string") payload.reasoning += reasoning

  if (Array.isArray(message.images)) {
    for (const value of message.images) {
      const image = imageFromObject(value)
      if (image) payload.images.push(image)
    }
  }

  const refusal = message.refusal
  if (typeof refusal === "string" && refusal) payload.error = `模型拒绝请求: ${refusal}`

  const finishReason = choice.finish_reason
  payload.done = Boolean(finishReason)
  if (finishReason === "content_filter" && !payload.text && !payload.images.length) {
    payload.error = "模型输出被内容安全策略拦截"
  } else if (finishReason === "length" || finishReason === "max_tokens") {
    payload.error = "模型输出达到长度上限，翻译结果不完整"
  }
  return payload
}

function appendResponsesOutput(payload: ParsedProviderPayload, output: any, includeText = true): void {
  if (!Array.isArray(output)) return
  for (const item of output) {
    if (!item || typeof item !== "object") continue
    if (item.type === "message" && includeText) appendContentBlocks(payload, item.content)
    if (item.type === "reasoning" && includeText && Array.isArray(item.summary)) {
      for (const summary of item.summary) {
        if (typeof summary?.text === "string") payload.reasoning += summary.text
      }
    }
    if (item.type === "image_generation_call" && item.status === "failed") {
      payload.error = errorMessage(item.error) || "图片生成被模型安全策略拒绝"
      continue
    }
    if (item.type === "image_generation_call" && typeof item.result === "string") {
      const image = imageFromObject(item)
      if (image) payload.images.push(image)
    } else if (item.type !== "message") {
      const image = imageFromObject(item)
      if (image) payload.images.push(image)
    }
  }
}

export function parseOpenAIResponsesPayload(
  json: any,
  options?: { includeTerminalText?: boolean }
): ParsedProviderPayload {
  const payload = emptyPayload()
  if (!json || typeof json !== "object") return payload
  const type = json.type || ""
  const includeTerminalText = options?.includeTerminalText !== false

  if (json.error || type === "error") {
    payload.error = errorMessage(json.error || json) || "服务返回未知错误"
    return payload
  }
  if (type === "response.refusal.delta" || type === "response.refusal.done") {
    const refusal = typeof json.delta === "string" ? json.delta : json.refusal
    payload.error = refusal ? `模型拒绝请求: ${refusal}` : "模型拒绝了当前请求"
    payload.done = type === "response.refusal.done"
    return payload
  }
  if (type === "response.failed") {
    payload.error = errorMessage(json.response?.error || json.error) || "Responses 请求失败"
    payload.done = true
    return payload
  }
  if (type === "response.incomplete") {
    const reason = json.response?.incomplete_details?.reason || json.incomplete_details?.reason
    payload.error = reason ? `Responses 输出不完整: ${reason}` : "Responses 输出不完整"
    payload.done = true
    return payload
  }

  if (type === "response.output_text.delta" || type === "response.text.delta") {
    payload.text = typeof json.delta === "string" ? json.delta : json.delta?.text || json.text || ""
  } else if (
    type === "response.reasoning_text.delta" ||
    type === "response.reasoning_summary_text.delta" ||
    type === "response.reasoning.delta" ||
    type === "response.thought.delta"
  ) {
    payload.reasoning = typeof json.delta === "string" ? json.delta : json.delta?.text || json.text || ""
  } else if (type === "response.image_generation_call.partial_image") {
    // Progressive previews are not final generated images. The final result is
    // emitted by image_generation_call in output_item.done/completed.
  } else if (type === "response.output_item.done") {
    // output_item.done repeats the complete message item after the delta
    // events. Keep image-generation results, but never append message text a
    // second time.
    appendResponsesOutput(payload, [json.item], false)
  } else if (type === "response.completed" || type === "response.done") {
    // A completed Responses stream normally delivered message text through
    // response.output_text.delta. The adapter drops terminal text when it
    // already has deltas, while retaining image-generation results.
    appendResponsesOutput(payload, json.response?.output, includeTerminalText)
    payload.done = true
  } else if (!type) {
    appendResponsesOutput(payload, json.output)
    if (!payload.text && typeof json.output_text === "string") payload.text = json.output_text
    payload.done = json.status === "completed"
    if (json.status === "failed") payload.error = errorMessage(json.error) || "Responses 请求失败"
    if (json.status === "incomplete") {
      payload.error = `Responses 输出不完整${json.incomplete_details?.reason ? `: ${json.incomplete_details.reason}` : ""}`
    }
  }

  return payload
}

export function parseGeminiPayload(json: any): ParsedProviderPayload {
  const payload = emptyPayload()
  if (!json || typeof json !== "object") return payload
  if (json.error) {
    payload.error = errorMessage(json.error) || "Gemini 返回未知错误"
    return payload
  }
  if (json.promptFeedback?.blockReason) {
    payload.error = `Gemini 拒绝请求: ${json.promptFeedback.blockReason}`
    return payload
  }

  // Cloud Code Assist and a few Gemini-compatible gateways wrap the native
  // response in `response`; direct Gemini REST responses do not.
  const effective = json.response && typeof json.response === "object" && !json.candidates
    ? json.response
    : json
  if (effective.error) {
    payload.error = errorMessage(effective.error) || "Gemini 返回未知错误"
    return payload
  }
  if (effective.promptFeedback?.blockReason) {
    payload.error = `Gemini 拒绝请求: ${effective.promptFeedback.blockReason}`
    return payload
  }

  const candidate = Array.isArray(effective.candidates) ? effective.candidates[0] : undefined
  if (!candidate) return payload
  const parts = candidate.content?.parts
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (typeof part?.text === "string") {
        if (part.thought) payload.reasoning += part.text
        else payload.text += part.text
      }
      const inline = part?.inlineData || part?.inline_data
      if (inline?.data) {
        payload.images.push({
          base64: inline.data,
          mediaType: inline.mimeType || inline.mime_type || "image/png",
        })
      }
    }
  }

  const finishReason = candidate.finishReason || candidate.finish_reason
  payload.done = Boolean(finishReason)
  if (finishReason === "MAX_TOKENS") {
    payload.error = "Gemini 输出达到长度上限，翻译结果不完整"
  } else if (finishReason && finishReason !== "STOP") {
    payload.error = `Gemini 未正常完成输出: ${finishReason}`
  }
  return payload
}

export function parseAnthropicPayload(json: any, eventName?: string): ParsedProviderPayload {
  const payload = emptyPayload()
  if (!json || typeof json !== "object") return payload
  const type = eventName || json.type || ""
  if (type === "error" || json.error) {
    payload.error = errorMessage(json.error || json) || "Anthropic 返回未知错误"
    return payload
  }

  if ((!type || type === "message") && Array.isArray(json.content)) {
    appendContentBlocks(payload, json.content)
    payload.done = Boolean(json.stop_reason)
    if (json.stop_reason === "max_tokens") {
      payload.error = "Anthropic 输出达到长度上限，翻译结果不完整"
    }
    return payload
  }
  if (type === "content_block_start") {
    appendContentBlocks(payload, [json.content_block])
  } else if (type === "content_block_delta") {
    const delta = json.delta || {}
    if (delta.type === "text_delta" && typeof delta.text === "string") payload.text += delta.text
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") payload.reasoning += delta.thinking
  } else if (type === "message_delta") {
    const stopReason = json.delta?.stop_reason
    if (stopReason === "max_tokens") {
      payload.error = "Anthropic 输出达到长度上限，翻译结果不完整"
      payload.done = true
    }
  } else if (type === "message_stop") {
    payload.done = true
  }
  return payload
}
