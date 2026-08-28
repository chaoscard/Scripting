/**
 * 健壮的 Server-Sent Events (SSE) 流式解析器
 * 兼容标准 SSE 协议（event + data）、单行 data 模式以及 chunk 粘包/断包处理
 */
import { Response } from "scripting"
import type { SignalLike } from "./types"

export interface SSEMessage {
  event?: string
  data: string
}

export async function parseSSEStream(
  response: Response,
  onMessage: (message: SSEMessage) => void,
  signal?: SignalLike
): Promise<void> {
  if (!response.body) {
    const fullText = await response.text()
    parseSSETxt(fullText, onMessage)
    return
  }

  const reader = response.body.getReader()
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

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          if (currentDataLines.length > 0) {
            const dataStr = currentDataLines.join("\n")
            onMessage({ event: currentEvent, data: dataStr })
            currentEvent = undefined
            currentDataLines = []
          }
          continue
        }

        if (trimmed.startsWith(":")) {
          continue
        }

        if (trimmed.startsWith("event:")) {
          currentEvent = trimmed.slice(6).trim()
        } else if (trimmed.startsWith("data:")) {
          currentDataLines.push(trimmed.slice(5).trim())
        }
      }
    }

    if (buffer.trim()) {
      const line = buffer.trim()
      if (line.startsWith("data:")) {
        currentDataLines.push(line.slice(5).trim())
      }
      if (currentDataLines.length > 0) {
        onMessage({ event: currentEvent, data: currentDataLines.join("\n") })
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
  onMessage: (message: SSEMessage) => void
): void {
  const lines = fullText.split(/\r\n|\r|\n/)
  let currentEvent: string | undefined = undefined
  let currentDataLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (currentDataLines.length > 0) {
        onMessage({ event: currentEvent, data: currentDataLines.join("\n") })
        currentEvent = undefined
        currentDataLines = []
      }
      continue
    }

    if (trimmed.startsWith(":")) continue

    if (trimmed.startsWith("event:")) {
      currentEvent = trimmed.slice(6).trim()
    } else if (trimmed.startsWith("data:")) {
      currentDataLines.push(trimmed.slice(5).trim())
    }
  }

  if (currentDataLines.length > 0) {
    onMessage({ event: currentEvent, data: currentDataLines.join("\n") })
  }
}
