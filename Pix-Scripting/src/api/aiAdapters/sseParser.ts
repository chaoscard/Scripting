/**
 * 健壮的 Server-Sent Events (SSE) 流式与纯 JSON 响应解析器
 * 兼容标准 SSE 协议（event + data）、单行 data 模式、chunk 粘包/断包处理，
 * 并支持业务级提前终止（onMessage 返回 true）、[DONE] 信号提前释放与普通 JSON 降级解析
 */
import { Response, AbortController } from "scripting"
import type { SignalLike } from "./types"

export interface SSEMessage {
  event?: string
  data: string
}

/**
 * 创建与外部 Signal 动态联动的 AbortController（支持响应式即时中断与资源清理）
 */
export function createLinkedAbortController(externalSignal?: SignalLike, timeoutMs?: number): {
  controller: AbortController
  cleanup: () => void
} {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      try {
        controller.abort()
      } catch {}
    }, timeoutMs)
  }

  if (!externalSignal) {
    return {
      controller,
      cleanup: () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
      },
    }
  }

  if (externalSignal.aborted) {
    controller.abort()
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    return { controller, cleanup: () => {} }
  }

  let isCleanedUp = false

  const onAbort = () => {
    if (!isCleanedUp) {
      try {
        controller.abort()
      } catch {}
    }
  }

  let unregisterCustom: (() => void) | undefined

  if (typeof externalSignal.onAbort === "function") {
    unregisterCustom = externalSignal.onAbort(onAbort)
  } else if (typeof externalSignal.addEventListener === "function") {
    externalSignal.addEventListener("abort", onAbort)
  }

  const cleanup = () => {
    isCleanedUp = true
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (unregisterCustom) {
      try {
        unregisterCustom()
      } catch {}
    } else if (typeof externalSignal.removeEventListener === "function") {
      try {
        externalSignal.removeEventListener("abort", onAbort)
      } catch {}
    }
  }

  return { controller, cleanup }
}

export async function parseSSEStream(
  response: Response,
  onMessage: (message: SSEMessage) => boolean | void,
  signal?: SignalLike | any
): Promise<void> {
  const contentType = response.headers?.get?.("content-type") || ""

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
    const fullText = await response.text()
    if (!parseSSETxt(fullText, onMessage)) {
      const trimmed = fullText.trim()
      if (trimmed) {
        onMessage({ data: trimmed })
      }
    }
    return
  }

  let abortResolver: (() => void) | null = null
  const abortPromise = new Promise<{ done: true; value?: undefined }>((resolve) => {
    abortResolver = () => resolve({ done: true })
    if ((signal as any)?.aborted) {
      resolve({ done: true })
    }
  })

  let isStreamFinished = false
  const cancelReaderOnAbort = () => {
    if (!isStreamFinished) {
      abortResolver?.()
      if (reader) {
        try {
          reader.cancel("Abort requested").catch(() => {})
        } catch {}
      }
    }
  }

  let unregisterAbort: (() => void) | undefined
  if (signal) {
    if ((signal as any).aborted) {
      cancelReaderOnAbort()
    } else if (typeof (signal as any).onAbort === "function") {
      unregisterAbort = (signal as any).onAbort(cancelReaderOnAbort)
    } else if (typeof (signal as any).addEventListener === "function") {
      (signal as any).addEventListener("abort", cancelReaderOnAbort)
    }
  }

  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  let rawText = ""
  let sawSSEField = false

  let currentEvent: string | undefined = undefined
  let currentDataLines: string[] = []

  try {
    while (true) {
      if ((signal as any)?.aborted) {
        try {
          await reader.cancel()
        } catch {}
        break
      }

      const { done, value } = await Promise.race([
        reader.read(),
        abortPromise,
      ])
      if (done || (signal as any)?.aborted) break

      const decoded = decoder.decode(value, { stream: true })
      rawText += decoded
      buffer += decoded
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
          continue
        }

        if (line.startsWith("event:")) {
          sawSSEField = true
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          sawSSEField = true
          const dataContent = line.slice(5).replace(/^ /, "")
          currentDataLines.push(dataContent)
        }
      }
      if (sawSSEField) rawText = ""
    }

    const decoderTail = decoder.decode()
    if (decoderTail) {
      rawText += decoderTail
      buffer += decoderTail
    }

    if (!sawSSEField && !(signal as any)?.aborted) {
      const trimmed = rawText.trim()
      if (trimmed && !parseSSETxt(trimmed, onMessage)) {
        onMessage({ data: trimmed })
      }
      return
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
    isStreamFinished = true
    if (unregisterAbort) {
      try {
        unregisterAbort()
      } catch {}
    } else if (signal && typeof (signal as any).removeEventListener === "function") {
      try {
        (signal as any).removeEventListener("abort", cancelReaderOnAbort)
      } catch {}
    }
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
