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
import { loadSettings } from "../store/settings"
import { exportNovelToEpub, type NovelChapter } from "./epubExporter"
import { exportMangaToCbz } from "./cbzExporter"
import { exportMangaToEpub } from "./epubExporter"

/**
 * 整本下载并导出小说系列为单本 EPUB 电子书
 */
export async function downloadEntireNovelSeries(
  seriesID: number,
  fallbackTitle?: string,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<string | null> {
  try {
    onProgress?.("正在获取小说系列目录…", 0, 1)
    const allNovels: any[] = []
    let seriesTitle = fallbackTitle || ""
    let seriesCoverUrl: string | undefined

    // 1. 分页获取系列全部小说条目
    let page = await session.call((token) => novelSeries(seriesID, token))
    if (page?.novel_series_detail) {
      seriesTitle = page.novel_series_detail.title || seriesTitle
      seriesCoverUrl = page.novel_series_detail.cover_image_urls?.large ||
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
      return null
    }

    // 保证按系列正序排列（从第一话开始）
    allNovels.sort((a, b) => (a.series?.series_order ?? a.id) - (b.series?.series_order ?? b.id))

    const authorName = allNovels[0]?.user?.name || "Pixiv"
    const authorId = allNovels[0]?.user?.id
    const chapters: NovelChapter[] = []

    // 2. 依次拉取每章节的正文与插图数据
    for (let i = 0; i < allNovels.length; i++) {
      const novelItem = allNovels[i]
      onProgress?.(`正在拉取正文 (${i + 1}/${allNovels.length}): ${novelItem.title}`, i + 1, allNovels.length)

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
        console.log(`Failed to fetch novel ${novelItem.id}:`, err?.message ?? err)
      }
    }

    if (chapters.length === 0) return null

    // 3. 打包为整本 EPUB
    onProgress?.("正在合成整本小说 EPUB…", chapters.length, chapters.length)
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

    return filePath
  } catch (err: any) {
    console.log("downloadEntireNovelSeries error:", err?.message ?? err)
    return null
  }
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
  try {
    onProgress?.("正在获取漫画系列目录…", 0, 1)
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

    if (allIllusts.length === 0) return null

    // 按正序排列
    allIllusts.sort((a, b) => (a.series_order ?? a.id) - (b.series_order ?? b.id))

    const quality = loadSettings().downloadImageQuality
    const allPages: { pageIndex: number; url: string }[] = []
    let globalPageCounter = 0

    // 2. 依次拉取每话所有页的原图/大图 URL
    for (let i = 0; i < allIllusts.length; i++) {
      const item = allIllusts[i]
      onProgress?.(`正在解析话数信息 (${i + 1}/${allIllusts.length}): ${item.title || ""}`, i + 1, allIllusts.length)

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

    if (allPages.length === 0) return null

    const authorName = allIllusts[0]?.user?.name || "Pixiv"
    const authorId = allIllusts[0]?.user?.id

    // 3. 导出为 CBZ 或 EPUB
    let filePath: string | null = null
    if (format === "cbz") {
      filePath = await exportMangaToCbz({
        id: seriesID,
        title: seriesTitle || `漫画系列_${seriesID}`,
        author: authorName,
        authorId,
        seriesTitle,
        pages: allPages,
        onProgress: (msg, cur, tot) => onProgress?.(msg, cur, tot),
      })
    } else {
      filePath = await exportMangaToEpub({
        id: seriesID,
        title: seriesTitle || `漫画系列_${seriesID}`,
        author: authorName,
        authorId,
        seriesTitle,
        pages: allPages,
        onProgress: (msg, cur, tot) => onProgress?.(msg, cur, tot),
      })
    }

    return filePath
  } catch (err: any) {
    console.log("downloadEntireMangaSeries error:", err?.message ?? err)
    return null
  }
}
