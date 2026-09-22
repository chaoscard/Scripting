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
import { getDownloadImageQuality } from "../store/settings"
import { exportNovelToEpub, type NovelChapter } from "./epubExporter"
import { exportMangaToCbz } from "./cbzExporter"
import { exportMangaToEpub } from "./epubExporter"
import { DownloadTaskManager } from "./downloadTaskManager"
import { yieldToMainThread } from "./downloadHelper"
import { StageProgressPipeline } from "./StageProgressPipeline"

/**
 * 整本下载并导出小说系列为单本 EPUB 电子书（支持断点续传与手动暂停/恢复/取消）
 */
export async function downloadEntireNovelSeries(
  seriesID: number,
  fallbackTitle?: string,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<string | null> {
  const taskId = `series_novel_${seriesID}_${Date.now()}`

  return new Promise<string | null>((resolve, reject) => {
    void DownloadTaskManager.submitTask({
      taskId,
      type: "novel_epub",
      title: "导出小说系列",
      subtitle: fallbackTitle ? `《${fallbackTitle}》` : `系列 ID: ${seriesID}`,
      categoryIcon: "book.closed.fill",
      runner: async (token, task, manifest, saveManifest) => {
        const pipeline = new StageProgressPipeline(task, {
          prepare: 0.10, // 章节与正文扫描 10%
          download: 0.85, // 全量插图下载 85%
          pack: 0.05, // EPUB 封装生成 5%
        })

        try {
          const initMsg = "正在获取小说系列目录…"
          onProgress?.(initMsg, 0, 1)
          pipeline.reportPrepare(0, 1, initMsg)

          const allNovels: any[] = []
          let seriesTitle = fallbackTitle || ""
          let seriesCaption: string | undefined
          let seriesCoverUrl: string | undefined

          // 1. 分页获取系列全部小说条目
          let page = await session.call((tokenVal) => novelSeries(seriesID, tokenVal))
          if (page?.novel_series_detail) {
            seriesTitle = page.novel_series_detail.title || seriesTitle
            seriesCaption = page.novel_series_detail.caption
            seriesCoverUrl =
              page.novel_series_detail.cover_image_urls?.large ||
              page.novel_series_detail.cover_image_urls?.medium
          }
          if (Array.isArray(page?.novels)) {
            allNovels.push(...page.novels)
          }

          while (page?.next_url) {
            await token.checkOrWait()
            const nextURL = page.next_url
            page = await session.call((tokenVal) => nextNovelSeries(nextURL, tokenVal))
            if (Array.isArray(page?.novels)) {
              allNovels.push(...page.novels)
            }
          }

          if (allNovels.length === 0) {
            throw new Error("未获取到该系列的章节内容")
          }

          // 保证按系列正序排列（从第一话开始）
          allNovels.sort((a, b) => (a.series?.series_order ?? a.id) - (b.series?.series_order ?? b.id))

          const authorName = allNovels[0]?.user?.name || "Pixiv"
          const authorId = allNovels[0]?.user?.id
          const chapters: NovelChapter[] = []
          const totalNovels = allNovels.length

          // 2. 依次拉取每章节的正文与插图数据
          for (let i = 0; i < totalNovels; i++) {
            await token.checkOrWait()
            const novelItem = allNovels[i]
            const statusMsg = `正在拉取章节正文 (${i + 1}/${totalNovels}): ${novelItem.title}`
            onProgress?.(statusMsg, i + 1, totalNovels)
            pipeline.reportPrepare(i + 1, totalNovels, statusMsg)

            try {
              const viewer = await session.call((tokenVal) => novelViewerData(novelItem.id, tokenVal))
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
                manifest.completedIndices.push(i)
                saveManifest()
              }
            } catch (err: any) {
              console.log(`Failed to fetch novel ${novelItem.id}:`, err?.message ?? err)
            }
            await yieldToMainThread()
          }

          if (chapters.length === 0) {
            throw new Error("无法获取章节正文内容")
          }

          // 3. 打包为整本 EPUB
          await token.checkOrWait()
          const packMsg = `准备合成整本小说 EPUB (共 ${chapters.length} 章)…`
          onProgress?.(packMsg, 0, 1)
          pipeline.reportPack(0, 1, packMsg)

          const handleNovelExportProgress = (msg: string, cur: number, tot: number) => {
            onProgress?.(msg, cur, tot)
            const isCompressing = msg.includes("打包") || msg.includes("压缩") || msg.includes("合成")
            if (isCompressing) {
              pipeline.reportPack(cur, tot, msg)
            } else {
              pipeline.reportDownload(cur, tot, msg)
            }
          }

          const isNovelSeriesR18 = allNovels.some((n) => (n.x_restrict ?? 0) > 0 || n.tags?.some((t: any) => /r-?18/i.test(t.name)))
          const novelSeriesTags = allNovels[0]?.tags?.map((t: any) => t.name) ?? []
          const filePath = await exportNovelToEpub({
            id: seriesID,
            title: seriesTitle || `系列_${seriesID}`,
            author: authorName,
            authorId,
            seriesTitle,
            seriesDescription: seriesCaption,
            tags: novelSeriesTags,
            createdDate: allNovels[0]?.create_date,
            isR18: isNovelSeriesR18,
            coverUrl: seriesCoverUrl,
            chapters,
            token,
            onProgress: handleNovelExportProgress,
          })

          if (!filePath) {
            throw new Error("EPUB 电子书生成失败")
          }

          const summary = `《${seriesTitle}》整本 EPUB (共 ${chapters.length} 章) 导出成功。`
          pipeline.reportComplete("导出成功")
          resolve(filePath)
          return { outputPath: filePath, summary }
        } catch (err: any) {
          console.log("downloadEntireNovelSeries error:", err?.message ?? err)
          resolve(null)
          throw err
        }
      },
    }).catch(reject)
  })
}

/**
 * 整本下载并导出漫画系列为 CBZ 或 EPUB（支持断点续传与手动暂停/恢复/取消）
 */
export async function downloadEntireMangaSeries(
  seriesID: number,
  fallbackTitle?: string,
  format: "cbz" | "epub" = "cbz",
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<string | null> {
  const formatLabel = format.toUpperCase()
  const taskId = `series_manga_${seriesID}_${Date.now()}`

  return new Promise<string | null>((resolve, reject) => {
    void DownloadTaskManager.submitTask({
      taskId,
      type: format === "cbz" ? "manga_cbz" : "manga_epub",
      title: "导出漫画系列",
      subtitle: fallbackTitle ? `《${fallbackTitle}》` : `系列 ID: ${seriesID}`,
      categoryIcon: "books.vertical.fill",
      runner: async (token, task, manifest, saveManifest) => {
        const pipeline = new StageProgressPipeline(task, {
          prepare: 0.05, // 话数与页面扫描 5%
          download: 0.90, // 高清原画并发下载 90%
          pack: 0.05, // CBZ/EPUB 压缩打包 5%
        })

        try {
          const initMsg = "正在获取漫画系列目录…"
          onProgress?.(initMsg, 0, 1)
          pipeline.reportPrepare(0, 1, initMsg)

          const allIllusts: any[] = []
          let seriesTitle = fallbackTitle || ""
          let seriesCaption = ""

          // 1. 分页获取系列全部漫画话数
          let page = await session.call((tokenVal) => illustrationSeries(seriesID, tokenVal))
          if (page?.illust_series_detail) {
            seriesTitle = page.illust_series_detail.title || seriesTitle
            seriesCaption = page.illust_series_detail.caption || ""
          }
          if (Array.isArray(page?.illusts)) {
            allIllusts.push(...page.illusts)
          }

          while (page?.next_url) {
            await token.checkOrWait()
            const nextURL = page.next_url
            page = await session.call((tokenVal) => nextIllustrationSeries(nextURL, tokenVal))
            if (Array.isArray(page?.illusts)) {
              allIllusts.push(...page.illusts)
            }
          }

          if (allIllusts.length === 0) {
            throw new Error("未获取到该漫画系列的作品")
          }

          // 按正序排列
          allIllusts.sort((a, b) => (a.series_order ?? a.id) - (b.series_order ?? b.id))

          const quality = getDownloadImageQuality()
          const chapters: { id: number; title: string; pages: { pageIndex: number; url: string }[] }[] = []
          let globalPageCounter = 0
          const totalIllusts = allIllusts.length

          // 2. 依次拉取每话所有页的原图/大图 URL
          for (let i = 0; i < totalIllusts; i++) {
            await token.checkOrWait()
            const item = allIllusts[i]
            const chapTitle = item.title || `第 ${i + 1} 话`
            const statusMsg = `正在解析目录与页面 (${i + 1}/${totalIllusts}): ${chapTitle}`
            onProgress?.(statusMsg, i + 1, totalIllusts)
            pipeline.reportPrepare(i + 1, totalIllusts, statusMsg)

            try {
              const detail = await session.call((tokenVal) => illustrationDetail(item.id, tokenVal))
              if (detail) {
                const pageCount = detail.page_count ?? 1
                const chapPages: { pageIndex: number; url: string }[] = []
                for (let p = 0; p < pageCount; p++) {
                  const url = imageUrlOf(detail, p, quality)
                  if (url) {
                    globalPageCounter++
                    chapPages.push({ pageIndex: globalPageCounter, url })
                  }
                }
                if (chapPages.length > 0) {
                  chapters.push({
                    id: item.id,
                    title: chapTitle,
                    pages: chapPages,
                  })
                }
                manifest.completedIndices.push(i)
                saveManifest()
              }
            } catch (err: any) {
              console.log(`Failed to fetch manga detail ${item.id}:`, err?.message ?? err)
            }
            await yieldToMainThread()
          }

          const allPages = chapters.flatMap((c) => c.pages)
          if (allPages.length === 0) {
            throw new Error("未获取到漫画页面图像")
          }

          const authorName = allIllusts[0]?.user?.name || "Pixiv"
          const authorId = allIllusts[0]?.user?.id
          const totalPagesCount = allPages.length
          const totalProgressSteps = totalPagesCount + 1 // +1 为最后的 CBZ/EPUB 压缩打包

          // 3. 导出为 CBZ 或 EPUB
          await token.checkOrWait()
          let filePath: string | null = null
          const exportStartMsg = `准备下载漫画原图 (共 ${totalPagesCount} 页)…`
          onProgress?.(exportStartMsg, 0, totalProgressSteps)
          pipeline.reportDownload(0, totalPagesCount, exportStartMsg)

          let isPartial = false
          let downloadedCount = 0
          let totalCount = totalPagesCount

          const handleExportProgress = (msg: string, cur: number, tot: number) => {
            onProgress?.(msg, cur, tot)
            const isCompressing = msg.includes("打包") || msg.includes("压缩") || msg.includes("归档")
            if (isCompressing) {
              pipeline.reportPack(cur, tot, msg)
            } else {
              pipeline.reportDownload(cur, tot, msg)
            }
          }

          const isR18 = allIllusts.some((a) => (a.x_restrict ?? 0) > 0 || a.tags?.some((t: any) => /r-?18/i.test(t.name)))
          if (format === "cbz") {
            const res = await exportMangaToCbz({
              id: seriesID,
              title: seriesTitle || `漫画系列_${seriesID}`,
              author: authorName,
              authorId,
              seriesTitle,
              description: seriesCaption || undefined,
              tags: allIllusts[0]?.tags?.map((t: any) => t.name) ?? [],
              createdDate: allIllusts[0]?.create_date,
              isR18,
              chapters,
              token,
              taskId,
              onProgress: handleExportProgress,
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
              description: seriesCaption || undefined,
              tags: allIllusts[0]?.tags?.map((t: any) => t.name) ?? [],
              createdDate: allIllusts[0]?.create_date,
              isR18,
              chapters,
              token,
              onProgress: handleExportProgress,
            })
            filePath = res.success ? (res.path ?? null) : null
            isPartial = Boolean(res.isPartial)
            downloadedCount = res.downloadedPages
            totalCount = res.totalPages
          }

          if (!filePath) {
            throw new Error(`${formatLabel} 漫画包生成失败`)
          }

          const partialNote = isPartial ? ` (容错导出，部分缺页: ${downloadedCount}/${totalCount}P)` : ""
          const summary = `《${seriesTitle}》全 ${totalIllusts} 话 (${downloadedCount}P) ${formatLabel} 导出成功${partialNote}。`
          pipeline.reportComplete("导出成功")
          resolve(filePath)
          return { outputPath: filePath, summary }
        } catch (err: any) {
          console.log("downloadEntireMangaSeries error:", err?.message ?? err)
          resolve(null)
          throw err
        }
      },
    }).catch(reject)
  })
}
