/**
 * 远程模型列表拉取与智能能力推断
 * 支持 OpenAI、OpenRouter、SiliconFlow、Gemini、Claude 等各协议端点的密钥校验与模型枚举
 */
import { fetch } from "scripting"
import type { GeneralAIProtocol } from "../../store/customAI"

export interface RemoteModelItem {
  id: string
  name?: string
  description?: string
  isVisionRecommended?: boolean
  isImageGenRecommended?: boolean
}

export interface FetchModelsResult {
  success: boolean
  models: RemoteModelItem[]
  error?: string
  latencyMs?: number
}

/**
 * 智能推断模型是否具备视觉 (Vision) 多模态能力
 */
export function isVisionCapableModel(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  if (
    lower.includes("4o") ||
    lower.includes("vision") ||
    lower.includes("-vl") ||
    lower.includes("_vl") ||
    lower.includes("gemini") ||
    lower.includes("claude-3") ||
    lower.includes("minicpm-v") ||
    lower.includes("internvl") ||
    lower.includes("qwen-vl") ||
    lower.includes("pixtral") ||
    lower.includes("glm-4v") ||
    lower.includes("omni")
  ) {
    return true
  }
  return false
}

/**
 * 智能推断模型是否属于独立生图/图像生成模型
 */
export function isImageGenModel(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  if (
    lower.includes("dall-e") ||
    lower.includes("flux") ||
    lower.includes("imagen") ||
    lower.includes("stable-diffusion") ||
    lower.includes("sdxl") ||
    lower.includes("midjourney") ||
    lower.includes("kolors") ||
    lower.includes("cogview")
  ) {
    return true
  }
  return false
}

function normalizeModelsEndpoint(protocol: GeneralAIProtocol, rawEndpoint: string, apiKey: string): string {
  let ep = rawEndpoint.trim().replace(/\/+$/, "")
  if (!ep) {
    if (protocol === "gemini") ep = "https://generativelanguage.googleapis.com"
    else if (protocol === "anthropic") ep = "https://api.anthropic.com"
    else ep = "https://api.openai.com"
  }

  if (protocol === "gemini") {
    if (ep.includes("/v1beta/models") || ep.includes("/v1/models")) {
      const sep = ep.includes("?") ? "&" : "?"
      return ep.includes("key=") ? ep : `${ep}${sep}key=${encodeURIComponent(apiKey)}`
    }
    if (!ep.includes("/v1beta") && !ep.includes("/v1")) {
      ep = `${ep}/v1beta`
    }
    return `${ep}/models?key=${encodeURIComponent(apiKey)}`
  }

  if (ep.endsWith("/models")) {
    return ep
  }
  if (ep.endsWith("/v1")) {
    return `${ep}/models`
  }
  if (ep.endsWith("/responses") || ep.endsWith("/chat/completions") || ep.endsWith("/messages")) {
    ep = ep.replace(/\/(responses|chat\/completions|messages)$/, "")
  }
  if (!ep.endsWith("/v1") && !ep.endsWith("/api")) {
    ep = `${ep}/v1`
  }
  return `${ep}/models`
}

/**
 * 发起请求校验密钥并拉取模型列表
 */
export async function fetchRemoteModelList(
  protocol: GeneralAIProtocol,
  rawEndpoint: string,
  apiKey: string
): Promise<FetchModelsResult> {
  const startTime = Date.now()
  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      models: [],
      error: "请先输入 API 密钥 (API Key)",
    }
  }

  const url = normalizeModelsEndpoint(protocol, rawEndpoint, apiKey)

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (protocol === "anthropic") {
      headers["x-api-key"] = apiKey
      headers["anthropic-version"] = "2023-06-01"
    } else if (protocol !== "gemini") {
      headers["Authorization"] = `Bearer ${apiKey}`
      if (rawEndpoint.includes("openrouter.ai")) {
        headers["HTTP-Referer"] = "https://github.com/Pix-Scripting"
        headers["X-Title"] = "Pix-Scripting"
      }
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
    })

    const latencyMs = Date.now() - startTime

    if (!res.ok) {
      if (protocol === "anthropic" && (res.status === 404 || res.status === 400)) {
        return {
          success: true,
          latencyMs,
          models: [
            { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet (推荐)", isVisionRecommended: true },
            { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku (极速)", isVisionRecommended: true },
            { id: "claude-3-opus-20240229", name: "Claude 3 Opus", isVisionRecommended: true },
            { id: "claude-3-sonnet-20240229", name: "Claude 3 Sonnet", isVisionRecommended: true },
            { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", isVisionRecommended: true },
          ],
        }
      }

      let errDetail = ""
      try {
        const errJson = await res.json()
        errDetail = errJson?.error?.message || JSON.stringify(errJson)
      } catch {
        errDetail = await res.text()
      }
      return {
        success: false,
        models: [],
        latencyMs,
        error: `密钥校验或拉取失败 (${res.status}): ${errDetail || res.statusText}`,
      }
    }

    const json = await res.json()
    const rawList: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
      ? json.models
      : []

    const models: RemoteModelItem[] = []
    for (const item of rawList) {
      const id = typeof item === "string" ? item : item?.id || item?.name || ""
      const cleanId = String(id).replace(/^models\//, "")
      if (!cleanId) continue

      models.push({
        id: cleanId,
        name: typeof item?.displayName === "string" ? item.displayName : cleanId,
        description: typeof item?.description === "string" ? item.description : undefined,
        isVisionRecommended: isVisionCapableModel(cleanId),
        isImageGenRecommended: isImageGenModel(cleanId),
      })
    }

    models.sort((a, b) => a.id.localeCompare(b.id))

    return {
      success: true,
      models,
      latencyMs,
    }
  } catch (e: any) {
    const latencyMs = Date.now() - startTime
    return {
      success: false,
      models: [],
      latencyMs,
      error: e?.message || String(e),
    }
  }
}
