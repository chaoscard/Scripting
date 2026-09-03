import { getDownloadImageQuality, loadSettings, type DownloadImageQuality } from "../store/settings"
import { cachedFilePath, imageUrlOf } from "../image/imageLoader"
import { fetchImageBinaryWithRetry, runConcurrentTasks } from "./downloadHelper"
import type { PixivIllustration } from "../types"

/**
 * 相册保存专用后台保活引用计数管理器
 * 确保在写入相册、反查索引以及后台并发下载期间系统不被挂起
 */
let albumKeepAliveRefCount = 0

export async function acquireAlbumKeepAlive(): Promise<void> {
  albumKeepAliveRefCount++
  if (albumKeepAliveRefCount === 1) {
    try {
      if (typeof BackgroundKeeper !== "undefined" && typeof BackgroundKeeper.keepAlive === "function") {
        await BackgroundKeeper.keepAlive()
      }
    } catch (e: any) {
      console.log("acquireAlbumKeepAlive error:", e?.message ?? e)
    }
  }
}

export async function releaseAlbumKeepAlive(): Promise<void> {
  albumKeepAliveRefCount = Math.max(0, albumKeepAliveRefCount - 1)
  if (albumKeepAliveRefCount === 0) {
    try {
      if (typeof BackgroundKeeper !== "undefined" && typeof BackgroundKeeper.stopKeepAlive === "function") {
        await BackgroundKeeper.stopKeepAlive()
      }
    } catch (e: any) {
      console.log("releaseAlbumKeepAlive error:", e?.message ?? e)
    }
  }
}

/**
 * 在后台保活守护下执行异步操作
 */
export async function withAlbumKeepAlive<T>(action: () => Promise<T>): Promise<T> {
  await acquireAlbumKeepAlive()
  try {
    return await action()
  } finally {
    await releaseAlbumKeepAlive()
  }
}

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
 * 精准反查刚存入的资产（通过保存前已知 ID 集合比对 + 轮询微重试，包容 iOS 退后台索引延迟与 EXIF 拍摄时间差异）
 */
async function findNewlySavedAsset(
  mediaType: "image" | "video",
  knownBeforeIds: Set<string>,
  maxRetries = 3
): Promise<PHAsset | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const candidates = await Photos.fetchAssets({
        mediaType,
        limit: 12,
      })
      if (candidates && candidates.length > 0) {
        // 优先找出不在保存前快照中的新资产
        const newAsset = candidates.find((a) => !knownBeforeIds.has(a.localIdentifier))
        if (newAsset) {
          return newAsset
        }
      }
    } catch (e: any) {
      console.log(`findNewlySavedAsset attempt ${attempt} error:`, e?.message ?? e)
    }

    if (attempt < maxRetries) {
      // 阶梯等待微重试（100ms, 200ms, 300ms），给予 iOS assetsd 充足的后台索引建立时间
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 100 * (attempt + 1)))
    }
  }

  // 保底容错：若未比对出差异（例如首次授权冷启动或系统极速刷新），回退至最新的一张资产
  try {
    const fallback = await Photos.fetchAssets({
      mediaType,
      limit: 1,
    })
    return fallback?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * 将图片保存至系统相册，并自动归类至专属相簿（保活守护、资产差量比对与微重试）
 */
export async function saveImageToPixivAlbum(
  source: string | Data,
  fileName?: string
): Promise<boolean> {
  return withAlbumKeepAlive(async () => {
    return enqueueAlbumOperation(async () => {
      try {
        // 1. 保存前记录最新资产快照，用于差量比对精准命中刚存入的照片
        let beforeIds = new Set<string>()
        try {
          const beforeAssets = await Photos.fetchAssets({
            mediaType: "image",
            limit: 12,
          })
          beforeIds = new Set((beforeAssets ?? []).map((a) => a.localIdentifier))
        } catch (snapErr: any) {
          console.log("saveImageToPixivAlbum snapshot error:", snapErr?.message ?? snapErr)
        }

        // 2. 写入系统相册
        let success = false
        if (typeof source === "string") {
          success = await Photos.savePhoto(source, { fileName })
        } else {
          success = await Photos.savePhoto(source, { fileName })
        }
        if (!success) return false

        // 3. 差量比对反查刚存入的资产并加入专属相簿
        try {
          const album = await getOrCreatePixivAlbum()
          if (album) {
            const newlySaved = await findNewlySavedAsset("image", beforeIds)
            if (newlySaved) {
              await album.addAssets([newlySaved])
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
  })
}

/**
 * 将动图 MP4 视频保存至系统相册，并自动归类至专属相簿（保活守护、资产差量比对与微重试）
 */
export async function saveVideoToPixivAlbum(
  videoPath: string,
  fileName?: string
): Promise<boolean> {
  return withAlbumKeepAlive(async () => {
    return enqueueAlbumOperation(async () => {
      try {
        // 1. 保存前记录最新视频资产快照
        let beforeIds = new Set<string>()
        try {
          const beforeAssets = await Photos.fetchAssets({
            mediaType: "video",
            limit: 12,
          })
          beforeIds = new Set((beforeAssets ?? []).map((a) => a.localIdentifier))
        } catch (snapErr: any) {
          console.log("saveVideoToPixivAlbum snapshot error:", snapErr?.message ?? snapErr)
        }

        // 2. 写入系统相册
        const success = await Photos.saveVideo(videoPath, { fileName })
        if (!success) return false

        // 3. 差量比对反查刚存入的视频并加入专属相簿
        try {
          const album = await getOrCreatePixivAlbum()
          if (album) {
            const newlySaved = await findNewlySavedAsset("video", beforeIds)
            if (newlySaved) {
              await album.addAssets([newlySaved])
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
  })
}

/**
 * 专用于将插画（单页/多页）下载并存入系统相册的独立通道
 * 全流程持有系统后台保活令牌，包容退后台切出与锁屏场景；
 * 优先复用前台已命中的磁盘缓存；若未缓存则直接流式下载二进制 Data 入相册，不污染浏览图片缓存 ImageCache
 */
export async function downloadIllustToAlbum(
  illust: PixivIllustration,
  downloadQuality?: DownloadImageQuality,
  onProgress?: (current: number, total: number) => void
): Promise<boolean> {
  return withAlbumKeepAlive(async () => {
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
  })
}
