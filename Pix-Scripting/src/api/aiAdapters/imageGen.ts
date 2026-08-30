import { fetch, FormData } from "scripting"
import { cleanAIEndpoint, getEffectiveImageGenEndpoint, type ImageGenAIConfig } from "../../store/customAI"
import type { SignalLike } from "./types"
import { normalizeResponsesEndpoint } from "./openaiResponses"
import { parseGeminiPayload, parseOpenAIResponsesPayload } from "./responseParsers"
import { createLinkedAbortController } from "./sseParser"

export interface CustomImageGenRequest {
  prompt: string
  referenceImageBase64?: string
  referenceImageMimeType?: string
  signal?: SignalLike
  onProgressText?: (text: string) => void
}

export interface CustomImageGenResponse {
  base64: string
  mediaType: string
  revisedPrompt?: string
}

function stripBase64Prefix(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, "")
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

function extractError(json: any): string {
  return json?.error?.message || json?.error || json?.message || JSON.stringify(json)
}

function removeSSEQuery(endpoint: string): string {
  return endpoint
    .replace(/([?&])alt=sse(?=&|$)/, "$1")
    .replace(/[?&]$/, "")
    .replace("?&", "?")
}

function usesGoogleAPIKeyQuery(endpoint: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(endpoint)
}

function appendAPIKey(endpoint: string, apiKey: string): string {
  if (!apiKey) return endpoint
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`
}

export function normalizeImagesEndpoint(rawEndpoint: string): string {
  let ep = cleanAIEndpoint(rawEndpoint)
  if (!ep) ep = "https://api.openai.com"
  if (ep.endsWith("/v1")) return `${ep}/images/generations`
  return `${ep}/v1/images/generations`
}

export function normalizeImageEditsEndpoint(rawEndpoint: string): string {
  let ep = cleanAIEndpoint(rawEndpoint)
  if (!ep) ep = "https://api.openai.com"
  if (ep.endsWith("/v1")) return `${ep}/images/edits`
  return `${ep}/v1/images/edits`
}

function isImagenModel(model: string): boolean {
  return /(^|[-.])imagen(?:[-.]|$)/i.test(model.trim())
}

function parseGoogleImageResponse(json: any): CustomImageGenResponse | null {
  const predictions = Array.isArray(json?.predictions) ? json.predictions : []
  for (const prediction of predictions) {
    const image = prediction?.bytesBase64Encoded || prediction?.bytes_base64_encoded || prediction?.image?.bytesBase64Encoded
    if (typeof image === "string" && image) {
      return {
        base64: image,
        mediaType: prediction?.mimeType || prediction?.mime_type || "image/png",
      }
    }
  }
  return null
}

export function normalizeImagenEndpoint(rawEndpoint: string, model: string, apiKey: string): string {
  const input = (rawEndpoint || "").trim()
  let ep = cleanAIEndpoint(input)
  if (!ep) ep = "https://generativelanguage.googleapis.com"
  if (!ep.includes("/v1beta") && !ep.includes("/v1")) {
    if (input.includes("/v1") && !input.includes("/v1beta")) ep += "/v1"
    else ep += "/v1beta"
  }
  const cleanModel = (model || "").trim().replace(/^models\//, "")
  const url = `${ep}/models/${encodeURIComponent(cleanModel)}:predict`
  return usesGoogleAPIKeyQuery(input || ep) ? appendAPIKey(url, apiKey) : url
}

export function normalizeGeminiImageEndpoint(rawEndpoint: string, model: string, apiKey: string): string {
  const input = (rawEndpoint || "").trim()
  let ep = cleanAIEndpoint(input)
  if (!ep) ep = "https://generativelanguage.googleapis.com"
  if (!ep.includes("/v1beta") && !ep.includes("/v1")) {
    if (input.includes("/v1") && !input.includes("/v1beta")) ep += "/v1"
    else ep += "/v1beta"
  }
  const cleanModel = (model || "").trim().replace(/^models\//, "")
  const url = `${ep}/models/${encodeURIComponent(cleanModel)}:generateContent`
  return usesGoogleAPIKeyQuery(input || ep) ? appendAPIKey(url, apiKey) : url
}

async function parseOpenAIImageResponse(res: any, failurePrefix: string): Promise<CustomImageGenResponse> {
  let data: any
  try {
    data = await res.json()
  } catch {
    const text = await res.text()
    throw new Error(`${failurePrefix}: ${text || "响应不是有效 JSON"}`)
  }
  if (!res.ok) throw new Error(`${failurePrefix} (${res.status}): ${extractError(data)}`)

  const imageItem = data?.data?.[0]
  if (!imageItem) throw new Error(`${failurePrefix}: 接口未返回图片数据`)
  if (typeof imageItem.b64_json === "string" && imageItem.b64_json) {
    return {
      base64: imageItem.b64_json,
      mediaType: imageItem.mime_type || "image/png",
      revisedPrompt: imageItem.revised_prompt,
    }
  }
  if (typeof imageItem.url === "string" && imageItem.url) {
    const imageResponse = await fetch(imageItem.url)
    if (!imageResponse.ok) {
      throw new Error(`${failurePrefix}: 下载生成图片失败 (${imageResponse.status})`)
    }
    const imageData = Data.fromArrayBuffer(await imageResponse.arrayBuffer())
    if (!imageData) throw new Error(`${failurePrefix}: 无法读取生成图片数据`)
    return {
      base64: imageData.toBase64String(),
      mediaType: imageResponse.headers?.get?.("content-type") || imageItem.mime_type || "image/png",
      revisedPrompt: imageItem.revised_prompt,
    }
  }
  throw new Error(`${failurePrefix}: 无法解析接口返回的图片格式`)
}

async function requestOpenAIResponsesImage(
  config: ImageGenAIConfig,
  apiKey: string,
  request: CustomImageGenRequest,
  signal: any
): Promise<CustomImageGenResponse> {
  const parts: any[] = [{ type: "input_text", text: request.prompt }]
  if (request.referenceImageBase64) {
    const referenceMime = request.referenceImageMimeType || "image/jpeg"
    const dataURL = request.referenceImageBase64.startsWith("data:")
      ? request.referenceImageBase64
      : `data:${referenceMime};base64,${request.referenceImageBase64}`
    parts.push({ type: "input_image", image_url: dataURL, detail: "high" })
  }

  const res = await fetch(normalizeResponsesEndpoint(getEffectiveImageGenEndpoint(config)), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(apiKey),
    },
    body: JSON.stringify({
      model: config.model,
      input: [{ role: "user", content: parts }],
      tools: [{ type: "image_generation" }],
      tool_choice: "auto",
      stream: false,
    }),
    signal,
  })

  let json: any
  try {
    json = await res.json()
  } catch {
    const text = await res.text()
    throw new Error(`Responses 生图失败 (${res.status}): ${text || "响应不是有效 JSON"}`)
  }
  if (!res.ok) throw new Error(`Responses 生图失败 (${res.status}): ${extractError(json)}`)

  const result = parseOpenAIResponsesPayload(json)
  if (result.error) throw new Error(`Responses 生图失败: ${result.error}`)
  const image = result.images[0]
  if (!image?.base64) {
    throw new Error("Responses 模型未调用 image_generation 工具或未返回图像")
  }
  return { base64: image.base64, mediaType: image.mediaType }
}

async function requestGeminiImage(
  config: ImageGenAIConfig,
  apiKey: string,
  request: CustomImageGenRequest,
  signal: any
): Promise<CustomImageGenResponse> {
  const parts: any[] = []
  if (request.referenceImageBase64) {
    const referenceMime = request.referenceImageMimeType || "image/jpeg"
    parts.push({
      inlineData: {
        mimeType: referenceMime,
        data: stripBase64Prefix(request.referenceImageBase64),
      },
    })
  }
  parts.push({ text: request.prompt || "Generate an image." })

  const requestBody = isImagenModel(config.model)
    ? {
        instances: [{ prompt: request.prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: "1:1",
        },
      }
    : {
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }

  const effectiveEndpoint = getEffectiveImageGenEndpoint(config)
  const googleOfficial = usesGoogleAPIKeyQuery(effectiveEndpoint)
  const res = await fetch(
    isImagenModel(config.model)
      ? normalizeImagenEndpoint(effectiveEndpoint, config.model, apiKey)
      : normalizeGeminiImageEndpoint(effectiveEndpoint, config.model, apiKey),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(!googleOfficial ? authHeaders(apiKey) : {}),
      },
      body: JSON.stringify(requestBody),
      signal,
    }
  )

  let json: any
  try {
    json = await res.json()
  } catch {
    const text = await res.text()
    throw new Error(`Gemini 生图失败 (${res.status}): ${text || "响应不是有效 JSON"}`)
  }
  if (!res.ok) throw new Error(`Gemini 生图失败 (${res.status}): ${extractError(json)}`)

  const parsed = isImagenModel(config.model)
    ? parseGoogleImageResponse(json)
    : (() => {
        const payload = parseGeminiPayload(json)
        if (payload.error) throw new Error(payload.error)
        return payload.images[0] || null
      })()
  if (!parsed?.base64) {
    throw new Error(
      isImagenModel(config.model)
        ? "Imagen 模型未返回 predictions 图片数据"
        : "Gemini 模型未返回 inlineData 图片，请选择支持图片输出的 Gemini 模型"
    )
  }
  return { base64: parsed.base64, mediaType: parsed.mediaType }
}

async function requestOpenAIImage(
  config: ImageGenAIConfig,
  apiKey: string,
  request: CustomImageGenRequest,
  signal: any
): Promise<CustomImageGenResponse> {
  const effectiveEndpoint = getEffectiveImageGenEndpoint(config)
  if (request.referenceImageBase64) {
    const imageData = Data.fromBase64String(stripBase64Prefix(request.referenceImageBase64))
    if (!imageData) throw new Error("参考图片 Base64 数据无效")

    const referenceMime = request.referenceImageMimeType || "image/jpeg"
    const extension = referenceMime === "image/png" ? "png" : referenceMime === "image/webp" ? "webp" : "jpg"
    const form = new FormData()
    form.append("model", config.model || "gpt-image-1")
    form.append("prompt", request.prompt)
    form.append("n", "1")
    if (config.size) form.append("size", config.size)
    form.append("image", imageData, referenceMime, `source.${extension}`)

    const res = await fetch(normalizeImageEditsEndpoint(effectiveEndpoint), {
      method: "POST",
      headers: authHeaders(apiKey),
      body: form,
      signal,
    })
    return parseOpenAIImageResponse(res, "图片编辑失败")
  }

  const url = normalizeImagesEndpoint(effectiveEndpoint)
  const basePayload: Record<string, any> = {
    model: config.model || "gpt-image-1",
    prompt: request.prompt,
    n: 1,
    size: config.size || "1024x1024",
    response_format: "b64_json",
  }
  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
    body: JSON.stringify(basePayload),
    signal,
  })

  if (res.status === 400) {
    const errorText = await res.text()
    if (/response_format|b64_json/i.test(errorText)) {
      delete basePayload.response_format
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
        body: JSON.stringify(basePayload),
        signal,
      })
    } else {
      throw new Error(`生图请求失败 (400): ${errorText}`)
    }
  }
  return parseOpenAIImageResponse(res, "生图请求失败")
}

export async function requestCustomImageGen(
  config: ImageGenAIConfig,
  effectiveApiKey: string,
  request: CustomImageGenRequest
): Promise<CustomImageGenResponse> {
  const { controller, cleanup } = createLinkedAbortController(request.signal, 600_000)
  try {
    switch (config.protocol) {
      case "openai-responses":
        return await requestOpenAIResponsesImage(config, effectiveApiKey, request, controller.signal)
      case "gemini-imagen":
        if (request.referenceImageBase64 && isImagenModel(config.model)) {
          throw new Error("Imagen API 仅支持文生图，不支持带参考图编辑；请改用 Gemini 图片模型或 OpenAI Images 编辑")
        }
        return await requestGeminiImage(config, effectiveApiKey, request, controller.signal)
      case "openai-images":
        return await requestOpenAIImage(config, effectiveApiKey, request, controller.signal)
      default:
        throw new Error(`不支持的生图协议: ${String(config.protocol)}`)
    }
  } finally {
    cleanup()
  }
}
