/**
 * 独立生图模型适配器
 * 支持 OpenAI DALL-E / FLUX (/v1/images/generations)、OpenAI Responses 生图与 Gemini Imagen
 */
import { fetch } from "scripting"
import { getEffectiveImageGenEndpoint, type ImageGenAIConfig } from "../../store/customAI"
import type { SignalLike } from "./types"
import { normalizeResponsesEndpoint } from "./openaiResponses"
import { createLinkedAbortController } from "./sseParser"

export interface CustomImageGenRequest {
  prompt: string
  referenceImageBase64?: string
  signal?: SignalLike
  onProgressText?: (text: string) => void
}

export interface CustomImageGenResponse {
  base64: string
  mediaType: string
  revisedPrompt?: string
}

export function normalizeImagesEndpoint(rawEndpoint: string): string {
  let ep = rawEndpoint.trim().replace(/\/+$/, "")
  if (!ep) ep = "https://api.openai.com"
  if (ep.endsWith("/images/generations")) {
    return ep
  }
  if (ep.endsWith("/v1")) {
    return `${ep}/images/generations`
  }
  return `${ep}/v1/images/generations`
}

export async function requestCustomImageGen(
  config: ImageGenAIConfig,
  effectiveApiKey: string,
  request: CustomImageGenRequest
): Promise<CustomImageGenResponse> {
  const protocol = config.protocol
  const effectiveEndpoint = getEffectiveImageGenEndpoint(config)

  if (protocol === "openai-responses") {
    const url = normalizeResponsesEndpoint(effectiveEndpoint)
    const inputContent: any[] = [
      {
        type: "input_text",
        text: request.prompt,
      },
    ]

    if (request.referenceImageBase64) {
      const dataUrl = request.referenceImageBase64.startsWith("data:")
        ? request.referenceImageBase64
        : `data:image/jpeg;base64,${request.referenceImageBase64}`
      inputContent.push({
        type: "input_image",
        image_url: dataUrl,
      })
    }

    const payload = {
      model: config.model,
      input: [{ role: "user", content: inputContent }],
      modalities: ["text", "image"],
    }

    const { controller, cleanup } = createLinkedAbortController(request.signal)

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${effectiveApiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!res.ok) {
        let errDetail = ""
        try {
          const json = await res.json()
          errDetail = json?.error?.message || JSON.stringify(json)
        } catch {
          errDetail = await res.text()
        }
        throw new Error(`Responses 生图失败 (${res.status}): ${errDetail}`)
      }

      const data = await res.json()
      const outputItems = data.output || data.output_items || []
      for (const item of outputItems) {
        if (item.type === "image" && item.image_base64) {
          return {
            base64: item.image_base64,
            mediaType: "image/png",
          }
        }
      }
      throw new Error("模型未返回生成的图像数据")
    } finally {
      cleanup()
    }
  }

  const url = normalizeImagesEndpoint(effectiveEndpoint)
  const payload: Record<string, any> = {
    model: config.model || "dall-e-3",
    prompt: request.prompt,
    n: 1,
    size: config.size || "1024x1024",
    response_format: "b64_json",
  }

  const { controller: controller2, cleanup: cleanup2 } = createLinkedAbortController(request.signal)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${effectiveApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller2.signal,
    })

    if (!res.ok) {
      let errDetail = ""
      try {
        const json = await res.json()
        errDetail = json?.error?.message || JSON.stringify(json)
      } catch {
        errDetail = await res.text()
      }
      throw new Error(`生图请求失败 (${res.status}): ${errDetail}`)
    }

    const data = await res.json()
    const imageItem = data.data?.[0]
    if (!imageItem) {
      throw new Error("生图接口未返回图片数据")
    }

    if (imageItem.b64_json) {
      return {
        base64: imageItem.b64_json,
        mediaType: "image/png",
        revisedPrompt: imageItem.revised_prompt,
      }
    }

    if (imageItem.url) {
      const imgRes = await fetch(imageItem.url, { signal: controller2.signal })
      const blob = await imgRes.arrayBuffer()
      const rawData = Data.fromArrayBuffer(blob)
      return {
        base64: rawData ? rawData.toBase64String() : "",
        mediaType: "image/png",
        revisedPrompt: imageItem.revised_prompt,
      }
    }

    throw new Error("无法解析生图接口返回的图片格式")
  } finally {
    cleanup2()
  }
}
