/**
 * 健壮的 Server-Sent Events (SSE) 流式与纯 JSON 响应解析器
 * 兼容标准 SSE 协议（event + data）、单行 data 模式、chunk 粘包/断包处理，
 * 并支持业务级提前终止（onMessage 返回 true）、[DONE] 信号提前释放与普通 JSON 降级解析
 */
import { Response } from "scripting"
import type { SignalLike } from "./types"

export interface SSEMessage {
  event?: string
  data: string
}

export async function parseSSEStream(
  response: Response,
  onMessage: (message: SSEMessage) => boolean | void,
  signal?: SignalLike
): Promise<void> {
  const contentType = response.headers?.get?.("content-type") || ""

  // 若明确为普通 JSON 响应，直接读取全文解析
  if (contentType.includes("application/json") || !response.body) {
    const fullText = await response.text()
    if (!parseSSETxt(fullText, onMessage)) {
      const trimmed = fullText.trim()
      if (trimmed) {
        onMessage({ data: trimmed })
      }
    }
    return
  }

  let reader: any = null
  try {
    reader = response.body.getReader()
  } catch {
    // 降级为 text 读取
    const fullText = await response.text()
    if (!parseSSETxt(fullText, onMessage)) {
      const trimmed = fullText.trim()
      if (trimmed) {
        onMessage({ data: trimmed })
      }
    }
    return
  }

  const decoder = new TextDecoder("utf-8")
  let buffer = ""

  let currentEvent: string | undefined = undefined
  let currentDataLines: string[] = []

  try {
    while (true) {
      if (signal?.aborted) {
        try {
          await reader.cancel()
        } catch {}
        break
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r\n|\r|\n/)
      buffer = lines.pop() ?? ""

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "")
        const trimmed = line.trim()

        if (!trimmed) {
          if (currentDataLines.length > 0) {
            const dataStr = currentDataLines.join("\n")
            if (dataStr === "[DONE]") {
              try {
                await reader.cancel()
              } catch {}
              return
            }
            const shouldStop = onMessage({ event: currentEvent, data: dataStr })
            if (shouldStop) {
              try {
                await reader.cancel()
              } catch {}
              return
            }
            currentEvent = undefined
            currentDataLines = []
          }
          continue
        }

        if (trimmed.startsWith(":")) {
          // SSE 注释 / 心跳保活
          continue
        }

        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          const dataContent = line.slice(5).replace(/^ /, "")
          currentDataLines.push(dataContent)
        }
      }
    }

    if (buffer.trim()) {
      const line = buffer.replace(/\r$/, "")
      if (line.startsWith("data:")) {
        const dataContent = line.slice(5).replace(/^ /, "")
        currentDataLines.push(dataContent)
      }
      if (currentDataLines.length > 0) {
        const dataStr = currentDataLines.join("\n")
        if (dataStr !== "[DONE]") {
          onMessage({ event: currentEvent, data: dataStr })
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {}
  }
}

function parseSSETxt(
  fullText: string,
  onMessage: (message: SSEMessage) => boolean | void
): boolean {
  const lines = fullText.split(/\r\n|\r|\n/)
  let currentEvent: string | undefined = undefined
  let currentDataLines: string[] = []
  let hasDispatched = false

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "")
    const trimmed = line.trim()

    if (!trimmed) {
      if (currentDataLines.length > 0) {
        const dataStr = currentDataLines.join("\n")
        if (dataStr === "[DONE]") {
          return true
        }
        const shouldStop = onMessage({ event: currentEvent, data: dataStr })
        hasDispatched = true
        if (shouldStop) {
          return true
        }
        currentEvent = undefined
        currentDataLines = []
      }
      continue
    }

    if (trimmed.startsWith(":")) continue

    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim()
    } else if (line.startsWith("data:")) {
      const dataContent = line.slice(5).replace(/^ /, "")
      currentDataLines.push(dataContent)
    }
  }

  if (currentDataLines.length > 0) {
    const dataStr = currentDataLines.join("\n")
    if (dataStr !== "[DONE]") {
      onMessage({ event: currentEvent, data: dataStr })
      hasDispatched = true
    }
  }

  return hasDispatched
}
