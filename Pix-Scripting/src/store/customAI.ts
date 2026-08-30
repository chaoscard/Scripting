/**
 * 自定义 AI 助手存储与安全管理层
 * 负责通用模型与生图模型配置的持久化、Keychain 加密存储与 iCloud 钥匙串双向同步
 */
import { Script } from "scripting"

export type GeneralAIProtocol =
  | "openai-responses"
  | "openai-chat"
  | "gemini"
  | "anthropic"

export type ImageGenAIProtocol =
  | "openai-responses"
  | "openai-images"
  | "gemini-imagen"

export interface GeneralAIConfig {
  preset?: string
  protocol: GeneralAIProtocol
  endpoint: string
  model: string
  apiKey: string
  noKeyRequired?: boolean
  supportsVision: boolean
  temperature?: number
}

export interface ImageGenAIConfig {
  enabled: boolean
  protocol: ImageGenAIProtocol
  endpoint: string
  model: string
  apiKey: string
  reuseGeneralKey: boolean
  size?: string
}

export interface CustomAIProfile {
  enabled: boolean
  syncToICloud: boolean
  general: GeneralAIConfig
  imageGen: ImageGenAIConfig
}

export interface AIPreset {
  id: string
  name: string
  provider: string
  protocol: GeneralAIProtocol
  defaultEndpoint: string
  defaultModel: string
  supportsVision: boolean
  description: string
  apiKeyUrl?: string
}

export const AI_PRESETS: AIPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    provider: "OpenAI",
    protocol: "openai-responses",
    defaultEndpoint: "https://api.openai.com",
    defaultModel: "",
    supportsVision: true,
    description: "官方最新标准，原生支持视觉与流式推理",
    apiKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    provider: "OpenCode",
    protocol: "openai-responses",
    defaultEndpoint: "https://opencode.ai/zen",
    defaultModel: "",
    supportsVision: true,
    description: "OpenCode Zen 套餐，聚合高可用大模型",
    apiKeyUrl: "https://opencode.ai/zen",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    provider: "OpenCode",
    protocol: "openai-responses",
    defaultEndpoint: "https://opencode.ai/zen/go",
    defaultModel: "",
    supportsVision: true,
    description: "OpenCode Go 套餐，高性价比直连网关",
    apiKeyUrl: "https://opencode.ai/zen/go",
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek",
    provider: "DeepSeek",
    protocol: "openai-responses",
    defaultEndpoint: "https://api.deepseek.com",
    defaultModel: "",
    supportsVision: false,
    description: "高性价比、二次元与轻小说翻译能力极强",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    provider: "Google",
    protocol: "gemini",
    defaultEndpoint: "https://generativelanguage.googleapis.com",
    defaultModel: "",
    supportsVision: true,
    description: "极速响应与超长上下文，支持多模态视觉",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    provider: "Anthropic",
    protocol: "anthropic",
    defaultEndpoint: "https://api.anthropic.com",
    defaultModel: "",
    supportsVision: true,
    description: "文学素养高，行文流畅细腻",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    provider: "OpenRouter",
    protocol: "openai-chat",
    defaultEndpoint: "https://openrouter.ai/api",
    defaultModel: "",
    supportsVision: true,
    description: "聚合各大主流大模型，支持按需切换",
    apiKeyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    provider: "SiliconFlow",
    protocol: "openai-chat",
    defaultEndpoint: "https://api.siliconflow.cn",
    defaultModel: "",
    supportsVision: false,
    description: "国内稳定高速的开源模型 API 托管平台",
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "custom",
    name: "自定义",
    provider: "Custom",
    protocol: "openai-responses",
    defaultEndpoint: "",
    defaultModel: "",
    supportsVision: true,
    description: "自建反向代理、第三方中转站或专用私有端点",
  },
]

const KEYCHAIN_KEY = "pixiv_custom_ai_profile_v1"

export const DEFAULT_CUSTOM_AI_PROFILE: CustomAIProfile = {
  enabled: false,
  syncToICloud: true,
  general: {
    preset: "openai",
    protocol: "openai-responses",
    endpoint: "",
    model: "",
    apiKey: "",
    noKeyRequired: false,
    supportsVision: true,
    temperature: 0.7,
  },
  imageGen: {
    enabled: false,
    protocol: "openai-images",
    endpoint: "",
    model: "",
    apiKey: "",
    reuseGeneralKey: true,
    size: "1024x1024",
  },
}

let cachedProfile: CustomAIProfile | null = null
const listeners = new Set<(profile: CustomAIProfile) => void>()

export function onCustomAIConfigChanged(
  listener: (profile: CustomAIProfile) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners(profile: CustomAIProfile) {
  for (const listener of listeners) {
    try {
      listener(profile)
    } catch (e) {
      console.log("onCustomAIConfigChanged listener error:", e)
    }
  }
}

function validateAndSanitizeProfile(raw: unknown): CustomAIProfile {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_CUSTOM_AI_PROFILE }
  }
  const obj = raw as Record<string, any>

  const enabled = Boolean(obj.enabled)
  const syncToICloud = obj.syncToICloud !== false

  const generalRaw = obj.general || {}
  let generalProtocol: GeneralAIProtocol = [
    "openai-responses",
    "openai-chat",
    "gemini",
    "anthropic",
  ].includes(generalRaw.protocol)
    ? generalRaw.protocol
    : "openai-chat"

  let preset = typeof generalRaw.preset === "string" ? generalRaw.preset : undefined
  if (preset === "openai-responses" || preset === "openai-chat") {
    preset = "openai"
  } else if (preset === "opencode") {
    preset = "opencode-zen"
  }
  const rawEndpoint = typeof generalRaw.endpoint === "string" ? generalRaw.endpoint.trim() : ""

  const general: GeneralAIConfig = {
    preset,
    protocol: generalProtocol,
    endpoint: rawEndpoint,
    model: typeof generalRaw.model === "string" ? generalRaw.model.trim() : "",
    apiKey: typeof generalRaw.apiKey === "string" ? generalRaw.apiKey.trim() : "",
    noKeyRequired: Boolean(generalRaw.noKeyRequired),
    supportsVision: Boolean(generalRaw.supportsVision),
    temperature: typeof generalRaw.temperature === "number" ? generalRaw.temperature : 0.7,
  }

  const imageRaw = obj.imageGen || {}
  const imageProtocol: ImageGenAIProtocol = [
    "openai-responses",
    "openai-images",
    "gemini-imagen",
  ].includes(imageRaw.protocol)
    ? imageRaw.protocol
    : "openai-images"

  const imageGen: ImageGenAIConfig = {
    enabled: Boolean(imageRaw.enabled),
    protocol: imageProtocol,
    endpoint: typeof imageRaw.endpoint === "string" ? imageRaw.endpoint.trim() : "",
    model: typeof imageRaw.model === "string" ? imageRaw.model.trim() : "",
    apiKey: typeof imageRaw.apiKey === "string" ? imageRaw.apiKey.trim() : "",
    reuseGeneralKey: imageRaw.reuseGeneralKey !== false,
    size: typeof imageRaw.size === "string" ? imageRaw.size : "1024x1024",
  }

  return {
    enabled,
    syncToICloud,
    general,
    imageGen,
  }
}

/**
 * 加载自定义 AI 配置（优先读取 iCloud 同步项，回退本地项）
 */
export function loadCustomAIProfile(): CustomAIProfile {
  if (cachedProfile) {
    return cachedProfile
  }

  let raw: string | null = null

  // 1. 尝试从 iCloud 同步 Keychain 读取
  try {
    raw = Keychain.get(KEYCHAIN_KEY, { synchronizable: true })
  } catch (e) {
    // 某些环境可能报错，降级读取本地
  }

  // 2. 如果 iCloud 没有，读取本地 Keychain
  if (!raw) {
    try {
      raw = Keychain.get(KEYCHAIN_KEY)
    } catch (e) {
      console.log("Local Keychain read error:", e)
    }
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      cachedProfile = validateAndSanitizeProfile(parsed)
      return cachedProfile
    } catch (e) {
      console.log("Failed to parse custom AI profile:", e)
    }
  }

  cachedProfile = { ...DEFAULT_CUSTOM_AI_PROFILE }
  return cachedProfile
}

/**
 * 保存自定义 AI 配置到 Keychain（根据 syncToICloud 控制是否同步）
 */
export function saveCustomAIProfile(profile: CustomAIProfile): void {
  const sanitized = validateAndSanitizeProfile(profile)
  cachedProfile = sanitized

  const json = JSON.stringify(sanitized)

  try {
    if (sanitized.syncToICloud) {
      // 写入 iCloud 同步钥匙串
      Keychain.set(KEYCHAIN_KEY, json, {
        synchronizable: true,
        accessibility: "first_unlock",
      })
    } else {
      // 若关闭同步，则尝试从 iCloud 移除同步项，仅保留本地
      try {
        Keychain.remove(KEYCHAIN_KEY, { synchronizable: true })
      } catch {}
    }

    // 始终写入本地钥匙串备份
    Keychain.set(KEYCHAIN_KEY, json, {
      synchronizable: false,
      accessibility: "first_unlock_this_device",
    })
  } catch (e) {
    console.log("Failed to save custom AI profile to Keychain:", e)
  }

  notifyListeners(sanitized)
}

/**
 * 部分更新自定义 AI 配置
 */
export function updateCustomAIProfile(
  patch: Partial<CustomAIProfile>
): CustomAIProfile {
  const current = loadCustomAIProfile()
  const updated: CustomAIProfile = {
    ...current,
    ...patch,
    general: {
      ...current.general,
      ...(patch.general || {}),
    },
    imageGen: {
      ...current.imageGen,
      ...(patch.imageGen || {}),
    },
  }
  saveCustomAIProfile(updated)
  return updated
}

/**
 * 彻底删除自定义 AI 配置（同步删除本地与 iCloud Keychain）
 */
export function deleteCustomAIProfile(): void {
  cachedProfile = { ...DEFAULT_CUSTOM_AI_PROFILE }

  try {
    // 1. 删除本地钥匙串项
    Keychain.remove(KEYCHAIN_KEY)
  } catch (e) {
    console.log("Failed to remove local AI profile keychain:", e)
  }

  try {
    // 2. 同步删除 iCloud 钥匙串项
    Keychain.remove(KEYCHAIN_KEY, { synchronizable: true })
  } catch (e) {
    console.log("Failed to remove iCloud AI profile keychain:", e)
  }

  notifyListeners(cachedProfile)
}

/**
 * 检查当前用户是否具备 Scripting PRO 会员完整权限
 */
export function isScriptingPro(): boolean {
  try {
    return (
      typeof Script !== "undefined" &&
      typeof Script.hasFullAccess === "function" &&
      Boolean(Script.hasFullAccess())
    )
  } catch {
    return false
  }
}

/**
 * 获取通用模型的有效端点（若未填写自定义端点，则自动回退到预设或协议默认端点）
 */
export function getEffectiveGeneralEndpoint(general: GeneralAIConfig): string {
  const raw = (general.endpoint || "").trim()
  if (raw) return raw
  if (general.preset === "custom") return ""
  if (general.preset) {
    const preset = AI_PRESETS.find((p) => p.id === general.preset)
    if (preset && preset.defaultEndpoint) return preset.defaultEndpoint
  }
  if (!general.preset) return ""
  if (general.protocol === "gemini") return "https://generativelanguage.googleapis.com"
  if (general.protocol === "anthropic") return "https://api.anthropic.com"
  if (general.protocol === "openai-responses") return "https://api.openai.com"
  return "https://api.openai.com"
}

/**
 * 获取生图模型的有效端点（若未填写，则自动回退到默认端点）
 */
export function getEffectiveImageGenEndpoint(imageGen: ImageGenAIConfig): string {
  const raw = (imageGen.endpoint || "").trim()
  if (raw) return raw
  if (imageGen.protocol === "gemini-imagen") return "https://generativelanguage.googleapis.com"
  return "https://api.openai.com"
}

/**
 * 快速判断自定义 AI 是否处于有效启用状态
 */
export function isCustomAIConfigured(): boolean {
  const profile = loadCustomAIProfile()
  const gen = profile.general
  const effectiveEndpoint = getEffectiveGeneralEndpoint(gen)
  const hasKey = gen.noKeyRequired || Boolean(gen.apiKey)
  return Boolean(effectiveEndpoint && gen.model && hasKey)
}

/**
 * 获取生图模型的有效 API Key（支持复用通用模型密钥）
 */
export function getEffectiveImageGenKey(profile: CustomAIProfile): string {
  if (profile.imageGen.reuseGeneralKey) {
    return profile.general.apiKey
  }
  return profile.imageGen.apiKey
}

/**
 * 解析并获取当前自定义 AI 配置的服务商/厂商名称（到厂商一级）
 */
export function getCustomAIProviderName(profile: CustomAIProfile): string {
  if (profile.general.preset && !profile.general.endpoint) {
    const preset = AI_PRESETS.find((p) => p.id === profile.general.preset)
    if (preset) return preset.name
  }

  const endpoint = getEffectiveGeneralEndpoint(profile.general).toLowerCase()
  const model = (profile.general.model || "").toLowerCase()
  const protocol = profile.general.protocol

  if (endpoint.includes("deepseek") || model.includes("deepseek")) return "DeepSeek"
  if (endpoint.includes("siliconflow") || endpoint.includes("silicon")) return "SiliconFlow"
  if (endpoint.includes("openrouter")) return "OpenRouter"
  if (endpoint.includes("opencode") || model.includes("opencode")) return "OpenCode"
  if (endpoint.includes("anthropic") || protocol === "anthropic" || model.includes("claude")) return "Anthropic"
  if (
    endpoint.includes("google") ||
    endpoint.includes("googleapis") ||
    protocol === "gemini" ||
    model.includes("gemini")
  ) {
    return "Google Gemini"
  }
  if (
    endpoint.includes("openai") ||
    protocol === "openai-responses" ||
    model.startsWith("gpt") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("chatgpt")
  ) {
    return "OpenAI"
  }
  if (endpoint.includes("groq")) return "Groq"
  if (endpoint.includes("moonshot") || model.includes("moonshot") || model.includes("kimi")) return "Moonshot"
  if (endpoint.includes("aliyun") || endpoint.includes("dashscope") || model.includes("qwen")) return "通义千问"
  if (endpoint.includes("zhipu") || model.includes("glm")) return "智谱清言"
  if (endpoint.includes("minimax")) return "MiniMax"
  if (endpoint.includes("baichuan")) return "百川智能"
  if (endpoint.includes("x.ai") || model.includes("grok")) return "xAI"
  if (endpoint.includes("together")) return "Together AI"

  return "OpenAI 兼容"
}

