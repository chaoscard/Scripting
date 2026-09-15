import {
  HStack,
  Image,
  ImageRenderer,
  Spacer,
  Text,
  VStack,
} from "scripting"
import type {
  PixivIllustration,
  PixivisionArtwork,
  PixivisionBodyBlock,
  PixivisionDetail,
} from "../types"
import { getDownloadImageQuality, loadSettings, type DownloadImageQuality } from "../store/settings"
import { fetchImageBinaryWithRetry, runConcurrentTasks, yieldToMainThread, yieldIfExceeded } from "./downloadHelper"
import { saveImageToPixivAlbum, withAlbumKeepAlive } from "./photoAlbum"
import { cachedFilePath, derivePixivThumbUrl, imageUrlOf, loadImage } from "../image/imageLoader"
import { getCategoryDirectory, sanitizeFileName } from "./directoryResolver"
import { notifyDownloadFilesChanged } from "./downloadFileManager"
import { getCachedIllust } from "../store/illustCache"
import { triggerHaptic } from "../platform/haptics"
import { publishPreparedFile } from "../store/safeFile"
import { session } from "../api/session"
import { illustrationDetail } from "../api/pixiv"
import { runWithBackgroundTask } from "./backgroundTaskManager"
import { DownloadTaskManager } from "./downloadTaskManager"

declare const Dialog: any

/**
 * XML / XHTML 字符转义
 */
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
 * 特辑电子画报专属响应式 CSS（连续画报流式排版、无缝图文流与深浅色自适应）
 */
const PIXIVISION_EPUB_CSS = `@charset "UTF-8";
:root {
  --bg-color: #FFFFFF;
  --card-bg: #F8F9FA;
  --text-primary: #1C1C1E;
  --text-secondary: #636366;
  --text-tertiary: #8E8E93;
  --accent-blue: #0096FA;
  --accent-teal: #00C7BE;
  --border-color: rgba(0, 0, 0, 0.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg-color: #121212;
    --card-bg: #1C1C1E;
    --text-primary: #F2F2F7;
    --text-secondary: #AEAEB2;
    --text-tertiary: #636366;
    --accent-blue: #0A84FF;
    --accent-teal: #64D2FF;
    --border-color: rgba(255, 255, 255, 0.12);
  }
}
html, body {
  margin: 0;
  padding: 0;
  background-color: var(--bg-color);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.cover-page {
  padding: 24px 20px 32px;
  margin: 0;
  background-color: var(--bg-color);
  min-height: 98vh;
  box-sizing: border-box;
}
.cover-magazine-container {
  max-width: 760px;
  margin: 0 auto;
}
.cover-brand-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.cover-badge {
  font-size: 13px;
  font-weight: 700;
  color: #FFFFFF;
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-teal));
  padding: 4px 10px;
  border-radius: 6px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.cover-date {
  font-size: 13px;
  color: var(--text-tertiary);
  font-weight: 500;
}
.cover-main-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1.35;
  margin: 8px 0 16px 0;
}
.cover-poster-wrap {
  width: 100%;
  text-align: center;
  margin-bottom: 12px;
}
.cover-poster-img {
  max-width: 100%;
  max-height: 52vh;
  height: auto;
  object-fit: contain;
  border-radius: 12px;
  box-shadow: 0 4px 20px var(--border-color);
  display: block;
  margin: 0 auto;
}
.cover-source-wrap {
  text-align: center;
  margin-bottom: 16px;
}
.cover-source-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--accent-blue);
  text-decoration: none;
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  padding: 6px 14px;
  border-radius: 20px;
  word-break: break-all;
}
.cover-source-icon {
  font-size: 12px;
}
.cover-source-text {
  font-weight: 500;
}
.cover-lead-box {
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--accent-blue);
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 14px;
}
.cover-lead-box p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.cover-tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.cover-tag-item {
  font-size: 12px;
  color: var(--accent-blue);
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  padding: 4px 10px;
  border-radius: 8px;
}
.cover-footer-bar {
  text-align: center;
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
  margin-top: 10px;
}
.cover-brand-footer {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-blue);
  margin-bottom: 4px;
}
.cover-copyright-footer {
  font-size: 11px;
  color: var(--text-tertiary);
}
.cover-wrapper {
  text-align: center;
  width: 100%;
}
.cover-img {
  max-width: 100%;
  max-height: 92vh;
  height: auto;
  object-fit: contain;
  border-radius: 12px;
  box-shadow: 0 4px 20px var(--border-color);
}
.magazine-body {
  padding: 20px 16px;
}
.magazine-article-container {
  max-width: 820px;
  margin: 0 auto;
}
.magazine-header {
  margin-bottom: 16px;
}
.magazine-meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.magazine-category {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent-blue);
  letter-spacing: 0.5px;
}
.magazine-date {
  font-size: 13px;
  color: var(--text-tertiary);
}
.magazine-title {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.35;
  color: var(--text-primary);
  margin: 8px 0 16px;
  text-align: center;
}
.magazine-hero-image-wrap {
  width: 100%;
  margin: 12px 0 16px;
  text-align: center;
}
.magazine-hero-image {
  max-width: 100%;
  height: auto;
  border-radius: 12px;
  box-shadow: 0 4px 16px var(--border-color);
  object-fit: contain;
}
.magazine-lead-box {
  background-color: var(--card-bg);
  border-left: 4px solid var(--accent-blue);
  border-radius: 8px;
  padding: 12px 16px;
  margin: 16px 0 20px;
  text-align: left;
}
.lead-tag {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-blue);
  margin-bottom: 4px;
}
.magazine-lead-box p {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.magazine-artworks-flow {
  margin-top: 16px;
}
.artwork-card {
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 16px;
  margin: 16px 0 20px;
  box-sizing: border-box;
}
.artwork-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-blue);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--border-color);
}
.artwork-id {
  font-size: 11px;
  font-weight: normal;
  color: var(--text-tertiary);
}
.artwork-image-container {
  text-align: center;
  margin: 8px 0 12px;
}
.artwork-image {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  box-shadow: 0 2px 10px var(--border-color);
  object-fit: contain;
  display: block;
  margin: 0 auto;
}
.artwork-meta {
  margin-top: 10px;
  text-align: left;
}
.artwork-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px 0;
}
.artwork-author {
  font-size: 13px;
  color: var(--accent-blue);
  margin: 0 0 8px 0;
}
.artwork-comment {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  background-color: var(--bg-color);
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  margin-top: 6px;
}
.magazine-footer {
  text-align: center;
  margin-top: 32px;
  padding: 24px 0 16px;
  border-top: 1px solid var(--border-color);
}
.magazine-brand {
  font-size: 15px;
  font-weight: 700;
  color: var(--accent-blue);
  margin-bottom: 6px;
}
.magazine-copyright {
  font-size: 11px;
  color: var(--text-tertiary);
}
nav {
  padding: 24px 20px;
}
nav h1 {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 16px;
}
nav ol {
  padding-left: 20px;
}
nav li {
  margin: 8px 0;
}
nav a {
  color: var(--accent-blue);
  text-decoration: none;
}
`

/**
 * 精确获取已下载到本地磁盘的插画物理宽高与真实比例
 */
function getLocalImageDimensions(filePath: string | null): { width: number; height: number; aspect: number } {
  if (!filePath || !FileManager.existsSync(filePath)) {
    return { width: 1200, height: 800, aspect: 1.5 }
  }
  try {
    const uiImg = UIImage.fromFile(filePath)
    if (uiImg && uiImg.width > 0 && uiImg.height > 0) {
      return {
        width: uiImg.width,
        height: uiImg.height,
        aspect: uiImg.width / uiImg.height,
      }
    }
  } catch {}
  return { width: 1200, height: 800, aspect: 1.5 }
}

// ============================================================================
// 1. 帮助函数与数据构建
// ============================================================================

/**
 * 根据画作 ID 尝试从缓存或网络请求获取官方真实 PixivIllustration 元数据（包含真实 img-original 原图地址）
 */
async function resolveArtworkIllustration(artwork: PixivisionArtwork): Promise<PixivIllustration> {
  if (artwork.id) {
    const cached = getCachedIllust(artwork.id)
    if (cached && cached.image_urls?.original && cached.image_urls.original.includes("img-original")) {
      return cached
    }
    try {
      const live = await session.call((token) => illustrationDetail(artwork.id, token))
      if (live && live.image_urls) {
        return live
      }
    } catch (e: any) {
      console.log(`Failed to fetch original illust #${artwork.id}:`, e?.message ?? e)
    }
  }
  return buildArtworkSkeleton(artwork)
}

/**
 * 根据画作与用户画质设置，获取真实的高清原图下载链接
 */
async function resolveArtworkHighResUrl(
  artwork: PixivisionArtwork,
  quality: DownloadImageQuality = getDownloadImageQuality()
): Promise<string> {
  if (artwork.id) {
    const illust = await resolveArtworkIllustration(artwork)
    const highResUrl = imageUrlOf(illust, 0, quality) || illust.image_urls?.large || illust.image_urls?.original
    if (highResUrl) {
      return highResUrl
    }
  }
  return artwork.imageURL
}
export function buildArtworkSkeleton(artwork: PixivisionArtwork): PixivIllustration {
  const thumb = artwork.thumbURL || derivePixivThumbUrl(artwork.imageURL) || artwork.imageURL
  const hasDrafts = Boolean(artwork.draftImages && artwork.draftImages.length > 0)
  const metaPages = hasDrafts
    ? [
        {
          image_urls: {
            square_medium: thumb,
            medium: thumb,
            large: artwork.imageURL,
            original: artwork.imageURL,
          },
        },
        ...artwork.draftImages!.map((d) => {
          const dThumb = d.thumbURL || derivePixivThumbUrl(d.imageURL) || d.imageURL
          return {
            image_urls: {
              square_medium: dThumb,
              medium: dThumb,
              large: d.imageURL,
              original: d.imageURL,
            },
          }
        }),
      ]
    : []

  return {
    id: artwork.id,
    title: artwork.title,
    type: "illust",
    image_urls: {
      square_medium: thumb,
      medium: thumb,
      large: artwork.imageURL,
      original: artwork.imageURL,
    },
    caption: artwork.comment || "",
    user: {
      id: artwork.authorID || 0,
      name: artwork.authorName || "Artist",
      account: "",
      profile_image_urls: {
        medium: "",
      },
      is_followed: false,
    },
    tags: [],
    create_date: new Date().toISOString(),
    page_count: metaPages.length > 0 ? metaPages.length : 1,
    width: artwork.width || 1200,
    height: artwork.height || 800,
    x_restrict: 0,
    series: null,
    meta_single_page: {},
    meta_pages: metaPages,
    total_view: 0,
    total_bookmarks: 0,
    is_bookmarked: false,
    is_muted: false,
    total_comments: 0,
    illust_ai_type: 0,
    comment_access_control: 0,
  }
}

/**
 * 确保单个图片已下载到本地磁盘缓存，返回本地文件绝对路径
 */
async function ensureImageCached(url: string): Promise<string | null> {
  if (!url) return null
  const local = cachedFilePath(url)
  if (local && FileManager.existsSync(local)) {
    return local
  }
  try {
    const data = await fetchImageBinaryWithRetry(url, 2)
    if (data) {
      // 触发一次 loadImage 写入磁盘缓存
      await loadImage(url)
      const cached = cachedFilePath(url)
      if (cached && FileManager.existsSync(cached)) {
        return cached
      }
    }
  } catch (e: any) {
    console.log("ensureImageCached error for url:", url, e?.message ?? e)
  }
  return cachedFilePath(url)
}

// ============================================================================
// 2. 特性 A：批量下载特辑内所有插画至系统相册
// ============================================================================

export interface BatchDownloadPixivisionResult {
  success: boolean
  total: number
  downloaded: number
  failed: number
}

export async function downloadAllPixivisionImagesToAlbum(
  detail: PixivisionDetail,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<BatchDownloadPixivisionResult> {
  const cleanSubtitle = detail.title.length > 20 ? detail.title.slice(0, 18) + "…" : detail.title
  const totalArtworks = (detail.artworks || []).length
  const initialTotal = totalArtworks > 0 ? totalArtworks : 1

  return runWithBackgroundTask(
    {
      title: "下载特辑插画",
      subtitle: cleanSubtitle,
      total: initialTotal,
      categoryIcon: "rectangle.stack.fill",
      initialStatus: "正在解析特辑插画直链…",
    },
    async (bgTask) => {
      const quality: DownloadImageQuality = getDownloadImageQuality()
      const tasks: { index: number; url: string; fileName: string }[] = []

      // 1. 并发解析各作品真实画质直链（带协程让出主线程）
      const artworks = detail.artworks || []
      if (artworks.length > 0) {
        onProgress?.(0, artworks.length, "正在按画质设置解析插画直链…")
        bgTask.updateProgress({
          current: 0,
          total: artworks.length,
          statusText: "正在解析特辑原画直链…",
        })

        const resolvedList: Array<{ art: PixivisionArtwork; illust: PixivIllustration; index: number }> = []

        await runConcurrentTasks(artworks, 4, async (art, idx) => {
          const illust = await resolveArtworkIllustration(art)
          resolvedList.push({ art, illust, index: idx })
          await yieldToMainThread()
        })

        resolvedList.sort((a, b) => a.index - b.index)

        // 精选单页下载：特辑严格对齐正文赏析精选原画 (p0)，防止多图作品引起任务量恶意膨胀
        resolvedList.forEach(({ art, illust }) => {
          const url =
            imageUrlOf(illust, 0, quality) ||
            illust.image_urls?.large ||
            illust.image_urls?.original ||
            art.imageURL
          if (url) {
            tasks.push({
              index: tasks.length + 1,
              url,
              fileName: `pixivision_${detail.id}_art_${art.id}`,
            })
          }
        })
      }

      // 2. 收集正文独立配图 (blocks.image)
      if (detail.blocks && detail.blocks.length > 0) {
        detail.blocks.forEach((block, idx) => {
          if (block.type === "image" && block.src) {
            const alreadyAdded = tasks.some((t) => t.url === block.src)
            if (!alreadyAdded) {
              tasks.push({
                index: tasks.length + 1,
                url: block.src,
                fileName: `pixivision_${detail.id}_img_${idx + 1}`,
              })
            }
          }
        })
      }

      if (tasks.length === 0) {
        await bgTask.finish({
          success: false,
          summary: "特辑内无可用插画",
          errorMessage: "未找到可供下载的插画",
        })
        return { success: false, total: 0, downloaded: 0, failed: 0 }
      }

      let downloadedCount = 0
      let failedCount = 0

      onProgress?.(0, tasks.length, `准备下载特辑插画 (共 ${tasks.length} 张)…`)
      bgTask.updateProgress({
        current: 0,
        total: tasks.length,
        statusText: `准备下载插画 (共 ${tasks.length} 张)…`,
      })

      // 3. 并发下载与相册写入（带主线程协程让出）
      await runConcurrentTasks(tasks, 3, async (task) => {
        try {
          const cached = cachedFilePath(task.url)
          if (cached && FileManager.existsSync(cached)) {
            const ok = await saveImageToPixivAlbum(cached, task.fileName)
            if (ok) downloadedCount++
            else failedCount++
          } else {
            const data = await fetchImageBinaryWithRetry(task.url, 2)
            if (data) {
              const ok = await saveImageToPixivAlbum(data, task.fileName)
              if (ok) downloadedCount++
              else failedCount++
            } else {
              failedCount++
            }
          }
        } catch (err: any) {
          console.log(`download task error for ${task.fileName}:`, err?.message ?? err)
          failedCount++
        }

        const processed = downloadedCount + failedCount
        const statusMsg = `正在下载第 ${processed}/${tasks.length} 张…`
        onProgress?.(processed, tasks.length, statusMsg)
        bgTask.updateProgress({
          current: processed,
          total: tasks.length,
          statusText: `正在存入相簿 (${processed}/${tasks.length})`,
        })

        // 每次完成一张后让出主线程
        await yieldToMainThread()
      })

      const isSuccess = downloadedCount > 0
      await bgTask.finish({
        success: isSuccess,
        summary: isSuccess
          ? `已成功将 ${downloadedCount} 张特辑插画存入专属相簿`
          : "特辑插画下载失败",
        errorMessage: isSuccess ? undefined : "下载过程中发生错误",
      })

      return {
        success: isSuccess,
        total: tasks.length,
        downloaded: downloadedCount,
        failed: failedCount,
      }
    }
  )
}

// ============================================================================
// 3. 特性 B：特辑图文长图拼合导出至系统相册
// ============================================================================

export interface LongImageExportResult {
  success: boolean
  imagePath?: string
  error?: string
}

export async function exportPixivisionLongImageToAlbum(
  detail: PixivisionDetail,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<LongImageExportResult> {
  const cleanSubtitle = detail.title.length > 20 ? detail.title.slice(0, 18) + "…" : detail.title

  const artworks = detail.artworks || []
  const imageBlocks = (detail.blocks || []).filter(
    (b): b is Extract<PixivisionBodyBlock, { type: "image" }> => b.type === "image"
  )
  const allUrls: string[] = []
  if (detail.thumbnailURL) allUrls.push(detail.thumbnailURL)
  artworks.forEach((a) => {
    if (a.imageURL) allUrls.push(a.imageURL)
  })
  imageBlocks.forEach((b) => {
    if (b.src) allUrls.push(b.src)
  })
  const uniqueUrls = Array.from(new Set(allUrls.filter(Boolean)))
  const totalSteps = uniqueUrls.length + 2

  return runWithBackgroundTask(
    {
      title: "合成特辑长图",
      subtitle: cleanSubtitle,
      total: totalSteps,
      categoryIcon: "rectangle.stack.fill",
      initialStatus: "正在预加载特辑高清画作…",
    },
    async (bgTask) => {
      try {
        // 1. 预加载所有插画到本地（带协程让出主线程）
        onProgress?.(0, uniqueUrls.length, "正在预加载特辑高清画作…")
        bgTask.updateProgress({
          current: 0,
          total: totalSteps,
          statusText: "正在预加载特辑高清画作…",
        })

        let loadedCount = 0
        await runConcurrentTasks(uniqueUrls, 4, async (url) => {
          await ensureImageCached(url)
          loadedCount++
          onProgress?.(loadedCount, uniqueUrls.length, `正在缓存图片 (${loadedCount}/${uniqueUrls.length})…`)
          bgTask.updateProgress({
            current: loadedCount,
            total: totalSteps,
            statusText: `正在缓存画作 (${loadedCount}/${uniqueUrls.length})`,
          })
          await yieldToMainThread()
        })

        onProgress?.(uniqueUrls.length, uniqueUrls.length, "正在排版与计算安全尺寸…")
        bgTask.updateProgress({
          current: uniqueUrls.length,
          total: totalSteps,
          statusText: "正在排版与计算安全尺寸…",
        })
        await yieldToMainThread()

        // 2. 构造长图 VirtualNode (750pt 宽度，专业版面排版)
        const canvasWidth = 750
        const contentPadding = 32
        const cardWidth = canvasWidth - contentPadding * 2

        const longImageElement = (
          <VStack
            alignment="leading"
            spacing={24}
            padding={contentPadding}
            background="#FFFFFF"
            frame={{ width: canvasWidth }}
          >
            {/* Header */}
            <VStack alignment="leading" spacing={12} frame={{ width: cardWidth }}>
              <HStack alignment="center">
                <Text font="headline" fontWeight="bold" foregroundStyle="#0096FA">
                  {detail.category || "Pixivision 特辑"}
                </Text>
                <Spacer />
                <Text font="subheadline" foregroundStyle="#8E8E93">
                  {detail.date ? detail.date.slice(0, 10) : ""}
                </Text>
              </HStack>

              <Text
                font="title"
                fontWeight="bold"
                foregroundStyle="#1C1C1E"
                multilineTextAlignment="center"
                frame={{ width: cardWidth, alignment: "center" }}
              >
                {detail.title}
              </Text>

              {detail.lead ? (
                <VStack
                  alignment="leading"
                  spacing={6}
                  padding={16}
                  background="#F2F2F7"
                  clipShape={{ type: "rect", cornerRadius: 12 }}
                  frame={{ width: cardWidth }}
                >
                  <Text font="caption" fontWeight="bold" foregroundStyle="#0096FA">
                    导语
                  </Text>
                  <Text font="body" foregroundStyle="#3A3A3C" lineSpacing={4}>
                    {detail.lead.replace(/<[^>]+>/g, "").trim()}
                  </Text>
                </VStack>
              ) : null}
            </VStack>

            {/* Body Artworks */}
            {artworks.map((art, idx) => {
              const localPath = cachedFilePath(art.imageURL)
              const dims = getLocalImageDimensions(localPath)
              const aspect = dims.aspect
              const imageContainerWidth = cardWidth - 32
              const imageHeight = Math.round(imageContainerWidth / aspect)

              return (
                <VStack
                  key={`long-art-${art.id}-${idx}`}
                  alignment="leading"
                  spacing={12}
                  padding={16}
                  background="#F8F9FA"
                  clipShape={{ type: "rect", cornerRadius: 16 }}
                  frame={{ width: cardWidth }}
                >
                  {localPath && FileManager.existsSync(localPath) ? (
                    <Image
                      filePath={localPath}
                      resizable={true}
                      aspectRatio={{ value: aspect, contentMode: "fit" }}
                      frame={{ width: imageContainerWidth, height: imageHeight }}
                      clipShape={{ type: "rect", cornerRadius: 10 }}
                    />
                  ) : null}

                  <VStack alignment="leading" spacing={4} frame={{ width: imageContainerWidth }}>
                    <Text font="headline" fontWeight="bold" foregroundStyle="#1C1C1E">
                      {art.title}
                    </Text>
                    {art.authorName ? (
                      <Text font="subheadline" foregroundStyle="#0096FA">
                        by {art.authorName}
                      </Text>
                    ) : null}
                  </VStack>

                  {art.comment ? (
                    <Text font="footnote" foregroundStyle="#636366" lineSpacing={3}>
                      {art.comment.replace(/<[^>]+>/g, "").trim()}
                    </Text>
                  ) : null}
                </VStack>
              )
            })}

            {/* Footer */}
            <VStack alignment="center" spacing={8} padding={{ top: 20, bottom: 10 }} frame={{ width: cardWidth }}>
              <Text font="headline" fontWeight="bold" foregroundStyle="#0096FA">
                Pixivision × Pix-Scripting
              </Text>
              <Text font="caption2" foregroundStyle="#AEAEB2">
                特辑内容版权归 Pixiv 及各原作者所有 · 离线珍藏生成
              </Text>
            </VStack>
          </VStack>
        )

        // 3. 动态自适应 Scale：严格将物理高度限制在 iOS 纹理安全阈值（12,000 px）内（带时间片预算）
        let estimatedHeight = 360
        let timeBudget = Date.now()
        for (const art of artworks) {
          const localPath = cachedFilePath(art.imageURL)
          const dims = getLocalImageDimensions(localPath)
          const imageHeight = Math.round((cardWidth - 32) / dims.aspect)
          estimatedHeight += imageHeight + 160
          timeBudget = await yieldIfExceeded(timeBudget, 10)
        }

        const maxSafePixels = 12000
        const calculatedScale = maxSafePixels / Math.max(1, estimatedHeight)
        const renderScale = Math.round(Math.max(1.0, Math.min(2.0, calculatedScale)) * 10) / 10

        onProgress?.(uniqueUrls.length, uniqueUrls.length, "正在渲染高清排版长图…")
        bgTask.updateProgress({
          current: uniqueUrls.length + 1,
          total: totalSteps,
          statusText: "正在渲染高清排版长图…",
        })
        await yieldToMainThread()

        // 渲染为 UIImage
        const renderedImage = await ImageRenderer.toUIImage(longImageElement, {
          scale: renderScale,
          opaque: true,
        })

        if (!renderedImage) {
          await bgTask.finish({
            success: false,
            summary: "长图位图渲染失败",
            errorMessage: "ImageRenderer 无法生成位图",
          })
          return { success: false, error: "长图位图渲染失败" }
        }

        // 4. 存入 Pixiv 相册
        const jpegData = renderedImage.toJPEGData(0.92)
        if (!jpegData) {
          await bgTask.finish({
            success: false,
            summary: "JPEG 数据转换失败",
            errorMessage: "toJPEGData 转换失败",
          })
          return { success: false, error: "JPEG 数据转换失败" }
        }

        const fileName = `pixivision_${detail.id}_long_${Date.now()}`
        const saved = await saveImageToPixivAlbum(jpegData, fileName)
        if (!saved) {
          await bgTask.finish({
            success: false,
            summary: "保存至专属相簿失败",
            errorMessage: "相册保存失败",
          })
          return { success: false, error: "相册保存失败" }
        }

        await bgTask.finish({
          success: true,
          summary: "特辑长图已成功合成并保存至相簿",
        })

        return { success: true }
      } catch (e: any) {
        console.log("exportPixivisionLongImageToAlbum error:", e?.message ?? e)
        await bgTask.finish({
          success: false,
          summary: "合成长图时发生异常",
          errorMessage: e?.message ?? String(e),
        })
        return { success: false, error: e?.message ?? String(e) }
      }
    }
  )
}

// ============================================================================
// 4. 特性 C：特辑导出为标准 EPUB 电子画报至文件目录 (Pix-Scripting/pixivision/)
// ============================================================================

export interface EpubExportResult {
  success: boolean
  filePath?: string
  error?: string
}

export async function exportPixivisionToEpub(
  detail: PixivisionDetail,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<EpubExportResult> {
  const cleanSubtitle = detail.title.length > 20 ? detail.title.slice(0, 18) + "…" : detail.title
  const artworks = detail.artworks || []
  const initialTotal = artworks.length > 0 ? artworks.length + 2 : 2
  const taskId = `pixivision_epub_${detail.id}_${Date.now()}`

  return new Promise<EpubExportResult>((resolve) => {
    void DownloadTaskManager.submitTask({
      taskId,
      type: "pixivision_epub",
      title: "导出特辑 EPUB",
      subtitle: cleanSubtitle,
      total: initialTotal,
      categoryIcon: "rectangle.stack.fill",
      runner: async (token, task, manifest, saveManifest) => {
        const tempDir = `${getCategoryDirectory("temp")}/epub_pixivision_${detail.id}_${Date.now()}`
        const oebpsDir = `${tempDir}/OEBPS`
        const metaInfDir = `${tempDir}/META-INF`
        const imagesDir = `${oebpsDir}/images`
        const tempZipPath = `${tempDir}.zip`

        try {
          const quality = getDownloadImageQuality()

          // 1. 并发解析各精选画作的高清原画/大图元数据与下载直链（带协程让出主线程）
          onProgress?.(0, artworks.length + 1, "正在解析特辑高清原画直链…")
          task.updateProgress({
            current: 0,
            total: initialTotal,
            statusText: "正在解析特辑高清原画直链…",
          })

          interface ResolvedArtInfo {
            art: PixivisionArtwork
            index: number
            highResUrl: string
            fileName: string
            mediaType: string
          }

          const resolvedArtworks: ResolvedArtInfo[] = []
          await runConcurrentTasks(artworks, 4, async (art, idx) => {
            await token.checkOrWait()
            const highResUrl = await resolveArtworkHighResUrl(art, quality)
            const ext = highResUrl.includes(".png") ? "png" : highResUrl.includes(".webp") ? "webp" : "jpg"
            const fileName = `art_${idx + 1}_${art.id}.${ext}`
            const mediaType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
            resolvedArtworks.push({
              art,
              index: idx,
              highResUrl,
              fileName,
              mediaType,
            })
            await yieldToMainThread()
          })

          // 保持原始先后顺序
          resolvedArtworks.sort((a, b) => a.index - b.index)

          // 2. 准备所有待下载图片任务（包含封面和各插画原图）
          interface ImageDownloadTask {
            url: string
            destPath: string
            fileName: string
            mediaType: string
            isCover?: boolean
          }

          const downloadTasks: ImageDownloadTask[] = []
          const coverUrl = detail.thumbnailURL || artworks[0]?.imageURL || resolvedArtworks[0]?.highResUrl
          let coverFileName = "cover.jpg"
          if (coverUrl) {
            const coverExt = coverUrl.includes(".png") ? "png" : "jpg"
            coverFileName = `cover.${coverExt}`
            downloadTasks.push({
              url: coverUrl,
              destPath: `${imagesDir}/${coverFileName}`,
              fileName: coverFileName,
              mediaType: coverExt === "png" ? "image/png" : "image/jpeg",
              isCover: true,
            })
          }

          resolvedArtworks.forEach((item) => {
            downloadTasks.push({
              url: item.highResUrl,
              destPath: `${imagesDir}/${item.fileName}`,
              fileName: item.fileName,
              mediaType: item.mediaType,
              isCover: false,
            })
          })

          const totalSteps = downloadTasks.length + 2

          // 3. 创建 EPUB 目录结构与标准容器
          FileManager.createDirectorySync(imagesDir, true)
          FileManager.createDirectorySync(metaInfDir, true)

          // 3.1 mimetype (规范必须是首个无 BOM 文件)
          FileManager.writeAsStringSync(`${tempDir}/mimetype`, "application/epub+zip", "utf-8")

          // 3.2 container.xml
          const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
          FileManager.writeAsStringSync(`${metaInfDir}/container.xml`, containerXml, "utf-8")

          // 3.3 style.css (无缝流式画报排版样式)
          FileManager.writeAsStringSync(`${oebpsDir}/style.css`, PIXIVISION_EPUB_CSS, "utf-8")

          // 4. 并发下载高清原图与封面（带协程让出主线程）
          let downloadedImagesCount = 0
          onProgress?.(0, downloadTasks.length, `正在下载特辑高清原画 (共 ${downloadTasks.length} 张)…`)
          task.updateProgress({
            current: 0,
            total: totalSteps,
            statusText: `正在下载原画素材 (共 ${downloadTasks.length} 张)…`,
          })

          await runConcurrentTasks(downloadTasks, 4, async (imgTask) => {
            await token.checkOrWait()
            try {
              const cached = cachedFilePath(imgTask.url)
              if (cached && FileManager.existsSync(cached)) {
                FileManager.copyFileSync(cached, imgTask.destPath)
              } else {
                const data = await fetchImageBinaryWithRetry(imgTask.url, 2)
                if (data) {
                  FileManager.writeAsDataSync(imgTask.destPath, data)
                }
              }
            } catch (e: any) {
              console.log(`Failed to download epub image ${imgTask.fileName}:`, e?.message ?? e)
            }
            downloadedImagesCount++
            const statusText = `正在下载原画 (${downloadedImagesCount}/${downloadTasks.length})…`
            onProgress?.(downloadedImagesCount, downloadTasks.length, statusText)
            task.updateProgress({
              current: downloadedImagesCount,
              total: totalSteps,
              statusText,
            })
            await yieldToMainThread()
          })

          // 5. 构造 EPUB 章节与页面内容
          onProgress?.(downloadTasks.length, totalSteps, "正在合成 EPUB 电子画报…")
          task.updateProgress({
            current: downloadTasks.length,
            total: totalSteps,
            statusText: "正在生成画报页面与目录…",
          })
          await yieldToMainThread()

          const manifestImages: Array<{ id: string; href: string; mediaType: string; isCover?: boolean }> = []
          downloadTasks.forEach((imgTask, idx) => {
            manifestImages.push({
              id: imgTask.isCover ? "cover-image" : `img_${idx}`,
              href: `images/${imgTask.fileName}`,
              mediaType: imgTask.mediaType,
              isCover: imgTask.isCover,
            })
          })

          // 5.1 cover.xhtml (精美画报杂志封面：包含标头、大标题、封面插画海报、原始网页链接、简介与标签)
          const summaryText = (detail.lead || detail.description || "").replace(/<[^>]+>/g, "").trim()
          const coverLeadHtml = summaryText
            ? `<div class="cover-lead-box"><p>${escapeXml(summaryText)}</p></div>`
            : ""

          const coverTagsHtml =
            detail.tags && detail.tags.length > 0
              ? `<div class="cover-tags-wrap">${detail.tags
                  .map((t) => `<span class="cover-tag-item">#${escapeXml(t.name)}</span>`)
                  .join("\n")}</div>`
              : ""

          const articleWebUrl = `https://www.pixivision.net/zh/a/${detail.id}`

          const coverXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(detail.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body class="cover-page">
  <div class="cover-magazine-container">
    <div class="cover-brand-bar">
      <span class="cover-badge">${escapeXml(detail.category || "PIXIVISION 特辑")}</span>
      <span class="cover-date">${escapeXml(detail.date ? detail.date.slice(0, 10) : "")}</span>
    </div>

    <h1 class="cover-main-title">${escapeXml(detail.title)}</h1>

    <div class="cover-poster-wrap">
      <img src="images/${coverFileName}" alt="Cover" class="cover-poster-img"/>
    </div>

    <div class="cover-source-wrap">
      <a href="${articleWebUrl}" class="cover-source-link">
        <span class="cover-source-icon">🔗</span>
        <span class="cover-source-text">${articleWebUrl}</span>
      </a>
    </div>

    ${coverLeadHtml}

    ${coverTagsHtml}

    <div class="cover-footer-bar">
      <div class="cover-brand-footer">Pixivision × Pix-Scripting</div>
      <div class="cover-copyright-footer">特辑内容版权归 Pixiv 及各原作者所有 · 离线珍藏画报</div>
    </div>
  </div>
</body>
</html>`
          FileManager.writeAsStringSync(`${oebpsDir}/cover.xhtml`, coverXhtml, "utf-8")

          // 5.2 article.xhtml (连续无缝图文画报正文瀑布流，不重复封面与简介)
          const artworkCardsHtml = resolvedArtworks
            .map((item) => {
              const { art, index, fileName } = item
              const commentHtml = art.comment
                ? `<div class="artwork-comment">${escapeXml(art.comment.replace(/<[^>]+>/g, "").trim())}</div>`
                : ""
              return `
      <div id="art-${index + 1}" class="artwork-card">
        <div class="artwork-header">
          <span class="artwork-badge">精选画作 ${index + 1} / ${resolvedArtworks.length}</span>
          <span class="artwork-id">ID: ${art.id}</span>
        </div>
        <div class="artwork-image-container">
          <img src="images/${fileName}" alt="${escapeXml(art.title)}" class="artwork-image"/>
        </div>
        <div class="artwork-meta">
          <h2 class="artwork-title">${escapeXml(art.title)}</h2>
          ${art.authorName ? `<div class="artwork-author">画师: ${escapeXml(art.authorName)}</div>` : ""}
          ${commentHtml}
        </div>
      </div>`
            })
            .join("\n")

          const articleXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(detail.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body class="magazine-body">
  <div class="magazine-article-container">
    <div class="magazine-artworks-flow">
${artworkCardsHtml}
    </div>

    <div class="magazine-footer">
      <div class="magazine-brand">Pixivision × Pix-Scripting</div>
      <div class="magazine-copyright">特辑内容版权归 Pixiv 及各原作者所有 · 离线珍藏生成</div>
    </div>
  </div>
</body>
</html>`
          FileManager.writeAsStringSync(`${oebpsDir}/article.xhtml`, articleXhtml, "utf-8")

          // 6. 构造 TOC 目录导航 (支持锚点直达各精选画作)
          interface TocItem {
            title: string
            href: string
          }
          const tocItems: TocItem[] = [
            { title: "封面", href: "cover.xhtml" },
            { title: "特辑导语", href: "article.xhtml" },
            ...resolvedArtworks.map((item) => ({
              title: `${String(item.index + 1).padStart(2, "0")}. ${item.art.title || `画作 #${item.art.id}`}${item.art.authorName ? ` - ${item.art.authorName}` : ""}`,
              href: `article.xhtml#art-${item.index + 1}`,
            })),
          ]

          // 6.1 toc.ncx
          const navPoints = tocItems
            .map(
              (item, idx) => `    <navPoint id="navPoint-${idx + 1}" playOrder="${idx + 1}">
      <navLabel><text>${escapeXml(item.title)}</text></navLabel>
      <content src="${item.href}"/>
    </navPoint>`
            )
            .join("\n")

          const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:pixivision:${detail.id}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${escapeXml(detail.title)}</text>
  </docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`
          FileManager.writeAsStringSync(`${oebpsDir}/toc.ncx`, tocNcx, "utf-8")

          // 6.2 nav.xhtml (EPUB 3 Navigation Document)
          const navListItems = tocItems
            .map((item) => `      <li><a href="${item.href}">${escapeXml(item.title)}</a></li>`)
            .join("\n")

          const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>目录</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${navListItems}
    </ol>
  </nav>
</body>
</html>`
          FileManager.writeAsStringSync(`${oebpsDir}/nav.xhtml`, navXhtml, "utf-8")

          // 6.3 content.opf
          const manifestItemsXml = [
            `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
            `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
            `    <item id="css" href="style.css" media-type="text/css"/>`,
            `    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
            `    <item id="article" href="article.xhtml" media-type="application/xhtml+xml"/>`,
            ...manifestImages.map((img) =>
              img.isCover
                ? `    <item id="${img.id}" href="${img.href}" media-type="${img.mediaType}" properties="cover-image"/>`
                : `    <item id="${img.id}" href="${img.href}" media-type="${img.mediaType}"/>`
            ),
          ].join("\n")

          const tagSubjectsXml = (detail.tags || [])
            .map((t) => `    <dc:subject>${escapeXml(t.name)}</dc:subject>`)
            .join("\n")

          const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:pixivision:${detail.id}</dc:identifier>
    <dc:title>${escapeXml(detail.title)}</dc:title>
    <dc:creator>Pixivision</dc:creator>
    <dc:publisher>Pixivision</dc:publisher>
    <dc:language>zh-CN</dc:language>
    <dc:date>${new Date().toISOString()}</dc:date>
    <dc:description>${escapeXml(detail.lead ? detail.lead.replace(/<[^>]+>/g, "").trim() : detail.title)}</dc:description>
${tagSubjectsXml}
    <meta name="cover" content="cover-image"/>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
${manifestItemsXml}
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
    <itemref idref="article"/>
  </spine>
</package>`
          FileManager.writeAsStringSync(`${oebpsDir}/content.opf`, contentOpf, "utf-8")

          // 7. 组装与打包 EPUB
          onProgress?.(downloadTasks.length + 1, totalSteps, "正在压缩封装 EPUB 归档…")
          task.updateProgress({
            current: downloadTasks.length + 1,
            total: totalSteps,
            statusText: "正在压缩封装 EPUB 归档…",
          })
          await yieldToMainThread()

          const targetDir = getCategoryDirectory("pixivision")
          if (!FileManager.existsSync(targetDir)) {
            try {
              FileManager.createDirectorySync(targetDir, true)
            } catch {}
          }
          const safeTitle = sanitizeFileName(`pixivision_${detail.id}_${detail.title}`)
          const targetFilePath = `${targetDir}/${safeTitle}.epub`

          if (FileManager.existsSync(tempZipPath)) {
            try {
              FileManager.removeSync(tempZipPath)
            } catch {}
          }

          await FileManager.zip(tempDir, tempZipPath)
          if (!FileManager.existsSync(tempZipPath)) {
            throw new Error("EPUB 归档压缩失败")
          }

          publishPreparedFile(tempZipPath, targetFilePath)
          notifyDownloadFilesChanged()

          resolve({
            success: true,
            filePath: targetFilePath,
          })

          return {
            summary: "特辑 EPUB 电子画报已成功导出",
            outputPath: targetFilePath,
          }
        } catch (e: any) {
          console.log("exportPixivisionToEpub error:", e?.message ?? e)
          resolve({ success: false, error: e?.message ?? String(e) })
          throw e
        } finally {
          try {
            if (FileManager.existsSync(tempDir)) {
              FileManager.removeSync(tempDir)
            }
            if (FileManager.existsSync(tempZipPath)) {
              FileManager.removeSync(tempZipPath)
            }
          } catch {}
        }
      },
    }).catch((err) => {
      resolve({ success: false, error: err?.message ?? String(err) })
    })
  })
}

// ============================================================================
// 5. 交互层：弹出下载与导出 ActionSheet
// ============================================================================

export async function presentPixivisionDownloadActionSheet(
  detail: PixivisionDetail,
  onStatusChange?: (status: string | null) => void
): Promise<void> {
  try {
    triggerHaptic("selection")
  } catch {}

  const artworkCount = detail.artworks?.length || 0
  const imageBlocksCount = detail.blocks?.filter((b) => b.type === "image")?.length || 0
  const totalImages = artworkCount > 0 ? artworkCount : imageBlocksCount

  const currentSettings = loadSettings()
  const albumName = currentSettings.downloadPhotoAlbumName || "Pix-Scripting"

  if (typeof Dialog !== "undefined" && typeof Dialog.actionSheet === "function") {
    const choice = await Dialog.actionSheet({
      title: "特辑下载与导出",
      message: detail.title,
      actions: [
        { label: `下载全部插画至相簿 (共 ${totalImages} 张)` },
        { label: "拼接特辑长图至相簿" },
        { label: "导出特辑 EPUB 画报至文件" },
      ],
    })

    if (choice == null || choice < 0 || choice > 2) return

    if (choice === 0) {
      try {
        triggerHaptic("light")
      } catch {}
      onStatusChange?.("正在下载插画…")
      const res = await downloadAllPixivisionImagesToAlbum(detail, (_curr, _tot, msg) => {
        onStatusChange?.(msg)
      })
      onStatusChange?.(null)
      if (res.success) {
        try {
          triggerHaptic("success")
        } catch {}
        if (typeof Dialog.alert === "function") {
          void Dialog.alert({
            title: "下载完成",
            message: `已成功将 ${res.downloaded} 张特辑插画存入专属相簿「${albumName}」。`,
          })
        }
      } else {
        try {
          triggerHaptic("error")
        } catch {}
        if (typeof Dialog.alert === "function") {
          void Dialog.alert({
            title: "下载失败",
            message: "未能成功下载特辑插画，请检查网络或相册权限后重试。",
          })
        }
      }
    } else if (choice === 1) {
      try {
        triggerHaptic("light")
      } catch {}
      onStatusChange?.("正在拼合长图…")
      const res = await exportPixivisionLongImageToAlbum(detail, (_curr, _tot, msg) => {
        onStatusChange?.(msg)
      })
      onStatusChange?.(null)
      if (res.success) {
        try {
          triggerHaptic("success")
        } catch {}
        if (typeof Dialog.alert === "function") {
          void Dialog.alert({
            title: "导出完成",
            message: `特辑长图已成功合成并保存至专属相簿「${albumName}」。`,
          })
        }
      } else {
        try {
          triggerHaptic("error")
        } catch {}
        if (typeof Dialog.alert === "function") {
          void Dialog.alert({
            title: "长图导出失败",
            message: res.error || "生成特辑长图时发生未知错误。",
          })
        }
      }
    } else if (choice === 2) {
      try {
        triggerHaptic("light")
      } catch {}
      onStatusChange?.("正在合成 EPUB…")
      const res = await exportPixivisionToEpub(detail, (_curr, _tot, msg) => {
        onStatusChange?.(msg)
      })
      onStatusChange?.(null)
      if (res.success && res.filePath) {
        try {
          triggerHaptic("success")
        } catch {}
        if (typeof Dialog.alert === "function") {
          let fileLocationDesc = "本地文件目录（/Pix-Scripting/Pixivision/）"
          if (currentSettings.downloadStorageMode === "icloud" && FileManager.isiCloudEnabled) {
            fileLocationDesc = "iCloud 云盘（/Pix-Scripting/Pixivision/）"
          } else if (currentSettings.downloadCustomDirectoryBookmark) {
            fileLocationDesc = "自定义文件目录"
          }

          void Dialog.alert({
            title: "导出完成",
            message: `特辑 EPUB 电子画报已成功存入${fileLocationDesc}，您可在「下载与文件管理」或「文件」App 中查阅，并随时导入「图书」App 翻阅或分享。`,
          })
        }
      } else {
        try {
          triggerHaptic("error")
        } catch {}
        if (typeof Dialog.alert === "function") {
          void Dialog.alert({
            title: "EPUB 导出失败",
            message: res.error || "生成特辑 EPUB 时发生未知错误。",
          })
        }
      }
    }
  }
}
