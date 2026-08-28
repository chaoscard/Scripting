/**
 * 自定义 AI 协议适配器统一分发与连接测试层
 */
import type { GeneralAIConfig, ImageGenAIConfig } from "../../store/customAI"
import type { AdapterRequest, AdapterResponse, TestResult, SignalLike } from "./types"
import { requestOpenAIResponses } from "./openaiResponses"
import { requestOpenAIChat } from "./openaiChat"
import { requestGemini } from "./gemini"
import { requestAnthropic } from "./anthropic"
import { requestCustomImageGen } from "./imageGen"

export * from "./types"
export * from "./sseParser"
export * from "./openaiResponses"
export * from "./openaiChat"
export * from "./gemini"
export * from "./anthropic"
export * from "./imageGen"
export * from "./models"

/**
 * 统一分发流式对话请求
 */
export async function streamCustomChat(
  config: GeneralAIConfig,
  request: AdapterRequest
): Promise<AdapterResponse> {
  switch (config.protocol) {
    case "openai-responses":
      return requestOpenAIResponses(config, request)
    case "openai-chat":
      return requestOpenAIChat(config, request)
    case "gemini":
      return requestGemini(config, request)
    case "anthropic":
      return requestAnthropic(config, request)
    default:
      return requestOpenAIChat(config, request)
  }
}

/**
 * 通用模型连接与可用性测试（极速 Ping）
 */
export async function testCustomAIConnection(
  config: GeneralAIConfig
): Promise<TestResult> {
  const startTime = Date.now()
  const signal: SignalLike = { aborted: false }
  const timeoutId = setTimeout(() => {
    signal.aborted = true
  }, 15000)

  try {
    const response = await streamCustomChat(config, {
      systemPrompt: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: "Respond with exactly the word 'OK'.",
        },
      ],
      temperature: 0.1,
      signal,
    })

    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime
    const text = (response.text || response.reasoning || "").trim()

    return {
      success: true,
      latencyMs,
      sampleResponse: text.length > 50 ? `${text.slice(0, 50)}...` : text,
    }
  } catch (e: any) {
    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime
    const isTimeout = signal.aborted || e?.name === "AbortError" || String(e).includes("abort")
    return {
      success: false,
      latencyMs,
      error: isTimeout ? "连接超时 (15s)，请检查端点地址与网络状态" : (e?.message || String(e)),
    }
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
  const signal: SignalLike = { aborted: false }
  const timeoutId = setTimeout(() => {
    signal.aborted = true
  }, 20000)

  try {
    if (!config.endpoint || !effectiveApiKey) {
      throw new Error("请先填写生图端点与 API 密钥")
    }

    const result = await requestCustomImageGen(config, effectiveApiKey, {
      prompt: "A tiny cute red apple icon on white background",
      signal,
    })

    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime

    return {
      success: Boolean(result.base64),
      latencyMs,
      sampleResponse: `图片生成成功 (Base64 长度: ${result.base64.length})`,
    }
  } catch (e: any) {
    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime
    const isTimeout = signal.aborted || e?.name === "AbortError" || String(e).includes("abort")
    return {
      success: false,
      latencyMs,
      error: isTimeout ? "生图连接超时 (20s)" : (e?.message || String(e)),
    }
  }
}
