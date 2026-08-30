import { buildUgoira, prepareUgoira } from "../ugoira/ugoira"
import { saveImageToPixivAlbum, saveVideoToPixivAlbum } from "./photoAlbum"
import { getCategoryDirectory, sanitizeFileName } from "./directoryResolver"
import { notifyDownloadFilesChanged } from "./downloadFileManager"
import { loadSettings, type UgoiraExportFormat } from "../store/settings"
import { publishPreparedFile } from "../store/safeFile"
import { yieldToMainThread, yieldIfExceeded } from "./downloadHelper"
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
 * 将动图原始 ZIP 压缩帧包（包含所有帧与完整元数据 info.json）导出保存至文件存储目录
 */
export async function exportUgoiraZip(
  illust: PixivIllustration,
  onProgress?: (msg: string) => void
): Promise<UgoiraExportResult> {
  const tempDir = `${getCategoryDirectory("temp")}/zip_ugoira_${illust.id}_${Date.now()}`
  const tempZipPath = `${tempDir}.zip`

  try {
    onProgress?.("正在准备动图序列帧资源...")
    const prep = await prepareUgoira(illust.id)
    if (!prep || !prep.frames || prep.frames.length === 0) {
      return { success: false, mp4Path: null, format: "zip", error: "动图资源准备失败" }
    }

    const author = illust.user?.name || "Unknown"
    const safeTitle = sanitizeFileName(`${illust.title}_${author}_${illust.id}`)
    const targetDir = getCategoryDirectory("ugoira")
    if (!FileManager.existsSync(targetDir)) {
      try { FileManager.createDirectorySync(targetDir, true) } catch {}
    }
    const destZipPath = `${targetDir}/${safeTitle}.zip`

    FileManager.createDirectorySync(tempDir, true)

    // 1. 复制所有帧图像文件至临时打包目录
    onProgress?.("正在整理动图序列帧...")
    let timeSliceFrames = Date.now()
    for (const frame of prep.frames) {
      const srcFramePath = `${prep.framesDir}/${frame.file}`
      const destFramePath = `${tempDir}/${frame.file}`
      if (FileManager.existsSync(srcFramePath)) {
        FileManager.copyFileSync(srcFramePath, destFramePath)
      }
      timeSliceFrames = await yieldIfExceeded(timeSliceFrames, 12)
    }

    // 2. 写入 info.json 元数据（包含作品基础信息与动图帧率延迟结构）
    onProgress?.("正在写入动图元数据 info.json...")
    const metaJson = {
      id: illust.id,
      title: illust.title,
      type: "ugoira",
      caption: illust.caption,
      user: {
        id: illust.user?.id,
        name: illust.user?.name,
        account: illust.user?.account,
      },
      tags: illust.tags?.map((t: any) => t.name) ?? [],
      create_date: illust.create_date,
      page_count: illust.page_count || prep.frames.length,
      width: illust.width || prep.width,
      height: illust.height || prep.height,
      total_bookmarks: illust.total_bookmarks,
      total_view: illust.total_view,
      web_url: `https://www.pixiv.net/artworks/${illust.id}`,
      author_url: illust.user?.id ? `https://www.pixiv.net/users/${illust.user.id}` : undefined,
      ugoira_metadata: {
        total_duration_ms: prep.totalDurationMs,
        frame_count: prep.frames.length,
        frames: prep.frames,
      },
      exported_at: new Date().toISOString(),
    }

    FileManager.writeAsStringSync(
      `${tempDir}/info.json`,
      JSON.stringify(metaJson, null, 2),
      "utf-8"
    )

    // 3. 打包生成 ZIP 文件
    onProgress?.("正在压缩打包 ZIP 动图帧包...")
    await yieldToMainThread()
    if (FileManager.existsSync(tempZipPath)) {
      try { FileManager.removeSync(tempZipPath) } catch {}
    }

    await FileManager.zip(tempDir, tempZipPath)
    if (!FileManager.existsSync(tempZipPath)) {
      return { success: false, mp4Path: null, format: "zip", error: "动图 ZIP 打包失败" }
    }

    // 4. 原子发布至目标存储路径
    publishPreparedFile(tempZipPath, destZipPath)
    notifyDownloadFilesChanged()

    return {
      success: true,
      mp4Path: destZipPath,
      format: "zip",
      savedPath: destZipPath,
    }
  } catch (err: any) {
    console.log("exportUgoiraZip error:", err?.message ?? err)
    return { success: false, mp4Path: null, format: "zip", error: err?.message ?? String(err) }
  } finally {
    try {
      if (FileManager.existsSync(tempZipPath)) {
        FileManager.removeSync(tempZipPath)
      }
    } catch {}
    try {
      if (FileManager.existsSync(tempDir)) {
        FileManager.removeSync(tempDir)
      }
    } catch {}
  }
}
