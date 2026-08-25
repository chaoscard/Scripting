import {
  nextIllustrations,
  nextNovels,
  novelViewerData,
  userNovels,
  userWorks,
} from "../api/pixiv"
import { session } from "../api/session"
import { imageUrlOf } from "../image/imageLoader"
import { loadSettings } from "../store/settings"
import { buildUgoira } from "../ugoira/ugoira"
import { exportMangaToCbz } from "./cbzExporter"
import {
  cleanTemporaryPath,
  getAuthorDownloadDirectory,
  getCategoryDirectory,
  sanitizeFileName,
} from "./directoryResolver"
import { fetchImageBinaryWithRetry, runConcurrentTasks } from "./downloadHelper"
import { exportMangaToEpub, exportNovelToEpub, type NovelChapter } from "./epubExporter"
import { downloadIllustToAlbum, saveVideoToPixivAlbum } from "./photoAlbum"
import { runWithBackgroundTask } from "./backgroundTaskManager"
import { publishPreparedFile } from "../store/safeFile"
import type { PixivIllustration, PixivNovel } from "../types"

export interface SeriesCluster<T> {
  seriesId: number
  seriesTitle: string
  works: T[]
}

export interface WorksClusteringResult<T> {
  seriesList: SeriesCluster<T>[]
  standaloneWorks: T[]
  totalWorksCount: number
}

/**
 * 分页拉取创作者名下的全部插画或漫画作品
 */
export async function fetchAllUserIllustrations(
  userID: number,
  type: "illust" | "manga" = "illust",
  onProgress?: (msg: string, count: number) => void
): Promise<PixivIllustration[]> {
  const allWorks: PixivIllustration[] = []
  const label = type === "illust" ? "插画" : "漫画"
  onProgress?.(`正在获取用户${label}列表…`, 0)

  let page = await session.call((token) => userWorks(userID, type, token))
  if (Array.isArray(page?.items)) {
    allWorks.push(...page.items)
    onProgress?.(`已获取 ${allWorks.length} 部${label}…`, allWorks.length)
  }

  while (page?.nextURL) {
    const nextURL = page.nextURL
    page = await session.call((token) => nextIllustrations(nextURL, token))
    if (Array.isArray(page?.items)) {
      allWorks.push(...page.items)
      onProgress?.(`已获取 ${allWorks.length} 部${label}…`, allWorks.length)
    }
  }

  return allWorks
}

/**
 * 分页拉取创作者名下的全部小说作品
 */
export async function fetchAllUserNovels(
  userID: number,
  onProgress?: (msg: string, count: number) => void
): Promise<PixivNovel[]> {
  const allNovels: PixivNovel[] = []
  onProgress?.("正在获取作者小说列表…", 0)

  let page = await session.call((token) => userNovels(userID, token))
  if (Array.isArray(page?.items)) {
    allNovels.push(...page.items)
    onProgress?.(`已获取 ${allNovels.length} 部小说…`, allNovels.length)
  }

  while (page?.nextURL) {
    const nextURL = page.nextURL
    page = await session.call((token) => nextNovels(nextURL, token))
    if (Array.isArray(page?.items)) {
      allNovels.push(...page.items)
      onProgress?.(`已获取 ${allNovels.length} 部小说…`, allNovels.length)
    }
  }

  return allNovels
}

/**
 * 将漫画或插画列表按照系列 (Series) 进行聚合归类
 */
export function clusterIllustrationsBySeries(
  works: PixivIllustration[]
): WorksClusteringResult<PixivIllustration> {
  const seriesMap = new Map<number, { title: string; works: PixivIllustration[] }>()
  const standaloneWorks: PixivIllustration[] = []

  for (const item of works) {
    if (item.series && item.series.id > 0) {
      const existing = seriesMap.get(item.series.id)
      const seriesTitle = item.series.title || existing?.title || `系列_${item.series.id}`
      if (existing) {
        existing.works.push(item)
        if (!existing.title && item.series.title) {
          existing.title = item.series.title
        }
      } else {
        seriesMap.set(item.series.id, {
          title: seriesTitle,
          works: [item],
        })
      }
    } else {
      standaloneWorks.push(item)
    }
  }

  const seriesList: SeriesCluster<PixivIllustration>[] = []
  seriesMap.forEach((val, id) => {
    // 章节升序排列（从第 1 话到最新话）
    val.works.sort((a, b) => {
      const orderA = a.episode_number ?? (a as any).series_order ?? a.id
      const orderB = b.episode_number ?? (b as any).series_order ?? b.id
      return orderA - orderB
    })
    seriesList.push({
      seriesId: id,
      seriesTitle: val.title,
      works: val.works,
    })
  })

  // 按系列 ID 升序排列系列
  seriesList.sort((a, b) => a.seriesId - b.seriesId)

  return {
    seriesList,
    standaloneWorks,
    totalWorksCount: works.length,
  }
}

/**
 * 将小说列表按照系列 (Series) 进行聚合归类
 */
export function clusterNovelsBySeries(
  novels: PixivNovel[]
): WorksClusteringResult<PixivNovel> {
  const seriesMap = new Map<number, { title: string; works: PixivNovel[] }>()
  const standaloneWorks: PixivNovel[] = []

  for (const item of novels) {
    if (item.series && item.series.id > 0) {
      const existing = seriesMap.get(item.series.id)
      const seriesTitle = item.series.title || existing?.title || `系列_${item.series.id}`
      if (existing) {
        existing.works.push(item)
        if (!existing.title && item.series.title) {
          existing.title = item.series.title
        }
      } else {
        seriesMap.set(item.series.id, {
          title: seriesTitle,
          works: [item],
        })
      }
    } else {
      standaloneWorks.push(item)
    }
  }

  const seriesList: SeriesCluster<PixivNovel>[] = []
  seriesMap.forEach((val, id) => {
    val.works.sort((a, b) => {
      const orderA = (a.series as any)?.series_order ?? (a as any).series_order ?? a.id
      const orderB = (b.series as any)?.series_order ?? (b as any).series_order ?? b.id
      return orderA - orderB
    })
    seriesList.push({
      seriesId: id,
      seriesTitle: val.title,
      works: val.works,
    })
  })

  seriesList.sort((a, b) => a.seriesId - b.seriesId)

  return {
    seriesList,
    standaloneWorks,
    totalWorksCount: novels.length,
  }
}

/**
 * 批量下载画师全量插画至专属相簿
 */
export async function downloadAuthorIllustrationsToAlbum(
  authorName: string,
  illusts: PixivIllustration[],
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<{ successCount: number; totalCount: number }> {
  return runWithBackgroundTask(
    {
      title: "下载用户插画",
      subtitle: `用户: ${authorName}`,
      total: illusts.length,
      categoryIcon: "photo.stack.fill",
      initialStatus: `准备下载 ${illusts.length} 项作品至相簿…`,
    },
    async (task) => {
      let successCount = 0
      const totalCount = illusts.length

      for (let i = 0; i < illusts.length; i++) {
        const item = illusts[i]
        const statusMsg = `正在保存插画 (${i + 1}/${totalCount}): ${item.title}`
        onProgress?.(statusMsg, i + 1, totalCount)
        task.updateProgress({ current: i + 1, total: totalCount, statusText: statusMsg })

        try {
          if (item.type === "ugoira") {
            const ugoiraRes = await buildUgoira(item.id)
            if (ugoiraRes?.mp4Path) {
              const safeTitle = sanitizeFileName(`${item.title}_${authorName}_${item.id}`)
              const ok = await saveVideoToPixivAlbum(ugoiraRes.mp4Path, `${safeTitle}.mp4`)
              if (ok) successCount++
            }
          } else {
            const ok = await downloadIllustToAlbum(item)
            if (ok) successCount++
          }
        } catch (e: any) {
          console.log(`downloadAuthorIllustrationsToAlbum failed for ${item.id}:`, e?.message ?? e)
        }
      }

      const albumName = loadSettings().downloadPhotoAlbumName || "Pix-Scripting"
      await task.finish({
        success: true,
        summary: `已成功将 ${successCount}/${totalCount} 部插画保存至相簿「${albumName}」。`,
      })

      return { successCount, totalCount }
    }
  )
}

/**
 * 批量将画师全量插画打包导出为单一分层 ZIP 归档文件
 */
export async function exportAuthorIllustrationsToZip(
  authorName: string,
  authorId: number,
  illusts: PixivIllustration[],
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<string | null> {
  const quality = loadSettings().downloadImageQuality
  const safeAuthorName = sanitizeFileName(authorName || `User_${authorId}`)
  const targetDir = getAuthorDownloadDirectory(safeAuthorName, authorId, "illustrations")

  // 计算总 P 数
  let totalPages = 0
  illusts.forEach((item) => {
    totalPages += Math.max(1, item.page_count || item.meta_pages?.length || 1)
  })

  const zipFileName = sanitizeFileName(`[${safeAuthorName}] 插画全集 (共${illusts.length}部_${totalPages}P)`) + ".zip"
  const targetFilePath = `${targetDir}/${zipFileName}`
  const tempDir = `${getCategoryDirectory("temp")}/zip_author_${authorId}_${Date.now()}`

  return runWithBackgroundTask(
    {
      title: "打包用户插画全集",
      subtitle: `用户: ${safeAuthorName}`,
      total: totalPages,
      categoryIcon: "doc.zipper",
      initialStatus: `准备打包 ${illusts.length} 部插画 (${totalPages} 张)…`,
    },
    async (task) => {
      try {
        FileManager.createDirectorySync(tempDir, true)

        let processedPages = 0
        const initialMsg = `准备下载用户「${safeAuthorName}」插画全集 (共 ${illusts.length} 部, ${totalPages} 张)…`
        onProgress?.(initialMsg, 0, totalPages)
        task.updateProgress({ current: 0, total: totalPages, statusText: initialMsg })

        for (let i = 0; i < illusts.length; i++) {
          const item = illusts[i]
          const safeTitle = sanitizeFileName(item.title || "Untitled")
          const pageCount = Math.max(1, item.page_count || item.meta_pages?.length || 1)

          if (item.type === "ugoira") {
            // 动图导出为 mp4 放入根目录
            const statusMsg = `正在合成动图 (${i + 1}/${illusts.length}): ${item.title}`
            onProgress?.(statusMsg, processedPages, totalPages)
            task.updateProgress({ current: processedPages, total: totalPages, statusText: statusMsg })
            try {
              const ugoiraRes = await buildUgoira(item.id)
              if (ugoiraRes?.mp4Path && FileManager.existsSync(ugoiraRes.mp4Path)) {
                const destMp4 = `${tempDir}/${item.id}_${safeTitle}.mp4`
                await FileManager.copyFile(ugoiraRes.mp4Path, destMp4)
              }
            } catch (ugErr: any) {
              console.log(`Ugoira export error in batch ${item.id}:`, ugErr?.message ?? ugErr)
            }
            processedPages++
          } else if (pageCount === 1) {
            // 单页插画：直接放入根目录
            const url = imageUrlOf(item, 0, quality)
            if (url) {
              const data = await fetchImageBinaryWithRetry(url)
              if (data) {
                const ext = url.includes(".png") ? "png" : "jpg"
                const fileName = `${item.id}_${safeTitle}.${ext}`
                FileManager.writeAsDataSync(`${tempDir}/${fileName}`, data)
              }
            }
            processedPages++
            const statusMsg = `下载插画 (${processedPages}/${totalPages}): ${item.title}`
            onProgress?.(statusMsg, processedPages, totalPages)
            task.updateProgress({ current: processedPages, total: totalPages, statusText: statusMsg })
          } else {
            // 多页插画：创建子目录
            const subFolder = `${tempDir}/${item.id}_${safeTitle} (${pageCount}P)`
            FileManager.createDirectorySync(subFolder, true)

            const pageUrls: string[] = []
            for (let p = 0; p < pageCount; p++) {
              const url = imageUrlOf(item, p, quality)
              if (url) pageUrls.push(url)
            }

            await runConcurrentTasks(pageUrls, 4, async (url, idx) => {
              const data = await fetchImageBinaryWithRetry(url)
              if (data) {
                const paddedNum = String(idx + 1).padStart(pageUrls.length >= 100 ? 3 : 2, "0")
                const ext = url.includes(".png") ? "png" : "jpg"
                const fileName = `${paddedNum}.${ext}`
                FileManager.writeAsDataSync(`${subFolder}/${fileName}`, data)
              }
              processedPages++
              const statusMsg = `下载插画 (${processedPages}/${totalPages}): ${item.title} (P${idx + 1})`
              onProgress?.(statusMsg, processedPages, totalPages)
              task.updateProgress({ current: processedPages, total: totalPages, statusText: statusMsg })
            })
          }
        }

        // 写入画师与作品元数据
        const metaJson = {
          author: {
            id: authorId,
            name: authorName,
          },
          exported_at: new Date().toISOString(),
          total_works: illusts.length,
          total_pages: totalPages,
          works: illusts.map((it) => ({
            id: it.id,
            title: it.title,
            type: it.type,
            page_count: it.page_count,
            create_date: it.create_date,
            tags: it.tags?.map((t: any) => t.name) ?? [],
            total_bookmarks: it.total_bookmarks,
            total_view: it.total_view,
          })),
        }

        FileManager.writeAsStringSync(
          `${tempDir}/info.json`,
          JSON.stringify(metaJson, null, 2),
          "utf-8"
        )

        const packMsg = "正在打包插画全集 ZIP 压缩包…"
        onProgress?.(packMsg, totalPages, totalPages)
        task.updateProgress({ current: totalPages, total: totalPages, statusText: packMsg })

        const tempZipPath = `${tempDir}.zip`
        if (FileManager.existsSync(tempZipPath)) {
          try { FileManager.removeSync(tempZipPath) } catch {}
        }

        await FileManager.zip(tempDir, tempZipPath)
        if (!FileManager.existsSync(tempZipPath)) {
          await task.finish({
            success: false,
            summary: "ZIP 压缩包打包失败",
          })
          return null
        }

        // 使用 .bak 回滚与临时文件校验进行原子发布
        publishPreparedFile(tempZipPath, targetFilePath)

        await task.finish({
          success: true,
          summary: `已成功将 ${illusts.length} 部作品 (${totalPages}P) 打包归档至文件。`,
        })

        return targetFilePath
      } catch (err: any) {
        console.log("exportAuthorIllustrationsToZip error:", err?.message ?? err)
        await task.finish({
          success: false,
          summary: "打包插画归档时发生异常",
          errorMessage: err?.message ?? String(err),
        })
        return null
      } finally {
        // 幂等清理任务临时工作目录与临时 ZIP
        try {
          const tempZipPath = `${tempDir}.zip`
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
  )
}

/**
 * 批量将画师漫画导出（系列合并为全集卷，单篇独立导出为单本）
 */
export async function exportAuthorManga(
  authorName: string,
  authorId: number,
  mangaWorks: PixivIllustration[],
  format: "cbz" | "epub" = "cbz",
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<{ totalExported: number; targetDir: string }> {
  const quality = loadSettings().downloadImageQuality
  const safeAuthorName = sanitizeFileName(authorName || `User_${authorId}`)
  const targetDir = getAuthorDownloadDirectory(safeAuthorName, authorId, "manga")

  const clustered = clusterIllustrationsBySeries(mangaWorks)
  const totalTasks = clustered.seriesList.length + clustered.standaloneWorks.length

  return runWithBackgroundTask(
    {
      title: "导出用户漫画全集",
      subtitle: `用户: ${safeAuthorName}`,
      total: totalTasks,
      categoryIcon: "books.vertical.fill",
      initialStatus: `准备导出 ${totalTasks} 个漫画系列与短篇…`,
    },
    async (task) => {
      let completedTasks = 0
      let partialTasks = 0
      let failedTasks = 0

      // 1. 导出各个系列
      for (const series of clustered.seriesList) {
        const seriesTitle = series.seriesTitle || `系列_${series.seriesId}`
        const episodeCount = series.works.length
        const currentProgress = completedTasks + partialTasks + failedTasks
        const statusMsg = `正在导出漫画系列「${seriesTitle}」(${currentProgress + 1}/${totalTasks})…`
        onProgress?.(statusMsg, currentProgress, totalTasks)
        task.updateProgress({ current: currentProgress, total: totalTasks, statusText: statusMsg })

        // 收集该系列所有话的所有漫画页面
        const allPages: { pageIndex: number; url: string }[] = []
        let pageCounter = 1

        for (const ep of series.works) {
          const pageCount = Math.max(1, ep.page_count || ep.meta_pages?.length || 1)
          for (let p = 0; p < pageCount; p++) {
            const url = imageUrlOf(ep, p, quality)
            if (url) {
              allPages.push({ pageIndex: pageCounter++, url })
            }
          }
        }

        const customFileName = `[${safeAuthorName}] - [系列] ${seriesTitle} (全${episodeCount}话)`

        const res = format === "cbz"
          ? await exportMangaToCbz({
              id: series.seriesId,
              title: seriesTitle,
              author: authorName,
              authorId,
              seriesTitle,
              description: `包含全部 ${episodeCount} 话连载。`,
              pages: allPages,
              targetDir,
              customFileName,
            })
          : await exportMangaToEpub({
              id: series.seriesId,
              title: seriesTitle,
              author: authorName,
              authorId,
              seriesTitle,
              description: `包含全部 ${episodeCount} 话连载。`,
              pages: allPages,
              targetDir,
              customFileName,
            })

        if (res.success) {
          if (res.isPartial) {
            partialTasks++
          } else {
            completedTasks++
          }
        } else {
          failedTasks++
        }
      }

      // 2. 导出不成系列的单篇漫画
      for (const single of clustered.standaloneWorks) {
        const title = single.title || `漫画_${single.id}`
        const currentProgress = completedTasks + partialTasks + failedTasks
        const statusMsg = `正在导出短篇漫画「${title}」(${currentProgress + 1}/${totalTasks})…`
        onProgress?.(statusMsg, currentProgress, totalTasks)
        task.updateProgress({ current: currentProgress, total: totalTasks, statusText: statusMsg })

        const pageCount = Math.max(1, single.page_count || single.meta_pages?.length || 1)
        const pages: { pageIndex: number; url: string }[] = []
        for (let p = 0; p < pageCount; p++) {
          const url = imageUrlOf(single, p, quality)
          if (url) {
            pages.push({ pageIndex: p + 1, url })
          }
        }

        const customFileName = `[${safeAuthorName}] - [短篇] ${title}`

        const res = format === "cbz"
          ? await exportMangaToCbz({
              id: single.id,
              title,
              author: authorName,
              authorId,
              description: single.caption,
              pages,
              targetDir,
              customFileName,
            })
          : await exportMangaToEpub({
              id: single.id,
              title,
              author: authorName,
              authorId,
              description: single.caption,
              pages,
              targetDir,
              customFileName,
            })

        if (res.success) {
          if (res.isPartial) {
            partialTasks++
          } else {
            completedTasks++
          }
        } else {
          failedTasks++
        }
      }

      const totalSuccessful = completedTasks + partialTasks
      const summaryParts: string[] = []
      if (completedTasks > 0) summaryParts.push(`${completedTasks} 部完整`)
      if (partialTasks > 0) summaryParts.push(`${partialTasks} 部缺页容错`)
      if (failedTasks > 0) summaryParts.push(`${failedTasks} 部失败`)

      await task.finish({
        success: totalSuccessful > 0,
        summary: `已将「${safeAuthorName}」的漫画导出至文件（共 ${summaryParts.join("，")}）。`,
      })

      return { totalExported: totalSuccessful, targetDir }
    }
  )
}

/**
 * 批量将画师小说导出（系列合并为完整多章节 EPUB，单篇独立导出为单本 EPUB）
 */
export async function exportAuthorNovels(
  authorName: string,
  authorId: number,
  novels: PixivNovel[],
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<{ totalExported: number; targetDir: string }> {
  const safeAuthorName = sanitizeFileName(authorName || `User_${authorId}`)
  const targetDir = getAuthorDownloadDirectory(safeAuthorName, authorId, "novels")

  const clustered = clusterNovelsBySeries(novels)
  const totalTasks = clustered.seriesList.length + clustered.standaloneWorks.length

  return runWithBackgroundTask(
    {
      title: "导出用户小说全集",
      subtitle: `用户: ${safeAuthorName}`,
      total: totalTasks,
      categoryIcon: "book.fill",
      initialStatus: `准备导出 ${totalTasks} 个小说系列与短篇…`,
    },
    async (task) => {
      let completedTasks = 0

      // 1. 导出各个小说系列
      for (const series of clustered.seriesList) {
        const seriesTitle = series.seriesTitle || `系列_${series.seriesId}`
        const chapterCount = series.works.length
        const statusMsg = `正在拉取小说系列「${seriesTitle}」(${completedTasks + 1}/${totalTasks})…`
        onProgress?.(statusMsg, completedTasks, totalTasks)
        task.updateProgress({ current: completedTasks, total: totalTasks, statusText: statusMsg })

    const chapters: NovelChapter[] = []
    let seriesCoverUrl: string | undefined

    for (let i = 0; i < series.works.length; i++) {
      const novelItem = series.works[i]
      try {
        const viewer = await session.call((token) => novelViewerData(novelItem.id, token))
        if (viewer && viewer.text) {
          const imageMap: Record<string, string> = {}
          if (viewer.textEmbeddedImages) {
            Object.entries(viewer.textEmbeddedImages).forEach(([key, imgObj]) => {
              const url = imgObj.urls.original || imgObj.urls["1200x1200"] || imgObj.urls["480mw"]
              if (url) imageMap[key] = url
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
        console.log(`Failed to fetch novel chapter ${novelItem.id}:`, err?.message ?? err)
      }
    }

    if (chapters.length > 0) {
      const customFileName = `[${safeAuthorName}] - [系列] ${seriesTitle} (全${chapterCount}章)`
      await exportNovelToEpub({
        id: series.seriesId,
        title: seriesTitle,
        author: authorName,
        authorId,
        seriesTitle,
        coverUrl: seriesCoverUrl,
        chapters,
        targetDir,
        customFileName,
      })
    }

    completedTasks++
  }

  // 2. 导出不成系列的短篇小说
  for (const single of clustered.standaloneWorks) {
    const title = single.title || `小说_${single.id}`
    onProgress?.(`正在拉取短篇小说「${title}」(${completedTasks + 1}/${totalTasks})…`, completedTasks, totalTasks)

    try {
      const viewer = await session.call((token) => novelViewerData(single.id, token))
      if (viewer && viewer.text) {
        const imageMap: Record<string, string> = {}
        if (viewer.textEmbeddedImages) {
          Object.entries(viewer.textEmbeddedImages).forEach(([key, imgObj]) => {
            const url = imgObj.urls.original || imgObj.urls["1200x1200"] || imgObj.urls["480mw"]
            if (url) imageMap[key] = url
          })
        }

        const customFileName = `[${safeAuthorName}] - [短篇] ${title}`
        await exportNovelToEpub({
          id: single.id,
          title,
          author: authorName,
          authorId,
          coverUrl: viewer.coverUrl,
          chapters: [
            {
              id: single.id,
              title,
              text: viewer.text,
              images: imageMap,
              caption: single.caption,
            },
          ],
          targetDir,
          customFileName,
        })
      }
    } catch (err: any) {
      console.log(`Failed to fetch standalone novel ${single.id}:`, err?.message ?? err)
    }

    completedTasks++
  }

  await task.finish({
    success: true,
    summary: `已成功将「${safeAuthorName}」的 ${completedTasks} 部小说导出至文件。`,
  })

  return { totalExported: completedTasks, targetDir }
}
)
}
