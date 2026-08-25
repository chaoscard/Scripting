import { downloadBinary } from "../api/client"
import { imageUrlOf } from "../image/imageLoader"
import { getDownloadImageQuality, loadSettings, type DownloadImageQuality } from "../store/settings"
import type { PixivIllustration } from "../types"

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
 * 安全下载二进制图片，带有一次自动重试
 */
export async function fetchImageBinaryWithRetry(
  url: string,
  retryCount = 1
): Promise<Data | null> {
  if (!url) return null
  try {
    const data = await downloadBinary(url)
    if (data) return data
  } catch (err: any) {
    console.log("fetchImageBinary error (retrying):", url.slice(0, 80), err?.message ?? err)
  }

  if (retryCount > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 600)
    })
    try {
      const data = await downloadBinary(url)
      if (data) return data
    } catch {}
  }
  return null
}

/**
 * 受控并发执行器
 */
export async function runConcurrentTasks<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let currentIndex = 0
  const maxConcurrency = Math.max(1, Math.min(8, limit))

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++
      try {
        results[index] = await task(items[index], index)
      } catch (e: any) {
        console.log(`Task at index ${index} failed:`, e?.message ?? e)
      }
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
