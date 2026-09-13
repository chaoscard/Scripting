/**
 * 远程模型列表拉取与智能能力推断
 * 严格按照各大官方 API 模型列表接口规范：
 * - OpenAI / SiliconFlow / OpenRouter: GET /v1/models
 * - Anthropic: GET /v1/models
 * - Google Gemini: GET /v1beta/models?key={apiKey}
 */
import { fetch } from "scripting"
import { AI_PRESETS, cleanAIEndpoint, type GeneralAIProtocol } from "../../store/customAI"

function usesGoogleAPIKeyQuery(endpoint: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(endpoint)
}

export interface RemoteModelItem {
  id: string
  name?: string
  description?: string
  protocol?: GeneralAIProtocol
  endpoint?: string
  supportsVision?: boolean
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

function stripProviderEndpointSuffix(rawEndpoint: string, presetId?: string): string {
  return cleanAIEndpoint(rawEndpoint, presetId)
}

function inferPresetModelRoute(presetId: string | undefined, modelId: string): {
  protocol?: GeneralAIProtocol
  endpointSuffix?: string
  supportsVision?: boolean
} {
  const model = modelId.toLowerCase().replace(/^models\//, "")
  if (presetId !== "opencode-zen" && presetId !== "opencode-go") return {}

  if (model.startsWith("claude-")) {
    return { protocol: "anthropic", endpointSuffix: "/messages", supportsVision: true }
  }
  if (model.startsWith("gemini-")) {
    return { protocol: "gemini", endpointSuffix: `/models/${encodeURIComponent(model)}`, supportsVision: true }
  }
  if (
    model.startsWith("deepseek-") ||
    model.startsWith("qwen") ||
    model.startsWith("minimax-") ||
    model.startsWith("glm-") ||
    model.startsWith("kimi-") ||
    model.startsWith("mimo-") ||
    model.startsWith("ling-") ||
    model.startsWith("nemotron-") ||
    model.startsWith("hy3") ||
    model.startsWith("hy4") ||
    model.startsWith("hunyuan") ||
    model.startsWith("doubao") ||
    model.startsWith("step") ||
    model.startsWith("yi-") ||
    model.startsWith("longcat-") ||
    model.startsWith("big-pickle")
  ) {
    return { protocol: "openai-chat", endpointSuffix: "/chat/completions", supportsVision: /vision|multimodal|(?:^|[-_])vl(?:[-_]|$)|omni/i.test(model) }
  }
  if (
    model.startsWith("gpt-") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4") ||
    model.startsWith("chatgpt-")
  ) {
    return { protocol: "openai-responses", endpointSuffix: "/responses", supportsVision: true }
  }
  return { protocol: "openai-chat", endpointSuffix: "/chat/completions", supportsVision: /vision|multimodal|(?:^|[-_])vl(?:[-_]|$)|omni/i.test(model) }
}

export function inferPresetModelProtocol(presetId: string | undefined, modelId: string): GeneralAIProtocol | undefined {
  return inferPresetModelRoute(presetId, modelId).protocol
}

export function inferPresetModelSupportsVision(presetId: string | undefined, modelId: string): boolean | undefined {
  return inferPresetModelRoute(presetId, modelId).supportsVision
}

export function inferPresetModelEndpoint(presetId: string | undefined, baseEndpoint: string, modelId: string): string | undefined {
  const base = cleanAIEndpoint(baseEndpoint, presetId)
  if (!base) return undefined
  return base
}

export function normalizeModelsEndpoint(
  protocol: GeneralAIProtocol,
  rawEndpoint: string,
  apiKey: string,
  presetId?: string,
  noKeyRequired?: boolean
): string {
  let ep = cleanAIEndpoint(rawEndpoint, presetId)
  if (!ep) {
    if (presetId) {
      const p = AI_PRESETS.find((item) => item.id === presetId)
      if (p) ep = cleanAIEndpoint(p.defaultEndpoint, presetId)
    }
    if (!ep) {
      if (protocol === "gemini") ep = "https://generativelanguage.googleapis.com"
      else if (protocol === "anthropic") ep = "https://api.anthropic.com"
      else ep = "https://api.openai.com"
    }
  }

  if (presetId === "opencode-zen" || presetId === "opencode-go" || /opencode\.ai\/zen/i.test(ep)) {
    if (!ep.endsWith("/v1")) ep += "/v1"
    return `${ep}/models`
  }

  if (protocol === "gemini") {
    if (!ep.includes("/v1beta") && !ep.includes("/v1")) {
      if (rawEndpoint && rawEndpoint.includes("/v1") && !rawEndpoint.includes("/v1beta")) {
        ep += "/v1"
      } else {
        ep += "/v1beta"
      }
    }
    if (!ep.endsWith("/models")) ep += "/models"
    if (!apiKey || noKeyRequired || !usesGoogleAPIKeyQuery(rawEndpoint || ep)) return ep
    return `${ep}?key=${encodeURIComponent(apiKey)}`
  }

  if (ep.endsWith("/api") && ep.includes("openrouter.ai")) {
    return `${ep}/v1/models`
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
        if (presetId === "opencode-zen" || presetId === "opencode-go") {
          headers["Authorization"] = `Bearer ${apiKey}`
        }
      } else if (protocol !== "gemini" || !usesGoogleAPIKeyQuery(effectiveEndpoint)) {
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
      const inferredRoute = inferPresetModelRoute(presetId, cleanId)
      const metadataVision = isVisionCapableModel(item)

      parsedModels.push({
        id: cleanId,
        name: displayName,
        description,
        protocol: inferredRoute.protocol,
        endpoint: cleanAIEndpoint(effectiveEndpoint, presetId),
        // `false` from a model list usually means "metadata absent", not
        // "this model cannot see images". Preserve the user's current toggle
        // unless the provider gives a positive capability signal.
        supportsVision:
          metadataVision || inferredRoute.supportsVision === true
            ? true
            : undefined,
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
