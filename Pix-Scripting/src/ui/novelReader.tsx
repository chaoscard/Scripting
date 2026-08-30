import {
  ProgressView,
  Spacer,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  WebView,
  ZStack,
  type Color,
} from "scripting"
import { requestPixivRoute } from "./routeNavigation"
import { presentExternalURL, routeForDescriptionLink } from "./components"
import { session } from "../api/session"
import { illustrationDetail } from "../api/pixiv"
import { imageUrlOf, cachedFilePath, loadImage } from "../image/imageLoader"
import type { PixivIllustration, TextEmbeddedImage } from "../types"
import {
  calculateLineSpacing,
  loadNovelReaderSettings,
  NOVEL_THEME_PALETTES,
  onNovelReaderSettingsChanged,
  resolveFontName,
  type NovelReaderSettings,
  type NovelThemePalette,
} from "../store/novelReaderSettings"
import { getNovelProgress, recordNovelProgress } from "../store/novelProgress"

export function escapeHtml(text: string): string {
  if (!text) return ""
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * 将 Pixiv 小说注音 [[rb: 汉字 > 假名]] 转换为标准文本 汉字(假名)
 */
export function formatPixivRubyText(rawText: string): string {
  if (!rawText || !rawText.includes("[[rb:")) return rawText
  return rawText.replace(
    /\[\[rb:\s*([^\r\n>]+?)\s*(?:>|&gt;)\s*([^\r\n\]]+?)\s*\]\]/g,
    (_, kanji: string, ruby: string) => `${kanji.trim()}(${ruby.trim()})`
  )
}

/**
 * 将 Pixiv 小说注音 [[rb: 汉字 > 假名]] 转换为 HTML <ruby> 标签
 */
export function formatPixivRubyToHtml(rawText: string): string {
  if (!rawText || !rawText.includes("[[rb:")) return escapeHtml(rawText)
  return rawText.replace(
    /\[\[rb:\s*([^\r\n>]+?)\s*(?:>|&gt;)\s*([^\r\n\]]+?)\s*\]\]/g,
    (_, kanji: string, ruby: string) =>
      `<ruby>${escapeHtml(kanji.trim())}<rt>${escapeHtml(ruby.trim())}</rt></ruby>`
  )
}

const URL_CHAR = "[a-zA-Z0-9\\-._~:/?#\\[\\]@!$&'()*+,;%=]"
const INLINE_LINK_PATTERN = new RegExp(
  "(?:https?:\\/\\/|www\\.)" + URL_CHAR + "+|" +
  "(?:https?:\\/\\/)?(?:www\\.)?pixiv\\.net\\/(?:[a-zA-Z]{2}(?:-[a-zA-Z0-9]+)?\\/)?(?:users?|user|artworks|novels?|novel|manga|illusts?|illust|tags)" + URL_CHAR + "*|" +
  "\\/?(?:users?|user|artworks|novels?|novel|manga|illusts?|illust)\\/" + URL_CHAR + "+|" +
  "(?:pixiv\\.net\\/|\\/)?(?:[a-zA-Z]{2}(?:-[a-zA-Z0-9]+)?\\/)?novel\\/show\\.php\\?[^#\\s<>\"]+|" +
  "(?:pixiv\\.net\\/|\\/)?(?:[a-zA-Z]{2}(?:-[a-zA-Z0-9]+)?\\/)?member\\.php\\?[^#\\s<>\"]+|" +
  "(?:pixiv\\.net\\/|\\/)?(?:[a-zA-Z]{2}(?:-[a-zA-Z0-9]+)?\\/)?member_illust\\.php\\?[^#\\s<>\"]+|" +
  "\\b(?:uid|pid|nid)\\s*[:：#=]?\\s*\\d+\\b|" +
  "pixiv:\\/\\/" + URL_CHAR + "+",
  "gi"
)

function containsPotentialLink(text: string): boolean {
  if (!text) return false
  return (
    text.includes("http://") ||
    text.includes("https://") ||
    text.includes("www.") ||
    text.includes("pixiv.net") ||
    text.includes("pixiv://") ||
    text.includes("/user/") ||
    text.includes("/users/") ||
    text.includes("/artworks/") ||
    text.includes("/novel/") ||
    text.includes("/novels/") ||
    text.includes("/illust/") ||
    text.includes("/illusts/") ||
    text.includes("/tags/") ||
    text.includes(".php?") ||
    /\b(?:uid|pid|nid)\b/i.test(text)
  )
}

/**
 * 格式化段落中的链接与跳转指令为带有点击事件的 HTML
 */
export function formatNovelParagraphToHtml(rawText: string): string {
  const hasJumpuri = rawText.includes("[[jumpuri:")
  const hasLink = containsPotentialLink(rawText)

  if (!hasJumpuri && !hasLink) {
    return formatPixivRubyToHtml(rawText)
  }

  const jumpuris: { label: string; url: string }[] = []
  const textWithPlaceholders = hasJumpuri
    ? rawText.replace(
        /\[\[jumpuri:\s*([^\r\n>]+?)\s*(?:>|&gt;)\s*([^\r\n\]]+?)\s*\]\]/g,
        (_, label: string, url: string) => {
          const idx = jumpuris.length
          jumpuris.push({ label: label.trim(), url: url.trim() })
          return `\uE000JUMPURI_${idx}\uE001`
        }
      )
    : rawText

  const jumpParts = hasJumpuri
    ? textWithPlaceholders.split(/(\uE000JUMPURI_\d+\uE001)/g)
    : [textWithPlaceholders]

  const outHtmlParts: string[] = []

  for (const part of jumpParts) {
    if (!part) continue
    if (hasJumpuri) {
      const jMatch = part.match(/^\uE000JUMPURI_(\d+)\uE001$/)
      if (jMatch) {
        const jItem = jumpuris[Number(jMatch[1])]
        if (jItem) {
          const safeUrl = escapeHtml(jItem.url)
          const safeLabel = formatPixivRubyToHtml(jItem.label)
          outHtmlParts.push(
            `<a href="#" onclick="handleOpenLink('${safeUrl}'); return false;">${safeLabel}</a>`
          )
        }
        continue
      }
    }

    if (!containsPotentialLink(part)) {
      outHtmlParts.push(formatPixivRubyToHtml(part))
      continue
    }

    let cursor = 0
    let match: RegExpExecArray | null
    INLINE_LINK_PATTERN.lastIndex = 0

    while ((match = INLINE_LINK_PATTERN.exec(part)) != null) {
      if (match.index > cursor) {
        outHtmlParts.push(formatPixivRubyToHtml(part.slice(cursor, match.index)))
      }
      const raw = match[0]
      const link = raw.replace(/[),.，。！!？?;；）】》」』、]+$/, "")
      const trailingPunct = raw.slice(link.length)
      if (link) {
        const safeUrl = escapeHtml(link)
        outHtmlParts.push(
          `<a href="#" onclick="handleOpenLink('${safeUrl}'); return false;">${safeUrl}</a>`
        )
      }
      if (trailingPunct) {
        outHtmlParts.push(formatPixivRubyToHtml(trailingPunct))
      }
      cursor = match.index + raw.length
    }

    if (cursor < part.length) {
      outHtmlParts.push(formatPixivRubyToHtml(part.slice(cursor)))
    }
  }

  return outHtmlParts.join("")
}

export type NovelChunkItem =
  | { type: "text"; id: string; text: string }
  | { type: "chapter"; id: string; title: string; chapterIndex: number }
  | { type: "newpage"; id: string; page: number }
  | { type: "jump"; id: string; page: number }
  | { type: "uploadedimage"; id: string; imageId: string; info?: TextEmbeddedImage }
  | { type: "pixivimage"; id: string; illustId: number; page?: number }

interface NovelParserState {
  pageIndex: number
  chapterIndex: number
  currentBuffer: string[]
  currentBufferChars: number
  items: NovelChunkItem[]
}

function flushTextBuffer(state: NovelParserState): void {
  if (state.currentBuffer.length === 0) return
  const text = state.currentBuffer.join("\n").trim()
  if (text.length > 0) {
    state.items.push({
      type: "text",
      id: `chunk-${state.items.length}`,
      text,
    })
  }
  state.currentBuffer = []
  state.currentBufferChars = 0
}

function processLineIntoNovelItems(
  rawLine: string,
  state: NovelParserState,
  textEmbeddedImages?: Record<string, TextEmbeddedImage>
): void {
  const line = rawLine.trim()

  // 1. [newpage]
  if (/^\[newpage\]$/i.test(line)) {
    flushTextBuffer(state)
    state.pageIndex += 1
    state.items.push({
      type: "newpage",
      id: `page-${state.pageIndex}`,
      page: state.pageIndex,
    })
    return
  }

  // 2. [chapter: xxx]
  const chapterMatch = line.match(/^\[chapter\s*[:：]\s*(.+?)\]$/i)
  if (chapterMatch) {
    flushTextBuffer(state)
    state.chapterIndex += 1
    state.items.push({
      type: "chapter",
      id: `chapter-${state.chapterIndex}`,
      title: chapterMatch[1].trim(),
      chapterIndex: state.chapterIndex,
    })
    return
  }

  // 3. [jump: xxx]
  const jumpMatch = line.match(/^\[jump\s*[:：]\s*(\d+)\]$/i)
  if (jumpMatch) {
    flushTextBuffer(state)
    const targetPage = parseInt(jumpMatch[1], 10)
    state.items.push({
      type: "jump",
      id: `jump-${state.items.length}`,
      page: targetPage,
    })
    return
  }

  // 4. [uploadedimage: xxx]
  const UP_IMG_INLINE = /\[(?:uploadedimage|uploadimage)\s*[:：]\s*([a-zA-Z0-9_\-]+)\s*\]/gi
  if (UP_IMG_INLINE.test(line)) {
    UP_IMG_INLINE.lastIndex = 0
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = UP_IMG_INLINE.exec(line)) != null) {
      const before = line.slice(cursor, match.index)
      if (before) {
        state.currentBuffer.push(before)
        state.currentBufferChars += before.length
      }
      cursor = UP_IMG_INLINE.lastIndex
      flushTextBuffer(state)
      const imageId = match[1].trim()
      const info = textEmbeddedImages
        ? textEmbeddedImages[imageId] ||
          (textEmbeddedImages as any)[Number(imageId)] ||
          Object.values(textEmbeddedImages).find(
            (img: any) => img?.novelImageId === imageId || img?.id === imageId
          )
        : undefined
      state.items.push({
        type: "uploadedimage",
        id: `up-${imageId}-${state.items.length}`,
        imageId,
        info,
      })
    }
    if (cursor < line.length) {
      const remaining = line.slice(cursor)
      if (remaining) {
        state.currentBuffer.push(remaining)
        state.currentBufferChars += remaining.length + 1
      }
    }
    if (state.currentBufferChars > 1500) {
      flushTextBuffer(state)
    }
    return
  }

  // 5. [pixivimage: xxx]
  const PX_IMG_INLINE = /\[pixivimage\s*[:：]\s*(\d+)(?:-(\d+))?\s*\]/gi
  if (PX_IMG_INLINE.test(line)) {
    PX_IMG_INLINE.lastIndex = 0
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = PX_IMG_INLINE.exec(line)) != null) {
      const before = line.slice(cursor, match.index)
      if (before) {
        state.currentBuffer.push(before)
        state.currentBufferChars += before.length
      }
      cursor = PX_IMG_INLINE.lastIndex
      flushTextBuffer(state)
      const illustId = parseInt(match[1], 10)
      const page = match[2] ? parseInt(match[2], 10) : undefined
      state.items.push({
        type: "pixivimage",
        id: `px-${illustId}-${page || 0}-${state.items.length}`,
        illustId,
        page,
      })
    }
    if (cursor < line.length) {
      const remaining = line.slice(cursor)
      if (remaining) {
        state.currentBuffer.push(remaining)
        state.currentBufferChars += remaining.length + 1
      }
    }
    if (state.currentBufferChars > 1500) {
      flushTextBuffer(state)
    }
    return
  }

  state.currentBuffer.push(line)
  state.currentBufferChars += line.length + 1

  if (state.currentBufferChars > 1500) {
    flushTextBuffer(state)
  }
}

export function parseNovelToChunks(
  rawText: string,
  textEmbeddedImages?: Record<string, TextEmbeddedImage>
): NovelChunkItem[] {
  if (!rawText) return []
  const lines = rawText.split(/\r?\n/)
  const state: NovelParserState = {
    pageIndex: 1,
    chapterIndex: 0,
    currentBuffer: [],
    currentBufferChars: 0,
    items: [],
  }

  for (let i = 0; i < lines.length; i++) {
    processLineIntoNovelItems(lines[i], state, textEmbeddedImages)
  }

  if (state.currentBuffer.length > 0) {
    const combined = state.currentBuffer.join("\n").trim()
    if (combined.length > 0) {
      state.items.push({
        type: "text",
        id: `chunk-${state.items.length}`,
        text: combined,
      })
    }
  }

  return state.items
}

export interface NovelPageBlock {
  page: number
  items: NovelChunkItem[]
}

export function groupChunksByPage(chunks: NovelChunkItem[]): NovelPageBlock[] {
  if (chunks.length === 0) return []
  const pages: NovelPageBlock[] = []
  let currentBlock: NovelPageBlock = { page: 1, items: [] }
  pages.push(currentBlock)

  for (const chunk of chunks) {
    if (chunk.type === "newpage") {
      currentBlock = { page: chunk.page, items: [chunk] }
      pages.push(currentBlock)
    } else {
      currentBlock.items.push(chunk)
    }
  }

  return pages
}

function getLocalImageDataUrl(filePath: string): string | null {
  try {
    if (!FileManager.existsSync(filePath)) return null
    const data = FileManager.readAsDataSync(filePath)
    if (!data) return null
    const lower = filePath.toLowerCase()
    const mime = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg"
    return `data:${mime};base64,${data.toBase64String()}`
  } catch {
    return null
  }
}

function getUploadedImageUrl(info?: TextEmbeddedImage): string | null {
  if (!info) return null
  return (
    info.urls?.["1200x1200"] ||
    info.urls?.original ||
    info.urls?.["480mw"] ||
    (info as any)?.urls?.large ||
    (info as any)?.urls?.medium ||
    (info as any)?.url ||
    null
  )
}

/**
 * 统一小说排版 HTML 生成器（横排 / 竖排）
 */
function buildNovelHtml(
  direction: "horizontal" | "vertical",
  chunks: NovelChunkItem[],
  settings: NovelReaderSettings,
  palette: NovelThemePalette,
  targetChunkId?: string | null,
  targetPage?: number | null,
  imageCache?: Record<
    string,
    { dataUrl: string; title?: string; author?: string; illustId?: number }
  >
): string {
  const isVertical = direction === "vertical"
  const fontName = resolveFontName(settings.fontId, settings.customFontPostscriptName)
  const fontFamilyCss = fontName
    ? `"${fontName}", "Songti SC", "Hiragino Mincho ProN", "PingFang SC", serif`
    : `"-apple-system", "PingFang SC", "Songti SC", "Hiragino Mincho ProN", serif`

  const weightCss =
    settings.fontWeight === "bold"
      ? "bold"
      : settings.fontWeight === "medium"
      ? "500"
      : "normal"
  const lineSpacing = calculateLineSpacing(settings.fontSize, settings.lineSpacingLevel)
  const lineHeight = ((settings.fontSize + lineSpacing) / settings.fontSize).toFixed(2)

  let colorSchemeMeta = '<meta name="color-scheme" content="light dark">'
  let themeCssVars = ""

  if (settings.themeId === "default") {
    colorSchemeMeta = '<meta name="color-scheme" content="light dark">'
    themeCssVars = `
  :root {
    color-scheme: light dark;
    --bg-color: transparent;
    --text-color: #1C1C1E;
    --secondary-text-color: #8E8E93;
    --divider-color: rgba(128, 128, 128, 0.2);
    --accent-color: #007AFF;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg-color: transparent;
      --text-color: #F2F2F7;
      --secondary-text-color: #98989D;
      --divider-color: rgba(255, 255, 255, 0.15);
      --accent-color: #0A84FF;
    }
  }`
  } else if (settings.themeId === "custom") {
    const isDarkMask = settings.customBgMaskColor === "black"
    colorSchemeMeta = `<meta name="color-scheme" content="${isDarkMask ? "dark" : "light"}">`
    themeCssVars = `
  :root {
    color-scheme: ${isDarkMask ? "dark" : "light"};
    --bg-color: transparent;
    --text-color: ${isDarkMask ? "#F2F2F7" : "#1C1C1E"};
    --secondary-text-color: ${isDarkMask ? "#A0A0A5" : "#8E8E93"};
    --divider-color: ${isDarkMask ? "rgba(255, 255, 255, 0.2)" : "rgba(128, 128, 128, 0.2)"};
    --accent-color: ${isDarkMask ? "#0A84FF" : "#007AFF"};
  }`
  } else {
    const isDark = palette.isDark
    colorSchemeMeta = `<meta name="color-scheme" content="${isDark ? "dark" : "light"}">`
    const bg = palette.backgroundColor ?? (isDark ? "#000000" : "#FFFFFF")
    const text = palette.textColor ?? (isDark ? "#F2F2F7" : "#1C1C1E")
    const secondaryText = palette.secondaryTextColor ?? (isDark ? "#68686C" : "#8E8E93")
    const divider =
      palette.dividerColor ?? (isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(128, 128, 128, 0.2)")
    const accent = isDark ? "#0A84FF" : "#007AFF"

    themeCssVars = `
  :root {
    color-scheme: ${isDark ? "dark" : "light"};
    --bg-color: ${bg};
    --text-color: ${text};
    --secondary-text-color: ${secondaryText};
    --divider-color: ${divider};
    --accent-color: ${accent};
  }`
  }

  const bodyHtmlParts: string[] = []
  let currentPage = 1

  for (const chunk of chunks) {
    if (chunk.type === "newpage") {
      currentPage = chunk.page
      bodyHtmlParts.push(
        `<div id="${chunk.id}" class="page-divider" data-page="${chunk.page}" data-chunk-id="${chunk.id}"><span class="page-badge">第 ${chunk.page} 页</span></div>`
      )
    } else if (chunk.type === "chapter") {
      bodyHtmlParts.push(
        `<div id="${chunk.id}" class="chapter-block" data-page="${currentPage}" data-chunk-id="${chunk.id}"><div class="chapter-tag">CHAPTER</div><h2 class="chapter-title">${escapeHtml(chunk.title)}</h2></div>`
      )
    } else if (chunk.type === "uploadedimage") {
      const cached = imageCache?.[chunk.id]
      if (cached?.dataUrl) {
        bodyHtmlParts.push(
          `<div id="${chunk.id}" class="illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}"><img class="novel-img" src="${cached.dataUrl}" alt="插图" /></div>`
        )
      } else {
        bodyHtmlParts.push(
          `<div id="${chunk.id}" class="illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}"><div class="illust-placeholder" data-chunk-id="${chunk.id}"><div class="illust-spinner"></div><span class="illust-hint">正文插图 #${escapeHtml(chunk.imageId)}</span></div></div>`
        )
      }
    } else if (chunk.type === "pixivimage") {
      const cached = imageCache?.[chunk.id]
      if (cached?.dataUrl) {
        bodyHtmlParts.push(
          `<div id="${chunk.id}" class="illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}"><div class="pixiv-illust-card" onclick="handleOpenIllust(${chunk.illustId})"><img class="novel-img" src="${cached.dataUrl}" alt="${escapeHtml(cached.title || 'Pixiv 插画')}" />${cached.title ? `<div class="illust-caption"><span class="illust-title">${escapeHtml(cached.title)}</span>${cached.author ? `<span class="illust-author"> · by ${escapeHtml(cached.author)}</span>` : ''}</div>` : ''}</div></div>`
        )
      } else {
        bodyHtmlParts.push(
          `<div id="${chunk.id}" class="illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}"><div class="illust-placeholder" onclick="handleOpenIllust(${chunk.illustId})" data-chunk-id="${chunk.id}"><div class="illust-spinner"></div><span class="illust-hint">Pixiv 插画 #${chunk.illustId}</span></div></div>`
        )
      }
    } else if (chunk.type === "jump") {
      bodyHtmlParts.push(
        `<div id="${chunk.id}" class="page-divider" data-page="${currentPage}" data-chunk-id="${chunk.id}"><button class="jump-btn" onclick="handleJumpToPage(${chunk.page})">📄 跳转至第 ${chunk.page} 页 →</button></div>`
      )
    } else if (chunk.type === "text") {
      const paragraphs = chunk.text.split("\n")
      const pParts: string[] = []
      for (const p of paragraphs) {
        const trimmed = p.trim()
        if (trimmed.length === 0) {
          pParts.push('<div class="empty-line"></div>')
        } else {
          pParts.push(`<p class="paragraph">${formatNovelParagraphToHtml(p)}</p>`)
        }
      }
      bodyHtmlParts.push(
        `<div id="${chunk.id}" class="text-chunk-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">${pParts.join("\n")}</div>`
      )
    }
  }

  const safeTargetId = JSON.stringify(targetChunkId || null)
  const safeTargetPage = JSON.stringify(typeof targetPage === "number" ? targetPage : null)
  const safeIsVertical = isVertical ? "true" : "false"

  const layoutCss = isVertical
    ? `
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-color);
    color: var(--text-color);
  }
  .novel-container {
    width: 100%;
    height: 100%;
    min-height: 100%;
    padding: 24px 20px;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    writing-mode: vertical-rl;
    -webkit-writing-mode: vertical-rl;
    text-orientation: upright;
    -webkit-text-orientation: upright;
    font-family: ${fontFamilyCss};
    font-size: ${settings.fontSize}px;
    font-weight: ${weightCss};
    line-height: ${lineHeight};
    letter-spacing: 0.06em;
    display: inline-block;
  }
  .text-chunk-block {
    display: inline-block;
  }
  .paragraph {
    margin: 0 10px;
    text-indent: 2em;
    line-break: strict;
    word-break: break-all;
  }
  .empty-line {
    width: 14px;
    height: 100%;
    display: inline-block;
  }
  .chapter-block {
    margin: 0 24px;
    border-left: 2px solid var(--divider-color);
    padding-left: 12px;
  }
  .chapter-tag {
    font-size: 0.7em;
    font-weight: bold;
    color: var(--accent-color);
    margin-bottom: 4px;
  }
  .chapter-title {
    margin: 0;
    font-size: 1.25em;
    font-weight: bold;
    color: var(--text-color);
  }
  .page-divider {
    margin: 0 20px;
    padding: 0 8px;
    border-left: 1px dashed var(--divider-color);
    display: flex;
    align-items: center;
  }
  .page-badge {
    font-size: 0.75em;
    color: var(--secondary-text-color);
    padding: 4px 8px;
  }
  .illust-block {
    margin: 0 16px;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
  }
  .novel-img {
    max-height: 75vh;
    max-width: 75vw;
    border-radius: 8px;
    object-fit: contain;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  }
  .pixiv-illust-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
  }
  .illust-caption {
    margin-top: 8px;
    font-size: 0.75em;
    writing-mode: horizontal-tb;
    -webkit-writing-mode: horizontal-tb;
    text-align: center;
    color: var(--accent-color);
  }
  .illust-author {
    color: var(--secondary-text-color);
  }
  .illust-placeholder {
    width: 180px;
    height: 240px;
    border-radius: 8px;
    border: 1px dashed var(--divider-color);
    background: rgba(128, 128, 128, 0.08);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    writing-mode: horizontal-tb;
    -webkit-writing-mode: horizontal-tb;
    cursor: pointer;
  }
  .jump-btn {
    background: rgba(0, 122, 255, 0.1);
    color: var(--accent-color);
    border: 1px solid var(--accent-color);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 0.8em;
    cursor: pointer;
    writing-mode: horizontal-tb;
    -webkit-writing-mode: horizontal-tb;
    display: inline-block;
  }`
    : `
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: auto;
    min-height: 100%;
    overflow: hidden;
    background: var(--bg-color);
    color: var(--text-color);
  }
  .novel-container {
    width: 100%;
    height: auto;
    min-height: 100%;
    padding: 16px 16px 28px 16px;
    overflow: hidden;
    writing-mode: horizontal-tb;
    -webkit-writing-mode: horizontal-tb;
    font-family: ${fontFamilyCss};
    font-size: ${settings.fontSize}px;
    font-weight: ${weightCss};
    line-height: ${lineHeight};
    letter-spacing: 0.03em;
    display: block;
  }
  .text-chunk-block {
    display: block;
    margin-bottom: 6px;
  }
  .paragraph {
    margin: 0 0 ${lineSpacing > 4 ? lineSpacing : 8}px 0;
    text-indent: 2em;
    line-break: strict;
    word-break: break-word;
    text-align: justify;
  }
  .empty-line {
    height: ${settings.fontSize}px;
    width: 100%;
  }
  .chapter-block {
    margin: 24px 0 16px 0;
    border-bottom: 2px solid var(--divider-color);
    padding-bottom: 8px;
  }
  .chapter-tag {
    font-size: 0.7em;
    font-weight: bold;
    color: var(--accent-color);
    margin-bottom: 4px;
  }
  .chapter-title {
    margin: 0;
    font-size: 1.25em;
    font-weight: bold;
    color: var(--text-color);
  }
  .page-divider {
    margin: 24px 0;
    border-top: 1px dashed var(--divider-color);
    display: flex;
    align-items: center;
    justify-content: center;
    padding-top: 8px;
  }
  .page-badge {
    font-size: 0.75em;
    color: var(--secondary-text-color);
    padding: 4px 12px;
    background: rgba(128, 128, 128, 0.08);
    border-radius: 12px;
  }
  .illust-block {
    margin: 16px 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .novel-img {
    max-width: 100%;
    max-height: 75vh;
    border-radius: 10px;
    object-fit: contain;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  }
  .pixiv-illust-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    max-width: 100%;
  }
  .illust-caption {
    margin-top: 8px;
    font-size: 0.8em;
    text-align: center;
    color: var(--accent-color);
  }
  .illust-author {
    color: var(--secondary-text-color);
  }
  .illust-placeholder {
    width: 220px;
    height: 180px;
    border-radius: 10px;
    border: 1px dashed var(--divider-color);
    background: rgba(128, 128, 128, 0.08);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
  }
  .jump-btn {
    background: rgba(0, 122, 255, 0.1);
    color: var(--accent-color);
    border: 1px solid var(--accent-color);
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 0.85em;
    cursor: pointer;
    display: inline-block;
  }`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
${colorSchemeMeta}
<style>
${themeCssVars}
  * {
    box-sizing: border-box;
    -webkit-touch-callout: default;
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  ::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
${layoutCss}
  .illust-hint {
    font-size: 0.75em;
    color: var(--secondary-text-color);
  }
  .illust-spinner {
    width: 22px;
    height: 22px;
    border: 2px solid var(--divider-color);
    border-top-color: var(--accent-color);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  ruby rt {
    font-size: 0.55em;
    color: var(--secondary-text-color);
  }
  a {
    color: var(--accent-color);
    text-decoration: underline;
  }
</style>
</head>
<body>
  <div class="novel-container">
    <div id="novel-start-anchor" style="width: 1px; height: 1px; display: inline-block; visibility: hidden; margin: 0; padding: 0;"></div>
    ${bodyHtmlParts.join("\n")}
  </div>
  <script>
    var isVertical = ${safeIsVertical};
    var targetChunkId = ${safeTargetId};
    var targetPage = ${safeTargetPage};

    var lastReportedHeight = 0;
    var layoutTimer = null;

    function reportLayout() {
      if (isVertical) return;
      var body = document.body;
      var html = document.documentElement;
      var container = document.querySelector(".novel-container");
      var totalHeight = Math.max(
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        html ? html.scrollHeight : 0,
        html ? html.offsetHeight : 0,
        container ? container.scrollHeight : 0,
        container ? container.offsetHeight : 0
      );

      var chunkEls = document.querySelectorAll("[data-chunk-id]");
      var heights = {};
      for (var i = 0; i < chunkEls.length; i++) {
        var el = chunkEls[i];
        var id = el.getAttribute("data-chunk-id");
        if (id) {
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          var marginTop = style ? parseFloat(style.marginTop) || 0 : 0;
          var marginBottom = style ? parseFloat(style.marginBottom) || 0 : 0;
          var h = (el.offsetHeight || 0) + marginTop + marginBottom;
          heights[id] = Math.ceil(Math.max(h, 20));
        }
      }

      lastReportedHeight = totalHeight;

      if (totalHeight > 50 && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onChunkLayout) {
        window.webkit.messageHandlers.onChunkLayout.postMessage({
          height: totalHeight,
          chunks: heights
        });
      }
    }

    function scheduleLayout() {
      if (layoutTimer) clearTimeout(layoutTimer);
      layoutTimer = setTimeout(reportLayout, 60);
    }

    if (window.ResizeObserver && !isVertical) {
      new ResizeObserver(scheduleLayout).observe(document.body);
    }
    window.addEventListener("load", reportLayout);
    reportLayout();
    setTimeout(reportLayout, 60);
    setTimeout(reportLayout, 200);
    setTimeout(reportLayout, 500);

    function handleOpenIllust(illustId) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openIllust) {
        window.webkit.messageHandlers.openIllust.postMessage({ illustId: illustId });
      }
    }

    function handleJumpToPage(page) {
      var pageEl = document.getElementById("page-" + page);
      if (pageEl && typeof pageEl.scrollIntoView === "function") {
        try {
          pageEl.scrollIntoView({ inline: "start", block: "start", behavior: "smooth" });
        } catch (e) {
          pageEl.scrollIntoView(true);
        }
      }
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jumpToPage) {
        window.webkit.messageHandlers.jumpToPage.postMessage({ page: page });
      }
    }

    function handleOpenLink(url) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openRoute) {
        window.webkit.messageHandlers.openRoute.postMessage({ url: url });
      }
    }

    window.updateNovelImage = function(chunkId, dataUrl, title, author, illustId) {
      var container = document.getElementById(chunkId);
      if (!container) return;
      if (illustId) {
        var captionHtml = '';
        if (title) {
          captionHtml = '<div class="illust-caption"><span class="illust-title">' + (title || '') + '</span>' + (author ? '<span class="illust-author"> · by ' + (author || '') + '</span>' : '') + '</div>';
        }
        container.innerHTML = '<div class="pixiv-illust-card" onclick="handleOpenIllust(' + illustId + ')">' +
          '<img class="novel-img" src="' + dataUrl + '" />' +
          captionHtml +
          '</div>';
      } else {
        container.innerHTML = '<img class="novel-img" src="' + dataUrl + '" />';
      }
      scheduleLayout();
    };

    function scrollToNovelStart() {
      if (isVertical) {
        var anchor = document.getElementById("novel-start-anchor");
        if (anchor && typeof anchor.scrollIntoView === "function") {
          try {
            anchor.scrollIntoView({ inline: "start", block: "start", behavior: "instant" });
          } catch (e) {
            anchor.scrollIntoView(true);
          }
        }
        var container = document.querySelector(".novel-container");
        var maxScroll = Math.max(
          container ? container.scrollWidth : 0,
          document.documentElement ? document.documentElement.scrollWidth : 0,
          document.body ? document.body.scrollWidth : 0,
          window.innerWidth || 0,
          1000000
        );
        if (container) container.scrollLeft = maxScroll;
        window.scrollTo(maxScroll, 0);
      } else {
        window.scrollTo(0, 0);
      }
    }

    function restoreProgress() {
      if (!isVertical) return;
      if (targetChunkId && targetChunkId !== "novel-top-anchor" && targetChunkId !== "chunk-0") {
        var el = document.getElementById(targetChunkId);
        if (el && typeof el.scrollIntoView === "function") {
          try {
            el.scrollIntoView({ inline: "start", block: "start", behavior: "instant" });
            return true;
          } catch (e) {
            el.scrollIntoView(true);
            return true;
          }
        }
      }
      if (targetPage && targetPage > 1) {
        var pageEl = document.getElementById("page-" + targetPage);
        if (pageEl && typeof pageEl.scrollIntoView === "function") {
          try {
            pageEl.scrollIntoView({ inline: "start", block: "start", behavior: "instant" });
            return true;
          } catch (e) {
            pageEl.scrollIntoView(true);
            return true;
          }
        }
      }
      scrollToNovelStart();
      return false;
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", restoreProgress);
    } else {
      restoreProgress();
    }
    window.addEventListener("load", function() {
      restoreProgress();
      setTimeout(restoreProgress, 50);
      setTimeout(restoreProgress, 150);
      setTimeout(restoreProgress, 350);
      setTimeout(restoreProgress, 700);
    });
    requestAnimationFrame(restoreProgress);

    var scrollTimer = null;
    function reportProgress() {
      if (!isVertical) return;
      var checkX = Math.max(0, window.innerWidth - 60);
      var checkY = Math.min(window.innerHeight / 2, 200);
      var el = document.elementFromPoint(checkX, checkY);
      while (el && !el.getAttribute("data-chunk-id") && el !== document.body) {
        el = el.parentElement;
      }
      if (el && el.getAttribute("data-chunk-id")) {
        var chunkId = el.getAttribute("data-chunk-id");
        var pageNum = parseInt(el.getAttribute("data-page") || "1", 10);
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onProgressChange) {
          window.webkit.messageHandlers.onProgressChange.postMessage({
            chunkId: chunkId,
            page: pageNum
          });
        }
      }
    }

    var vContainer = document.querySelector(".novel-container");
    if (vContainer && isVertical) {
      vContainer.addEventListener("scroll", function() {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(reportProgress, 250);
      }, { passive: true });
    }
    window.addEventListener("scroll", function() {
      if (isVertical) {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(reportProgress, 250);
      }
    }, { passive: true });
  </script>
</body>
</html>`
}

/**
 * 统一 Web 渲染引擎组件（横排 / 竖排）
 */
function NovelWebView(props: {
  novelId?: number
  direction: "horizontal" | "vertical"
  chunks: NovelChunkItem[]
  settings: NovelReaderSettings
  palette: NovelThemePalette
  targetChunkId?: string | null
  targetPage?: number
  onProgressChange?: (page: number, chunkId?: string) => void
  onJumpToPage?: (page: number) => void
  onScrollToTarget?: (targetId: string) => void
}) {
  const {
    novelId,
    direction,
    chunks,
    settings,
    palette,
    targetChunkId,
    targetPage,
    onProgressChange,
    onJumpToPage,
    onScrollToTarget,
  } = props

  const isVertical = direction === "vertical"
  const [contentHeight, setContentHeight] = useState<number>(isVertical ? 620 : 600)
  const [chunkHeights, setChunkHeights] = useState<Record<string, number>>({})
  const hasRestoredTargetRef = useRef(false)

  useEffect(() => {
    hasRestoredTargetRef.current = false
  }, [novelId, targetPage])

  const [imageCache, setImageCache] = useState<
    Record<
      string,
      { dataUrl: string; title?: string; author?: string; illustId?: number }
    >
  >(() => {
    const initial: Record<
      string,
      { dataUrl: string; title?: string; author?: string; illustId?: number }
    > = {}
    for (const chunk of chunks) {
      if (chunk.type === "uploadedimage") {
        const url = getUploadedImageUrl(chunk.info)
        if (url) {
          const path = cachedFilePath(url)
          if (path) {
            const dataUrl = getLocalImageDataUrl(path)
            if (dataUrl) {
              initial[chunk.id] = { dataUrl }
            }
          }
        }
      }
    }
    return initial
  })

  const imageCacheRef = useRef(imageCache)
  imageCacheRef.current = imageCache

  const html = useMemo(() => {
    return buildNovelHtml(
      direction,
      chunks,
      settings,
      palette,
      targetChunkId,
      targetPage,
      imageCacheRef.current
    )
  }, [direction, chunks, settings, palette, targetChunkId, targetPage])

  const onProgressChangeRef = useRef(onProgressChange)
  onProgressChangeRef.current = onProgressChange
  const onJumpToPageRef = useRef(onJumpToPage)
  onJumpToPageRef.current = onJumpToPage
  const onScrollToTargetRef = useRef(onScrollToTarget)
  onScrollToTargetRef.current = onScrollToTarget
  const novelIdRef = useRef(novelId)
  novelIdRef.current = novelId
  const targetChunkIdRef = useRef(targetChunkId)
  targetChunkIdRef.current = targetChunkId

  const controller = useMemo(() => {
    const ctrl = new WebViewController()

    void ctrl.addScriptMessageHandler("onChunkLayout", (data: any) => {
      if (!data) return
      const h = typeof data.height === "number" ? data.height : parseFloat(data.height)
      if (h && !isNaN(h) && h > 50) {
        setContentHeight((prev) => {
          if (Math.abs(prev - h) > 4) {
            return Math.ceil(h) + 24
          }
          return prev
        })
      }
      if (data.chunks && typeof data.chunks === "object") {
        setChunkHeights(data.chunks)
      }
      const target = targetChunkIdRef.current
      if (
        target &&
        target !== "novel-top-anchor" &&
        target !== "chunk-0" &&
        !hasRestoredTargetRef.current
      ) {
        hasRestoredTargetRef.current = true
        setTimeout(() => {
          onScrollToTargetRef.current?.(target)
        }, 50)
      }
    }).catch(() => {})

    void ctrl.addScriptMessageHandler("onProgressChange", (data: any) => {
      if (!data) return
      const page = typeof data.page === "number" ? data.page : 1
      const chunkId = typeof data.chunkId === "string" ? data.chunkId : undefined
      const id = novelIdRef.current
      if (id) {
        recordNovelProgress(id, page, chunkId)
      }
      onProgressChangeRef.current?.(page, chunkId)
    }).catch(() => {})

    void ctrl.addScriptMessageHandler("openIllust", (data: any) => {
      const illustId =
        typeof data?.illustId === "number" ? data.illustId : parseInt(data?.illustId, 10)
      if (illustId && !isNaN(illustId)) {
        requestPixivRoute(`illust:${illustId}`)
      }
    }).catch(() => {})

    void ctrl.addScriptMessageHandler("openRoute", (data: any) => {
      const rawUrl = typeof data?.url === "string" ? data.url : ""
      if (!rawUrl) return
      const target = routeForDescriptionLink(rawUrl) ?? rawUrl
      if (target.startsWith("http://") || target.startsWith("https://")) {
        void presentExternalURL(target)
      } else {
        requestPixivRoute(target)
      }
    }).catch(() => {})

    void ctrl.addScriptMessageHandler("jumpToPage", (data: any) => {
      const page = typeof data?.page === "number" ? data.page : parseInt(data?.page, 10)
      if (page && !isNaN(page)) {
        onJumpToPageRef.current?.(page)
      }
    }).catch(() => {})

    void ctrl.loadHTML(html).catch(() => {})
    return ctrl
  }, [html])

  useEffect(() => {
    return () => {
      try {
        controller.dispose()
      } catch {
        // ignore dispose error
      }
    }
  }, [controller])

  // 异步拉取正文插图与引用的 Pixiv 插画
  useEffect(() => {
    let active = true

    for (const chunk of chunks) {
      if (chunk.type === "uploadedimage") {
        const url = getUploadedImageUrl(chunk.info)
        if (!url || imageCacheRef.current[chunk.id]?.dataUrl) continue

        loadImage(url, -1000)
          .then((path) => {
            if (!active || !path) return
            const dataUrl = getLocalImageDataUrl(path)
            if (!dataUrl) return
            setImageCache((prev: any) => ({
              ...prev,
              [chunk.id]: { dataUrl },
            }))
            void controller
              .evaluateJavaScript(
                `if (window.updateNovelImage) { window.updateNovelImage(${JSON.stringify(
                  chunk.id
                )}, ${JSON.stringify(dataUrl)}); }`
              )
              .catch(() => {})
          })
          .catch(() => {})
      } else if (chunk.type === "pixivimage") {
        if (imageCacheRef.current[chunk.id]?.dataUrl) continue
        const illustId = chunk.illustId
        const pageIdx = Math.max(0, (chunk.page || 1) - 1)

        session
          .call((token) => illustrationDetail(illustId, token))
          .then(async (illust: PixivIllustration) => {
            if (!active || !illust) return
            const url = imageUrlOf(illust, pageIdx, "large")
            if (!url) return
            const path = await loadImage(url, -1000)
            if (!active || !path) return
            const dataUrl = getLocalImageDataUrl(path)
            if (!dataUrl) return
            const title = illust.title || `Pixiv 插画 #${illustId}`
            const author = illust.user?.name || ""
            setImageCache((prev: any) => ({
              ...prev,
              [chunk.id]: { dataUrl, title, author, illustId },
            }))
            void controller
              .evaluateJavaScript(
                `if (window.updateNovelImage) { window.updateNovelImage(${JSON.stringify(
                  chunk.id
                )}, ${JSON.stringify(dataUrl)}, ${JSON.stringify(title)}, ${JSON.stringify(
                  author
                )}, ${illustId}); }`
              )
              .catch(() => {})
          })
          .catch(() => {})
      }
    }

    return () => {
      active = false
    }
  }, [chunks, controller])

  if (isVertical) {
    return (
      <VStack
        key="novel-webview-vertical"
        frame={{ maxWidth: "infinity", height: 620 }}
      >
        <WebView controller={controller} />
      </VStack>
    )
  }

  return (
    <ZStack
      key={novelId ? `novel-webview-h-${novelId}` : "novel-webview-h"}
      alignment="topLeading"
      frame={{ maxWidth: "infinity", height: contentHeight }}
    >
      {/* 1. 原生隐式锚点定位层：为每个 chunk 建立对应的 SwiftUI 节点，支持 ScrollViewReader 滚动恢复与 onScrollTargetVisibilityChange */}
      <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
        {chunks.map((chunk) => {
          const h = chunkHeights[chunk.id] ?? 24
          return (
            <VStack
              key={chunk.id}
              frame={{ maxWidth: "infinity", height: h }}
            />
          )
        })}
      </VStack>

      {/* 2. WebKit 渲染层：全保真排版、注音、防盗链图片与高精度划词选区 */}
      <WebView controller={controller} />
    </ZStack>
  )
}

/**
 * 小说正文统一渲染引擎组件：
 * 1. 自动响应全局小说版式与主题设置（字体/字号/字重/行距/横竖排/夜间模式）；
 * 2. 横排模式采用自适应高度 WebKit 引擎 + 原生隐式定位锚点，整页平滑滚动与高精度选区兼得；
 * 3. 竖排模式采用文库本排版引擎，支持日文/中文标点悬挂旋转、右对齐注音假名与无缝双向进度恢复。
 */
export function NovelReaderView(props: {
  novelId?: number
  text: string
  title?: string
  markerPage?: number | null
  currentPage?: number
  textEmbeddedImages?: Record<string, TextEmbeddedImage>
  onJumpToPage?: (page: number) => void
  onReady?: (totalPages: number) => void
  onChunkVisible?: (chunkId: string) => void
  onScrollToTarget?: (targetId: string) => void
}) {
  const {
    novelId,
    text,
    textEmbeddedImages,
    markerPage,
    currentPage = 1,
    onJumpToPage,
    onReady,
    onChunkVisible,
    onScrollToTarget,
  } = props

  const [settings, setSettings] = useState<NovelReaderSettings>(() =>
    loadNovelReaderSettings()
  )

  useEffect(() => {
    return onNovelReaderSettingsChanged((updated) => {
      setSettings(updated)
    })
  }, [])

  const palette = useMemo(() => {
    const themeId = settings.themeId
    return (NOVEL_THEME_PALETTES as any)[themeId] || NOVEL_THEME_PALETTES.default
  }, [settings.themeId])

  // 同步初始化分块
  const syncChunks = useMemo(() => {
    if (!text) return []
    if (text.length <= 100000) {
      return parseNovelToChunks(text, textEmbeddedImages)
    }
    return null
  }, [text, textEmbeddedImages])

  const [asyncChunks, setAsyncChunks] = useState<NovelChunkItem[] | null>(null)
  const chunks = syncChunks ?? asyncChunks ?? []
  const pageBlocks = useMemo(() => groupChunksByPage(chunks), [chunks])

  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    let active = true
    if (syncChunks) {
      setAsyncChunks(null)
      const total = Math.max(1, groupChunksByPage(syncChunks).length)
      onReadyRef.current?.(total)
      return
    }

    void Promise.resolve().then(() => {
      const parsed = parseNovelToChunks(text, textEmbeddedImages)
      if (active) {
        setAsyncChunks(parsed)
        const total = Math.max(1, groupChunksByPage(parsed).length)
        onReadyRef.current?.(total)
      }
    })

    return () => {
      active = false
    }
  }, [text, textEmbeddedImages, syncChunks])

  if (chunks.length === 0) {
    return (
      <VStack spacing={0} frame={{ maxWidth: "infinity", height: 60 }} alignment="center">
        <Spacer />
        <ProgressView progressViewStyle="circular" />
        <Spacer />
      </VStack>
    )
  }

  const isVertical = settings.layoutDirection === "vertical"
  const savedProgress = novelId ? getNovelProgress(novelId) : undefined
  const targetChunkId = savedProgress?.chunkId ?? null
  const targetPage = savedProgress?.page ?? currentPage ?? markerPage ?? 1

  // 横排模式下按当前页分块展示（支持翻页与整页滚动），竖排模式连续直书翻阅
  const displayedChunks = isVertical
    ? chunks
    : pageBlocks.find((b) => b.page === currentPage)?.items ?? chunks

  return (
    <NovelWebView
      novelId={novelId}
      direction={isVertical ? "vertical" : "horizontal"}
      chunks={displayedChunks}
      settings={settings}
      palette={palette}
      targetChunkId={targetChunkId}
      targetPage={targetPage}
      onProgressChange={(page, chunkId) => {
        if (chunkId) onChunkVisible?.(chunkId)
      }}
      onJumpToPage={onJumpToPage}
      onScrollToTarget={onScrollToTarget}
    />
  )
}

export const NovelReaderWebView = NovelReaderView
