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
    const data = await downloadBinary(url)
    if (data) return data
  } catch (err: any) {
    console.log("fetchImageBinary error (retrying):", url.slice(0, 80), err?.message ?? err)
  }

  if (token) await token.checkOrWait()

  if (retryCount > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 600)
    })
    if (token) await token.checkOrWait()
    try {
      const data = await downloadBinary(url)
      if (data) return data
    } catch {}
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
