import { fetchImageBinaryWithRetry, runConcurrentTasks, type ExportResult } from "./downloadHelper"
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
  description?: string
  tags?: string[]
  coverUrl?: string
  chapters: NovelChapter[]
  targetDir?: string
  customFileName?: string
  onProgress?: (msg: string, current: number, total: number) => void
}

export interface MangaPageItem {
  pageIndex: number
  url: string
}

export interface MangaEpubOptions {
  id: number
  title: string
  author: string
  authorId?: number
  seriesTitle?: string
  description?: string
  tags?: string[]
  pages: MangaPageItem[]
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
body {
  margin: 0;
  padding: 0;
  background-color: #000000;
  text-align: center;
}
.manga-page {
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
}
.manga-page img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
`

/**
 * 将章节简介清洗并转换为规范的 XHTML 段落结构
 */
function formatCaptionToXHtml(rawCaption?: string): string {
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
  return `<div class="caption-box">\n  ${pTags}\n</div>`
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
  imageKeyToFileMap: Map<string, string>
): string {
  if (!rawText) return ""
  const lines = rawText.split(/\r?\n/)
  const resultBlocks: string[] = []

  // 块级/独立指令正则：[uploadedimage:...], [pixivimage:...], [chapter:...], [newpage], [jump:...]
  const BLOCK_SPLIT_REGEX =
    /(\[(?:uploadedimage|pixivimage)\s*[:：]\s*[^\]]+\]|\[chapter\s*[:：]\s*[^\]]+\]|\[newpage\]|\[jump\s*[:：]\s*\d+\])/gi

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

      // 2. [newpage]
      if (/^\[newpage\]$/i.test(seg.trim())) {
        resultBlocks.push(`<hr class="page-divider"/>`)
        continue
      }

      // 3. [jump: 页码]
      if (/^\[jump\s*[:：]\s*\d+\]$/i.test(seg.trim())) {
        continue
      }

      // 4. [uploadedimage: ID] 或 [pixivimage: ID]
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

      // 5. 普通正文文本：去除行首段落缩进与空白（由 CSS text-indent: 2em 统一保证精准空两格），转义并解析行内语法
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
    description,
    tags = [],
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
    onProgress?.("准备下载封面与插图...", 0, chapters.length)
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
      onProgress?.(`下载插图 (共 ${allImagesToDownload.length} 张)...`, 0, allImagesToDownload.length)
      await runConcurrentTasks(allImagesToDownload, 4, async (item, idx) => {
        const data = await fetchImageBinaryWithRetry(item.url)
        if (data) {
          FileManager.writeAsDataSync(`${imagesDir}/${item.filename}`, data)
        }
        onProgress?.(`下载插图 (${idx + 1}/${allImagesToDownload.length})`, idx + 1, allImagesToDownload.length)
      })
    }

    // 5. 生成各章节 XHTML 文件
    const manifestItems: string[] = [
      `<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
      `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
      `<item id="style" href="style.css" media-type="text/css"/>`,
    ]
    const spineItems: string[] = []
    const navPoints: string[] = []
    const tocList: string[] = []

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
  <navPoint id="nav-cover" playOrder="1">
    <navLabel><text>封面</text></navLabel>
    <content src="cover.xhtml"/>
  </navPoint>`)
      tocList.push(`<li><a href="cover.xhtml">封面</a></li>`)
    }

    const isSeries = Boolean(seriesTitle && chapters.length > 1)
    const workUrl = isSeries
      ? `https://www.pixiv.net/novel/series/${id}`
      : `https://www.pixiv.net/novel/show.php?id=${id}`
    const authorUrl = authorId ? `https://www.pixiv.net/users/${authorId}` : ""

    chapters.forEach((chap, idx) => {
      const chapId = `chapter_${idx + 1}`
      const chapFileName = `${chapId}.xhtml`
      const formattedBody = formatNovelTextToXHtml(chap.text, imageKeyToFileMap)
      const chapTitle = chap.title || `第 ${idx + 1} 章`
      const captionHtml = formatCaptionToXHtml(chap.caption)

      let metaInfoHtml = ""
      if (idx === 0) {
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
          metaItems.push(`<div class="meta-item">标签：${escapeXml(tags.join(", "))}</div>`)
        }
        metaInfoHtml = `<div class="meta-info">\n    ${metaItems.join("\n    ")}\n  </div>`
      }

      const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(chapTitle)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(chapTitle)}</h1>
  ${metaInfoHtml}
  ${captionHtml}
  ${formattedBody}
</body>
</html>`

      FileManager.writeAsStringSync(`${oebpsDir}/${chapFileName}`, chapterXhtml, "utf-8")
      manifestItems.push(`<item id="${chapId}" href="${chapFileName}" media-type="application/xhtml+xml"/>`)
      spineItems.push(`<itemref idref="${chapId}"/>`)

      const playOrder = (hasCover ? 2 : 1) + idx
      navPoints.push(`
  <navPoint id="nav-${chapId}" playOrder="${playOrder}">
    <navLabel><text>${escapeXml(chapTitle)}</text></navLabel>
    <content src="${chapFileName}"/>
  </navPoint>`)
      tocList.push(`<li><a href="${chapFileName}">${escapeXml(chapTitle)}</a></li>`)
    })

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

    // 6. content.opf
    const dateStr = new Date().toISOString()
    const cleanDescription = description ? htmlToPlainText(description) : ""
    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:pixiv:novel:${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>zh</dc:language>
    <dc:source>${workUrl}</dc:source>
    ${authorUrl ? `<dc:relation>${authorUrl}</dc:relation>` : ""}
    ${cleanDescription ? `<dc:description>${escapeXml(cleanDescription)}</dc:description>` : ""}
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

    // 7. toc.ncx
    const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:pixiv:novel:${id}"/>
    <meta name="dtb:depth" content="1"/>
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

    // 8. toc.xhtml
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
    onProgress?.("正在组装 EPUB 电子书...", chapters.length, chapters.length)
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
 * 导出漫画为固定版面 EPUB 文件（支持容错导出与确切结果报告）
 */
export async function exportMangaToEpub(options: MangaEpubOptions): Promise<ExportResult> {
  const {
    id,
    title,
    author,
    authorId,
    seriesTitle,
    description,
    pages,
    targetDir: customTargetDir,
    customFileName,
    onProgress,
  } = options

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

    // 并发下载所有漫画页面
    onProgress?.(`下载漫画图片 (共 ${pages.length} 页)...`, 0, pages.length)
    const downloadedPages: { index: number; fileName: string }[] = []
    const failedPages: number[] = []

    await runConcurrentTasks(pages, 4, async (p, idx) => {
      const pageNum = idx + 1
      const data = await fetchImageBinaryWithRetry(p.url)
      if (data) {
        const paddedNum = String(pageNum).padStart(3, "0")
        const ext = p.url.includes(".png") ? "png" : "jpg"
        const fileName = `page_${paddedNum}.${ext}`
        FileManager.writeAsDataSync(`${imagesDir}/${fileName}`, data)
        downloadedPages.push({ index: pageNum, fileName })
      } else {
        failedPages.push(pageNum)
      }
      onProgress?.(`下载漫画图片 (${idx + 1}/${pages.length})`, idx + 1, pages.length)
    })

    downloadedPages.sort((a, b) => a.index - b.index)
    failedPages.sort((a, b) => a - b)

    if (downloadedPages.length === 0) {
      return {
        success: false,
        path: null,
        isPartial: false,
        downloadedPages: 0,
        totalPages: pages.length,
        failedPages,
        error: "全部漫画页面下载失败",
      }
    }

    const isPartial = downloadedPages.length < pages.length
    const partialSuffix = isPartial ? `_[缺${pages.length - downloadedPages.length}页]` : ""

    const safeTitle = customFileName
      ? sanitizeFileName(customFileName)
      : sanitizeFileName(seriesTitle ? `${seriesTitle} - ${title}` : `${title}_${author}`)
    const outputFileName = `${safeTitle}${partialSuffix}.epub`
    const targetDir = customTargetDir || getCategoryDirectory("manga")
    if (!FileManager.existsSync(targetDir)) {
      try { FileManager.createDirectorySync(targetDir, true) } catch {}
    }
    const targetFilePath = `${targetDir}/${outputFileName}`

    const manifestItems: string[] = [
      `<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
      `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
      `<item id="style" href="style.css" media-type="text/css"/>`,
    ]
    const spineItems: string[] = []
    const navPoints: string[] = []
    const tocList: string[] = []

    downloadedPages.forEach((p, idx) => {
      const pageId = `page_${p.index}`
      const pageXhtmlName = `${pageId}.xhtml`
      const mime = p.fileName.endsWith(".png") ? "image/png" : "image/jpeg"
      const isCover = idx === 0

      const pageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>P${p.index}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <div class="manga-page"><img src="images/${p.fileName}" alt="Page ${p.index}"/></div>
</body>
</html>`

      FileManager.writeAsStringSync(`${oebpsDir}/${pageXhtmlName}`, pageXhtml, "utf-8")
      manifestItems.push(`<item id="img_${pageId}" href="images/${p.fileName}" media-type="${mime}"${isCover ? ` properties="cover-image"` : ""}/>`)
      manifestItems.push(`<item id="${pageId}" href="${pageXhtmlName}" media-type="application/xhtml+xml"/>`)
      spineItems.push(`<itemref idref="${pageId}"/>`)

      navPoints.push(`
  <navPoint id="nav-${pageId}" playOrder="${idx + 1}">
    <navLabel><text>第 ${p.index} 页</text></navLabel>
    <content src="${pageXhtmlName}"/>
  </navPoint>`)
      tocList.push(`<li><a href="${pageXhtmlName}">第 ${p.index} 页</a></li>`)
    })

    const dateStr = new Date().toISOString()
    const cleanDescription = description ? htmlToPlainText(description) : ""
    const missingDesc = isPartial ? ` (容错导出，缺失第 ${failedPages.join(", ")} 页)` : ""
    const workUrl = `https://www.pixiv.net/artworks/${id}`
    const authorUrl = authorId ? `https://www.pixiv.net/users/${authorId}` : ""
    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:pixiv:manga:${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>ja</dc:language>
    <dc:source>${workUrl}</dc:source>
    ${authorUrl ? `<dc:relation>${authorUrl}</dc:relation>` : ""}
    <dc:description>${escapeXml((cleanDescription || "") + missingDesc)}</dc:description>
    <meta property="dcterms:modified">${dateStr}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta name="cover" content="img_page_1"/>
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
  <head><meta name="dtb:uid" content="urn:pixiv:manga:${id}"/></head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>${navPoints.join("")}</navMap>
</ncx>`
    FileManager.writeAsStringSync(`${oebpsDir}/toc.ncx`, tocNcx, "utf-8")

    const tocXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>${tocList.join("\n")}</ol></nav></body>
</html>`
    FileManager.writeAsStringSync(`${oebpsDir}/toc.xhtml`, tocXhtml, "utf-8")

    onProgress?.("正在组装漫画 EPUB...", pages.length, pages.length)
    const success = await packageEpubDirectory(tempDir, targetFilePath)
    return {
      success,
      path: success ? targetFilePath : null,
      isPartial,
      downloadedPages: downloadedPages.length,
      totalPages: pages.length,
      failedPages,
    }
  } catch (err: any) {
    console.log("exportMangaToEpub error:", err?.message ?? err)
    return {
      success: false,
      path: null,
      isPartial: false,
      downloadedPages: 0,
      totalPages: pages.length,
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
