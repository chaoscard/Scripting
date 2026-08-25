import { buildUgoira } from "../ugoira/ugoira"
import { saveVideoToPixivAlbum } from "./photoAlbum"
import { sanitizeFileName } from "./directoryResolver"
import type { PixivIllustration } from "../types"

export interface UgoiraExportResult {
  success: boolean
  mp4Path: string | null
  error?: string
}

/**
 * 将 Ugoira 动图合成为高清 MP4 视频并保存至专属相簿 Pix-Scripting
 */
export async function exportUgoiraToAlbum(
  illust: PixivIllustration,
  onProgress?: (msg: string) => void
): Promise<UgoiraExportResult> {
  try {
    onProgress?.("正在下载动图帧数据并合成为 MP4...")
    const ugoiraRes = await buildUgoira(illust.id)
    if (!ugoiraRes || !ugoiraRes.mp4Path) {
      return { success: false, mp4Path: null, error: "动图合成失败" }
    }

    onProgress?.("正在保存至相簿...")
    const author = illust.user?.name || "Unknown"
    const safeTitle = sanitizeFileName(`${illust.title}_${author}_${illust.id}`)
    const fileName = `${safeTitle}.mp4`

    const saved = await saveVideoToPixivAlbum(ugoiraRes.mp4Path, fileName)
    if (!saved) {
      return { success: false, mp4Path: ugoiraRes.mp4Path, error: "保存相册失败" }
    }

    return { success: true, mp4Path: ugoiraRes.mp4Path }
  } catch (err: any) {
    console.log("exportUgoiraToAlbum error:", err?.message ?? err)
    return { success: false, mp4Path: null, error: err?.message ?? String(err) }
  }
}
