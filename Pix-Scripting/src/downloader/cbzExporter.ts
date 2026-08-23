import { fetchImageBinaryWithRetry, runConcurrentTasks } from "./downloadHelper"
import { getCategoryDirectory, sanitizeFileName } from "./directoryResolver"

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
 * 导出漫画为行业标准 CBZ 格式
 */
export async function exportMangaToCbz(options: MangaCbzOptions): Promise<string | null> {
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

  const safeTitle = customFileName
    ? sanitizeFileName(customFileName)
    : sanitizeFileName(seriesTitle ? `${seriesTitle} - ${title}` : `${title}_${author}`)
  const outputFileName = `${safeTitle}.cbz`
  const targetDir = customTargetDir || getCategoryDirectory("manga")
  if (!FileManager.existsSync(targetDir)) {
    try { FileManager.createDirectorySync(targetDir, true) } catch {}
  }
  const targetFilePath = `${targetDir}/${outputFileName}`

  const tempDir = `${getCategoryDirectory("temp")}/cbz_${id}_${Date.now()}`

  try {
    FileManager.createDirectorySync(tempDir, true)

    onProgress?.(`下载漫画原图 (共 ${pages.length} 页)...`, 0, pages.length)
    let downloadedCount = 0

    await runConcurrentTasks(pages, 4, async (p, idx) => {
      const data = await fetchImageBinaryWithRetry(p.url)
      if (data) {
        const paddedNum = String(idx + 1).padStart(3, "0")
        const ext = p.url.includes(".png") ? "png" : "jpg"
        const fileName = `page_${paddedNum}.${ext}`
        FileManager.writeAsDataSync(`${tempDir}/${fileName}`, data)
        downloadedCount++
      }
      onProgress?.(`下载漫画原图 (${idx + 1}/${pages.length})`, idx + 1, pages.length)
    })

    if (downloadedCount === 0) return null

    // 写入 ComicInfo.xml 元数据
    const comicInfoXml = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${escapeXml(title)}</Title>
  ${seriesTitle ? `<Series>${escapeXml(seriesTitle)}</Series>` : ""}
  ${seriesNumber != null ? `<Number>${escapeXml(String(seriesNumber))}</Number>` : ""}
  <Writer>${escapeXml(author)}</Writer>
  ${description ? `<Summary>${escapeXml(description)}</Summary>` : ""}
  <PageCount>${downloadedCount}</PageCount>
  <Manga>YesAndRightToLeft</Manga>
  ${tags.length > 0 ? `<Genre>${escapeXml(tags.join(", "))}</Genre>` : ""}
  <Web>https://www.pixiv.net/artworks/${id}</Web>
</ComicInfo>`

    FileManager.writeAsStringSync(`${tempDir}/ComicInfo.xml`, comicInfoXml, "utf-8")

    onProgress?.("正在打包 CBZ 漫画文件...", pages.length, pages.length)

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
    console.log("exportMangaToCbz error:", err?.message ?? err)
    return null
  }
}
