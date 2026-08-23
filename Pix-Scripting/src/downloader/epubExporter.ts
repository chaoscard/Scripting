import { fetchImageBinaryWithRetry, runConcurrentTasks } from "./downloadHelper"
import { getCategoryDirectory, sanitizeFileName } from "./directoryResolver"

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
  padding-bottom: 15px;
  margin-bottom: 25px;
  font-size: 0.9em;
  color: #666666;
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
 * 转换 Pixiv 小说正文中的自定义语法为标准 XHTML
 */
function formatNovelTextToXHtml(
  rawText: string,
  imageKeyToFileMap: Map<string, string>
): string {
  let content = rawText || ""

  // 1. Ruby 语法转换: [[rb:汉字 > 注音]] 或 [ruby text=注音]汉字[/ruby]
  content = content.replace(/\[\[rb:([^>]+)>([^\]]+)\]\]/g, (_m, word, rt) => {
    return `<ruby>${escapeXml(word.trim())}<rt>${escapeXml(rt.trim())}</rt></ruby>`
  })
  content = content.replace(/\[ruby\s+text=([^\]]+)\](.*?)\[\/ruby\]/g, (_m, rt, word) => {
    return `<ruby>${escapeXml(word.trim())}<rt>${escapeXml(rt.trim())}</rt></ruby>`
  })

  // 2. 章节标题: [chapter:章节名]
  content = content.replace(/\[chapter:([^\]]+)\]/g, (_m, title) => {
    return `<h2>${escapeXml(title.trim())}</h2>`
  })

  // 3. 换页/跳转: [jump:页码] 或 [newpage]
  content = content.replace(/\[newpage\]/g, `<hr style="margin:2em 0;border:0;border-top:1px dashed #ccc;"/>`)
  content = content.replace(/\[jump:\d+\]/g, "")

  // 4. 插图标记: [pixivimage:xxxx] 或 [uploadedimage:xxxx]
  content = content.replace(/\[(?:pixivimage|uploadedimage):([^\]]+)\]/g, (_m, imgId) => {
    const filename = imageKeyToFileMap.get(imgId)
    if (filename) {
      return `<div class="ill-box"><img src="images/${filename}" alt="插图"/></div>`
    }
    return ""
  })

  // 5. 按行切分转段落
  const lines = content.split(/\r?\n/)
  const resultBlocks: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    if (
      trimmed.startsWith("<h2") ||
      trimmed.startsWith("<div") ||
      trimmed.startsWith("<hr")
    ) {
      resultBlocks.push(line)
    } else {
      resultBlocks.push(`<p>${escapeXml(line)}</p>`)
    }
  }

  return resultBlocks.join("\n")
}

/**
 * 构建 EPUB 规范目录并打包
 */
async function packageEpubDirectory(
  tempEpubDir: string,
  targetOutputPath: string
): Promise<boolean> {
  try {
    if (FileManager.existsSync(targetOutputPath)) {
      try {
        FileManager.removeSync(targetOutputPath)
      } catch {}
    }

    const tempZipPath = `${tempEpubDir}.zip`
    if (FileManager.existsSync(tempZipPath)) {
      try {
        FileManager.removeSync(tempZipPath)
      } catch {}
    }

    await FileManager.zip(tempEpubDir, tempZipPath)
    if (!FileManager.existsSync(tempZipPath)) {
      return false
    }

    // 移动并重命名为 .epub
    await FileManager.copyFile(tempZipPath, targetOutputPath)
    try {
      FileManager.removeSync(tempZipPath)
      FileManager.removeSync(tempEpubDir)
    } catch {}

    return true
  } catch (err: any) {
    console.log("packageEpubDirectory error:", err?.message ?? err)
    return false
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
    seriesTitle,
    description,
    tags = [],
    coverUrl,
    chapters,
    onProgress,
  } = options

  const safeTitle = sanitizeFileName(seriesTitle ? `${seriesTitle} - ${title}` : `${title}_${author}`)
  const outputFileName = `${safeTitle}.epub`
  const targetDir = getCategoryDirectory("novels")
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

    // 4. 下载封面与内嵌插图
    onProgress?.("准备下载封面与插图...", 0, chapters.length)
    let hasCover = false
    if (coverUrl) {
      const coverData = await fetchImageBinaryWithRetry(coverUrl)
      if (coverData) {
        FileManager.writeAsDataSync(`${imagesDir}/cover.jpg`, coverData)
        hasCover = true
      }
    }

    // 收集所有章节的插图 URL 并并发下载
    const imageKeyToFileMap = new Map<string, string>()
    const allImagesToDownload: { key: string; url: string }[] = []

    chapters.forEach((chap) => {
      if (chap.images) {
        Object.entries(chap.images).forEach(([key, url]) => {
          if (url && !imageKeyToFileMap.has(key)) {
            const ext = url.includes(".png") ? "png" : "jpg"
            const filename = `ill_${sanitizeFileName(key)}.${ext}`
            imageKeyToFileMap.set(key, filename)
            allImagesToDownload.push({ key, url })
          }
        })
      }
    })

    if (allImagesToDownload.length > 0) {
      onProgress?.(`下载插图 (共 ${allImagesToDownload.length} 张)...`, 0, allImagesToDownload.length)
      await runConcurrentTasks(allImagesToDownload, 4, async (item, idx) => {
        const data = await fetchImageBinaryWithRetry(item.url)
        if (data) {
          const filename = imageKeyToFileMap.get(item.key)
          if (filename) {
            FileManager.writeAsDataSync(`${imagesDir}/${filename}`, data)
          }
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

    chapters.forEach((chap, idx) => {
      const chapId = `chapter_${idx + 1}`
      const chapFileName = `${chapId}.xhtml`
      const formattedBody = formatNovelTextToXHtml(chap.text, imageKeyToFileMap)
      const chapTitle = chap.title || `第 ${idx + 1} 章`

      let captionHtml = ""
      if (chap.caption) {
        captionHtml = `<div class="caption-box">${escapeXml(chap.caption)}</div>`
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
  ${idx === 0 ? `<div class="meta-info">作者：${escapeXml(author)}${tags.length > 0 ? ` · 标签：${escapeXml(tags.join(", "))}` : ""}</div>` : ""}
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

    // 加入插图 manifest
    imageKeyToFileMap.forEach((fileName, key) => {
      const mime = fileName.endsWith(".png") ? "image/png" : "image/jpeg"
      manifestItems.push(`<item id="img_${sanitizeFileName(key)}" href="images/${fileName}" media-type="${mime}"/>`)
    })

    // 6. content.opf
    const dateStr = new Date().toISOString()
    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:pixiv:novel:${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>zh</dc:language>
    ${description ? `<dc:description>${escapeXml(description)}</dc:description>` : ""}
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
  }
}

/**
 * 导出漫画为固定版面 EPUB 文件
 */
export async function exportMangaToEpub(options: MangaEpubOptions): Promise<string | null> {
  const { id, title, author, seriesTitle, description, pages, onProgress } = options

  const safeTitle = sanitizeFileName(seriesTitle ? `${seriesTitle} - ${title}` : `${title}_${author}`)
  const outputFileName = `${safeTitle}.epub`
  const targetDir = getCategoryDirectory("manga")
  const targetFilePath = `${targetDir}/${outputFileName}`

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

    await runConcurrentTasks(pages, 4, async (p, idx) => {
      const data = await fetchImageBinaryWithRetry(p.url)
      if (data) {
        const paddedNum = String(idx + 1).padStart(3, "0")
        const ext = p.url.includes(".png") ? "png" : "jpg"
        const fileName = `page_${paddedNum}.${ext}`
        FileManager.writeAsDataSync(`${imagesDir}/${fileName}`, data)
        downloadedPages.push({ index: idx + 1, fileName })
      }
      onProgress?.(`下载漫画图片 (${idx + 1}/${pages.length})`, idx + 1, pages.length)
    })

    downloadedPages.sort((a, b) => a.index - b.index)
    if (downloadedPages.length === 0) return null

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
    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:pixiv:manga:${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>ja</dc:language>
    ${description ? `<dc:description>${escapeXml(description)}</dc:description>` : ""}
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
    return success ? targetFilePath : null
  } catch (err: any) {
    console.log("exportMangaToEpub error:", err?.message ?? err)
    return null
  }
}
