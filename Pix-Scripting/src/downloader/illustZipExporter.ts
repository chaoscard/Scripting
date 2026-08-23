import { fetchImageBinaryWithRetry, runConcurrentTasks } from "./downloadHelper"
import { getCategoryDirectory, sanitizeFileName } from "./directoryResolver"
import type { PixivIllustration } from "../types"

export interface IllustZipOptions {
  illust: PixivIllustration
  imageUrls: string[]
  targetDir?: string
  customFileName?: string
  onProgress?: (msg: string, current: number, total: number) => void
}

/**
 * 将插画/组图导出为包含元数据的 ZIP 归档包
 */
export async function exportIllustToZip(options: IllustZipOptions): Promise<string | null> {
  const { illust, imageUrls, targetDir: customTargetDir, customFileName, onProgress } = options
  const authorName = illust.user?.name || "Unknown"
  const title = illust.title || "Illust"

  const safeFolderName = customFileName
    ? sanitizeFileName(customFileName)
    : sanitizeFileName(`${authorName} - ${title} (${illust.id})`)
  const outputFileName = `${safeFolderName}.zip`
  const targetDir = customTargetDir || getCategoryDirectory("illustrations")
  if (!FileManager.existsSync(targetDir)) {
    try { FileManager.createDirectorySync(targetDir, true) } catch {}
  }
  const targetFilePath = `${targetDir}/${outputFileName}`

  const tempDir = `${getCategoryDirectory("temp")}/zip_illust_${illust.id}_${Date.now()}`

  try {
    FileManager.createDirectorySync(tempDir, true)

    onProgress?.(`下载插画原图 (共 ${imageUrls.length} 张)...`, 0, imageUrls.length)
    let downloadedCount = 0

    await runConcurrentTasks(imageUrls, 4, async (url, idx) => {
      const data = await fetchImageBinaryWithRetry(url)
      if (data) {
        const paddedNum = String(idx + 1).padStart(imageUrls.length >= 100 ? 3 : 2, "0")
        const ext = url.includes(".png") ? "png" : "jpg"
        const fileName = `${paddedNum}.${ext}`
        FileManager.writeAsDataSync(`${tempDir}/${fileName}`, data)
        downloadedCount++
      }
      onProgress?.(`下载插画原图 (${idx + 1}/${imageUrls.length})`, idx + 1, imageUrls.length)
    })

    if (downloadedCount === 0) return null

    // 写入 info.json 元数据
    const metaJson = {
      id: illust.id,
      title: illust.title,
      type: illust.type,
      caption: illust.caption,
      user: {
        id: illust.user?.id,
        name: illust.user?.name,
        account: illust.user?.account,
      },
      tags: illust.tags?.map((t: any) => t.name) ?? [],
      create_date: illust.create_date,
      page_count: illust.page_count,
      width: illust.width,
      height: illust.height,
      total_bookmarks: illust.total_bookmarks,
      total_view: illust.total_view,
      urls: imageUrls,
      web_url: `https://www.pixiv.net/artworks/${illust.id}`,
      exported_at: new Date().toISOString(),
    }

    FileManager.writeAsStringSync(
      `${tempDir}/info.json`,
      JSON.stringify(metaJson, null, 2),
      "utf-8"
    )

    onProgress?.("正在打包插画 ZIP 压缩包...", imageUrls.length, imageUrls.length)

    if (FileManager.existsSync(targetFilePath)) {
      try { FileManager.removeSync(targetFilePath) } catch {}
    }

    const tempZipPath = `${tempDir}.zip`
    if (FileManager.existsSync(tempZipPath)) {
      try { FileManager.removeSync(tempZipPath) } catch {}
    }

    await FileManager.zip(tempDir, tempZipPath)
    if (!FileManager.existsSync(tempZipPath)) {
      return null
    }

    await FileManager.copyFile(tempZipPath, targetFilePath)

    try {
      FileManager.removeSync(tempZipPath)
      FileManager.removeSync(tempDir)
    } catch {}

    return targetFilePath
  } catch (err: any) {
    console.log("exportIllustToZip error:", err?.message ?? err)
    return null
  }
}
