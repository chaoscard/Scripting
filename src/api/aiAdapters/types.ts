/**
 * 自定义 AI 适配器通用类型定义
 */

export interface SignalLike {
  aborted?: boolean
  addEventListener?: (type: any, listener: any, options?: any) => void
  removeEventListener?: (type: any, listener: any) => void
  onAbort?: (callback: () => void) => () => void
}

export interface AdapterMessageContentPart {
  type: "text" | "image"
  text?: string
  imageBase64?: string
  mimeType?: string
}

export interface AdapterMessage {
  role: "system" | "user" | "assistant"
  content: string | AdapterMessageContentPart[]
}

export interface AdapterRequest {
  systemPrompt?: string
  messages: AdapterMessage[]
  temperature?: number
  signal?: SignalLike
  onChunk?: (deltaText: string) => void
  onReasoning?: (deltaReasoning: string) => void
  onImage?: (image: { base64: string; mediaType: string }) => void
  requestImageOutput?: boolean
}

export interface AdapterResponse {
  text: string
  reasoning: string
  images: Array<{ base64: string; mediaType: string }>
}

export interface TestResult {
  success: boolean
  latencyMs?: number
  error?: string
  sampleResponse?: string
}
