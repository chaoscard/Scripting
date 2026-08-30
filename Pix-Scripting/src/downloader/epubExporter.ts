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
import { session } from "../api/session"
import { illustrationDetail } from "../api/pixiv"
import { imageUrlOf, pageThumbUrlOf } from "../image/imageLoader"
import { htmlToPlainText } from "../ui/components/formatUtils"

export interface NovelChapter {
  id: number
  title: string
  text: string
  images?: Record<string, string> // image_id -> image_url
  caption?: string
}

export interface NovelEpubOptions {
  id: number
  title: string
  author: string
  authorId?: number
  seriesTitle?: string
  seriesDescription?: string
  description?: string
  tags?: string[]
  createdDate?: string
  isR18?: boolean
  coverUrl?: string
  chapters: NovelChapter[]
  targetDir?: string
  customFileName?: string
  onProgress?: (msg: string, current: number, total: number) => void
}

export interface MangaPageItem {
  pageIndex: number
  url: string
  chapterTitle?: string
  chapterId?: number
}

export interface MangaChapterItem {
  id?: number
  title: string
  pages: { pageIndex?: number; url: string }[]
}

export interface MangaEpubOptions {
  id: number
  title: string
  author: string
  authorId?: number
  seriesTitle?: string
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

const NOVEL_CSS = `
@charset "utf-8";
body {
  margin: 5% 6%;
  padding: 0;
  line-height: 1.85;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  word-break: break-word;
}
h1 {
  font-size: 1.5em;
  text-align: center;
  margin: 1.6em 0 0.8em 0;
  font-weight: bold;
}
h2 {
  font-size: 1.2em;
  text-align: center;
  margin: 1.4em 0 0.6em 0;
  font-weight: bold;
}
p {
  text-indent: 2em;
  margin: 0.4em 0;
}
.meta-info {
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 14px;
  margin-bottom: 22px;
  font-size: 0.9em;
  color: #666666;
  line-height: 1.6;
}
.meta-info a {
  color: #007aff;
  text-decoration: none;
}
.meta-item {
  margin: 3px 0;
}
.caption-box {
  background: #f8f9fa;
  border-left: 4px solid #007aff;
  padding: 10px 14px;
  margin: 12px 0 20px 0;
  font-size: 0.92em;
  color: #444444;
  border-radius: 2px;
}
.caption-box p {
  text-indent: 0;
  margin: 0.3em 0;
  line-height: 1.6;
}
.caption-header {
  font-weight: bold;
  font-size: 0.95em;
  color: #007aff;
  margin-bottom: 6px;
}
.page-header {
  font-size: 1.05em;
  color: #888888;
  text-align: center;
  margin: 1.2em 0 0.8em 0;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.jump-box {
  text-align: center;
  text-indent: 0;
  margin: 1.5em 0;
}
.jump-link {
  display: inline-block;
  padding: 6px 16px;
  background-color: #f0f4f8;
  color: #007aff;
  text-decoration: none;
  border-radius: 16px;
  font-size: 0.88em;
  font-weight: 500;
  border: 1px solid #d0e0f0;
}
.ill-box {
  text-align: center;
  text-indent: 0;
  margin: 1.5em 0;
}
.ill-box img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.cover-box {
  text-align: center;
  text-indent: 0;
  margin: 0;
  padding: 0;
}
.cover-box img {
  max-width: 100%;
  max-height: 96vh;
}
.page-divider {
  margin: 2em 0;
  border: 0;
  border-top: 1px dashed #ccc;
}
ruby {
  ruby-align: center;
}
rt {
  font-size: 0.55em;
}
`

const MANGA_CSS = `
@charset "utf-8";
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background-color: #ffffff;
  -webkit-text-size-adjust: 100%;
}
.manga-page-body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #ffffff;
}
.manga-svg-container {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}
svg {
  width: 100%;
  height: 100%;
  display: block;
}
.info-body {
  margin: 0;
  padding: 36px 28px;
  background-color: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  line-height: 1.7;
  color: #333333;
  box-sizing: border-box;
}
.info-container {
  max-width: 800px;
  margin: 0 auto;
}
.info-title {
  font-size: 1.6em;
  margin: 0 0 8px 0;
  color: #111111;
  text-align: left;
  font-weight: 700;
}
.info-series {
  font-size: 1.05em;
  color: #007aff;
  margin-bottom: 18px;
  font-weight: 600;
}
.meta-info {
  border-bottom: 1px solid #e5e5ea;
  padding-bottom: 14px;
  margin-bottom: 20px;
  font-size: 0.92em;
  color: #666666;
}
.meta-info a {
  color: #007aff;
  text-decoration: none;
}
.meta-item {
  margin: 6px 0;
  word-break: break-all;
}
.meta-item strong {
  color: #333333;
}
.caption-box {
  background: #f8f9fa;
  border-left: 4px solid #007aff;
  padding: 12px 16px;
  margin: 16px 0;
  font-size: 0.92em;
  color: #444444;
  border-radius: 4px;
}
.caption-box p {
  text-indent: 0;
  margin: 0.4em 0;
  line-height: 1.6;
}
.caption-header {
  font-weight: 600;
  font-size: 0.95em;
  color: #007aff;
  margin-bottom: 6px;
}
.chapters-box {
  background: #f8f9fa;
  border-left: 4px solid #34c759;
  padding: 12px 16px;
  margin: 16px 0;
  font-size: 0.92em;
  color: #444444;
  border-radius: 4px;
}
.chapter-list {
  margin: 8px 0 0 0;
  padding-left: 0;
  list-style: none;
}
.chapter-list li {
  padding: 5px 0;
  border-bottom: 1px dashed #e5e5ea;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.chapter-list li:last-child {
  border-bottom: none;
}
.chap-idx {
  color: #007aff;
  font-weight: 600;
  margin-right: 8px;
}
.chap-title {
  flex: 1;
  word-break: break-all;
}
.chap-count {
  color: #8e8e93;
  font-size: 0.88em;
  margin-left: 8px;
}
nav {
  padding: 28px 24px;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  line-height: 1.8;
  color: #333333;
}
nav h1 {
  font-size: 1.4em;
  margin-bottom: 16px;
  color: #111111;
}
nav ol {
  padding-left: 20px;
}
nav li {
  margin: 8px 0;
}
nav a {
  color: #007aff;
  text-decoration: none;
}
`

/**
 * 将章节或系列简介清洗并转换为规范的 XHTML 段落结构
 */
function formatCaptionToXHtml(rawCaption?: string, headerTitle?: string): string {
  if (!rawCaption) return ""
  const plain = htmlToPlainText(rawCaption)
  if (!plain) return ""
  const lines = plain.split(/\r?\n/)
  const pTags = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escapeXml(line)}</p>`)
    .join("\n  ")
  if (!pTags) return ""
  const titleHtml = headerTitle ? `<div class="caption-header">${escapeXml(headerTitle)}</div>\n  ` : ""
  return `<div class="caption-box">\n  ${titleHtml}${pTags}\n</div>`
}

/**
 * 将段落文本内的行内语法（Ruby 注音、jumpuri 链接）转换为标准且安全转义的 XHTML
 */
function formatInlineToXHtml(text: string): string {
  if (!text) return ""

  // 匹配 [[rb: 汉字 > 假名 ]]、[ruby text=假名]汉字[/ruby] 以及 [[jumpuri: 标题 > url ]]
  const INLINE_REGEX =
    /(\[\[rb:\s*[^>\r\n]+?\s*(?:>|&gt;)\s*[^\]\r\n]+?\s*\]\]|\[ruby\s+text=[^\]]+?\].*?\[\/ruby\]|\[\[jumpuri:\s*[^>\r\n]+?\s*(?:>|&gt;)\s*[^\]\r\n]+?\s*\]\])/gi

  const parts = text.split(INLINE_REGEX)
  return parts
    .map((part) => {
      if (!part) return ""

      // 1. [[rb: 汉字 > 假名 ]]
      const rbMatch = part.match(
        /^\[\[rb:\s*([^>\r\n]+?)\s*(?:>|&gt;)\s*([^\]\r\n]+?)\s*\]\]$/i
      )
      if (rbMatch) {
        return `<ruby>${escapeXml(rbMatch[1].trim())}<rt>${escapeXml(rbMatch[2].trim())}</rt></ruby>`
      }

      // 2. [ruby text=假名]汉字[/ruby]
      const rubyMatch = part.match(/^\[ruby\s+text=([^\]]+?)\](.*?)\[\/ruby\]$/i)
      if (rubyMatch) {
        return `<ruby>${escapeXml(rubyMatch[2].trim())}<rt>${escapeXml(rubyMatch[1].trim())}</rt></ruby>`
      }

      // 3. [[jumpuri: 标题 > url ]]
      const jumpMatch = part.match(
        /^\[\[jumpuri:\s*([^>\r\n]+?)\s*(?:>|&gt;)\s*([^\]\r\n]+?)\s*\]\]$/i
      )
      if (jumpMatch) {
        return `<a href="${escapeXml(jumpMatch[2].trim())}">${escapeXml(jumpMatch[1].trim())}</a>`
      }

      // 普通纯文本：安全转义 XML
      return escapeXml(part)
    })
    .join("")
}

/**
 * 转换 Pixiv 小说正文中的自定义语法为标准 XHTML
 */
function formatNovelTextToXHtml(
  rawText: string,
  imageKeyToFileMap: Map<string, string>,
  resolveJumpLink?: (targetPage: number) => string | null
): string {
  if (!rawText) return ""
  const lines = rawText.split(/\r?\n/)
  const resultBlocks: string[] = []

  // 块级/独立指令正则：[uploadedimage:...], [pixivimage:...], [chapter:...], [jump:...]
  const BLOCK_SPLIT_REGEX =
    /(\[(?:uploadedimage|pixivimage)\s*[:：]\s*[^\]]+\]|\[chapter\s*[:：]\s*[^\]]+\]|\[jump\s*[:：]\s*\d+\])/gi

  for (const rawLine of lines) {
    // 检查是否全为空白行
    if (rawLine.replace(/[\s\r\n\u3000]/g, "").length === 0) {
      continue
    }

    // 将单行文本按可能内嵌的块级标记切分
    const segments = rawLine.split(BLOCK_SPLIT_REGEX)
    for (const seg of segments) {
      if (!seg) continue

      // 1. [chapter: 章节名]
      const chapMatch = seg.match(/^\[chapter\s*[:：]\s*(.+?)\]$/i)
      if (chapMatch) {
        resultBlocks.push(`<h2>${escapeXml(chapMatch[1].trim())}</h2>`)
        continue
      }

      // 2. [jump: 页码]
      const jumpMatch = seg.match(/^\[jump\s*[:：]\s*(\d+)\]$/i)
      if (jumpMatch) {
        const targetPage = parseInt(jumpMatch[1], 10)
        const targetLink = resolveJumpLink ? resolveJumpLink(targetPage) : null
        if (targetLink) {
          resultBlocks.push(
            `<div class="jump-box"><a href="${escapeXml(targetLink)}" class="jump-link">📄 跳转至第 ${targetPage} 页 →</a></div>`
          )
        }
        continue
      }

      // 3. [uploadedimage: ID] 或 [pixivimage: ID]
      const imgMatch = seg.match(/^\[(uploadedimage|pixivimage)\s*[:：]\s*([^\]]+)\]$/i)
      if (imgMatch) {
        const rawKey = imgMatch[2].trim()
        const filename =
          imageKeyToFileMap.get(rawKey) ||
          imageKeyToFileMap.get(rawKey.toLowerCase()) ||
          imageKeyToFileMap.get(rawKey.replace(/^ill_/, ""))
        if (filename) {
          resultBlocks.push(`<div class="ill-box"><img src="images/${filename}" alt="插图"/></div>`)
        }
        continue
      }

      // 4. 普通正文文本：去除行首段落缩进与空白（由 CSS text-indent: 2em 统一保证精准空两格），转义并解析行内语法
      const cleanText = seg.replace(/^[\s\u3000]+/, "").replace(/[\s\u3000]+$/, "")
      if (cleanText.length > 0) {
        const innerHtml = formatInlineToXHtml(cleanText)
        resultBlocks.push(`<p>${innerHtml}</p>`)
      }
    }
  }

  return resultBlocks.join("\n")
}

/**
 * 在小说封面位图上绘制系列名与标题标牌（无原图时自动生成标准书封），返回合成后的 JPEG 二进制数据
 */
async function stampSeriesOnCover(
  baseCoverData: Data | null,
  seriesTitle?: string,
  bookTitle?: string,
  authorName?: string
): Promise<Data | null> {
  const controller = new WebViewController()

  try {
    const promise = new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 4000)
      void controller.addScriptMessageHandler("onCoverReady", (data: any) => {
        clearTimeout(timeout)
        resolve(typeof data === "string" ? data : null)
      })
    })

    const base64Img = baseCoverData ? baseCoverData.toBase64String() : ""
    const safeSeries = seriesTitle || ""
    const safeTitle = bookTitle || "作品"
    const safeAuthor = authorName || "作者"

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<canvas id="c"></canvas>
<script>
window.onload = function() {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const series = ${JSON.stringify(safeSeries)};
  const title = ${JSON.stringify(safeTitle)};
  const author = ${JSON.stringify(safeAuthor)};
  const base64 = ${JSON.stringify(base64Img)};

  function drawSeriesBadge(w, h) {
    if (!series) return;
    const padX = Math.round(w * 0.04);
    const boxY = Math.round(h * 0.035);
    const boxW = w - padX * 2;
    const boxH = Math.max(46, Math.round(h * 0.09));
    const r = Math.min(12, Math.round(boxH * 0.25));

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = 'rgba(15, 20, 30, 0.82)';

    ctx.beginPath();
    ctx.moveTo(padX + r, boxY);
    ctx.lineTo(padX + boxW - r, boxY);
    ctx.quadraticCurveTo(padX + boxW, boxY, padX + boxW, boxY + r);
    ctx.lineTo(padX + boxW, boxY + boxH - r);
    ctx.quadraticCurveTo(padX + boxW, boxY + boxH, padX + boxW - r, boxY + boxH);
    ctx.lineTo(padX + r, boxY + boxH);
    ctx.quadraticCurveTo(padX, boxY + boxH, padX, boxY + boxH - r);
    ctx.lineTo(padX, boxY + r);
    ctx.quadraticCurveTo(padX, boxY, padX + r, boxY);
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.stroke();
    ctx.restore();

    const tagFontSize = Math.max(11, Math.round(boxH * 0.22));
    const textFontSize = Math.max(15, Math.round(boxH * 0.38));

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = 'bold ' + tagFontSize + 'px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#FFD15C';
    ctx.fillText('SERIES · 系列', w / 2, boxY + boxH * 0.32);

    ctx.font = 'bold ' + textFontSize + 'px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillStyle = '#FFFFFF';

    let displaySeries = series;
    const maxTextWidth = boxW - 32;
    if (ctx.measureText(displaySeries).width > maxTextWidth) {
      while (displaySeries.length > 1 && ctx.measureText(displaySeries + '...').width > maxTextWidth) {
        displaySeries = displaySeries.slice(0, -1);
      }
      displaySeries += '...';
    }
    ctx.fillText(displaySeries, w / 2, boxY + boxH * 0.72);
    ctx.restore();
  }

  if (base64) {
    const img = new Image();
    img.onload = function() {
      canvas.width = img.naturalWidth || img.width || 800;
      canvas.height = img.naturalHeight || img.height || 1200;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      drawSeriesBadge(canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      window.webkit.messageHandlers.onCoverReady.postMessage(dataUrl);
    };
    img.onerror = function() {
      fallback();
    };
    img.src = 'data:image/jpeg;base64,' + base64;
  } else {
    fallback();
  }

  function fallback() {
    canvas.width = 800;
    canvas.height = 1200;
    const grad = ctx.createLinearGradient(0, 0, 800, 1200);
    grad.addColorStop(0, '#1a252f');
    grad.addColorStop(0.5, '#2c3e50');
    grad.addColorStop(1, '#34495e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 1200);

    drawSeriesBadge(800, 1200);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 42px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillText(title, 400, 580);

    ctx.font = '24px -apple-system, sans-serif';
    ctx.fillStyle = '#BDC3C7';
    ctx.fillText('作者：' + author, 400, 650);
    ctx.restore();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    window.webkit.messageHandlers.onCoverReady.postMessage(dataUrl);
  }
};
</script>
</body>
</html>`

    await controller.loadHTML(html)
    const result = await promise
    if (!result) return null
    const b64 = result.replace(/^data:image\/[a-z]+;base64,/, "")
    return Data.fromBase64String(b64)
  } catch (err: any) {
    console.log("stampSeriesOnCover error:", err?.message ?? err)
    return null
  } finally {
    try {
      controller.dispose()
    } catch {}
  }
}

/**
 * 构建 EPUB 规范目录并打包
 */
async function packageEpubDirectory(
  tempEpubDir: string,
  targetOutputPath: string
): Promise<boolean> {
  const tempZipPath = `${tempEpubDir}.zip`
  try {
    if (FileManager.existsSync(tempZipPath)) {
      try {
        FileManager.removeSync(tempZipPath)
      } catch {}
    }

    await FileManager.zip(tempEpubDir, tempZipPath)
    if (!FileManager.existsSync(tempZipPath)) {
      return false
    }

    // 原子发布并带 .bak 备份保护，避免覆盖损坏有效文件
    publishPreparedFile(tempZipPath, targetOutputPath)
    return true
  } catch (err: any) {
    console.log("packageEpubDirectory error:", err?.message ?? err)
    return false
  } finally {
    try {
      if (FileManager.existsSync(tempZipPath)) {
        FileManager.removeSync(tempZipPath)
      }
    } catch {}
  }
}

/**
 * 导出小说为标准 EPUB 文件
 */
export async function exportNovelToEpub(options: NovelEpubOptions): Promise<string | null> {
  const {
    id,
    title,
    author,
    authorId,
    seriesTitle,
    seriesDescription,
    description,
    tags = [],
    createdDate,
    isR18,
    coverUrl,
    chapters,
    targetDir: customTargetDir,
    customFileName,
    onProgress,
  } = options

  const safeTitle = customFileName
    ? sanitizeFileName(customFileName)
    : sanitizeFileName(seriesTitle ? `${seriesTitle} - ${title}` : `${title}_${author}`)
  const outputFileName = `${safeTitle}.epub`
  const targetDir = customTargetDir || getCategoryDirectory("novels")
  if (!FileManager.existsSync(targetDir)) {
    try { FileManager.createDirectorySync(targetDir, true) } catch {}
  }
  const targetFilePath = `${targetDir}/${outputFileName}`

  const tempDir = `${getCategoryDirectory("temp")}/epub_novel_${id}_${Date.now()}`
  const oebpsDir = `${tempDir}/OEBPS`
  const metaInfDir = `${tempDir}/META-INF`
  const imagesDir = `${oebpsDir}/images`

  try {
    const progressReporter = createThrottledProgress(onProgress, 80)
    FileManager.createDirectorySync(imagesDir, true)
    FileManager.createDirectorySync(metaInfDir, true)

    // 1. mimetype (规范必须是首个无 BOM 文件)
    FileManager.writeAsStringSync(`${tempDir}/mimetype`, "application/epub+zip", "utf-8")

    // 2. container.xml
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    FileManager.writeAsStringSync(`${metaInfDir}/container.xml`, containerXml, "utf-8")

    // 3. style.css
    FileManager.writeAsStringSync(`${oebpsDir}/style.css`, NOVEL_CSS, "utf-8")

    // 4. 下载封面与系列名印制处理
    progressReporter.notify("准备下载封面与插图...", 0, chapters.length)
    let hasCover = false
    let rawCoverData: Data | null = null
    if (coverUrl) {
      rawCoverData = await fetchImageBinaryWithRetry(coverUrl)
    }

    if (seriesTitle || rawCoverData) {
      const stampedCover = await stampSeriesOnCover(
        rawCoverData,
        seriesTitle,
        title,
        author
      )
      const finalCoverData = stampedCover ?? rawCoverData
      if (finalCoverData) {
        FileManager.writeAsDataSync(`${imagesDir}/cover.jpg`, finalCoverData)
        hasCover = true
      }
    }

    // 收集所有章节的插图（包括 uploadedimage 和正文中引用的 pixivimage）
    const imageKeyToFileMap = new Map<string, string>()
    const allImagesToDownload: { key: string; url: string; filename: string }[] = []
    const urlToFilenameMap = new Map<string, string>()

    // 1. 先加入章节已带的 images 字典
    for (const chap of chapters) {
      if (chap.images) {
        for (const [key, url] of Object.entries(chap.images)) {
          if (!url) continue
          let filename = urlToFilenameMap.get(url)
          if (!filename) {
            const ext = url.includes(".png") ? "png" : url.includes(".webp") ? "webp" : "jpg"
            filename = `ill_${sanitizeFileName(key)}.${ext}`
            urlToFilenameMap.set(url, filename)
            allImagesToDownload.push({ key, url, filename })
          }
          imageKeyToFileMap.set(key, filename)
          imageKeyToFileMap.set(key.trim(), filename)
        }
      }
    }

    // 2. 扫描章节正文中可能引用的 pixivimage 并动态拉取
    for (const chap of chapters) {
      if (!chap.text) continue
      const pxMatches = chap.text.matchAll(/\[pixivimage\s*[:：]\s*(\d+)(?:-(\d+))?\s*\]/gi)
      for (const m of pxMatches) {
        const illustId = parseInt(m[1], 10)
        const pageIdx = Math.max(0, (m[2] ? parseInt(m[2], 10) : 1) - 1)
        const fullKey = m[2] ? `${m[1]}-${m[2]}` : m[1]
        if (!imageKeyToFileMap.has(fullKey) && !imageKeyToFileMap.has(m[1])) {
          try {
            const illust = await session.call((token) => illustrationDetail(illustId, token))
            if (illust) {
              const url = imageUrlOf(illust, pageIdx, "large") || pageThumbUrlOf(illust, pageIdx)
              if (url) {
                let filename = urlToFilenameMap.get(url)
                if (!filename) {
                  const ext = url.includes(".png") ? "png" : "jpg"
                  filename = `ill_px_${illustId}_p${pageIdx}.${ext}`
                  urlToFilenameMap.set(url, filename)
                  allImagesToDownload.push({ key: fullKey, url, filename })
                }
                imageKeyToFileMap.set(fullKey, filename)
                imageKeyToFileMap.set(m[1], filename)
              }
            }
          } catch (e: any) {
            console.log(`Failed to fetch pixivimage #${illustId}:`, e?.message ?? e)
          }
        }
      }
    }

    if (allImagesToDownload.length > 0) {
      progressReporter.notify(`下载插图 (共 ${allImagesToDownload.length} 张)...`, 0, allImagesToDownload.length)
      await runConcurrentTasks(allImagesToDownload, 4, async (item, idx) => {
        const data = await fetchImageBinaryWithRetry(item.url)
        if (data) {
          FileManager.writeAsDataSync(`${imagesDir}/${item.filename}`, data)
        }
        progressReporter.notify(`下载插图 (${idx + 1}/${allImagesToDownload.length})`, idx + 1, allImagesToDownload.length)
      })
    }

    // 5. 规划章节与多页切分结构
    interface NovelPageSection {
      pageIndex: number
      text: string
      chapterHeading?: string
      fileName: string
      xhtmlId: string
      pageTitle: string
    }

    interface NovelChapterPlan {
      chapterIndex: number
      chapterTitle: string
      caption?: string
      pages: NovelPageSection[]
    }

    const isSingleNovel = chapters.length === 1

    const chapterPlans: NovelChapterPlan[] = chapters.map((chap, cIdx) => {
      const chapterIndex = cIdx + 1
      const chapterTitle = chap.title || (isSingleNovel ? title : `第 ${chapterIndex} 章`)

      // 按 [newpage] 进行分页切分
      const rawParts = (chap.text || "").split(/\[newpage\]/gi)

      // 过滤掉末尾纯空白的多余部分
      while (rawParts.length > 1) {
        const last = rawParts[rawParts.length - 1]
        if (last.replace(/[\s\r\n\u3000]/g, "").length === 0) {
          rawParts.pop()
        } else {
          break
        }
      }

      if (rawParts.length === 0) {
        rawParts.push("")
      }

      const isChapMultiPage = rawParts.length > 1
      const pages: NovelPageSection[] = rawParts.map((part, pIdx) => {
        const pageIndex = pIdx + 1
        const chapMatch = part.match(/\[chapter\s*[:：]\s*(.+?)\]/i)
        const chapterHeading = chapMatch ? chapMatch[1].trim() : undefined

        const xhtmlId = isSingleNovel
          ? `page_${pageIndex}`
          : `chap_${chapterIndex}_p${pageIndex}`
        const fileName = `${xhtmlId}.xhtml`

        let pageTitle = ""
        if (isSingleNovel && !isChapMultiPage) {
          // 单篇单页：目录标题为书名/章节名
          pageTitle = chapterTitle
        } else {
          // 多页情况：若本页包含 chapter 标签，则显示 "第 X 页 · 章节名"；否则显示 "第 X 页"
          if (chapterHeading) {
            pageTitle = `第 ${pageIndex} 页 · ${chapterHeading}`
          } else {
            pageTitle = `第 ${pageIndex} 页`
          }
        }

        return {
          pageIndex,
          text: part,
          chapterHeading,
          fileName,
          xhtmlId,
          pageTitle,
        }
      })

      return {
        chapterIndex,
        chapterTitle,
        caption: chap.caption,
        pages,
      }
    })

    const totalPages = chapterPlans.reduce((sum, cp) => sum + cp.pages.length, 0)

    // 6. 生成各章节与页面 XHTML 文件
    const manifestItems: string[] = [
      `<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
      `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
      `<item id="style" href="style.css" media-type="text/css"/>`,
    ]
    const spineItems: string[] = []
    const navPoints: string[] = []
    const tocList: string[] = []

    let globalPlayOrder = 1

    if (hasCover) {
      manifestItems.push(`<item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`)
      const coverPageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>封面</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body style="margin:0;padding:0;text-align:center;">
  <div class="cover-box"><img src="images/cover.jpg" alt="封面"/></div>
</body>
</html>`
      FileManager.writeAsStringSync(`${oebpsDir}/cover.xhtml`, coverPageXhtml, "utf-8")
      manifestItems.push(`<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`)
      spineItems.push(`<itemref idref="cover-page"/>`)
      navPoints.push(`
  <navPoint id="nav-cover" playOrder="${globalPlayOrder++}">
    <navLabel><text>封面</text></navLabel>
    <content src="cover.xhtml"/>
  </navPoint>`)
      tocList.push(`<li><a href="cover.xhtml">封面</a></li>`)
    }

    const isSeries = Boolean(seriesTitle && chapters.length > 1)
    const resolvedSeriesDesc = seriesDescription || (isSeries ? description : undefined)
    const workUrl = isSeries
      ? `https://www.pixiv.net/novel/series/${id}`
      : `https://www.pixiv.net/novel/show.php?id=${id}`
    const authorUrl = authorId ? `https://www.pixiv.net/users/${authorId}` : ""

    let pageCounter = 0
    let timeSliceNovel = Date.now()
    for (const chapPlan of chapterPlans) {
      const chapCaptionHtml = formatCaptionToXHtml(chapPlan.caption)

      for (const page of chapPlan.pages) {
        pageCounter++
        const isFirstPageOfBook = chapPlan.chapterIndex === 1 && page.pageIndex === 1
        const isFirstPageOfChap = page.pageIndex === 1

        let metaInfoHtml = ""
        let seriesCaptionHtml = ""
        if (isFirstPageOfBook) {
          const hasR18 = isR18 || tags.some((t) => /r-?18/i.test(t))
          let createdDateFormatted = ""
          if (createdDate) {
            try {
              const d = new Date(createdDate)
              if (!isNaN(d.getTime())) {
                createdDateFormatted = d.toLocaleString()
              }
            } catch {}
          }
          const exportTimeStr = new Date().toLocaleString()

          const metaItems: string[] = []
          metaItems.push(`<div class="meta-item">作者：${authorUrl ? `<a href="${authorUrl}">${escapeXml(author)}</a>` : escapeXml(author)}</div>`)
          metaItems.push(`<div class="meta-item">作品主页：<a href="${workUrl}">${escapeXml(workUrl)}</a></div>`)
          if (authorUrl) {
            metaItems.push(`<div class="meta-item">作者主页：<a href="${authorUrl}">${escapeXml(authorUrl)}</a></div>`)
          }
          if (seriesTitle) {
            metaItems.push(`<div class="meta-item">所属系列：${escapeXml(seriesTitle)}</div>`)
          }
          if (tags.length > 0) {
            metaItems.push(`<div class="meta-item">标签：${escapeXml(tags.map(t => `#${t}`).join(" "))}</div>`)
          }
          metaItems.push(`<div class="meta-item">年龄分级：${hasR18 ? '<span style="color:#ff3b30;font-weight:600;">🔞 R-18 (成人向)</span>' : '全年龄 (General)'}</div>`)
          if (createdDateFormatted) {
            metaItems.push(`<div class="meta-item">投稿时间：${createdDateFormatted}</div>`)
          }
          metaItems.push(`<div class="meta-item">导出时间：${exportTimeStr}</div>`)
          metaInfoHtml = `<div class="meta-info">\n    ${metaItems.join("\n    ")}\n  </div>`

          if (resolvedSeriesDesc) {
            seriesCaptionHtml = formatCaptionToXHtml(resolvedSeriesDesc, "系列简介")
          }
        }

        let pageHeaderHtml = ""
        if (isSingleNovel) {
          if (isFirstPageOfChap) {
            pageHeaderHtml = `<h1>${escapeXml(title)}</h1>`
          } else if (!page.chapterHeading) {
            pageHeaderHtml = `<div class="page-header">第 ${page.pageIndex} 页</div>`
          }
        } else {
          if (isFirstPageOfChap) {
            pageHeaderHtml = `<h1>${escapeXml(chapPlan.chapterTitle)}</h1>`
          } else if (!page.chapterHeading) {
            pageHeaderHtml = `<div class="page-header">${escapeXml(chapPlan.chapterTitle)} · 第 ${page.pageIndex} 页</div>`
          }
        }

        const resolveJump = (targetPage: number): string | null => {
          if (targetPage < 1) return null
          if (isSingleNovel) {
            const target = chapPlan.pages.find((p) => p.pageIndex === targetPage)
            return target ? target.fileName : `page_${targetPage}.xhtml`
          } else {
            const target = chapPlan.pages.find((p) => p.pageIndex === targetPage)
            return target ? target.fileName : `chap_${chapPlan.chapterIndex}_p${targetPage}.xhtml`
          }
        }

        const formattedBody = formatNovelTextToXHtml(page.text, imageKeyToFileMap, resolveJump)
        const captionHtml = isFirstPageOfChap ? chapCaptionHtml : ""

        const pageDocumentTitle = isSingleNovel
          ? (page.chapterHeading ? `${title} - ${page.pageTitle}` : (chapPlan.pages.length > 1 ? `${title} (${page.pageTitle})` : title))
          : (page.chapterHeading ? `${chapPlan.chapterTitle} - ${page.pageTitle}` : (chapPlan.pages.length > 1 ? `${chapPlan.chapterTitle} (${page.pageTitle})` : chapPlan.chapterTitle))

        const pageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(pageDocumentTitle)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  ${pageHeaderHtml}
  ${metaInfoHtml}
  ${seriesCaptionHtml}
  ${captionHtml}
  ${formattedBody}
</body>
</html>`

        FileManager.writeAsStringSync(`${oebpsDir}/${page.fileName}`, pageXhtml, "utf-8")
        manifestItems.push(`<item id="${page.xhtmlId}" href="${page.fileName}" media-type="application/xhtml+xml"/>`)
        spineItems.push(`<itemref idref="${page.xhtmlId}"/>`)

        progressReporter.notify(`生成正文页面 (${pageCounter}/${totalPages})...`, pageCounter, totalPages)
        timeSliceNovel = await yieldIfExceeded(timeSliceNovel, 12)
      }
    }

    // 7. 构建目录导航 (TOC - 支持单篇多页与系列多页层级目录)
    if (isSingleNovel) {
      const plan = chapterPlans[0]
      if (plan.pages.length === 1) {
        const p1 = plan.pages[0]
        navPoints.push(`
  <navPoint id="nav-${p1.xhtmlId}" playOrder="${globalPlayOrder++}">
    <navLabel><text>${escapeXml(title)}</text></navLabel>
    <content src="${p1.fileName}"/>
  </navPoint>`)
        tocList.push(`<li><a href="${p1.fileName}">${escapeXml(title)}</a></li>`)
      } else {
        // 单篇多页小说：目录直接列出到每一页
        for (const page of plan.pages) {
          navPoints.push(`
  <navPoint id="nav-${page.xhtmlId}" playOrder="${globalPlayOrder++}">
    <navLabel><text>${escapeXml(page.pageTitle)}</text></navLabel>
    <content src="${page.fileName}"/>
  </navPoint>`)
          tocList.push(`<li><a href="${page.fileName}">${escapeXml(page.pageTitle)}</a></li>`)
        }
      }
    } else {
      // 系列小说
      for (const chapPlan of chapterPlans) {
        if (chapPlan.pages.length === 1) {
          const p1 = chapPlan.pages[0]
          navPoints.push(`
  <navPoint id="nav-chap-${chapPlan.chapterIndex}" playOrder="${globalPlayOrder++}">
    <navLabel><text>${escapeXml(chapPlan.chapterTitle)}</text></navLabel>
    <content src="${p1.fileName}"/>
  </navPoint>`)
          tocList.push(`<li><a href="${p1.fileName}">${escapeXml(chapPlan.chapterTitle)}</a></li>`)
        } else {
          // 系列章节包含多页：两级嵌套目录
          const chapOrder = globalPlayOrder++
          const subNavPoints: string[] = []
          const subTocItems: string[] = []

          for (const page of chapPlan.pages) {
            const pageOrder = globalPlayOrder++
            subNavPoints.push(`
    <navPoint id="nav-${page.xhtmlId}" playOrder="${pageOrder}">
      <navLabel><text>${escapeXml(page.pageTitle)}</text></navLabel>
      <content src="${page.fileName}"/>
    </navPoint>`)
            subTocItems.push(`<li><a href="${page.fileName}">${escapeXml(page.pageTitle)}</a></li>`)
          }

          navPoints.push(`
  <navPoint id="nav-chap-${chapPlan.chapterIndex}" playOrder="${chapOrder}">
    <navLabel><text>${escapeXml(chapPlan.chapterTitle)}</text></navLabel>
    <content src="${chapPlan.pages[0].fileName}"/>${subNavPoints.join("")}
  </navPoint>`)

          tocList.push(`<li>
        <a href="${chapPlan.pages[0].fileName}">${escapeXml(chapPlan.chapterTitle)}</a>
        <ol>
          ${subTocItems.join("\n          ")}
        </ol>
      </li>`)
        }
      }
    }

    // 加入插图 manifest (去重确保每个文件唯一注册)
    const registeredFiles = new Set<string>()
    for (const item of allImagesToDownload) {
      if (registeredFiles.has(item.filename)) continue
      registeredFiles.add(item.filename)
      const mime = item.filename.endsWith(".png")
        ? "image/png"
        : item.filename.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg"
      const itemId = `img_${sanitizeFileName(item.filename.replace(/\.[^.]+$/, ""))}`
      manifestItems.push(`<item id="${itemId}" href="images/${item.filename}" media-type="${mime}"/>`)
    }

    // 8. content.opf
    const dateStr = new Date().toISOString()
    const metaDescription = resolvedSeriesDesc || description || ""
    const cleanDescription = metaDescription ? htmlToPlainText(metaDescription) : ""
    const hasR18 = isR18 || tags.some((t) => /r-?18/i.test(t))
    let createdDateIso = ""
    if (createdDate) {
      try {
        const d = new Date(createdDate)
        if (!isNaN(d.getTime())) {
          createdDateIso = d.toISOString()
        }
      } catch {}
    }

    const tagSubjects = tags.map((t) => `<dc:subject>${escapeXml(t)}</dc:subject>`).join("\n    ")
    const seriesCollectionMeta = seriesTitle
      ? `<meta property="belongs-to-collection" id="c01">${escapeXml(seriesTitle)}</meta>\n    <meta refines="#c01" property="collection-type">series</meta>`
      : ""
    const createdDateMeta = createdDateIso
      ? `<dc:date>${createdDateIso}</dc:date>\n    <meta property="dcterms:created">${createdDateIso}</meta>`
      : ""
    const ageRatingMeta = hasR18
      ? `<meta property="schema:contentRating">R-18</meta>\n    <meta property="schema:typicalAgeRange">18-</meta>`
      : `<meta property="schema:contentRating">General</meta>`

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:pixiv:novel:${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>zh</dc:language>
    <dc:publisher>Pixiv</dc:publisher>
    <dc:source>${workUrl}</dc:source>
    ${authorUrl ? `<dc:relation>${authorUrl}</dc:relation>` : ""}
    ${cleanDescription ? `<dc:description>${escapeXml(cleanDescription)}</dc:description>` : ""}
    ${tagSubjects}
    ${createdDateMeta}
    ${ageRatingMeta}
    ${seriesCollectionMeta}
    <meta property="dcterms:modified">${dateStr}</meta>
    ${hasCover ? `<meta name="cover" content="cover-img"/>` : ""}
  </metadata>
  <manifest>
    ${manifestItems.join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join("\n    ")}
  </spine>
</package>`
    FileManager.writeAsStringSync(`${oebpsDir}/content.opf`, contentOpf, "utf-8")

    // 9. toc.ncx
    const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:pixiv:novel:${id}"/>
    <meta name="dtb:depth" content="2"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <docAuthor><text>${escapeXml(author)}</text></docAuthor>
  <navMap>
    ${navPoints.join("")}
  </navMap>
</ncx>`
    FileManager.writeAsStringSync(`${oebpsDir}/toc.ncx`, tocNcx, "utf-8")

    // 10. toc.xhtml
    const tocXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
      ${tocList.join("\n      ")}
    </ol>
  </nav>
</body>
</html>`
    FileManager.writeAsStringSync(`${oebpsDir}/toc.xhtml`, tocXhtml, "utf-8")

    // 9. 打包压缩
    progressReporter.notify("正在组装 EPUB 电子书...", chapters.length, chapters.length)
    progressReporter.flush()
    await yieldToMainThread()
    const success = await packageEpubDirectory(tempDir, targetFilePath)
    return success ? targetFilePath : null
  } catch (err: any) {
    console.log("exportNovelToEpub failed:", err?.message ?? err)
    return null
  } finally {
    try {
      if (FileManager.existsSync(tempDir)) {
        FileManager.removeSync(tempDir)
      }
    } catch {}
  }
}

/**
 * 导出漫画为固定版面 EPUB 文件（支持容错导出、系列章节层级与确切结果报告）
 */
export async function exportMangaToEpub(options: MangaEpubOptions): Promise<ExportResult> {
  const {
    id,
    title,
    author,
    authorId,
    seriesTitle,
    description,
    tags,
    createdDate,
    isR18,
    chapters,
    pages,
    targetDir: customTargetDir,
    customFileName,
    onProgress,
  } = options

  const progressReporter = createThrottledProgress(onProgress, 80)
  const tempDir = `${getCategoryDirectory("temp")}/epub_manga_${id}_${Date.now()}`
  const oebpsDir = `${tempDir}/OEBPS`
  const metaInfDir = `${tempDir}/META-INF`
  const imagesDir = `${oebpsDir}/images`

  try {
    FileManager.createDirectorySync(imagesDir, true)
    FileManager.createDirectorySync(metaInfDir, true)

    FileManager.writeAsStringSync(`${tempDir}/mimetype`, "application/epub+zip", "utf-8")

    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    FileManager.writeAsStringSync(`${metaInfDir}/container.xml`, containerXml, "utf-8")
    FileManager.writeAsStringSync(`${oebpsDir}/style.css`, MANGA_CSS, "utf-8")

    // 1. 归一化章节与页面结构
    interface NormalizedMangaPage {
      globalIndex: number
      pageInChap: number
      url: string
      chapIndex: number
      chapTitle: string
      isChapFirstPage?: boolean
    }

    interface NormalizedMangaChapter {
      id?: number
      title: string
      pages: NormalizedMangaPage[]
    }

    const normalizedChapters: NormalizedMangaChapter[] = []
    let globalCounter = 0

    if (chapters && chapters.length > 0) {
      chapters.forEach((c, cIdx) => {
        const chapTitle = c.title || `第 ${cIdx + 1} 话`
        const pageList: NormalizedMangaPage[] = (c.pages || []).map((p, pIdx) => {
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
      let currentChapPages: NormalizedMangaPage[] = []
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

    const allPagesToDownload: NormalizedMangaPage[] = normalizedChapters.flatMap((c) => c.pages)
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

    // 2. 并发下载所有漫画页面原图并提取宽高
    progressReporter.notify(`下载漫画图片 (共 ${allPagesToDownload.length} 页)...`, 0, allPagesToDownload.length)
    const downloadedPagesMap = new Map<number, {
      index: number
      pageInChap: number
      chapTitle: string
      isChapFirstPage: boolean
      fileName: string
      width: number
      height: number
    }>()
    const failedPages: number[] = []

    await runConcurrentTasks(allPagesToDownload, 4, async (p, idx) => {
      const pageNum = p.globalIndex
      const data = await fetchImageBinaryWithRetry(p.url)
      if (data) {
        const paddedNum = String(pageNum).padStart(allPagesToDownload.length >= 1000 ? 4 : 3, "0")
        const ext = p.url.includes(".png") ? "png" : "jpg"
        const fileName = `page_${paddedNum}.${ext}`
        const filePath = `${imagesDir}/${fileName}`
        FileManager.writeAsDataSync(filePath, data)

        let width = 1200
        let height = 1800
        try {
          const uiImg = UIImage.fromFile(filePath)
          if (uiImg && uiImg.width > 0 && uiImg.height > 0) {
            const scale = uiImg.scale || 1
            width = Math.round(uiImg.width * scale)
            height = Math.round(uiImg.height * scale)
          }
        } catch {}

        downloadedPagesMap.set(pageNum, {
          index: pageNum,
          pageInChap: p.pageInChap,
          chapTitle: p.chapTitle,
          isChapFirstPage: p.isChapFirstPage ?? (p.pageInChap === 1),
          fileName,
          width,
          height,
        })
      } else {
        failedPages.push(pageNum)
      }
      progressReporter.notify(`下载漫画图片 (${idx + 1}/${allPagesToDownload.length})`, idx + 1, allPagesToDownload.length)
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
        error: "全部漫画页面下载失败",
      }
    }

    const isPartial = downloadedCount < allPagesToDownload.length
    const partialSuffix = isPartial ? `_[缺${allPagesToDownload.length - downloadedCount}页]` : ""

    const safeTitle = customFileName
      ? sanitizeFileName(customFileName)
      : sanitizeFileName(seriesTitle ? `${seriesTitle} - ${title}` : `${title}_${author}`)
    const outputFileName = `${safeTitle}${partialSuffix}.epub`
    const targetDir = customTargetDir || getCategoryDirectory("manga")
    if (!FileManager.existsSync(targetDir)) {
      try { FileManager.createDirectorySync(targetDir, true) } catch {}
    }
    const targetFilePath = `${targetDir}/${outputFileName}`

    const dateStr = new Date().toISOString()
    const cleanDescription = description ? htmlToPlainText(description) : ""
    const missingDesc = isPartial ? ` (容错导出，缺失第 ${failedPages.join(", ")} 页)` : ""
    const workUrl = `https://www.pixiv.net/artworks/${id}`
    const authorUrl = authorId ? `https://www.pixiv.net/users/${authorId}` : ""

    const manifestItems: string[] = [
      `<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
      `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
      `<item id="style" href="style.css" media-type="text/css"/>`,
      `<item id="info" href="info.xhtml" media-type="application/xhtml+xml"/>`,
    ]
    const spineItems: string[] = [
      `<itemref idref="info"/>`,
    ]
    const navPoints: string[] = [
      `
  <navPoint id="nav-info" playOrder="1">
    <navLabel><text>作品信息</text></navLabel>
    <content src="info.xhtml"/>
  </navPoint>`,
    ]
    const tocList: string[] = [
      `<li><a href="info.xhtml">作品信息</a></li>`,
    ]

    const hasR18 = isR18 || tags?.some((t) => /r-?18/i.test(t))
    let createdDateIso = ""
    let createdDateFormatted = ""
    if (createdDate) {
      try {
        const d = new Date(createdDate)
        if (!isNaN(d.getTime())) {
          createdDateIso = d.toISOString()
          createdDateFormatted = d.toLocaleString()
        }
      } catch {}
    }

    // 3. 生成作品元数据与章节收录卡片 info.xhtml
    let chaptersCardHtml = ""
    if (normalizedChapters.length > 1) {
      const chapterListItems = normalizedChapters.map((c, i) => {
        const chapDownloaded = c.pages.filter((p) => downloadedPagesMap.has(p.globalIndex)).length
        const countStr = isPartial ? `${chapDownloaded}/${c.pages.length}P` : `${c.pages.length}P`
        return `<li><span class="chap-idx">#${i + 1}</span><span class="chap-title">${escapeXml(c.title)}</span><span class="chap-count">(${countStr})</span></li>`
      }).join("\n        ")

      chaptersCardHtml = `
    <div class="chapters-box">
      <div class="caption-header">收录章节 (全 ${normalizedChapters.length} 话)</div>
      <ul class="chapter-list">
        ${chapterListItems}
      </ul>
    </div>`
    }

    const captionHtml = formatCaptionToXHtml(description, "作品简介")
    const exportTimeStr = new Date().toLocaleString()
    const infoXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=1080, height=1520"/>
  <title>作品信息 - ${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body class="info-body">
  <div class="info-container">
    <h1 class="info-title">${escapeXml(title)}</h1>
    ${seriesTitle ? `<div class="info-series">系列 · ${escapeXml(seriesTitle)}</div>` : ""}

    <div class="meta-info">
      <div class="meta-item"><strong>作者：</strong>${authorUrl ? `<a href="${authorUrl}">${escapeXml(author)}</a>` : escapeXml(author)}</div>
      <div class="meta-item"><strong>Pixiv ID：</strong><a href="${workUrl}">${id}</a></div>
      <div class="meta-item"><strong>作品链接：</strong><a href="${workUrl}">${workUrl}</a></div>
      ${authorUrl ? `<div class="meta-item"><strong>作者主页：</strong><a href="${authorUrl}">${authorUrl}</a></div>` : ""}
      ${tags && tags.length > 0 ? `<div class="meta-item"><strong>标签：</strong>${escapeXml(tags.map(t => `#${t}`).join(" "))}</div>` : ""}
      <div class="meta-item"><strong>年龄分级：</strong>${hasR18 ? '<span style="color:#ff3b30;font-weight:600;">🔞 R-18 (成人向)</span>' : '全年龄 (General)'}</div>
      ${createdDateFormatted ? `<div class="meta-item"><strong>投稿时间：</strong>${createdDateFormatted}</div>` : ""}
      <div class="meta-item"><strong>收录规模：</strong>${normalizedChapters.length > 1 ? `全 ${normalizedChapters.length} 话，` : ""}共 ${allPagesToDownload.length} 页${isPartial ? ` (已下载 ${downloadedCount} 页)` : ""}</div>
      <div class="meta-item"><strong>导出时间：</strong>${exportTimeStr}</div>
    </div>

    ${captionHtml}
    ${chaptersCardHtml}
  </div>
</body>
</html>`
    FileManager.writeAsStringSync(`${oebpsDir}/info.xhtml`, infoXhtml, "utf-8")

    // 4. 生成各个漫画页面的 XHTML 与 Spine
    const downloadedPagesSorted = Array.from(downloadedPagesMap.values()).sort((a, b) => a.index - b.index)
    const isMultiChapManga = normalizedChapters.length > 1

    let timeSliceManga = Date.now()
    for (let idx = 0; idx < downloadedPagesSorted.length; idx++) {
      const p = downloadedPagesSorted[idx]
      const pageId = `page_${p.index}`
      const pageXhtmlName = `${pageId}.xhtml`
      const mime = p.fileName.endsWith(".png") ? "image/png" : "image/jpeg"
      const isCover = idx === 0

      const pageDocTitle = isMultiChapManga
        ? `${p.chapTitle} · 第 ${p.pageInChap} 页`
        : `${title} · 第 ${p.index} 页`

      const pageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=${p.width}, height=${p.height}"/>
  <title>${escapeXml(pageDocTitle)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body class="manga-page-body">
  <div class="manga-svg-container">
    <svg xmlns="http://www.w3.org/2000/svg" version="1.1"
         xmlns:xlink="http://www.w3.org/1999/xlink"
         viewBox="0 0 ${p.width} ${p.height}"
         width="100%" height="100%">
      <image width="${p.width}" height="${p.height}" xlink:href="images/${p.fileName}"/>
    </svg>
  </div>
</body>
</html>`

      FileManager.writeAsStringSync(`${oebpsDir}/${pageXhtmlName}`, pageXhtml, "utf-8")
      manifestItems.push(`<item id="img_${pageId}" href="images/${p.fileName}" media-type="${mime}"${isCover ? ` properties="cover-image"` : ""}/>`)
      manifestItems.push(`<item id="${pageId}" href="${pageXhtmlName}" media-type="application/xhtml+xml"/>`)
      spineItems.push(`<itemref idref="${pageId}"/>`)

      timeSliceManga = await yieldIfExceeded(timeSliceManga, 12)
    }

    // 5. 构建 TOC 目录树 (支持系列漫画章节层级与单篇平铺)
    let currentPlayOrder = 2
    const pageListItems: string[] = [
      `<li><a href="info.xhtml">作品信息</a></li>`
    ]

    downloadedPagesSorted.forEach((p) => {
      pageListItems.push(`<li><a href="page_${p.index}.xhtml">${p.index}</a></li>`)
    })

    if (isMultiChapManga) {
      normalizedChapters.forEach((c, cIdx) => {
        const chapDownloadedPages = c.pages
          .map((p) => downloadedPagesMap.get(p.globalIndex))
          .filter((p): p is { index: number; pageInChap: number; chapTitle: string; isChapFirstPage: boolean; fileName: string; width: number; height: number } => p != null)

        if (chapDownloadedPages.length === 0) return

        const firstPage = chapDownloadedPages[0]
        const firstPageXhtml = `page_${firstPage.index}.xhtml`

        const chapPlayOrder = currentPlayOrder++
        const subNavPoints: string[] = chapDownloadedPages.map((p) => {
          const pagePlayOrder = currentPlayOrder++
          const subTitle = `${c.title} · 第 ${p.pageInChap} 页`
          return `
      <navPoint id="nav-page-${p.index}" playOrder="${pagePlayOrder}">
        <navLabel><text>${escapeXml(subTitle)}</text></navLabel>
        <content src="page_${p.index}.xhtml"/>
      </navPoint>`
        })

        navPoints.push(`
  <navPoint id="nav-chap-${cIdx + 1}" playOrder="${chapPlayOrder}">
    <navLabel><text>${escapeXml(c.title)}</text></navLabel>
    <content src="${firstPageXhtml}"/>${subNavPoints.join("")}
  </navPoint>`)

        const subTocItems = chapDownloadedPages.map((p) => `<li><a href="page_${p.index}.xhtml">${escapeXml(c.title)} · 第 ${p.pageInChap} 页</a></li>`).join("\n          ")
        tocList.push(`<li>
        <a href="${firstPageXhtml}">${escapeXml(c.title)}</a>
        <ol>
          ${subTocItems}
        </ol>
      </li>`)
      })
    } else {
      downloadedPagesSorted.forEach((p) => {
        const pageId = `page_${p.index}`
        const pageXhtmlName = `${pageId}.xhtml`
        const pTitle = `第 ${p.index} 页`
        navPoints.push(`
  <navPoint id="nav-${pageId}" playOrder="${currentPlayOrder++}">
    <navLabel><text>${escapeXml(pTitle)}</text></navLabel>
    <content src="${pageXhtmlName}"/>
  </navPoint>`)
        tocList.push(`<li><a href="${pageXhtmlName}">${escapeXml(pTitle)}</a></li>`)
      })
    }

    const firstPageId = downloadedPagesSorted.length > 0 ? `img_page_${downloadedPagesSorted[0].index}` : ""
    const tagSubjects = (tags || []).map((t) => `<dc:subject>${escapeXml(t)}</dc:subject>`).join("\n    ")
    const seriesCollectionMeta = seriesTitle
      ? `<meta property="belongs-to-collection" id="c01">${escapeXml(seriesTitle)}</meta>\n    <meta refines="#c01" property="collection-type">series</meta>`
      : ""
    const createdDateMeta = createdDateIso
      ? `<dc:date>${createdDateIso}</dc:date>\n    <meta property="dcterms:created">${createdDateIso}</meta>`
      : ""
    const ageRatingMeta = hasR18
      ? `<meta property="schema:contentRating">R-18</meta>\n    <meta property="schema:typicalAgeRange">18-</meta>`
      : `<meta property="schema:contentRating">General</meta>`

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:pixiv:manga:${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>ja</dc:language>
    <dc:publisher>Pixiv</dc:publisher>
    <dc:source>${workUrl}</dc:source>
    ${authorUrl ? `<dc:relation>${authorUrl}</dc:relation>` : ""}
    <dc:description>${escapeXml((cleanDescription || "") + missingDesc)}</dc:description>
    ${tagSubjects}
    ${createdDateMeta}
    ${ageRatingMeta}
    ${seriesCollectionMeta}
    <meta property="dcterms:modified">${dateStr}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">auto</meta>
    ${firstPageId ? `<meta name="cover" content="${firstPageId}"/>` : ""}
  </metadata>
  <manifest>
    ${manifestItems.join("\n    ")}
  </manifest>
  <spine toc="ncx" page-progression-direction="rtl">
    ${spineItems.join("\n    ")}
  </spine>
</package>`
    FileManager.writeAsStringSync(`${oebpsDir}/content.opf`, contentOpf, "utf-8")

    const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:pixiv:manga:${id}"/>
    <meta name="dtb:depth" content="${isMultiChapManga ? "2" : "1"}"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>${navPoints.join("")}</navMap>
</ncx>`
    FileManager.writeAsStringSync(`${oebpsDir}/toc.ncx`, tocNcx, "utf-8")

    const tocXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
      ${tocList.join("\n      ")}
    </ol>
  </nav>
  <nav epub:type="page-list" id="page-list" hidden="hidden">
    <h2>页码表</h2>
    <ol>
      ${pageListItems.join("\n      ")}
    </ol>
  </nav>
</body>
</html>`
    FileManager.writeAsStringSync(`${oebpsDir}/toc.xhtml`, tocXhtml, "utf-8")

    progressReporter.notify("正在组装漫画 EPUB...", allPagesToDownload.length, allPagesToDownload.length)
    progressReporter.flush()
    await yieldToMainThread()
    const success = await packageEpubDirectory(tempDir, targetFilePath)
    return {
      success,
      path: success ? targetFilePath : null,
      isPartial,
      downloadedPages: downloadedCount,
      totalPages: allPagesToDownload.length,
      failedPages,
    }
  } catch (err: any) {
    console.log("exportMangaToEpub error:", err?.message ?? err)
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
      if (FileManager.existsSync(tempDir)) {
        FileManager.removeSync(tempDir)
      }
    } catch {}
  }
}
