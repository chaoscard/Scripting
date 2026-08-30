import { fetchImageBinaryWithRetry, runConcurrentTasks, type ExportResult } from "./downloadHelper"
import { getCategoryDirectory, sanitizeFileName } from "./directoryResolver"
import { publishPreparedFile } from "../store/safeFile"
import { htmlToPlainText } from "../ui/components/formatUtils"

export interface MangaCbzOptions {
  id: number
  title: string
  author: string
  authorId?: number
  seriesTitle?: string
  seriesNumber?: number | string
  description?: string
  tags?: string[]
  pages: { pageIndex: number; url: string }[]
  targetDir?: string
  customFileName?: string
  onProgress?: (msg: string, current: number, total: number) => void
}

function escapeXml(unsafe: string): string {
  if (!unsafe) return ""
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * 导出漫画为行业标准 CBZ 格式（支持容错导出与确切结果报告）
 */
export async function exportMangaToCbz(options: MangaCbzOptions): Promise<ExportResult> {
  const {
    id,
    title,
    author,
    seriesTitle,
    seriesNumber,
    description,
    tags = [],
    pages,
    targetDir: customTargetDir,
    customFileName,
    onProgress,
  } = options

  const tempDir = `${getCategoryDirectory("temp")}/cbz_${id}_${Date.now()}`
  const tempZipPath = `${tempDir}.zip`

  try {
    FileManager.createDirectorySync(tempDir, true)

    onProgress?.(`下载漫画原图 (共 ${pages.length} 页)...`, 0, pages.length)
    const downloadedIndexes = new Set<number>()
    const failedPages: number[] = []

    await runConcurrentTasks(pages, 4, async (p, idx) => {
      const pageNum = idx + 1
      const data = await fetchImageBinaryWithRetry(p.url)
      if (data) {
        const paddedNum = String(pageNum).padStart(3, "0")
        const ext = p.url.includes(".png") ? "png" : "jpg"
        const fileName = `page_${paddedNum}.${ext}`
        FileManager.writeAsDataSync(`${tempDir}/${fileName}`, data)
        downloadedIndexes.add(pageNum)
      } else {
        failedPages.push(pageNum)
      }
      onProgress?.(`下载漫画原图 (${idx + 1}/${pages.length})`, idx + 1, pages.length)
    })

    const downloadedCount = downloadedIndexes.size
    failedPages.sort((a, b) => a - b)

    if (downloadedCount === 0) {
      return {
        success: false,
        path: null,
        isPartial: false,
        downloadedPages: 0,
        totalPages: pages.length,
        failedPages,
        error: "全部页面下载失败",
      }
    }

    const isPartial = downloadedCount < pages.length
    const partialSuffix = isPartial ? `_[缺${pages.length - downloadedCount}页]` : ""

    const baseName = customFileName
      ? sanitizeFileName(customFileName)
      : sanitizeFileName(seriesTitle ? `${seriesTitle} - ${title}` : `${title}_${author}`)
    const outputFileName = `${baseName}${partialSuffix}.cbz`

    const targetDir = customTargetDir || getCategoryDirectory("manga")
    if (!FileManager.existsSync(targetDir)) {
      try { FileManager.createDirectorySync(targetDir, true) } catch {}
    }
    const targetFilePath = `${targetDir}/${outputFileName}`

    // 写入 ComicInfo.xml 元数据
    const cleanDescription = description ? htmlToPlainText(description) : ""
    const missingNote = isPartial ? `\n[缺页说明] 本文件为容错导出，缺失第 ${failedPages.join(", ")} 页` : ""
    const comicInfoXml = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${escapeXml(title)}</Title>
  ${seriesTitle ? `<Series>${escapeXml(seriesTitle)}</Series>` : ""}
  ${seriesNumber != null ? `<Number>${escapeXml(String(seriesNumber))}</Number>` : ""}
  <Writer>${escapeXml(author)}</Writer>
  ${cleanDescription || isPartial ? `<Summary>${escapeXml((cleanDescription || "") + missingNote)}</Summary>` : ""}
  <PageCount>${downloadedCount}</PageCount>
  <Manga>YesAndRightToLeft</Manga>
  ${tags.length > 0 ? `<Genre>${escapeXml(tags.join(", "))}</Genre>` : ""}
  <Web>https://www.pixiv.net/artworks/${id}</Web>
</ComicInfo>`

    FileManager.writeAsStringSync(`${tempDir}/ComicInfo.xml`, comicInfoXml, "utf-8")

    onProgress?.("正在打包 CBZ 漫画文件...", pages.length, pages.length)

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
        totalPages: pages.length,
        failedPages,
        error: "ZIP 压缩失败",
      }
    }

    // 使用 .bak 回滚与临时文件校验进行原子发布，防止损坏已有文件
    publishPreparedFile(tempZipPath, targetFilePath)

    return {
      success: true,
      path: targetFilePath,
      isPartial,
      downloadedPages: downloadedCount,
      totalPages: pages.length,
      failedPages,
    }
  } catch (err: any) {
    console.log("exportMangaToCbz error:", err?.message ?? err)
    return {
      success: false,
      path: null,
      isPartial: false,
      downloadedPages: 0,
      totalPages: pages.length,
      error: err?.message ?? String(err),
    }
  } finally {
    // 无论成功还是失败，均幂等清理临时工作目录与临时 ZIP
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
