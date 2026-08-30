import {
  illustrationDetail,
  illustrationSeries,
  nextIllustrationSeries,
  nextNovelSeries,
  novelSeries,
  novelViewerData,
} from "../api/pixiv"
import { session } from "../api/session"
import { imageUrlOf } from "../image/imageLoader"
import { getDownloadImageQuality, loadSettings } from "../store/settings"
import { exportNovelToEpub, type NovelChapter } from "./epubExporter"
import { exportMangaToCbz } from "./cbzExporter"
import { exportMangaToEpub } from "./epubExporter"
import { runWithBackgroundTask } from "./backgroundTaskManager"

/**
 * 整本下载并导出小说系列为单本 EPUB 电子书
 */
export async function downloadEntireNovelSeries(
  seriesID: number,
  fallbackTitle?: string,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<string | null> {
  return runWithBackgroundTask(
    {
      title: "导出小说系列",
      subtitle: fallbackTitle ? `《${fallbackTitle}》` : `系列 ID: ${seriesID}`,
      categoryIcon: "book.closed.fill",
      initialStatus: "正在获取小说系列目录…",
    },
    async (task) => {
      try {
        const initMsg = "正在获取小说系列目录…"
        onProgress?.(initMsg, 0, 1)
        task.updateProgress({ current: 0, total: 1, statusText: initMsg })

        const allNovels: any[] = []
        let seriesTitle = fallbackTitle || ""
        let seriesCoverUrl: string | undefined

        // 1. 分页获取系列全部小说条目
        let page = await session.call((token) => novelSeries(seriesID, token))
        if (page?.novel_series_detail) {
          seriesTitle = page.novel_series_detail.title || seriesTitle
          seriesCoverUrl =
            page.novel_series_detail.cover_image_urls?.large ||
            page.novel_series_detail.cover_image_urls?.medium
        }
        if (Array.isArray(page?.novels)) {
          allNovels.push(...page.novels)
        }

        while (page?.next_url) {
          const nextURL = page.next_url
          page = await session.call((token) => nextNovelSeries(nextURL, token))
          if (Array.isArray(page?.novels)) {
            allNovels.push(...page.novels)
          }
        }

        if (allNovels.length === 0) {
          await task.finish({
            success: false,
            summary: "未获取到该系列的章节内容",
          })
          return null
        }

        // 保证按系列正序排列（从第一话开始）
        allNovels.sort((a, b) => (a.series?.series_order ?? a.id) - (b.series?.series_order ?? b.id))

        const authorName = allNovels[0]?.user?.name || "Pixiv"
        const authorId = allNovels[0]?.user?.id
        const chapters: NovelChapter[] = []
        const totalNovels = allNovels.length

        // 2. 依次拉取每章节的正文与插图数据
        for (let i = 0; i < totalNovels; i++) {
          const novelItem = allNovels[i]
          const statusMsg = `正在拉取正文 (${i + 1}/${totalNovels}): ${novelItem.title}`
          onProgress?.(statusMsg, i + 1, totalNovels)
          task.updateProgress({ current: i + 1, total: totalNovels, statusText: statusMsg })

          try {
            const viewer = await session.call((token) => novelViewerData(novelItem.id, token))
            if (viewer && viewer.text) {
              const imageMap: Record<string, string> = {}
              if (viewer.textEmbeddedImages) {
                Object.entries(viewer.textEmbeddedImages).forEach(([key, imgObj]) => {
                  const url =
                    imgObj?.urls?.original ||
                    imgObj?.urls?.["1200x1200"] ||
                    imgObj?.urls?.["480mw"] ||
                    (imgObj as any)?.urls?.large ||
                    (imgObj as any)?.urls?.medium ||
                    (imgObj as any)?.url
                  if (url) {
                    imageMap[key] = url
                    if (imgObj.novelImageId && imgObj.novelImageId !== key) {
                      imageMap[imgObj.novelImageId] = url
                    }
                  }
                })
              }

              chapters.push({
                id: novelItem.id,
                title: novelItem.title,
                text: viewer.text,
                images: imageMap,
                caption: novelItem.caption,
              })
              if (!seriesCoverUrl && viewer.coverUrl) {
                seriesCoverUrl = viewer.coverUrl
              }
            }
          } catch (err: any) {
            console.log(`Failed to fetch novel ${novelItem.id}:`, err?.message ?? err)
          }
        }

        if (chapters.length === 0) {
          await task.finish({
            success: false,
            summary: "无法获取章节正文内容",
          })
          return null
        }

        // 3. 打包为整本 EPUB
        const packMsg = "正在合成整本小说 EPUB…"
        onProgress?.(packMsg, chapters.length, chapters.length)
        task.updateProgress({ current: chapters.length, total: chapters.length, statusText: packMsg })

        const filePath = await exportNovelToEpub({
          id: seriesID,
          title: seriesTitle || `系列_${seriesID}`,
          author: authorName,
          authorId,
          seriesTitle,
          coverUrl: seriesCoverUrl,
          chapters,
          onProgress: (msg, cur, tot) => onProgress?.(msg, cur, tot),
        })

        if (filePath) {
          await task.finish({
            success: true,
            summary: `《${seriesTitle}》整本 EPUB (共 ${chapters.length} 章) 导出成功。`,
          })
        } else {
          await task.finish({
            success: false,
            summary: "EPUB 电子书生成失败",
          })
        }

        return filePath
      } catch (err: any) {
        console.log("downloadEntireNovelSeries error:", err?.message ?? err)
        await task.finish({
          success: false,
          summary: "导出小说系列时发生异常",
          errorMessage: err?.message ?? String(err),
        })
        return null
      }
    }
  )
}

/**
 * 整本下载并导出漫画系列为 CBZ 或 EPUB
 */
export async function downloadEntireMangaSeries(
  seriesID: number,
  fallbackTitle?: string,
  format: "cbz" | "epub" = "cbz",
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<string | null> {
  const formatLabel = format.toUpperCase()
  return runWithBackgroundTask(
    {
      title: "导出漫画系列",
      subtitle: fallbackTitle ? `《${fallbackTitle}》` : `系列 ID: ${seriesID}`,
      categoryIcon: "books.vertical.fill",
      initialStatus: "正在获取漫画系列目录…",
    },
    async (task) => {
      try {
        const initMsg = "正在获取漫画系列目录…"
        onProgress?.(initMsg, 0, 1)
        task.updateProgress({ current: 0, total: 1, statusText: initMsg })

        const allIllusts: any[] = []
        let seriesTitle = fallbackTitle || ""

        // 1. 分页获取系列全部漫画话数
        let page = await session.call((token) => illustrationSeries(seriesID, token))
        if (page?.illust_series_detail) {
          seriesTitle = page.illust_series_detail.title || seriesTitle
        }
        if (Array.isArray(page?.illusts)) {
          allIllusts.push(...page.illusts)
        }

        while (page?.next_url) {
          const nextURL = page.next_url
          page = await session.call((token) => nextIllustrationSeries(nextURL, token))
          if (Array.isArray(page?.illusts)) {
            allIllusts.push(...page.illusts)
          }
        }

        if (allIllusts.length === 0) {
          await task.finish({
            success: false,
            summary: "未获取到该漫画系列的作品",
          })
          return null
        }

        // 按正序排列
        allIllusts.sort((a, b) => (a.series_order ?? a.id) - (b.series_order ?? b.id))

        const quality = getDownloadImageQuality()
        const allPages: { pageIndex: number; url: string }[] = []
        let globalPageCounter = 0
        const totalIllusts = allIllusts.length

        // 2. 依次拉取每话所有页的原图/大图 URL
        for (let i = 0; i < totalIllusts; i++) {
          const item = allIllusts[i]
          const statusMsg = `正在解析话数信息 (${i + 1}/${totalIllusts}): ${item.title || ""}`
          onProgress?.(statusMsg, i + 1, totalIllusts)
          task.updateProgress({ current: i + 1, total: totalIllusts, statusText: statusMsg })

          try {
            const detail = await session.call((token) => illustrationDetail(item.id, token))
            if (detail) {
              const pageCount = detail.page_count ?? 1
              for (let p = 0; p < pageCount; p++) {
                const url = imageUrlOf(detail, p, quality)
                if (url) {
                  globalPageCounter++
                  allPages.push({ pageIndex: globalPageCounter, url })
                }
              }
            }
          } catch (err: any) {
            console.log(`Failed to fetch manga detail ${item.id}:`, err?.message ?? err)
          }
        }

        if (allPages.length === 0) {
          await task.finish({
            success: false,
            summary: "未获取到漫画页面图像",
          })
          return null
        }

        const authorName = allIllusts[0]?.user?.name || "Pixiv"
        const authorId = allIllusts[0]?.user?.id

        // 3. 导出为 CBZ 或 EPUB
        let filePath: string | null = null
        const exportMsg = `正在合并导出整本漫画 ${formatLabel}…`
        onProgress?.(exportMsg, allPages.length, allPages.length)
        task.updateProgress({ current: allPages.length, total: allPages.length, statusText: exportMsg })

        let isPartial = false
        let downloadedCount = 0
        let totalCount = allPages.length

        if (format === "cbz") {
          const res = await exportMangaToCbz({
            id: seriesID,
            title: seriesTitle || `漫画系列_${seriesID}`,
            author: authorName,
            authorId,
            seriesTitle,
            pages: allPages,
            onProgress: (msg, cur, tot) => onProgress?.(msg, cur, tot),
          })
          filePath = res.success ? (res.path ?? null) : null
          isPartial = Boolean(res.isPartial)
          downloadedCount = res.downloadedPages
          totalCount = res.totalPages
        } else {
          const res = await exportMangaToEpub({
            id: seriesID,
            title: seriesTitle || `漫画系列_${seriesID}`,
            author: authorName,
            authorId,
            seriesTitle,
            pages: allPages,
            onProgress: (msg, cur, tot) => onProgress?.(msg, cur, tot),
          })
          filePath = res.success ? (res.path ?? null) : null
          isPartial = Boolean(res.isPartial)
          downloadedCount = res.downloadedPages
          totalCount = res.totalPages
        }

        if (filePath) {
          const partialNote = isPartial ? ` (容错导出，部分缺页: ${downloadedCount}/${totalCount}P)` : ""
          await task.finish({
            success: true,
            summary: `《${seriesTitle}》全 ${totalIllusts} 话 (${downloadedCount}P) ${formatLabel} 导出成功${partialNote}。`,
          })
        } else {
          await task.finish({
            success: false,
            summary: `${formatLabel} 漫画包生成失败`,
          })
        }

        return filePath
      } catch (err: any) {
        console.log("downloadEntireMangaSeries error:", err?.message ?? err)
        await task.finish({
          success: false,
          summary: "导出漫画系列时发生异常",
          errorMessage: err?.message ?? String(err),
        })
        return null
      }
    }
  )
}
