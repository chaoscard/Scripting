import { getDownloadImageQuality, loadSettings, type DownloadImageQuality } from "../store/settings"
import { cachedFilePath, imageUrlOf } from "../image/imageLoader"
import { fetchImageBinaryWithRetry, runConcurrentTasks } from "./downloadHelper"
import type { PixivIllustration } from "../types"

/**
 * 获取或自动创建专属相簿（默认 "Pix-Scripting"）
 */
export async function getOrCreatePixivAlbum(customTitle?: string): Promise<PHAssetCollection | null> {
  const albumTitle = (customTitle ?? loadSettings().downloadPhotoAlbumName ?? "Pix-Scripting").trim()
  if (!albumTitle) return null

  try {
    const albums = await Photos.fetchAlbums({ type: "album" })
    const existing = albums.find((a) => a.title === albumTitle)
    if (existing) {
      return existing
    }
    const created = await Photos.createAlbum(albumTitle)
    return created
  } catch (err: any) {
    console.log("getOrCreatePixivAlbum error:", err?.message ?? err)
    return null
  }
}

// 串行化相册资产保存与归类队列，消除并发保存时的反查资产竞态
let albumSaveQueue: Promise<unknown> = Promise.resolve()

async function enqueueAlbumOperation<T>(op: () => Promise<T>): Promise<T> {
  const prev = albumSaveQueue
  let resolveCurrent: () => void
  const current = new Promise<void>((res) => {
    resolveCurrent = res
  })
  albumSaveQueue = prev.then(() => current, () => current)
  try {
    await prev
    return await op()
  } finally {
    resolveCurrent!()
  }
}

/**
 * 将图片保存至系统相册，并自动归类至专属相簿（串行化保护与时间窗口匹配）
 */
export async function saveImageToPixivAlbum(
  source: string | Data,
  fileName?: string
): Promise<boolean> {
  return enqueueAlbumOperation(async () => {
    try {
      const beforeTimestamp = Date.now() - 3000
      let success = false
      if (typeof source === "string") {
        success = await Photos.savePhoto(source, { fileName })
      } else {
        success = await Photos.savePhoto(source, { fileName })
      }
      if (!success) return false

      // 串行化反查本次存入的最新照片并加入专属相簿
      try {
        const album = await getOrCreatePixivAlbum()
        if (album) {
          const latestAssets = await Photos.fetchAssets({
            mediaType: "image",
            limit: 1,
            createdAfter: beforeTimestamp,
          })
          if (latestAssets && latestAssets.length > 0) {
            await album.addAssets([latestAssets[0]])
          }
        }
      } catch (albumErr: any) {
        console.log("add image to album error (saved to main library):", albumErr?.message ?? albumErr)
      }

      return true
    } catch (err: any) {
      console.log("saveImageToPixivAlbum error:", err?.message ?? err)
      return false
    }
  })
}

/**
 * 将动图 MP4 视频保存至系统相册，并自动归类至专属相簿（串行化保护与时间窗口匹配）
 */
export async function saveVideoToPixivAlbum(
  videoPath: string,
  fileName?: string
): Promise<boolean> {
  return enqueueAlbumOperation(async () => {
    try {
      const beforeTimestamp = Date.now() - 3000
      const success = await Photos.saveVideo(videoPath, { fileName })
      if (!success) return false

      // 串行化反查本次存入的视频资产并加入专属相簿
      try {
        const album = await getOrCreatePixivAlbum()
        if (album) {
          const latestAssets = await Photos.fetchAssets({
            mediaType: "video",
            limit: 1,
            createdAfter: beforeTimestamp,
          })
          if (latestAssets && latestAssets.length > 0) {
            await album.addAssets([latestAssets[0]])
          }
        }
      } catch (albumErr: any) {
        console.log("add video to album error (saved to main library):", albumErr?.message ?? albumErr)
      }

      return true
    } catch (err: any) {
      console.log("saveVideoToPixivAlbum error:", err?.message ?? err)
      return false
    }
  })
}

/**
 * 专用于将插画（单页/多页）下载并存入系统相册的独立通道
 * 优先复用前台已命中的磁盘缓存；若未缓存则直接流式下载二进制 Data 入相册，不污染浏览图片缓存 ImageCache
 */
export async function downloadIllustToAlbum(
  illust: PixivIllustration,
  downloadQuality?: DownloadImageQuality,
  onProgress?: (current: number, total: number) => void
): Promise<boolean> {
  const quality = downloadQuality ?? getDownloadImageQuality()
  const pageCount = Math.max(1, illust.page_count || illust.meta_pages?.length || 1)
  const tasks: { pageIndex: number; url: string }[] = []

  for (let i = 0; i < pageCount; i++) {
    const url = imageUrlOf(illust, i, quality)
    if (url) {
      tasks.push({ pageIndex: i + 1, url })
    }
  }

  if (tasks.length === 0) return false

  let successCount = 0
  await runConcurrentTasks(tasks, 3, async (task) => {
    const fileName = `pixiv_${illust.id}_p${task.pageIndex}`
    try {
      const cached = cachedFilePath(task.url)
      if (cached) {
        const ok = await saveImageToPixivAlbum(cached, fileName)
        if (ok) successCount++
      } else {
        const data = await fetchImageBinaryWithRetry(task.url)
        if (data) {
          const ok = await saveImageToPixivAlbum(data, fileName)
          if (ok) successCount++
        }
      }
    } catch (err: any) {
      console.log(`downloadIllustToAlbum error for page ${task.pageIndex}:`, err?.message ?? err)
    }
    onProgress?.(task.pageIndex, tasks.length)
  })

  return successCount > 0
}
