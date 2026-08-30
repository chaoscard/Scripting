/**
 * 自定义 AI 协议适配器统一分发与连接测试层
 */
import { AbortController } from "scripting"
import {
  cleanAIEndpoint,
  getEffectiveGeneralEndpoint,
  getEffectiveImageGenEndpoint,
  type GeneralAIConfig,
  type ImageGenAIConfig,
} from "../../store/customAI"
import type { AdapterRequest, AdapterResponse, TestResult } from "./types"
import { requestOpenAIResponses } from "./openaiResponses"
import { requestOpenAIChat } from "./openaiChat"
import { requestGemini } from "./gemini"
import { requestAnthropic } from "./anthropic"
import { requestCustomImageGen } from "./imageGen"
import {
  inferPresetModelEndpoint,
  inferPresetModelProtocol,
  inferPresetModelSupportsVision,
} from "./models"

export * from "./types"
export * from "./sseParser"
export * from "./responseParsers"
export * from "./openaiResponses"
export * from "./openaiChat"
export * from "./gemini"
export * from "./anthropic"
export * from "./imageGen"
export * from "./models"

export function resolveGeneralAIConfigRoute(config: GeneralAIConfig): GeneralAIConfig {
  const cleanEndpoint = cleanAIEndpoint(config.endpoint || getEffectiveGeneralEndpoint(config), config.preset)
  if (config.preset !== "opencode-zen" && config.preset !== "opencode-go") {
    return {
      ...config,
      endpoint: cleanEndpoint,
    }
  }
  const inferredProtocol = inferPresetModelProtocol(config.preset, config.model)
  return {
    ...config,
    ...(inferredProtocol ? { protocol: inferredProtocol } : {}),
    endpoint: cleanEndpoint,
    supportsVision: inferPresetModelSupportsVision(config.preset, config.model) ?? config.supportsVision,
  }
}

/**
 * 统一分发流式对话请求
 */
export async function streamCustomChat(
  config: GeneralAIConfig,
  request: AdapterRequest
): Promise<AdapterResponse> {
  const routedConfig = resolveGeneralAIConfigRoute(config)
  switch (routedConfig.protocol) {
    case "openai-responses":
      return requestOpenAIResponses(routedConfig, request)
    case "openai-chat":
      return requestOpenAIChat(routedConfig, request)
    case "gemini":
      return requestGemini(routedConfig, request)
    case "anthropic":
      return requestAnthropic(routedConfig, request)
    default:
      return requestOpenAIChat(routedConfig, request)
  }
}

/**
 * 通用模型连接与可用性测试（极速 Ping）
 */
export async function testCustomAIConnection(
  config: GeneralAIConfig
): Promise<TestResult> {
  const routedConfig = resolveGeneralAIConfigRoute(config)
  const effectiveEndpoint = getEffectiveGeneralEndpoint(routedConfig)
  if (!effectiveEndpoint || !routedConfig.model || (!routedConfig.noKeyRequired && !routedConfig.apiKey)) {
    return {
      success: false,
      latencyMs: 0,
      error: "请先填写完整的模型名称与 API 密钥",
    }
  }

  const startTime = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, 15000)

  try {
    const probeContent = routedConfig.supportsVision
      ? [
          { type: "text" as const, text: "What is the single dominant color in the attached image? Reply with RED only." },
          {
            type: "image" as const,
            imageBase64:
              "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=",
            mimeType: "image/png",
          },
        ]
      : "Respond with exactly the word 'OK'."

    const response = await streamCustomChat(routedConfig, {
      systemPrompt: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: probeContent,
        },
      ],
      temperature: 0.1,
      signal: controller.signal,
    })

    const latencyMs = Date.now() - startTime
    const rawText = (response.text || "").trim()
    const text = rawText
      .replace(/<(?:think|thought|thinking)>[\s\S]*?<\/(?:think|thought|thinking)>/gi, "")
      .replace(/^<(?:think|thought|thinking)>[\s\S]*$/gi, "")
      .trim()

    if (!text) {
      throw new Error(
        routedConfig.supportsVision
          ? "模型未返回可用正文，视觉图片请求可能未被当前端点支持"
          : "模型未返回可用正文，请检查所选协议是否与端点匹配"
      )
    }

    if (routedConfig.supportsVision) {
      if (!/(^|\b)red(\b|$)|红/i.test(text)) {
        throw new Error(`模型未正确识别测试图片，实际回复: ${text.slice(0, 80)}`)
      }
    } else if (!/(^|\b)ok(\b|$)/i.test(text)) {
      throw new Error(`模型未按要求返回 OK，实际回复: ${text.slice(0, 80)}`)
    }

    return {
      success: true,
      latencyMs,
      sampleResponse: text.length > 50 ? `${text.slice(0, 50)}...` : text,
    }
  } catch (e: any) {
    const latencyMs = Date.now() - startTime
    const isTimeout = controller.signal.aborted || e?.name === "AbortError" || String(e).includes("abort")
    return {
      success: false,
      latencyMs,
      error: isTimeout ? "连接超时 (15s)，请检查端点地址与网络状态" : (e?.message || String(e)),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 生图模型连接测试
 */
export async function testCustomImageGenConnection(
  config: ImageGenAIConfig,
  effectiveApiKey: string
): Promise<TestResult> {
  const startTime = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, 90000)

  try {
    const effectiveEndpoint = getEffectiveImageGenEndpoint(config)
    if (!effectiveEndpoint || !config.model) {
      throw new Error("请先填写有效的生图端点和模型名称")
    }

    const result = await requestCustomImageGen(config, effectiveApiKey, {
      prompt: "Preserve the reference image and add a small blue dot in the center.",
      referenceImageBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC",
      referenceImageMimeType: "image/png",
      signal: controller.signal,
    })

    if (!result.base64 || result.base64.length < 32) {
      throw new Error("生图端点未返回有效图片数据")
    }

    const latencyMs = Date.now() - startTime
    return {
      success: true,
      latencyMs,
      sampleResponse: `参考图编辑成功 (Base64 长度: ${result.base64.length})`,
    }
  } catch (e: any) {
    const latencyMs = Date.now() - startTime
    const isTimeout = controller.signal.aborted || e?.name === "AbortError" || String(e).includes("abort")
    return {
      success: false,
      latencyMs,
      error: isTimeout ? "生图连接超时 (90s)" : (e?.message || String(e)),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
