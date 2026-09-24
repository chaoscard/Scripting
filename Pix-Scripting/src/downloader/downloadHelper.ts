import { downloadBinary } from "../api/client"
import { imageUrlOf } from "../image/imageLoader"
import { getDownloadImageQuality, loadSettings, type DownloadImageQuality } from "../store/settings"
import type { PixivIllustration } from "../types"
import type { TaskControlToken } from "./downloadTaskManager"

/**
 * 获取下载使用的图片 URL（严格遵循设置中的 downloadImageQuality）
 */
export function getDownloadImageUrl(
  illust: PixivIllustration,
  pageIndex = 0,
  customQuality?: DownloadImageQuality
): string | null {
  const quality = customQuality ?? getDownloadImageQuality()
  return imageUrlOf(illust, pageIndex, quality)
}

/**
 * 安全下载二进制图片，带有一次自动重试与可选取消控制
 */
export async function fetchImageBinaryWithRetry(
  url: string,
  retryCount = 1,
  token?: TaskControlToken
): Promise<Data | null> {
  if (!url) return null
  if (token) await token.checkOrWait()

  try {
    const data = await downloadBinary(url, undefined, token?.signal)
    if (data) return data
  } catch (err: any) {
    if (token?.isCancelled || token?.isPaused) return null
    console.log("fetchImageBinary error (retrying):", url.slice(0, 80), err?.message ?? err)
  }

  if (token) await token.checkOrWait()

  if (retryCount > 0) {
    if (token?.isCancelled || token?.isPaused) return null
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 600)
    })
    if (token) await token.checkOrWait()
    try {
      const data = await downloadBinary(url, undefined, token?.signal)
      if (data) return data
    } catch {
      if (token?.isCancelled || token?.isPaused) return null
    }
  }
  return null
}

/**
 * 主动让出 JavaScript 事件循环，让 iOS 渲染管道与手势交互得到响应
 */
export async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/**
 * 帧时间预算检测：当耗时超过预算阈值（默认 12ms，即 1 帧以内）时主动出让主线程，并返回新的起始时间戳
 */
export async function yieldIfExceeded(startTime: number, budgetMs = 12): Promise<number> {
  const now = Date.now()
  if (now - startTime >= budgetMs) {
    await yieldToMainThread()
    return Date.now()
  }
  return startTime
}

/**
 * 进度回调防抖节流器：在频繁更新时平滑限制上报频率（默认 100ms），但在首帧与结束时立即派发
 */
export function createThrottledProgress(
  onProgress?: (msg: string, current: number, total: number) => void,
  intervalMs = 100
): {
  notify: (msg: string, current: number, total: number) => void
  flush: () => void
} {
  if (!onProgress) {
    return {
      notify: () => {},
      flush: () => {},
    }
  }

  let lastTime = 0
  let pendingArgs: [string, number, number] | null = null
  let timer: any = null

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pendingArgs) {
      const [msg, current, total] = pendingArgs
      pendingArgs = null
      lastTime = Date.now()
      try {
        onProgress(msg, current, total)
      } catch (err) {
        console.log("Throttled onProgress error:", err)
      }
    }
  }

  const notify = (msg: string, current: number, total: number) => {
    pendingArgs = [msg, current, total]
    const now = Date.now()

    // 首帧 (current === 0) 或完成帧 (current >= total) 立即同步触发
    if (current === 0 || (total > 0 && current >= total)) {
      flush()
      return
    }

    if (now - lastTime >= intervalMs) {
      flush()
    } else if (!timer) {
      const waitTime = Math.max(16, intervalMs - (now - lastTime))
      timer = setTimeout(() => {
        timer = null
        flush()
      }, waitTime)
    }
  }

  return { notify, flush }
}

/**
 * 受控并发执行器（集成微任务切片出让与可控令牌检查）
 */
export async function runConcurrentTasks<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  token?: TaskControlToken
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let currentIndex = 0
  const maxConcurrency = Math.max(1, Math.min(8, limit))

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      if (token) {
        await token.checkOrWait()
      }
      const index = currentIndex++
      try {
        results[index] = await task(items[index], index)
      } catch (e: any) {
        if (e?.name === "TaskAbortError" || token?.isCancelled) {
          throw e
        }
        console.log(`Task at index ${index} failed:`, e?.message ?? e)
      }
      if (token) {
        await token.checkOrWait()
      }
      // 每次完成一个任务主动出让一下微任务，防止多个 Worker 密集回调挤占主线程
      await yieldToMainThread()
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export interface ExportResult {
  success: boolean
  path?: string | null
  isPartial?: boolean
  downloadedPages: number
  totalPages: number
  failedPages?: number[]
  error?: string
}

/**
 * 从二进制数据或文件头部高效嗅探图片尺寸（PNG / JPEG / WebP / GIF）
 * 仅解析文件前几个字节的 Header，绝不将未经压缩的完整位图解码入内存，
 * 避免在批量下载几十上百张漫画时产生数百兆的瞬时内存波峰与 Jetsam OOM 风险。
 */
export function sniffImageDimensions(
  source: Data | Uint8Array | string
): { width: number; height: number } | null {
  try {
    let bytes: Uint8Array | null = null

    if (typeof source === "string") {
      const d = Data.fromFile(source)
      if (!d || d.size < 16) return null
      const headerData = d.size > 65536 ? d.slice(0, 65536) : d
      bytes = headerData.toUint8Array()
    } else if (source instanceof Uint8Array) {
      bytes = source
    } else if (source && typeof (source as Data).toUint8Array === "function") {
      const d = source as Data
      const headerData = d.size > 65536 ? d.slice(0, 65536) : d
      bytes = headerData.toUint8Array()
    }

    if (!bytes || bytes.length < 16) return null

    // 1. PNG 探测: 前 8 字节为 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a &&
      bytes.length >= 24
    ) {
      const width =
        ((bytes[16] << 24) >>> 0) +
        (bytes[17] << 16) +
        (bytes[18] << 8) +
        bytes[19]
      const height =
        ((bytes[20] << 24) >>> 0) +
        (bytes[21] << 16) +
        (bytes[22] << 8) +
        bytes[23]
      if (width > 0 && height > 0) {
        return { width, height }
      }
    }

    // 2. JPEG 探测: 前 2 字节为 FF D8 (SOI)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2
      const len = bytes.length

      while (offset < len) {
        while (offset < len && bytes[offset] !== 0xff) {
          offset++
        }
        while (offset < len && bytes[offset] === 0xff) {
          offset++
        }
        if (offset >= len) break

        const marker = bytes[offset]
        offset++

        // 遇到图像扫描开始 SOS (0xDA) 或文件结束 EOI (0xD9)，说明已超出元数据区
        if (marker === 0xda || marker === 0xd9) break

        if (offset + 1 >= len) break
        const segmentLength = (bytes[offset] << 8) | bytes[offset + 1]
        if (segmentLength < 2) break

        // 识别 SOF 帧开始标记
        const isSOF =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)

        if (isSOF && offset + segmentLength <= len) {
          if (segmentLength >= 7 && offset + 6 < len) {
            const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
            const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
            if (width > 0 && height > 0) {
              return { width, height }
            }
          }
        }

        offset += segmentLength
      }
    }

    // 3. GIF 探测: "GIF87a" 或 "GIF89a"
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes.length >= 10
    ) {
      const width = bytes[6] | (bytes[7] << 8)
      const height = bytes[8] | (bytes[9] << 8)
      if (width > 0 && height > 0) {
        return { width, height }
      }
    }

    // 4. WebP 探测: "RIFF" .... "WEBP"
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes.length >= 30 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20) {
        if (bytes.length >= 30) {
          const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff
          const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff
          if (width > 0 && height > 0) return { width, height }
        }
      }
      if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x4c) {
        if (bytes.length >= 25 && bytes[20] === 0x2f) {
          const b1 = bytes[21]
          const b2 = bytes[22]
          const b3 = bytes[23]
          const b4 = bytes[24]
          const width = 1 + (((b2 & 0x3f) << 8) | b1)
          const height = 1 + (((b4 & 0xf) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
          if (width > 0 && height > 0) return { width, height }
        }
      }
    }
  } catch (err: any) {
    console.log("sniffImageDimensions parse error:", err?.message ?? err)
  }

  return null
}
