/**
 * 远程模型列表拉取与智能能力推断
 * 严格按照各大官方 API 模型列表接口规范：
 * - OpenAI / SiliconFlow / OpenRouter: GET /v1/models
 * - Anthropic: GET /v1/models
 * - Google Gemini: GET /v1beta/models?key={apiKey}
 */
import { fetch } from "scripting"
import { AI_PRESETS, type GeneralAIProtocol } from "../../store/customAI"

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

function normalizeModelsEndpoint(protocol: GeneralAIProtocol, rawEndpoint: string, apiKey: string, presetId?: string, noKeyRequired?: boolean): string {
  let ep = (rawEndpoint || "").trim().replace(/\/+$/, "")
  if (!ep) {
    if (presetId) {
      const p = AI_PRESETS.find((item) => item.id === presetId)
      if (p) ep = p.defaultEndpoint
    }
    if (!ep) {
      if (protocol === "gemini") ep = "https://generativelanguage.googleapis.com"
      else if (protocol === "anthropic") ep = "https://api.anthropic.com"
      else ep = "https://api.openai.com"
    }
  }

  // Google Gemini 模型列表规范
  if (protocol === "gemini") {
    if (ep.includes("/v1beta/models") || ep.includes("/v1/models")) {
      if (!apiKey || noKeyRequired) return ep
      const sep = ep.includes("?") ? "&" : "?"
      return ep.includes("key=") ? ep : `${ep}${sep}key=${encodeURIComponent(apiKey)}`
    }
    if (!ep.includes("/v1beta") && !ep.includes("/v1")) {
      ep = `${ep}/v1beta`
    }
    if (!apiKey || noKeyRequired) return `${ep}/models`
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
  if (!ep.endsWith("/v1") && !ep.endsWith("/api") && !ep.endsWith("/anthropic")) {
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
  apiKey: string,
  presetId?: string,
  noKeyRequired?: boolean
): Promise<FetchModelsResult> {
  const startTime = Date.now()
  if (!noKeyRequired && (!apiKey || !apiKey.trim())) {
    return {
      success: false,
      models: [],
      error: "请先输入 API 密钥 (API Key)",
    }
  }

  let effectiveEndpoint = (rawEndpoint || "").trim()
  if (!effectiveEndpoint) {
    if (presetId) {
      const p = AI_PRESETS.find((item) => item.id === presetId)
      if (p) effectiveEndpoint = p.defaultEndpoint
    }
    if (!effectiveEndpoint) {
      if (protocol === "gemini") effectiveEndpoint = "https://generativelanguage.googleapis.com"
      else if (protocol === "anthropic") effectiveEndpoint = "https://api.anthropic.com"
      else effectiveEndpoint = "https://api.openai.com"
    }
  }

  const url = normalizeModelsEndpoint(protocol, rawEndpoint, apiKey, presetId, noKeyRequired)

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (apiKey && !noKeyRequired) {
      if (protocol === "anthropic") {
        headers["x-api-key"] = apiKey
        headers["anthropic-version"] = "2023-06-01"
      } else if (protocol !== "gemini") {
        headers["Authorization"] = `Bearer ${apiKey}`
        if (effectiveEndpoint.includes("openrouter.ai")) {
          headers["HTTP-Referer"] = "https://github.com/Pix-Scripting"
          headers["X-Title"] = "Pix-Scripting"
        }
      }
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
    })

    const latencyMs = Date.now() - startTime

    if (!res.ok) {
      let errText = ""
      try {
        const errJson = await res.json()
        errText = errJson?.error?.message || errJson?.message || JSON.stringify(errJson)
      } catch {
        errText = await res.text()
      }
      return {
        success: false,
        models: [],
        latencyMs,
        error: `校验失败 (${res.status}): ${errText || res.statusText}`,
      }
    }

    const data = await res.json()
    const rawList: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
      ? data.models
      : []

    if (rawList.length === 0) {
      return {
        success: true,
        models: [],
        latencyMs,
        error: "接口未返回任何可用模型",
      }
    }

    const parsedModels: RemoteModelItem[] = []
    for (const item of rawList) {
      const id = typeof item === "string" ? item : item?.id || item?.name || ""
      if (!id) continue

      const cleanId = id.replace(/^models\//, "")
      const displayName = item?.displayName || item?.name || cleanId
      const description = item?.description || ""

      parsedModels.push({
        id: cleanId,
        name: displayName,
        description,
        isVisionRecommended: isVisionCapableModel(cleanId),
        isImageGenRecommended: isImageGenModel(cleanId),
      })
    }

    return {
      success: true,
      models: parsedModels,
      latencyMs,
    }
  } catch (e: any) {
    const latencyMs = Date.now() - startTime
    return {
      success: false,
      models: [],
      latencyMs,
      error: `请求异常: ${e?.message || String(e)}`,
    }
  }
}
