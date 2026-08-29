import { buildUgoira, prepareUgoira } from "../ugoira/ugoira"
import { saveImageToPixivAlbum, saveVideoToPixivAlbum } from "./photoAlbum"
import { getCategoryDirectory, sanitizeFileName } from "./directoryResolver"
import { loadSettings, type UgoiraExportFormat } from "../store/settings"
import type { PixivIllustration } from "../types"

export interface UgoiraExportResult {
  success: boolean
  mp4Path: string | null
  format?: "mp4" | "gif" | "zip"
  savedPath?: string
  error?: string
}

/**
 * 将 Ugoira 动图合成为 MP4 或 GIF 并保存至专属相簿 Pix-Scripting
 */
export async function exportUgoiraToAlbum(
  illust: PixivIllustration,
  onProgress?: (msg: string) => void,
  formatOverride?: UgoiraExportFormat
): Promise<UgoiraExportResult> {
  const format: UgoiraExportFormat = formatOverride ?? loadSettings().ugoiraExportFormat ?? "mp4"
  try {
    const author = illust.user?.name || "Unknown"
    const safeTitle = sanitizeFileName(`${illust.title}_${author}_${illust.id}`)

    if (format === "gif") {
      onProgress?.("正在通过 FFmpeg 合成高质量 GIF 动图...")
      const ugoiraRes = await buildUgoira(illust.id, "gif")
      if (!ugoiraRes || !ugoiraRes.mp4Path) {
        return { success: false, mp4Path: null, format: "gif", error: "GIF 动图合成失败" }
      }

      onProgress?.("正在保存 GIF 至相簿...")
      const fileName = `${safeTitle}.gif`
      const saved = await saveImageToPixivAlbum(ugoiraRes.mp4Path, fileName)
      if (!saved) {
        return { success: false, mp4Path: ugoiraRes.mp4Path, format: "gif", error: "保存相册失败" }
      }
      return { success: true, mp4Path: ugoiraRes.mp4Path, format: "gif", savedPath: ugoiraRes.mp4Path }
    } else {
      onProgress?.("正在通过 FFmpeg 合成高清 MP4 视频...")
      const ugoiraRes = await buildUgoira(illust.id, "mp4")
      if (!ugoiraRes || !ugoiraRes.mp4Path) {
        return { success: false, mp4Path: null, format: "mp4", error: "MP4 视频合成失败" }
      }

      onProgress?.("正在保存 MP4 至相簿...")
      const fileName = `${safeTitle}.mp4`
      const saved = await saveVideoToPixivAlbum(ugoiraRes.mp4Path, fileName)
      if (!saved) {
        return { success: false, mp4Path: ugoiraRes.mp4Path, format: "mp4", error: "保存相册失败" }
      }
      return { success: true, mp4Path: ugoiraRes.mp4Path, format: "mp4", savedPath: ugoiraRes.mp4Path }
    }
  } catch (err: any) {
    console.log("exportUgoiraToAlbum error:", err?.message ?? err)
    return { success: false, mp4Path: null, format, error: err?.message ?? String(err) }
  }
}

/**
 * 将动图原生 ZIP 压缩帧包导出保存至文件存储目录
 */
export async function exportUgoiraZip(
  illust: PixivIllustration,
  onProgress?: (msg: string) => void
): Promise<UgoiraExportResult> {
  try {
    onProgress?.("正在准备动图原生 ZIP 帧包...")
    const prep = await prepareUgoira(illust.id)
    if (!prep) {
      return { success: false, mp4Path: null, format: "zip", error: "动图资源准备失败" }
    }

    const author = illust.user?.name || "Unknown"
    const safeTitle = sanitizeFileName(`${illust.title}_${author}_${illust.id}`)
    const targetDir = getCategoryDirectory("illustrations")
    const destZipPath = `${targetDir}/${safeTitle}.zip`

    if (prep.zipPath && FileManager.existsSync(prep.zipPath)) {
      if (FileManager.existsSync(destZipPath)) {
        try { FileManager.removeSync(destZipPath) } catch {}
      }
      FileManager.copyFileSync(prep.zipPath, destZipPath)
    } else if (FileManager.existsSync(prep.framesDir)) {
      await FileManager.zip(prep.framesDir, destZipPath, false)
    } else {
      return { success: false, mp4Path: null, format: "zip", error: "动图帧数据未就绪" }
    }

    return {
      success: true,
      mp4Path: destZipPath,
      format: "zip",
      savedPath: destZipPath,
    }
  } catch (err: any) {
    console.log("exportUgoiraZip error:", err?.message ?? err)
    return { success: false, mp4Path: null, format: "zip", error: err?.message ?? String(err) }
  }
}
