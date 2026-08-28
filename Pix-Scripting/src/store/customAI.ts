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
  protocol: GeneralAIProtocol
  endpoint: string
  model: string
  apiKey: string
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
}

export const AI_PRESETS: AIPreset[] = [
  {
    id: "deepseek-chat",
    name: "DeepSeek (V3 / R1)",
    provider: "DeepSeek",
    protocol: "openai-chat",
    defaultEndpoint: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    supportsVision: false,
    description: "高性价比、二次元与轻小说翻译能力极强",
  },
  {
    id: "openai-responses",
    name: "OpenAI Responses (最新协议)",
    provider: "OpenAI",
    protocol: "openai-responses",
    defaultEndpoint: "https://api.openai.com",
    defaultModel: "gpt-4o",
    supportsVision: true,
    description: "OpenAI 最新标准，原生支持视觉与流式推理",
  },
  {
    id: "openai-chat",
    name: "OpenAI Chat (标准接口)",
    provider: "OpenAI",
    protocol: "openai-chat",
    defaultEndpoint: "https://api.openai.com",
    defaultModel: "gpt-4o-mini",
    supportsVision: true,
    description: "通用主流接口，兼容绝大多数中转与自建服务",
  },
  {
    id: "openrouter",
    name: "OpenRouter (多模型聚合)",
    provider: "OpenRouter",
    protocol: "openai-chat",
    defaultEndpoint: "https://openrouter.ai/api",
    defaultModel: "deepseek/deepseek-chat",
    supportsVision: true,
    description: "聚合各大主流大模型，支持按需切换",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow (硅基流动)",
    provider: "SiliconFlow",
    protocol: "openai-chat",
    defaultEndpoint: "https://api.siliconflow.cn",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    supportsVision: false,
    description: "国内稳定高速的开源模型 API 托管平台",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    provider: "Google",
    protocol: "gemini",
    defaultEndpoint: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-2.5-flash",
    supportsVision: true,
    description: "极速响应与超长上下文，支持多模态视觉",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    provider: "Anthropic",
    protocol: "anthropic",
    defaultEndpoint: "https://api.anthropic.com",
    defaultModel: "claude-3-5-sonnet-20241022",
    supportsVision: true,
    description: "文学素养高，行文流畅细腻",
  },
]

const KEYCHAIN_KEY = "pixiv_custom_ai_profile_v1"

export const DEFAULT_CUSTOM_AI_PROFILE: CustomAIProfile = {
  enabled: false,
  syncToICloud: true,
  general: {
    protocol: "openai-chat",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKey: "",
    supportsVision: false,
    temperature: 0.7,
  },
  imageGen: {
    enabled: false,
    protocol: "openai-images",
    endpoint: "https://api.openai.com",
    model: "dall-e-3",
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
  const generalProtocol: GeneralAIProtocol = [
    "openai-responses",
    "openai-chat",
    "gemini",
    "anthropic",
  ].includes(generalRaw.protocol)
    ? generalRaw.protocol
    : "openai-chat"

  const general: GeneralAIConfig = {
    protocol: generalProtocol,
    endpoint: typeof generalRaw.endpoint === "string" ? generalRaw.endpoint.trim() : "https://api.deepseek.com",
    model: typeof generalRaw.model === "string" ? generalRaw.model.trim() : "deepseek-chat",
    apiKey: typeof generalRaw.apiKey === "string" ? generalRaw.apiKey.trim() : "",
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
    endpoint: typeof imageRaw.endpoint === "string" ? imageRaw.endpoint.trim() : "https://api.openai.com",
    model: typeof imageRaw.model === "string" ? imageRaw.model.trim() : "dall-e-3",
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
 * 快速判断自定义 AI 是否处于有效启用状态
 */
export function isCustomAIConfigured(): boolean {
  const profile = loadCustomAIProfile()
  if (!profile.enabled) return false
  const gen = profile.general
  return Boolean(gen.endpoint && gen.model && gen.apiKey)
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
