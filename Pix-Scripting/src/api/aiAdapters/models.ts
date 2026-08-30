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
}

export interface FetchModelsResult {
  success: boolean
  models: RemoteModelItem[]
  error?: string
  latencyMs?: number
}

/**
 * 仅根据接口返回的结构化元数据判断模型是否具备视觉 (Vision / Image Input) 能力
 * 不通过模型名称做任何猜测，严格从接口返回的字段中解析
 */
export function isVisionCapableModel(itemMeta?: any): boolean {
  if (!itemMeta || typeof itemMeta !== "object") {
    return false
  }

  // 1. capabilities / capability / features 属性
  const cap = itemMeta.capabilities || itemMeta.capability || itemMeta.features
  if (typeof cap === "object" && cap !== null) {
    if (
      cap.vision === true ||
      cap.image === true ||
      cap.image_input === true ||
      cap.multimodal === true ||
      cap.visual === true ||
      cap.input_image === true
    ) {
      return true
    }
    if (Array.isArray(cap) && cap.some((c: any) => typeof c === "string" && /vision|image|multimodal|visual/i.test(c))) {
      return true
    }
  }

  // 2. modalities / input_modalities / architecture (OpenRouter, OneAPI, OpenAI 扩展规范等)
  const modalities = [
    ...(Array.isArray(itemMeta.modalities) ? itemMeta.modalities : [itemMeta.modalities]),
    ...(Array.isArray(itemMeta.input_modalities) ? itemMeta.input_modalities : [itemMeta.input_modalities]),
    ...(Array.isArray(itemMeta.architecture?.modalities) ? itemMeta.architecture.modalities : [itemMeta.architecture?.modalities]),
    ...(Array.isArray(itemMeta.architecture?.input_modalities) ? itemMeta.architecture.input_modalities : [itemMeta.architecture?.input_modalities]),
    itemMeta.architecture?.modality,
  ].filter(Boolean)

  for (const m of modalities) {
    const mStr = String(m).toLowerCase()
    if (mStr.includes("image") || mStr.includes("vision") || mStr.includes("multimodal") || mStr.includes("visual")) {
      return true
    }
  }

  // 3. type / model_type / tags / categories 标签
  const tags = [
    itemMeta.type,
    itemMeta.model_type,
    ...(Array.isArray(itemMeta.tags) ? itemMeta.tags : [itemMeta.tags]),
    ...(Array.isArray(itemMeta.categories) ? itemMeta.categories : [itemMeta.categories]),
  ].filter(Boolean)

  for (const t of tags) {
    const tStr = String(t).toLowerCase()
    if (tStr.includes("vision") || tStr.includes("multimodal") || tStr.includes("vlm") || tStr.includes("image-to-text")) {
      return true
    }
  }

  // 4. description / summary / info 描述文本分析
  const desc = [itemMeta.description, itemMeta.summary, itemMeta.info]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase()

  if (
    desc.includes("vision") ||
    desc.includes("多模态") ||
    desc.includes("视觉") ||
    desc.includes("multimodal") ||
    desc.includes("图像识别") ||
    desc.includes("image input") ||
    desc.includes("image-to-text")
  ) {
    return true
  }

  return false
}

/**
 * 仅根据接口返回的结构化元数据判断模型是否属于独立生图/图像生成模型
 */
export function isImageGenModel(itemMeta?: any): boolean {
  if (!itemMeta || typeof itemMeta !== "object") {
    return false
  }

  const typeStr = String(itemMeta.type || itemMeta.model_type || itemMeta.category || "").toLowerCase()
  if (typeStr.includes("image") || typeStr.includes("text-to-image") || typeStr.includes("image_generation")) {
    return true
  }

  const desc = [itemMeta.description, itemMeta.summary, itemMeta.info]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase()

  if (
    desc.includes("生图") ||
    desc.includes("图像生成") ||
    desc.includes("text-to-image") ||
    desc.includes("image generation")
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
