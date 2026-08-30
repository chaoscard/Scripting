import { Script } from "scripting"
import {
  detectImageMime,
  parseAnthropicPayload,
  parseGeminiPayload,
  parseOpenAIChatPayload,
  parseOpenAIResponsesPayload,
} from "../src/api/aiAdapters/responseParsers"
import { normalizeChatEndpoint } from "../src/api/aiAdapters/openaiChat"
import { parseSSEStream } from "../src/api/aiAdapters/sseParser"
import {
  inferPresetModelEndpoint,
  inferPresetModelProtocol,
  normalizeModelsEndpoint,
  resolveGeneralAIConfigRoute,
} from "../src/api/aiAdapters"
import { normalizeResponsesEndpoint } from "../src/api/aiAdapters/openaiResponses"
import { normalizeGeminiEndpoint } from "../src/api/aiAdapters/gemini"
import { normalizeAnthropicEndpoint } from "../src/api/aiAdapters/anthropic"
import {
  normalizeGeminiImageEndpoint,
  normalizeImagenEndpoint,
  normalizeImageEditsEndpoint,
  normalizeImagesEndpoint,
} from "../src/api/aiAdapters/imageGen"
import { AI_PRESETS, cleanAIEndpoint } from "../src/store/customAI"
import { extractOCRBubbles, splitNovelChunks } from "../src/api/aiService"

let passed = 0

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
  passed += 1
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  assert(actual === expected, `${message}; expected=${String(expected)} actual=${String(actual)}`)
}

function testEndpoints() {
  assertEqual(normalizeChatEndpoint("https://api.deepseek.com"), "https://api.deepseek.com/v1/chat/completions", "DeepSeek Chat endpoint")
  assertEqual(normalizeChatEndpoint("https://openrouter.ai/api/v1"), "https://openrouter.ai/api/v1/chat/completions", "OpenRouter endpoint")
  assertEqual(normalizeResponsesEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/responses", "Responses endpoint")
  assertEqual(normalizeAnthropicEndpoint("https://api.anthropic.com/v1"), "https://api.anthropic.com/v1/messages", "Anthropic endpoint")
  assertEqual(
    normalizeGeminiEndpoint("https://generativelanguage.googleapis.com", "gemini-test", "secret"),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse&key=secret",
    "Gemini stream endpoint"
  )
  assertEqual(normalizeImagesEndpoint("https://api.openai.com"), "https://api.openai.com/v1/images/generations", "OpenAI image generation endpoint")
  assertEqual(normalizeImageEditsEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/images/edits", "OpenAI image edit endpoint")
  assertEqual(
    normalizeGeminiImageEndpoint("https://generativelanguage.googleapis.com", "gemini-image", "secret"),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-image:generateContent?key=secret",
    "Gemini image endpoint"
  )
  assertEqual(AI_PRESETS.find((item) => item.id === "deepseek-chat")?.protocol, "openai-responses", "DeepSeek preset protocol")
  assertEqual(inferPresetModelProtocol("opencode-zen", "claude-sonnet-4-6"), "anthropic", "OpenCode Claude protocol")
  assertEqual(inferPresetModelProtocol("opencode-go", "deepseek-v4-flash"), "openai-chat", "OpenCode DeepSeek protocol")
  assertEqual(inferPresetModelProtocol("opencode-go", "hy3-preview"), "openai-chat", "OpenCode Hunyuan protocol")
  assertEqual(inferPresetModelProtocol("opencode-go", "qwen-2.5-72b"), "openai-chat", "OpenCode Qwen protocol")
  assertEqual(
    cleanAIEndpoint("https://opencode.ai/zen/go/v1/chat/completions", "opencode-go"),
    "https://opencode.ai/zen/go",
    "OpenCode Go clean endpoint"
  )
  assertEqual(
    cleanAIEndpoint("https://opencode.ai/zen/v1/models/gemini-old:streamGenerateContent?alt=sse", "opencode-zen"),
    "https://opencode.ai/zen",
    "OpenCode Zen clean endpoint"
  )
  assertEqual(
    cleanAIEndpoint("https://api.openai.com/v1/responses", "openai"),
    "https://api.openai.com",
    "OpenAI clean endpoint"
  )
  assertEqual(
    cleanAIEndpoint("https://api.deepseek.com/v1/chat/completions", "deepseek-chat"),
    "https://api.deepseek.com",
    "DeepSeek clean endpoint"
  )
  assertEqual(
    cleanAIEndpoint("https://api.anthropic.com/v1/messages", "anthropic"),
    "https://api.anthropic.com",
    "Anthropic clean endpoint"
  )
  assertEqual(
    cleanAIEndpoint("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse", "gemini"),
    "https://generativelanguage.googleapis.com",
    "Gemini clean endpoint"
  )
  assertEqual(
    cleanAIEndpoint("https://api.example.com/v1/chat/completions", "custom"),
    "https://api.example.com/v1",
    "Custom clean endpoint strips operation but preserves base subpath"
  )
  const routed = resolveGeneralAIConfigRoute({
    preset: "opencode-go",
    protocol: "openai-responses",
    endpoint: "https://opencode.ai/zen/go/v1/chat/completions",
    model: "hy3-preview",
    apiKey: "test",
    supportsVision: false,
  })
  assertEqual(routed.protocol, "openai-chat", "OpenCode Go routed protocol for hy3-preview")
  assertEqual(routed.endpoint, "https://opencode.ai/zen/go", "OpenCode Go routed clean endpoint")
  assertEqual(
    inferPresetModelEndpoint("opencode-zen", "https://opencode.ai/zen/v1/responses", "deepseek-v4-flash"),
    "https://opencode.ai/zen",
    "OpenCode Chat endpoint clean base"
  )
  assertEqual(
    inferPresetModelEndpoint("opencode-go", "https://opencode.ai/zen/go/v1/chat/completions", "hy3-preview"),
    "https://opencode.ai/zen/go",
    "OpenCode Go endpoint clean base"
  )
  assertEqual(
    inferPresetModelEndpoint("opencode-zen", "https://opencode.ai/zen/v1/models/gemini-old", "gemini-3.7-flash"),
    "https://opencode.ai/zen",
    "OpenCode Gemini endpoint clean base"
  )
  assertEqual(
    normalizeChatEndpoint("https://opencode.ai/zen/go"),
    "https://opencode.ai/zen/go/v1/chat/completions",
    "OpenCode Go Chat normalized endpoint"
  )
  assertEqual(
    normalizeAnthropicEndpoint("https://opencode.ai/zen/go"),
    "https://opencode.ai/zen/go/v1/messages",
    "OpenCode Go Anthropic normalized endpoint"
  )
  assertEqual(
    normalizeResponsesEndpoint("https://opencode.ai/zen/go"),
    "https://opencode.ai/zen/go/v1/responses",
    "OpenCode Go Responses normalized endpoint"
  )
  assertEqual(
    normalizeGeminiEndpoint(
      "https://opencode.ai/zen/v1/models/gemini-old:streamGenerateContent?alt=sse",
      "gemini-3.7-flash",
      "secret"
    ),
    "https://opencode.ai/zen/v1/models/gemini-3.7-flash:streamGenerateContent?alt=sse",
    "Gemini gateway replaces stale model path"
  )
  assertEqual(
    normalizeModelsEndpoint(
      "gemini",
      "https://opencode.ai/zen/v1/models/gemini-old:streamGenerateContent?alt=sse",
      "secret",
      "opencode-zen"
    ),
    "https://opencode.ai/zen/v1/models",
    "OpenCode models endpoint strips stale Gemini method"
  )
  assertEqual(
    normalizeModelsEndpoint(
      "gemini",
      "https://gateway.example.com/v1/models/gemini-old:streamGenerateContent?alt=sse",
      "secret"
    ),
    "https://gateway.example.com/v1/models",
    "Custom Gemini models endpoint omits Google key query"
  )
  assertEqual(
    normalizeImagenEndpoint("https://generativelanguage.googleapis.com", "imagen-3.0-generate-002", "secret"),
    "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=secret",
    "Imagen predict endpoint"
  )
  assertEqual(
    normalizeGeminiImageEndpoint(
      "https://opencode.ai/zen/v1/models/gemini-old:streamGenerateContent?alt=sse",
      "gemini-image-new",
      "secret"
    ),
    "https://opencode.ai/zen/v1/models/gemini-image-new:generateContent",
    "Gemini image gateway replaces stale model path"
  )
}

function testOpenAIChat() {
  const stream = parseOpenAIChatPayload({ choices: [{ delta: { content: "译" }, finish_reason: null }] })
  assertEqual(stream.text, "译", "Chat stream text")
  assert(!stream.done, "Chat stream remains open")

  const complete = parseOpenAIChatPayload({
    choices: [{ message: { content: "译文", reasoning_content: "思考" }, finish_reason: "stop" }],
  })
  assertEqual(complete.text, "译文", "Chat non-stream text")
  assertEqual(complete.reasoning, "思考", "Chat reasoning")
  assert(complete.done, "Chat finish reason")

  const image = parseOpenAIChatPayload({
    choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,QUJD" } }] }, finish_reason: "stop" }],
  })
  assertEqual(image.images[0]?.base64, "QUJD", "OpenRouter Chat image output")
  assertEqual(parseOpenAIChatPayload({ error: { message: "bad key" } }).error, "bad key", "Chat error payload")
  assertEqual(
    parseOpenAIChatPayload({ choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }).error,
    "模型输出被内容安全策略拦截",
    "Chat content filter"
  )
  assertEqual(
    parseOpenAIChatPayload({ choices: [{ message: { content: "partial" }, finish_reason: "length" }] }).error,
    "模型输出达到长度上限，翻译结果不完整",
    "Chat truncated output"
  )
  assertEqual(
    parseOpenAIChatPayload({ choices: [{ message: { refusal: "policy" }, finish_reason: "stop" }] }).error,
    "模型拒绝请求: policy",
    "Chat refusal"
  )
}

function testOpenAIResponses() {
  assertEqual(
    parseOpenAIResponsesPayload({ type: "response.output_text.delta", delta: "片段" }).text,
    "片段",
    "Responses text delta"
  )
  assertEqual(
    parseOpenAIResponsesPayload({ type: "response.reasoning_summary_text.delta", delta: "推理" }).reasoning,
    "推理",
    "Responses reasoning delta"
  )

  const complete = parseOpenAIResponsesPayload({
    status: "completed",
    output_text: "译文",
    output: [{ type: "message", content: [{ type: "output_text", text: "译文" }] }],
  })
  assertEqual(complete.text, "译文", "Responses non-stream text without duplication")
  assert(complete.done, "Responses non-stream completion")

  const image = parseOpenAIResponsesPayload({
    output: [{ type: "image_generation_call", result: "QUJD", mime_type: "image/png" }],
    status: "completed",
  })
  assertEqual(image.images[0]?.base64, "QUJD", "Responses image_generation result")

  const failed = parseOpenAIResponsesPayload({
    type: "response.failed",
    response: { error: { code: "server_error", message: "upstream failed" } },
  })
  assertEqual(failed.error, "upstream failed", "Responses failed event")

  const incomplete = parseOpenAIResponsesPayload({
    type: "response.incomplete",
    response: { incomplete_details: { reason: "max_output_tokens" } },
  })
  assert(incomplete.error?.includes("max_output_tokens"), "Responses incomplete event")
  assertEqual(
    parseOpenAIResponsesPayload({ type: "response.refusal.done", refusal: "policy" }).error,
    "模型拒绝请求: policy",
    "Responses refusal event"
  )
  assertEqual(
    parseOpenAIResponsesPayload({
      output: [{ type: "image_generation_call", status: "failed", error: { message: "safety" } }],
      status: "completed",
    }).error,
    "safety",
    "Responses image tool failure"
  )
  assertEqual(
    parseOpenAIResponsesPayload({
      type: "response.output_item.done",
      item: { type: "message", content: [{ type: "output_text", text: "完整文本" }] },
    }).text,
    "",
    "Responses output item avoids duplicate terminal text"
  )
  assertEqual(
    parseOpenAIResponsesPayload({
      type: "response.completed",
      response: { output: [{ type: "message", content: [{ type: "output_text", text: "完整文本" }] }] },
    }, { includeTerminalText: false }).text,
    "",
    "Responses completed event respects terminal fallback flag"
  )
  assertEqual(detectImageMime("/9j/AAAA", "image/png"), "image/jpeg", "Image MIME detection")
}

function testGemini() {
  const parsed = parseGeminiPayload({
    candidates: [
      {
        content: {
          parts: [
            { text: "思考", thought: true },
            { text: "译文" },
            { inlineData: { mimeType: "image/png", data: "QUJD" } },
          ],
        },
        finishReason: "STOP",
      },
    ],
  })
  assertEqual(parsed.text, "译文", "Gemini text")
  assertEqual(parsed.reasoning, "思考", "Gemini thought")
  assertEqual(parsed.images[0]?.base64, "QUJD", "Gemini inlineData image")
  assert(parsed.done, "Gemini finish reason")
  assertEqual(
    parseGeminiPayload({
      candidates: [{ content: { parts: [{ text: "partial" }] }, finishReason: "MAX_TOKENS" }],
    }).error,
    "Gemini 输出达到长度上限，翻译结果不完整",
    "Gemini truncated output"
  )
  assertEqual(parseGeminiPayload({ promptFeedback: { blockReason: "SAFETY" } }).error, "Gemini 拒绝请求: SAFETY", "Gemini safety block")
  assertEqual(
    parseGeminiPayload({
      response: { candidates: [{ content: { parts: [{ text: "包装响应" }] }, finishReason: "STOP" }] },
    }).text,
    "包装响应",
    "Wrapped Gemini response"
  )
}

function testAnthropic() {
  const nonStream = parseAnthropicPayload({
    type: "message",
    content: [{ type: "text", text: "译文" }],
    stop_reason: "end_turn",
  })
  assertEqual(nonStream.text, "译文", "Anthropic non-stream message")
  assert(nonStream.done, "Anthropic non-stream completion")
  assertEqual(
    parseAnthropicPayload({
      type: "message",
      content: [{ type: "text", text: "partial" }],
      stop_reason: "max_tokens",
    }).error,
    "Anthropic 输出达到长度上限，翻译结果不完整",
    "Anthropic non-stream truncated output"
  )

  const delta = parseAnthropicPayload(
    { type: "content_block_delta", delta: { type: "text_delta", text: "片段" } },
    "content_block_delta"
  )
  assertEqual(delta.text, "片段", "Anthropic text delta")
  assertEqual(
    parseAnthropicPayload(
      { type: "message_delta", delta: { stop_reason: "max_tokens" } },
      "message_delta"
    ).error,
    "Anthropic 输出达到长度上限，翻译结果不完整",
    "Anthropic truncated output"
  )
  assertEqual(
    parseAnthropicPayload({ type: "error", error: { message: "rate limited" } }, "error").error,
    "rate limited",
    "Anthropic error event"
  )
}

function fakeStreamingResponse(chunks: string[]): any {
  const encoder = new TextEncoder()
  let index = 0
  return {
    headers: { get: () => "" },
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true, value: undefined },
        cancel: async () => {},
        releaseLock: () => {},
      }),
    },
    text: async () => chunks.join(""),
  }
}

async function testSSEFallback() {
  let plainText = ""
  await parseSSEStream(
    fakeStreamingResponse([
      '{"choices":[{"message":{"content":"普通',
      ' JSON"},"finish_reason":"stop"}]}',
    ]),
    (message) => {
      plainText += parseOpenAIChatPayload(JSON.parse(message.data)).text
    }
  )
  assertEqual(plainText, "普通 JSON", "SSE parser falls back to chunked JSON without content type")

  let singleLineText = ""
  await parseSSEStream(
    fakeStreamingResponse(['data: {"choices":[{"message":{"content":"单行"},"finish_reason":"stop"}]}']),
    (message) => {
      singleLineText += parseOpenAIChatPayload(JSON.parse(message.data)).text
    }
  )
  assertEqual(singleLineText, "单行", "SSE parser handles data line without trailing newline")
}

function testOCRParsing() {
  const bare = extractOCRBubbles(
    '说明文字 [{"box_2d":[10,20,100,200],"translation":"你好"}] 后续说明'
  )
  assertEqual(bare.length, 1, "OCR bare JSON array")
  assertEqual(bare[0]?.translation, "你好", "OCR translation text")
  assertEqual(
    extractOCRBubbles('[{"box_2d":[100,20,10,200],"translation":"倒置坐标"}]').length,
    0,
    "OCR rejects inverted coordinates"
  )
  assertEqual(
    extractOCRBubbles('[{"box_2d":[0,20,1001,200],"translation":"越界坐标"}]').length,
    0,
    "OCR rejects out-of-range coordinates"
  )
  assertEqual(
    extractOCRBubbles('[1,2] 后续 [{"box_2d":[10,20,100,200],"translation":"真正气泡"}]').length,
    1,
    "OCR skips unrelated JSON arrays"
  )
  const forcedChunks = splitNovelChunks("无".repeat(5000), 1800)
  assert(forcedChunks.length > 1, "Novel splits long punctuation-free paragraphs")
  assert(forcedChunks.every((chunk) => chunk.length <= 1800), "Novel chunk respects target size")
}

async function main() {
  testEndpoints()
  testOpenAIChat()
  testOpenAIResponses()
  testGemini()
  testAnthropic()
  testOCRParsing()
  await testSSEFallback()
  console.log(`AI protocol regression tests passed: ${passed}`)
  Script.exit({ passed })
}

void main()
