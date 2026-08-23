import { loadSettings } from "../store/settings"

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

/**
 * 将图片保存至系统相册，并自动归类至专属相簿
 */
export async function saveImageToPixivAlbum(
  source: string | Data,
  fileName?: string
): Promise<boolean> {
  try {
    let success = false
    if (typeof source === "string") {
      success = await Photos.savePhoto(source, { fileName })
    } else {
      success = await Photos.savePhoto(source, { fileName })
    }
    if (!success) return false

    // 获取最新存入的一张照片并加入专属相簿
    try {
      const album = await getOrCreatePixivAlbum()
      if (album) {
        const latestAssets = await Photos.fetchAssets({ limit: 1 })
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
}

/**
 * 将动图 MP4 视频保存至系统相册，并自动归类至专属相簿
 */
export async function saveVideoToPixivAlbum(
  videoPath: string,
  fileName?: string
): Promise<boolean> {
  try {
    const success = await Photos.saveVideo(videoPath, { fileName })
    if (!success) return false

    // 获取最新存入的视频资产并加入专属相簿
    try {
      const album = await getOrCreatePixivAlbum()
      if (album) {
        const latestAssets = await Photos.fetchAssets({ limit: 1 })
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
}
