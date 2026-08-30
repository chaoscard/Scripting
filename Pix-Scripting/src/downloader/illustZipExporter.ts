import {
  fetchImageBinaryWithRetry,
  runConcurrentTasks,
  yieldToMainThread,
  createThrottledProgress,
  type ExportResult,
} from "./downloadHelper"
import { getCategoryDirectory, sanitizeFileName } from "./directoryResolver"
import { notifyDownloadFilesChanged } from "./downloadFileManager"
import { publishPreparedFile } from "../store/safeFile"
import type { PixivIllustration } from "../types"

export interface IllustZipOptions {
  illust: PixivIllustration
  imageUrls: string[]
  targetDir?: string
  customFileName?: string
  onProgress?: (msg: string, current: number, total: number) => void
}

/**
 * 将插画/组图导出为包含元数据的 ZIP 归档包（支持容错导出与确切结果报告）
 */
export async function exportIllustToZip(options: IllustZipOptions): Promise<ExportResult> {
  const { illust, imageUrls, targetDir: customTargetDir, customFileName, onProgress } = options
  const authorName = illust.user?.name || "Unknown"
  const title = illust.title || "Illust"

  const tempDir = `${getCategoryDirectory("temp")}/zip_illust_${illust.id}_${Date.now()}`
  const tempZipPath = `${tempDir}.zip`
  const progressReporter = createThrottledProgress(onProgress, 80)

  try {
    FileManager.createDirectorySync(tempDir, true)

    progressReporter.notify(`下载插画原图 (共 ${imageUrls.length} 张)...`, 0, imageUrls.length)
    const downloadedIndexes = new Set<number>()
    const failedPages: number[] = []

    await runConcurrentTasks(imageUrls, 4, async (url, idx) => {
      const pageNum = idx + 1
      const data = await fetchImageBinaryWithRetry(url)
      if (data) {
        const paddedNum = String(pageNum).padStart(imageUrls.length >= 100 ? 3 : 2, "0")
        const ext = url.includes(".png") ? "png" : "jpg"
        const fileName = `${paddedNum}.${ext}`
        FileManager.writeAsDataSync(`${tempDir}/${fileName}`, data)
        downloadedIndexes.add(pageNum)
      } else {
        failedPages.push(pageNum)
      }
      progressReporter.notify(`下载插画原图 (${idx + 1}/${imageUrls.length})`, idx + 1, imageUrls.length)
    })

    const downloadedCount = downloadedIndexes.size
    failedPages.sort((a, b) => a - b)

    if (downloadedCount === 0) {
      return {
        success: false,
        path: null,
        isPartial: false,
        downloadedPages: 0,
        totalPages: imageUrls.length,
        failedPages,
        error: "全部插画原图下载失败",
      }
    }

    const isPartial = downloadedCount < imageUrls.length
    const partialSuffix = isPartial ? `_[缺${imageUrls.length - downloadedCount}张]` : ""

    const safeFolderName = customFileName
      ? sanitizeFileName(customFileName)
      : sanitizeFileName(`${authorName} - ${title} (${illust.id})`)
    const outputFileName = `${safeFolderName}${partialSuffix}.zip`

    const targetDir = customTargetDir || getCategoryDirectory("illustrations")
    if (!FileManager.existsSync(targetDir)) {
      try { FileManager.createDirectorySync(targetDir, true) } catch {}
    }
    const targetFilePath = `${targetDir}/${outputFileName}`

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
      is_partial: isPartial,
      downloaded_count: downloadedCount,
      total_count: imageUrls.length,
      failed_pages: isPartial ? failedPages : undefined,
    }

    FileManager.writeAsStringSync(
      `${tempDir}/info.json`,
      JSON.stringify(metaJson, null, 2),
      "utf-8"
    )

    progressReporter.notify("正在打包插画 ZIP 压缩包...", imageUrls.length, imageUrls.length)
    progressReporter.flush()
    await yieldToMainThread()

    if (FileManager.existsSync(tempZipPath)) {
      try { FileManager.removeSync(tempZipPath) } catch {}
    }

    await FileManager.zip(tempDir, tempZipPath)
    if (!FileManager.existsSync(tempZipPath)) {
      return {
        success: false,
        path: null,
        isPartial,
        downloadedPages: downloadedCount,
        totalPages: imageUrls.length,
        failedPages,
        error: "ZIP 压缩失败",
      }
    }

    // 使用 .bak 回滚与临时文件校验进行原子发布，防止损坏已有文件
    publishPreparedFile(tempZipPath, targetFilePath)
    notifyDownloadFilesChanged()

    return {
      success: true,
      path: targetFilePath,
      isPartial,
      downloadedPages: downloadedCount,
      totalPages: imageUrls.length,
      failedPages,
    }
  } catch (err: any) {
    console.log("exportIllustToZip error:", err?.message ?? err)
    return {
      success: false,
      path: null,
      isPartial: false,
      downloadedPages: 0,
      totalPages: imageUrls.length,
      error: err?.message ?? String(err),
    }
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
