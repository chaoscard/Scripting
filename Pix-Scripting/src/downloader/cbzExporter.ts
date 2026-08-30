import {
  fetchImageBinaryWithRetry,
  runConcurrentTasks,
  yieldToMainThread,
  yieldIfExceeded,
  createThrottledProgress,
  type ExportResult,
} from "./downloadHelper"
import { getCategoryDirectory, sanitizeFileName } from "./directoryResolver"
import { publishPreparedFile } from "../store/safeFile"
import { htmlToPlainText } from "../ui/components/formatUtils"
import type { MangaChapterItem, MangaPageItem } from "./epubExporter"

export type { MangaChapterItem, MangaPageItem }

export interface MangaCbzOptions {
  id: number
  title: string
  author: string
  authorId?: number
  seriesTitle?: string
  seriesNumber?: number | string
  description?: string
  tags?: string[]
  createdDate?: string
  isR18?: boolean
  chapters?: MangaChapterItem[]
  pages?: MangaPageItem[]
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
 * 导出漫画为行业标准 CBZ 格式（支持 ComicInfo 2.0 规范、章节书签与确切结果报告）
 */
export async function exportMangaToCbz(options: MangaCbzOptions): Promise<ExportResult> {
  const {
    id,
    title,
    author,
    authorId,
    seriesTitle,
    seriesNumber,
    description,
    tags = [],
    createdDate,
    isR18,
    chapters,
    pages,
    targetDir: customTargetDir,
    customFileName,
    onProgress,
  } = options

  const tempDir = `${getCategoryDirectory("temp")}/cbz_${id}_${Date.now()}`
  const tempZipPath = `${tempDir}.zip`
  const progressReporter = createThrottledProgress(onProgress, 80)

  try {
    FileManager.createDirectorySync(tempDir, true)

    // 1. 归一化章节与页面结构
    interface NormalizedPage {
      globalIndex: number
      pageInChap: number
      url: string
      chapIndex: number
      chapTitle: string
      isChapFirstPage: boolean
    }

    interface NormalizedChapter {
      id?: number
      title: string
      pages: NormalizedPage[]
    }

    const normalizedChapters: NormalizedChapter[] = []
    let globalCounter = 0

    if (chapters && chapters.length > 0) {
      chapters.forEach((c, cIdx) => {
        const chapTitle = c.title || `第 ${cIdx + 1} 话`
        const pageList: NormalizedPage[] = (c.pages || []).map((p, pIdx) => {
          globalCounter++
          return {
            globalIndex: p.pageIndex ?? globalCounter,
            pageInChap: pIdx + 1,
            url: p.url,
            chapIndex: cIdx,
            chapTitle,
            isChapFirstPage: pIdx === 0,
          }
        })
        if (pageList.length > 0) {
          normalizedChapters.push({
            id: c.id,
            title: chapTitle,
            pages: pageList,
          })
        }
      })
    } else if (pages && pages.length > 0) {
      let currentChapTitle = pages[0].chapterTitle || title || "单篇"
      let currentChapPages: NormalizedPage[] = []
      let currentChapIdx = 0

      pages.forEach((p, idx) => {
        const pChapTitle = p.chapterTitle || title || "单篇"
        if (pChapTitle !== currentChapTitle && currentChapPages.length > 0) {
          normalizedChapters.push({
            title: currentChapTitle,
            pages: currentChapPages,
          })
          currentChapTitle = pChapTitle
          currentChapPages = []
          currentChapIdx++
        }
        const isChapFirstPage = currentChapPages.length === 0
        currentChapPages.push({
          globalIndex: p.pageIndex ?? idx + 1,
          pageInChap: currentChapPages.length + 1,
          url: p.url,
          chapIndex: currentChapIdx,
          chapTitle: currentChapTitle,
          isChapFirstPage,
        })
      })
      if (currentChapPages.length > 0) {
        normalizedChapters.push({
          title: currentChapTitle,
          pages: currentChapPages,
        })
      }
    }

    const allPagesToDownload: NormalizedPage[] = normalizedChapters.flatMap((c) => c.pages)
    if (allPagesToDownload.length === 0) {
      return {
        success: false,
        path: null,
        isPartial: false,
        downloadedPages: 0,
        totalPages: 0,
        error: "未提供任何漫画页面",
      }
    }

    // 2. 并发下载漫画页面原图并提取宽高与尺寸
    progressReporter.notify(`下载漫画原图 (共 ${allPagesToDownload.length} 页)...`, 0, allPagesToDownload.length)
    const downloadedPagesMap = new Map<number, {
      index: number
      fileName: string
      filePath: string
      width: number
      height: number
      fileSize: number
      chapTitle: string
      isChapFirstPage: boolean
    }>()
    const failedPages: number[] = []

    await runConcurrentTasks(allPagesToDownload, 4, async (p, idx) => {
      const pageNum = p.globalIndex
      const data = await fetchImageBinaryWithRetry(p.url)
      if (data) {
        const paddedNum = String(pageNum).padStart(allPagesToDownload.length >= 1000 ? 4 : 3, "0")
        const ext = p.url.includes(".png") ? "png" : "jpg"
        const fileName = `page_${paddedNum}.${ext}`
        const filePath = `${tempDir}/${fileName}`
        FileManager.writeAsDataSync(filePath, data)

        let width = 0
        let height = 0
        try {
          const uiImg = UIImage.fromFile(filePath)
          if (uiImg && uiImg.width > 0 && uiImg.height > 0) {
            const scale = uiImg.scale || 1
            width = Math.round(uiImg.width * scale)
            height = Math.round(uiImg.height * scale)
          }
        } catch {}

        let fileSize = 0
        try {
          fileSize = (data as any)?.length || FileManager.statSync(filePath)?.size || 0
        } catch {}

        downloadedPagesMap.set(pageNum, {
          index: pageNum,
          fileName,
          filePath,
          width,
          height,
          fileSize,
          chapTitle: p.chapTitle,
          isChapFirstPage: p.isChapFirstPage,
        })
      } else {
        failedPages.push(pageNum)
      }
      progressReporter.notify(`下载漫画原图 (${idx + 1}/${allPagesToDownload.length})`, idx + 1, allPagesToDownload.length)
    })

    const downloadedCount = downloadedPagesMap.size
    failedPages.sort((a, b) => a - b)

    if (downloadedCount === 0) {
      return {
        success: false,
        path: null,
        isPartial: false,
        downloadedPages: 0,
        totalPages: allPagesToDownload.length,
        failedPages,
        error: "全部页面下载失败",
      }
    }

    const isPartial = downloadedCount < allPagesToDownload.length
    const partialSuffix = isPartial ? `_[缺${allPagesToDownload.length - downloadedCount}页]` : ""

    const baseName = customFileName
      ? sanitizeFileName(customFileName)
      : sanitizeFileName(seriesTitle ? `${seriesTitle} - ${title}` : `${title}_${author}`)
    const outputFileName = `${baseName}${partialSuffix}.cbz`

    const targetDir = customTargetDir || getCategoryDirectory("manga")
    if (!FileManager.existsSync(targetDir)) {
      try { FileManager.createDirectorySync(targetDir, true) } catch {}
    }
    const targetFilePath = `${targetDir}/${outputFileName}`

    // 3. 构建全功能 ComicInfo.xml 元数据
    const cleanDescription = description ? htmlToPlainText(description) : ""
    const missingNote = isPartial ? `\n[缺页说明] 本文件为容错导出，缺失第 ${failedPages.join(", ")} 页` : ""
    const fullSummary = (cleanDescription || "") + missingNote

    const authorUrl = authorId ? `https://www.pixiv.net/users/${authorId}` : ""
    const workUrl = `https://www.pixiv.net/artworks/${id}`
    const notesParts: string[] = []
    if (authorUrl) notesParts.push(`画师主页：${authorUrl}`)
    notesParts.push(`作品链接：${workUrl}`)
    if (normalizedChapters.length > 1) {
      notesParts.push(`连载规模：全 ${normalizedChapters.length} 话 / 共 ${allPagesToDownload.length} 页`)
    }
    notesParts.push(`导出时间：${new Date().toLocaleString()}`)
    const fullNotes = notesParts.join("\n")

    let yearTag = ""
    let monthTag = ""
    let dayTag = ""
    if (createdDate) {
      try {
        const d = new Date(createdDate)
        if (!isNaN(d.getTime())) {
          yearTag = `<Year>${d.getUTCFullYear()}</Year>`
          monthTag = `<Month>${d.getUTCMonth() + 1}</Month>`
          dayTag = `<Day>${d.getUTCDate()}</Day>`
        }
      } catch {}
    }

    const hasR18Tag = isR18 || tags.some((t) => /r-?18/i.test(t))
    const ageRatingTag = `<AgeRating>${hasR18Tag ? "Adults Only 18+" : "Everyone"}</AgeRating>`

    const sortedDownloadedPages = Array.from(downloadedPagesMap.values()).sort((a, b) => a.index - b.index)
    const isMultiChap = normalizedChapters.length > 1
    const pagesXmlItems: string[] = []

    sortedDownloadedPages.forEach((p, idx) => {
      const isFrontCover = idx === 0
      const attrs: string[] = [`Image="${idx}"`]
      if (isFrontCover) {
        attrs.push('Type="FrontCover"')
      } else {
        attrs.push('Type="Story"')
      }
      if (p.width > 0) attrs.push(`ImageWidth="${p.width}"`)
      if (p.height > 0) attrs.push(`ImageHeight="${p.height}"`)
      if (p.fileSize > 0) attrs.push(`ImageSize="${p.fileSize}"`)
      
      if (isMultiChap) {
        if (p.isChapFirstPage) {
          attrs.push(`Bookmark="${escapeXml(p.chapTitle)}"`)
        }
      } else if (idx === 0) {
        attrs.push(`Bookmark="${escapeXml(title || '正文')}"`)
      }
      pagesXmlItems.push(`    <Page ${attrs.join(" ")}/>`)
    })

    const genreText = tags.length > 0 ? tags.join(", ") : ""

    const comicInfoXml = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${escapeXml(title)}</Title>
  ${seriesTitle ? `<Series>${escapeXml(seriesTitle)}</Series>` : ""}
  ${seriesNumber != null ? `<Number>${escapeXml(String(seriesNumber))}</Number>` : ""}
  <Writer>${escapeXml(author)}</Writer>
  <Penciller>${escapeXml(author)}</Penciller>
  <CoverArtist>${escapeXml(author)}</CoverArtist>
  <Publisher>Pixiv</Publisher>
  ${fullSummary ? `<Summary>${escapeXml(fullSummary)}</Summary>` : ""}
  ${fullNotes ? `<Notes>${escapeXml(fullNotes)}</Notes>` : ""}
  ${yearTag}
  ${monthTag}
  ${dayTag}
  <PageCount>${downloadedCount}</PageCount>
  <Manga>YesAndRightToLeft</Manga>
  ${genreText ? `<Genre>${escapeXml(genreText)}</Genre>` : ""}
  ${genreText ? `<Tags>${escapeXml(genreText)}</Tags>` : ""}
  <LanguageISO>ja</LanguageISO>
  ${ageRatingTag}
  <Web>${workUrl}</Web>
  <Pages>
${pagesXmlItems.join("\n")}
  </Pages>
</ComicInfo>`

    FileManager.writeAsStringSync(`${tempDir}/ComicInfo.xml`, comicInfoXml, "utf-8")

    // 4. 打包并原子发布
    progressReporter.notify("正在打包 CBZ 漫画文件...", allPagesToDownload.length, allPagesToDownload.length)
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
        totalPages: allPagesToDownload.length,
        failedPages,
        error: "ZIP 压缩失败",
      }
    }

    publishPreparedFile(tempZipPath, targetFilePath)

    return {
      success: true,
      path: targetFilePath,
      isPartial,
      downloadedPages: downloadedCount,
      totalPages: allPagesToDownload.length,
      failedPages,
    }
  } catch (err: any) {
    console.log("exportMangaToCbz error:", err?.message ?? err)
    return {
      success: false,
      path: null,
      isPartial: false,
      downloadedPages: 0,
      totalPages: (chapters?.reduce((acc, c) => acc + (c.pages?.length || 0), 0) ?? pages?.length) || 0,
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
