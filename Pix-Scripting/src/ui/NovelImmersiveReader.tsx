import {
  Button,
  type Color,
  Device,
  Divider,
  Group,
  HStack,
  Image,
  Menu,
  NavigationStack,
  ProgressView,
  Rectangle,
  ScrollView,
  Spacer,
  Text,
  useCallback,
  useColorScheme,
  useEffect,
  useMemo,
  useRef,
  useState,
  type VirtualNode,
  VStack,
  WebView,
  ZStack,
} from "scripting"
import { appGlass } from "./components/glass"
import { useLayoutMetrics } from "./hooks"
import { presentExternalURL, routeForDescriptionLink } from "./components"
import { requestPixivRoute } from "../store/routeNavigation"
import {
  calculateLineSpacing,
  loadNovelReaderSettings,
  onNovelReaderSettingsChanged,
  resolveFontName,
  type NovelReaderSettings,
} from "../store/novelReaderSettings"
import type { AmbientAlgorithm } from "../store/settings"
import type { IllustAmbientPalette } from "../image/colorExtractor"
import { getNovelProgress, recordNovelProgress } from "../store/novelProgress"
import { NovelTypographySheet } from "./NovelTypographySheet"
import type { PixivIllustration, PixivNovel, PixivNovelDetail, TextEmbeddedImage } from "../types"
import {
  escapeHtml,
  formatPixivRubyToHtml,
  groupChunksByPage,
  parseNovelToChunks,
  type NovelChunkItem,
} from "./NovelReader"
import { imageUrlOf, loadImage, novelThumbUrlOf } from "../image/imageLoader"
import { useNovelExperimentalAmbientPalette, generateAmbientBackgroundCss } from "./ambient"
import { session } from "../api/session"
import { illustrationDetail, novelDetail, novelViewerData } from "../api/pixiv"
import { getCachedNovel, cacheNovel } from "../store/novelCache"
import { recordNovelHistory } from "../store/history"
import { useSeriesEpisodeNav, type SeriesEpisodeNavState } from "./SeriesEpisodePager"

function isVirtualNode(v: unknown): v is VirtualNode {
  return !!v && typeof v === "object" && ("render" in v || "isInternal" in v || "props" in v)
}

function extractNovelCoverUrl(novel: PixivNovelDetail | PixivNovel | null | undefined): string | null {
  if (!novel) return null
  return (
    novel.image_urls?.large ||
    novel.image_urls?.medium ||
    (novel as any)?.series?.cover_image_urls?.medium ||
    novelThumbUrlOf(novel as any) ||
    null
  )
}

export interface NovelImmersiveReaderViewProps {
  novelId: number
  title: string
  text: string
  coverUrl?: string | null
  textEmbeddedImages?: Record<string, TextEmbeddedImage>
  markerPage?: number | null
  currentPage?: number
  initialChunkId?: string | null
  seriesID?: number | null
  seriesTitle?: string | null
  seriesPrev?: { id: number; title?: string } | null
  seriesNext?: { id: number; title?: string } | null
  episodeNumber?: number | null
  onClose: (lastChunkId: string | null, page: number, finalNovelId: number) => void
  onToggleMarker?: () => Promise<void> | void
  onJumpToPage?: (page: number) => void
  onNavigateNovel?: (novelId: number) => void
  onNavigateSeries?: (seriesId: number) => void
}

let cachedBooksIconDataUrl: string | null = null
let cachedLeftIconDataUrl: string | null = null
let cachedRightIconDataUrl: string | null = null
let cachedUpIconDataUrl: string | null = null
let cachedDownIconDataUrl: string | null = null

function getSystemSymbolDataUrl(name: string, tintColor: Color = "#007AFF"): string | null {
  try {
    if (typeof UIImage !== "undefined" && typeof UIImage.fromSFSymbol === "function") {
      const img = UIImage.fromSFSymbol(name)
      const tinted = img?.withTintColor(tintColor)
      const b64 = tinted?.toPNGBase64String() || img?.toPNGBase64String()
      if (b64) return `data:image/png;base64,${b64}`
    }
  } catch {}
  return null
}

function getBooksSymbolDataUrl(): string {
  if (!cachedBooksIconDataUrl) {
    cachedBooksIconDataUrl = getSystemSymbolDataUrl("books.vertical", "#007AFF") || ""
  }
  return cachedBooksIconDataUrl
}

function getLeftSymbolDataUrl(): string {
  if (!cachedLeftIconDataUrl) {
    cachedLeftIconDataUrl = getSystemSymbolDataUrl("chevron.left", "#007AFF") || ""
  }
  return cachedLeftIconDataUrl
}

function getRightSymbolDataUrl(): string {
  if (!cachedRightIconDataUrl) {
    cachedRightIconDataUrl = getSystemSymbolDataUrl("chevron.right", "#007AFF") || ""
  }
  return cachedRightIconDataUrl
}

function getUpSymbolDataUrl(): string {
  if (!cachedUpIconDataUrl) {
    cachedUpIconDataUrl = getSystemSymbolDataUrl("chevron.up", "#007AFF") || ""
  }
  return cachedUpIconDataUrl
}

function getDownSymbolDataUrl(): string {
  if (!cachedDownIconDataUrl) {
    cachedDownIconDataUrl = getSystemSymbolDataUrl("chevron.down", "#007AFF") || ""
  }
  return cachedDownIconDataUrl
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

function resolveUploadedImageUrl(
  chunk: NovelChunkItem,
  imagesMap?: Record<string, TextEmbeddedImage>
): string | null {
  const directUrl = getUploadedImageUrl(chunk.info)
  if (directUrl) return directUrl

  if (!chunk.imageId || !imagesMap) return null
  const id = chunk.imageId
  const imgObj =
    imagesMap[id] ||
    (imagesMap as any)[Number(id)] ||
    Object.values(imagesMap).find(
      (img: any) =>
        img?.novelImageId === id ||
        img?.id === id ||
        String(img?.novelImageId) === String(id) ||
        String(img?.id) === String(id)
    )

  return getUploadedImageUrl(imgObj)
}

function resolveFontFamily(settings: NovelReaderSettings): string {
  const fontName = resolveFontName(settings.fontId, settings.customFontPostscriptName)
  if (fontName) {
    return `"${fontName}", -apple-system, BlinkMacSystemFont, sans-serif`
  }
  if (settings.fontId === "songti") {
    return "ui-serif, 'Songti SC', 'Source Han Serif SC', 'Hiragino Mincho ProN', serif"
  }
  if (settings.fontId === "kaiti") {
    return "'Kaiti SC', 'STKaiti', serif"
  }
  if (settings.fontId === "yuanti") {
    return "'Yuanti SC', 'STYuan', sans-serif"
  }
  return "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif"
}

const THEME_CSS_VARS = `
  :root {
    color-scheme: light dark;
    --bg-color: #FAFAFA;
    --text-color: #1C1C1E;
    --secondary-text-color: #8E8E93;
    --divider-color: rgba(128, 128, 128, 0.18);
    --accent-color: #007AFF;
    --card-bg: rgba(255, 255, 255, 0.72);
    --card-border: rgba(0, 0, 0, 0.04);
    --glass-shadow: 0 4px 14px rgba(0, 0, 0, 0.08), inset 0 0.5px 0.5px rgba(255, 255, 255, 0.6);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg-color: #000000;
      --text-color: #F2F2F7;
      --secondary-text-color: #98989D;
      --divider-color: rgba(255, 255, 255, 0.15);
      --accent-color: #0A84FF;
      --card-bg: rgba(36, 36, 38, 0.72);
      --card-border: rgba(255, 255, 255, 0.12);
      --glass-shadow: 0 4px 14px rgba(0, 0, 0, 0.28), inset 0 0.5px 0.5px rgba(255, 255, 255, 0.18);
    }
  }
`

interface BuildHtmlOptions {
  chunks: NovelChunkItem[]
  settings: NovelReaderSettings
  initialChunkId?: string | null
  initialPage?: number | null
  title: string
  seriesNav?: SeriesEpisodeNavState | null
  imageCache?: Record<
    string,
    { dataUrl: string; title?: string; author?: string; illustId?: number }
  >
  ambientActive?: boolean
  ambientBgCss?: string
}

/**
 * 构建沉浸式横向流式排版 HTML 模板
 */
function buildHorizontalImmersiveHtml(options: BuildHtmlOptions): string {
  const {
    chunks,
    settings,
    initialChunkId,
    initialPage,
    title,
    seriesNav,
    imageCache,
    ambientActive,
    ambientBgCss: propBgCss,
  } = options
  const ambientBgCss = propBgCss || "transparent"

  const fontFamily = resolveFontFamily(settings)
  const weightMap: Record<string, string> = {
    ultraLight: "100",
    thin: "200",
    light: "300",
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    heavy: "800",
    black: "900",
  }
  const fontWeight = weightMap[settings.fontWeight] || "400"
  const lineSpacing = calculateLineSpacing(settings.fontSize, settings.lineSpacingLevel)
  const lineHeight = ((settings.fontSize + lineSpacing) / settings.fontSize).toFixed(2)

  const bodyParts: string[] = []
  let currentPage = 1

  for (const chunk of chunks) {
    if (chunk.type === "newpage") {
      currentPage = chunk.page ?? 1
      bodyParts.push(
        `<div id="${chunk.id}" class="novel-chunk page-divider" data-page="${chunk.page ?? 1}" data-chunk-id="${chunk.id}">
          <span class="page-badge">第 ${chunk.page ?? 1} 页</span>
        </div>`
      )
    } else if (chunk.type === "chapter") {
      bodyParts.push(
        `<div id="${chunk.id}" class="novel-chunk chapter-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
          <div class="chapter-tag">CHAPTER</div>
          <h2 class="chapter-title">${escapeHtml(chunk.title ?? "")}</h2>
        </div>`
      )
    } else if (chunk.type === "uploadedimage") {
      const cached = imageCache?.[chunk.id]
      if (cached?.dataUrl) {
        bodyParts.push(
          `<div id="${chunk.id}" class="novel-chunk illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
            <img class="novel-img" src="${cached.dataUrl}" alt="插图" />
          </div>`
        )
      } else {
        bodyParts.push(
          `<div id="${chunk.id}" class="novel-chunk illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
            <div class="illust-placeholder" data-chunk-id="${chunk.id}">
              <div class="illust-spinner"></div>
              <span class="illust-hint">正文插图 #${escapeHtml(chunk.imageId ?? "")}</span>
            </div>
          </div>`
        )
      }
    } else if (chunk.type === "pixivimage") {
      const cached = imageCache?.[chunk.id]
      if (cached?.dataUrl) {
        bodyParts.push(
          `<div id="${chunk.id}" class="novel-chunk illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
            <div class="pixiv-illust-card" onclick="handleOpenIllust(${chunk.illustId})">
              <img class="novel-img" src="${cached.dataUrl}" alt="${escapeHtml(cached.title || "Pixiv 插画")}" />
              ${cached.title ? `<div class="illust-caption"><span class="illust-title">${escapeHtml(cached.title)}</span>${cached.author ? `<span class="illust-author"> · by ${escapeHtml(cached.author)}</span>` : ""}</div>` : ""}
            </div>
          </div>`
        )
      } else {
        bodyParts.push(
          `<div id="${chunk.id}" class="novel-chunk illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
            <div class="illust-placeholder" onclick="handleOpenIllust(${chunk.illustId})" data-chunk-id="${chunk.id}">
              <div class="illust-spinner"></div>
              <span class="illust-hint">Pixiv 插画 #${chunk.illustId}</span>
            </div>
          </div>`
        )
      }
    } else if (chunk.type === "jump") {
      bodyParts.push(
        `<div id="${chunk.id}" class="novel-chunk page-divider" data-page="${currentPage}" data-chunk-id="${chunk.id}">
          <button class="jump-btn" onclick="handleJumpToPage(${chunk.page ?? 1})">📄 跳转至第 ${chunk.page ?? 1} 页 →</button>
        </div>`
      )
    } else if (chunk.type === "text") {
      const paragraphs = (chunk.text || "").split("\n")
      const pParts: string[] = []
      for (const p of paragraphs) {
        if (p.replace(/[\s\u3000]/g, "").length === 0) {
          pParts.push('<div class="empty-line"></div>')
        } else {
          pParts.push(`<p class="paragraph">${formatPixivRubyToHtml(p)}</p>`)
        }
      }
      bodyParts.push(
        `<div id="${chunk.id}" class="novel-chunk text-chunk-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
          ${pParts.join("\n")}
        </div>`
      )
    }
  }

  // 结尾：系列翻页器（横排文末）
  let footerHtml = ""
  if (seriesNav?.seriesID) {
    const seriesTitleText = seriesNav.seriesTitle || "系列目录"
    const episodeText = seriesNav.episodeNumber != null ? `（第${seriesNav.episodeNumber}话）` : ""
    const hasPrev = Boolean(seriesNav.hasPrev && seriesNav.prevID)
    const hasNext = Boolean(seriesNav.hasNext && seriesNav.nextID)

    const booksIconUrl = getBooksSymbolDataUrl()
    const leftIconUrl = getLeftSymbolDataUrl()
    const rightIconUrl = getRightSymbolDataUrl()

    footerHtml = `
      <div class="novel-footer-container">
        <div class="novel-end-divider">✦ 本话完 ✦</div>
        <div class="series-nav-bar">
          <button class="series-nav-circle series-nav-prev ${hasPrev ? "" : "hidden"}" ${hasPrev ? `onclick="handleSeriesNav('prev', ${seriesNav.prevID})"` : "disabled"} title="上一话">
            ${leftIconUrl ? `<img class="nav-arrow-symbol" src="${leftIconUrl}" alt="‹" />` : "‹"}
          </button>
          <button class="series-nav-center" onclick="handleSeriesNav('series', ${seriesNav.seriesID})" title="查看系列详情">
            ${booksIconUrl ? `<img class="nav-series-symbol" src="${booksIconUrl}" alt="系列" />` : ""}
            <span class="nav-series-title">${escapeHtml(seriesTitleText)}${escapeHtml(episodeText)}</span>
          </button>
          <button class="series-nav-circle series-nav-next ${hasNext ? "" : "hidden"}" ${hasNext ? `onclick="handleSeriesNav('next', ${seriesNav.nextID})"` : "disabled"} title="下一话">
            ${rightIconUrl ? `<img class="nav-arrow-symbol" src="${rightIconUrl}" alt="›" />` : "›"}
          </button>
        </div>
      </div>
    `
  } else {
    footerHtml = `
      <div class="novel-footer-container">
        <div class="novel-end-divider">✦ 全文完 ✦</div>
      </div>
    `
  }

  const safeInitialChunk = JSON.stringify(initialChunkId || null)
  const safeInitialPage = JSON.stringify(typeof initialPage === "number" ? initialPage : null)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<style>
${THEME_CSS_VARS}
  * {
    box-sizing: border-box;
    -webkit-touch-callout: default;
  }
  .ambient-bg-layer {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: -9999;
    pointer-events: none;
    background: ${ambientBgCss};
    opacity: ${ambientActive ? 1 : 0};
    transition: background 0.4s ease, opacity 0.4s ease;
  }
  html {
    background: ${ambientActive ? "transparent !important" : "var(--bg-color)"};
    margin: 0;
    padding: 0;
  }
  body {
    margin: 0;
    padding: 0;
    background: ${ambientActive ? "transparent !important" : "var(--bg-color)"};
    color: var(--text-color);
    -webkit-text-size-adjust: 100%;
    -webkit-user-select: text;
    user-select: text;
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    font-family: ${fontFamily};
    font-size: ${settings.fontSize}px;
    font-weight: ${fontWeight};
    line-height: ${lineHeight};
    letter-spacing: 0.03em;
  }

  .immersive-content-wrapper {
    width: 100%;
    box-sizing: border-box;
    padding-top: 68px;
    padding-bottom: 100px;
    padding-left: max(24px, env(safe-area-inset-left));
    padding-right: max(24px, env(safe-area-inset-right));
  }

  @media (max-width: 480px) {
    .immersive-content-wrapper {
      padding-top: 64px;
      padding-bottom: 90px;
      padding-left: max(18px, env(safe-area-inset-left));
      padding-right: max(18px, env(safe-area-inset-right));
    }
  }

  .novel-header-title {
    font-size: 1.45em;
    font-weight: 700;
    margin-bottom: 32px;
    color: var(--text-color);
    line-height: 1.35;
    border-bottom: 1px solid var(--divider-color);
    padding-bottom: 18px;
  }

  .paragraph {
    margin: 0 0 1.15em 0;
    word-wrap: break-word;
    word-break: break-word;
    text-align: justify;
    line-break: strict;
  }
  .empty-line {
    height: 1.1em;
  }

  .chapter-block {
    margin: 40px 0 24px 0;
    padding: 12px 16px;
    border-left: 4px solid var(--accent-color);
    background: rgba(0, 122, 255, 0.04);
    border-radius: 0 8px 8px 0;
  }
  .chapter-tag {
    font-size: 0.72em;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--accent-color);
    margin-bottom: 4px;
  }
  .chapter-title {
    margin: 0;
    font-size: 1.28em;
    font-weight: 700;
    color: var(--text-color);
  }

  .page-divider {
    margin: 36px 0 24px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }
  .page-divider::before, .page-divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--divider-color);
  }
  .page-badge {
    font-size: 0.8em;
    color: var(--secondary-text-color);
    padding: 3px 12px;
    border-radius: 12px;
    background: rgba(128, 128, 128, 0.08);
  }

  .illust-block {
    margin: 28px 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .novel-img {
    max-width: 100%;
    max-height: 75vh;
    border-radius: 12px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12);
    object-fit: contain;
  }
  .pixiv-illust-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
  }
  .illust-caption {
    margin-top: 10px;
    font-size: 0.82em;
    text-align: center;
    color: var(--accent-color);
  }
  .illust-author {
    color: var(--secondary-text-color);
  }
  .illust-placeholder {
    width: 100%;
    max-width: 380px;
    height: 180px;
    background: rgba(128, 128, 128, 0.08);
    border: 1px dashed var(--divider-color);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .illust-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--divider-color);
    border-top-color: var(--accent-color);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .illust-hint {
    font-size: 0.78em;
    color: var(--secondary-text-color);
  }

  .jump-btn {
    background: rgba(0, 122, 255, 0.08);
    color: var(--accent-color);
    border: 1px solid var(--accent-color);
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 0.88em;
    cursor: pointer;
  }

  ruby rt {
    font-size: 0.55em;
    color: var(--secondary-text-color);
  }
  a {
    color: var(--accent-color);
    text-decoration: underline;
  }

  .novel-footer-container {
    margin-top: 60px;
    padding-top: 24px;
    border-top: 1px solid var(--divider-color);
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .novel-end-divider {
    font-size: 0.88em;
    letter-spacing: 0.2em;
    color: var(--secondary-text-color);
    margin-bottom: 24px;
  }
  .series-nav-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    max-width: 520px;
  }
  .series-nav-circle {
    width: 44px;
    height: 44px;
    border-radius: 22px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-color);
    cursor: pointer;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    flex-shrink: 0;
    transition: opacity 0.15s ease;
  }
  .series-nav-circle.hidden {
    visibility: hidden;
    pointer-events: none;
  }
  .series-nav-center {
    flex: 1;
    max-width: 380px;
    margin: 0 12px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 16px;
    border-radius: 22px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    color: var(--accent-color);
    font-size: 0.9em;
    font-weight: 600;
    cursor: pointer;
    overflow: hidden;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  .nav-series-symbol {
    width: 17px;
    height: 17px;
    object-fit: contain;
    flex-shrink: 0;
    vertical-align: middle;
  }
  .nav-arrow-symbol {
    width: 17px;
    height: 17px;
    object-fit: contain;
    flex-shrink: 0;
    vertical-align: middle;
  }
  .nav-series-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
</head>
<body>
  <div id="ambient-bg-layer" class="ambient-bg-layer"></div>
  <div class="immersive-content-wrapper">
    <div id="novel-top-anchor" class="novel-chunk" data-page="1" data-chunk-id="novel-top-anchor"></div>
    <h1 class="novel-header-title">${escapeHtml(title)}</h1>
    ${bodyParts.join("\n")}
    ${footerHtml}
  </div>

  <script>
    var targetChunkId = ${safeInitialChunk};
    var targetPage = ${safeInitialPage};
    var isRestoring = true;

    window.updateAmbientBackground = function(bgCss, enabled) {
      var layer = document.getElementById("ambient-bg-layer");
      if (layer) {
        if (enabled && bgCss) {
          layer.style.background = bgCss;
          layer.style.opacity = "1";
          document.documentElement.style.backgroundColor = "transparent";
          document.body.style.backgroundColor = "transparent";
        } else {
          layer.style.opacity = "0";
          document.documentElement.style.backgroundColor = "var(--bg-color)";
          document.body.style.backgroundColor = "var(--bg-color)";
        }
      }
    };

    window.applyTypography = function(config) {
      if (!config) return;
      if (config.fontFamily) {
        document.body.style.fontFamily = config.fontFamily;
      }
      if (config.fontSize) {
        document.body.style.fontSize = config.fontSize + "px";
      }
      if (config.fontWeight) {
        document.body.style.fontWeight = config.fontWeight;
      }
      if (config.lineHeight) {
        document.body.style.lineHeight = config.lineHeight;
      }
    };

    function handleOpenIllust(illustId) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openIllust) {
        window.webkit.messageHandlers.openIllust.postMessage({ illustId: illustId });
      }
    }

    function handleJumpToPage(page) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jumpToPage) {
        window.webkit.messageHandlers.jumpToPage.postMessage({ page: page });
      }
    }

    function handleSeriesNav(action, id) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onSeriesNav) {
        window.webkit.messageHandlers.onSeriesNav.postMessage({ action: action, id: id });
      }
    }

    window.updateSeriesNav = function(nav) {
      if (!nav || !nav.seriesID) return;
      var container = document.querySelector(".series-nav-bar");
      if (!container) return;
      var prevBtn = container.querySelector(".series-nav-prev");
      var nextBtn = container.querySelector(".series-nav-next");
      var titleSpan = container.querySelector(".nav-series-title");
      if (titleSpan) {
        var epText = nav.episodeNumber != null ? "（第" + nav.episodeNumber + "话）" : "";
        titleSpan.innerText = (nav.seriesTitle || "系列目录") + epText;
      }
      if (prevBtn) {
        if (nav.hasPrev && nav.prevID) {
          prevBtn.classList.remove("hidden");
          prevBtn.onclick = function() { handleSeriesNav("prev", nav.prevID); };
        } else {
          prevBtn.classList.add("hidden");
          prevBtn.onclick = null;
        }
      }
      if (nextBtn) {
        if (nav.hasNext && nav.nextID) {
          nextBtn.classList.remove("hidden");
          nextBtn.onclick = function() { handleSeriesNav("next", nav.nextID); };
        } else {
          nextBtn.classList.add("hidden");
          nextBtn.onclick = null;
        }
      }
    };

    function handleLinkClick(url) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openLink) {
        window.webkit.messageHandlers.openLink.postMessage({ url: url });
      }
    }

    window.pendingImages = window.pendingImages || {};

    function applyImageToDom(chunkId, info) {
      if (!chunkId || !info || !info.dataUrl) return false;
      var container = document.getElementById(chunkId) || document.querySelector('[data-chunk-id="' + chunkId + '"]');
      if (!container) return false;

      if (info.illustId) {
        var captionHtml = '';
        if (info.title) {
          captionHtml = '<div class="illust-caption"><span class="illust-title">' + (info.title || '') + '</span>' + (info.author ? '<span class="illust-author"> · by ' + (info.author || '') + '</span>' : '') + '</div>';
        }
        container.innerHTML = '<div class="pixiv-illust-card" onclick="handleOpenIllust(' + info.illustId + ')">' +
          '<img class="novel-img" src="' + info.dataUrl + '" alt="' + (info.title || '插图') + '" />' +
          captionHtml +
          '</div>';
      } else {
        container.innerHTML = '<img class="novel-img" src="' + info.dataUrl + '" alt="正文插图" />';
      }
      return true;
    }

    function flushPendingImages() {
      if (!window.pendingImages) return;
      var keys = Object.keys(window.pendingImages);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (window.pendingImages[k]) {
          var success = applyImageToDom(k, window.pendingImages[k]);
          if (success) {
            delete window.pendingImages[k];
          }
        }
      }
    }

    window.updateNovelImage = function(chunkId, dataUrl, title, author, illustId) {
      var info = { dataUrl: dataUrl, title: title, author: author, illustId: illustId };
      window.pendingImages[chunkId] = info;
      var success = applyImageToDom(chunkId, info);
      if (!success) {
        setTimeout(flushPendingImages, 100);
        setTimeout(flushPendingImages, 300);
        setTimeout(flushPendingImages, 800);
        setTimeout(flushPendingImages, 1500);
      }
    };

    window.addEventListener("DOMContentLoaded", flushPendingImages);
    window.addEventListener("load", flushPendingImages);

    function restoreProgress(chunkId) {
      var target = chunkId || targetChunkId;
      if (target && target !== "novel-top-anchor") {
        var el = document.getElementById(target);
        if (el) {
          try {
            el.scrollIntoView({ block: "start", behavior: "instant" });
            return true;
          } catch(e) {
            el.scrollIntoView(true);
            return true;
          }
        }
      }
      return false;
    }

    var scrollStopTimer = null;
    var isScrolling = false;

    window.addEventListener("scroll", function() {
      if (!isScrolling) {
        isScrolling = true;
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onScrollState) {
          window.webkit.messageHandlers.onScrollState.postMessage({ scrolling: true });
        }
      }
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      scrollStopTimer = setTimeout(function() {
        isScrolling = false;
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onScrollState) {
          window.webkit.messageHandlers.onScrollState.postMessage({ scrolling: false });
        }
      }, 1400);
    }, { passive: true });

    document.addEventListener("click", function(e) {
      var selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;
      var target = e.target;
      if (target.closest("button") || target.closest("a") || target.closest(".pixiv-illust-card")) {
        return;
      }
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.toggleControls) {
        window.webkit.messageHandlers.toggleControls.postMessage({});
      }
    });

    var progressTimer = null;
    var lastReportedChunk = null;

    function initObserver() {
      if (!window.IntersectionObserver) return;
      var observer = new IntersectionObserver(function(entries) {
        if (isRestoring) return;
        var visibleEntries = entries.filter(function(entry) { return entry.isIntersecting; });
        if (visibleEntries.length === 0) return;

        var topEntry = visibleEntries[0];
        var chunkId = topEntry.target.getAttribute("data-chunk-id");
        var pageAttr = topEntry.target.getAttribute("data-page");
        var page = pageAttr ? parseInt(pageAttr, 10) : 1;

        if (chunkId && chunkId !== lastReportedChunk) {
          lastReportedChunk = chunkId;
          if (progressTimer) clearTimeout(progressTimer);
          progressTimer = setTimeout(function() {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onProgressChange) {
              window.webkit.messageHandlers.onProgressChange.postMessage({ page: page, chunkId: chunkId });
            }
          }, 100);
        }
      }, {
        root: null,
        rootMargin: "-15% 0px -60% 0px",
        threshold: 0
      });

      var chunks = document.querySelectorAll(".novel-chunk");
      for (var i = 0; i < chunks.length; i++) {
        observer.observe(chunks[i]);
      }
    }

    window.addEventListener("DOMContentLoaded", function() {
      restoreProgress(targetChunkId);
      setTimeout(function() {
        restoreProgress(targetChunkId);
        isRestoring = false;
        initObserver();
      }, 250);
    });
  </script>
</body>
</html>`
}

/**
 * 构建沉浸式竖向文库本直书排版 HTML 模板（从右向左翻阅，日式传统文库本排版）
 */
function buildVerticalImmersiveHtml(options: BuildHtmlOptions): string {
  const {
    chunks,
    settings,
    initialChunkId,
    initialPage,
    title,
    seriesNav,
    imageCache,
    ambientActive,
    ambientBgCss: propBgCss,
  } = options
  const ambientBgCss = propBgCss || "transparent"

  const fontFamily = resolveFontFamily(settings)
  const weightMap: Record<string, string> = {
    ultraLight: "100",
    thin: "200",
    light: "300",
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    heavy: "800",
    black: "900",
  }
  const fontWeight = weightMap[settings.fontWeight] || "400"
  const lineSpacing = calculateLineSpacing(settings.fontSize, settings.lineSpacingLevel)
  const lineHeight = ((settings.fontSize + lineSpacing) / settings.fontSize).toFixed(2)

  const bodyParts: string[] = []
  let currentPage = 1

  for (const chunk of chunks) {
    if (chunk.type === "newpage") {
      currentPage = chunk.page ?? 1
      bodyParts.push(
        `<div id="${chunk.id}" class="novel-chunk page-divider" data-page="${chunk.page ?? 1}" data-chunk-id="${chunk.id}">
          <span class="page-badge">第 ${chunk.page ?? 1} 页</span>
        </div>`
      )
    } else if (chunk.type === "chapter") {
      bodyParts.push(
        `<div id="${chunk.id}" class="novel-chunk chapter-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
          <div class="chapter-tag">CHAPTER</div>
          <h2 class="chapter-title">${escapeHtml(chunk.title ?? "")}</h2>
        </div>`
      )
    } else if (chunk.type === "uploadedimage") {
      const cached = imageCache?.[chunk.id]
      if (cached?.dataUrl) {
        bodyParts.push(
          `<div id="${chunk.id}" class="novel-chunk illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
            <img class="novel-img" src="${cached.dataUrl}" alt="插图" />
          </div>`
        )
      } else {
        bodyParts.push(
          `<div id="${chunk.id}" class="novel-chunk illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
            <div class="illust-placeholder" data-chunk-id="${chunk.id}">
              <div class="illust-spinner"></div>
              <span class="illust-hint">正文插图 #${escapeHtml(chunk.imageId ?? "")}</span>
            </div>
          </div>`
        )
      }
    } else if (chunk.type === "pixivimage") {
      const cached = imageCache?.[chunk.id]
      if (cached?.dataUrl) {
        bodyParts.push(
          `<div id="${chunk.id}" class="novel-chunk illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
            <div class="pixiv-illust-card" onclick="handleOpenIllust(${chunk.illustId})">
              <img class="novel-img" src="${cached.dataUrl}" alt="${escapeHtml(cached.title || "Pixiv 插画")}" />
              ${cached.title ? `<div class="illust-caption"><span class="illust-title">${escapeHtml(cached.title)}</span>${cached.author ? `<span class="illust-author"> · by ${escapeHtml(cached.author)}</span>` : ""}</div>` : ""}
            </div>
          </div>`
        )
      } else {
        bodyParts.push(
          `<div id="${chunk.id}" class="novel-chunk illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
            <div class="illust-placeholder" onclick="handleOpenIllust(${chunk.illustId})" data-chunk-id="${chunk.id}">
              <div class="illust-spinner"></div>
              <span class="illust-hint">Pixiv 插画 #${chunk.illustId}</span>
            </div>
          </div>`
        )
      }
    } else if (chunk.type === "jump") {
      bodyParts.push(
        `<div id="${chunk.id}" class="novel-chunk page-divider" data-page="${currentPage}" data-chunk-id="${chunk.id}">
          <button class="jump-btn" onclick="handleJumpToPage(${chunk.page ?? 1})">📄 跳转至第 ${chunk.page ?? 1} 页 →</button>
        </div>`
      )
    } else if (chunk.type === "text") {
      const paragraphs = (chunk.text || "").split("\n")
      const pParts: string[] = []
      for (const p of paragraphs) {
        if (p.replace(/[\s\u3000]/g, "").length === 0) {
          pParts.push('<div class="empty-line"></div>')
        } else {
          pParts.push(`<p class="paragraph">${formatPixivRubyToHtml(p)}</p>`)
        }
      }
      bodyParts.push(
        `<div id="${chunk.id}" class="novel-chunk text-chunk-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">
          ${pParts.join("\n")}
        </div>`
      )
    }
  }

  // 结尾：系列翻页器（文库本最左侧文末，纯正纵列直书立柱方案 A）
  let footerHtml = ""
  if (seriesNav?.seriesID) {
    const seriesTitleText = seriesNav.seriesTitle || "系列目录"
    const episodeText = seriesNav.episodeNumber != null ? `（第${seriesNav.episodeNumber}话）` : ""
    const hasPrev = Boolean(seriesNav.hasPrev && seriesNav.prevID)
    const hasNext = Boolean(seriesNav.hasNext && seriesNav.nextID)

    const booksIconUrl = getBooksSymbolDataUrl()
    const upIconUrl = getUpSymbolDataUrl()
    const downIconUrl = getDownSymbolDataUrl()

    footerHtml = `
      <div class="novel-footer-vertical">
        <!-- 第一列（右）：竖排 本话完 -->
        <div class="novel-end-divider-vertical">✦ 本话完 ✦</div>

        <!-- 第二列（左）：纵列直书章节切换立柱 -->
        <div class="series-nav-bar-vertical">
          <!-- 上一话：chevron.up -->
          <button class="series-nav-circle-vertical series-nav-prev ${hasPrev ? "" : "hidden"}" ${hasPrev ? `onclick="handleSeriesNav('prev', ${seriesNav.prevID})"` : "disabled"} title="上一话">
            ${upIconUrl ? `<img class="nav-arrow-symbol" src="${upIconUrl}" alt="‹" />` : "‹"}
          </button>

          <!-- 系列胶囊（竖立立柱）：books.vertical + 竖排直书标题 -->
          <button class="series-nav-center-vertical" onclick="handleSeriesNav('series', ${seriesNav.seriesID})" title="查看系列详情">
            ${booksIconUrl ? `<img class="nav-series-symbol-vertical" src="${booksIconUrl}" alt="系列" />` : ""}
            <span class="nav-series-title-vertical">${escapeHtml(seriesTitleText)}${escapeHtml(episodeText)}</span>
          </button>

          <!-- 下一话：chevron.down -->
          <button class="series-nav-circle-vertical series-nav-next ${hasNext ? "" : "hidden"}" ${hasNext ? `onclick="handleSeriesNav('next', ${seriesNav.nextID})"` : "disabled"} title="下一话">
            ${downIconUrl ? `<img class="nav-arrow-symbol" src="${downIconUrl}" alt="›" />` : "›"}
          </button>
        </div>
      </div>
    `
  } else {
    footerHtml = `
      <div class="novel-footer-vertical">
        <div class="novel-end-divider-vertical">✦ 全文完 ✦</div>
      </div>
    `
  }

  const safeInitialChunk = JSON.stringify(initialChunkId || null)
  const safeInitialPage = JSON.stringify(typeof initialPage === "number" ? initialPage : null)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<style>
${THEME_CSS_VARS}
  * {
    box-sizing: border-box;
    -webkit-touch-callout: default;
  }
  .ambient-bg-layer {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: -9999;
    pointer-events: none;
    background: ${ambientBgCss};
    opacity: ${ambientActive ? 1 : 0};
    transition: background 0.4s ease, opacity 0.4s ease;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: ${ambientActive ? "transparent !important" : "var(--bg-color)"};
    color: var(--text-color);
    -webkit-text-size-adjust: 100%;
    -webkit-user-select: text;
    user-select: text;
  }

  .vertical-container {
    width: 100%;
    height: 100%;
    min-height: 100%;
    box-sizing: border-box;
    padding-top: max(48px, env(safe-area-inset-top));
    padding-bottom: max(60px, env(safe-area-inset-bottom));
    padding-left: max(24px, env(safe-area-inset-left));
    padding-right: max(24px, env(safe-area-inset-right));
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    writing-mode: vertical-rl;
    -webkit-writing-mode: vertical-rl;
    text-orientation: upright;
    -webkit-text-orientation: upright;
    font-family: ${fontFamily};
    font-size: ${settings.fontSize}px;
    font-weight: ${fontWeight};
    line-height: ${lineHeight};
    letter-spacing: 0.06em;
    display: inline-block;
  }

  .vertical-title-section {
    margin: 0 36px 0 16px;
    display: inline-block;
    height: 100%;
    vertical-align: top;
  }

  .vertical-header-title {
    font-size: 1.4em;
    font-weight: 700;
    color: var(--text-color);
    line-height: 1.4;
    margin: 0;
    border-left: 2px solid var(--divider-color);
    padding-left: 14px;
    letter-spacing: 0.08em;
  }

  .text-chunk-block {
    display: inline-block;
    height: 100%;
    vertical-align: top;
  }

  .paragraph {
    margin: 0 10px;
    white-space: pre-wrap;
    line-break: strict;
    word-break: break-all;
  }
  .empty-line {
    width: 14px;
    height: 100%;
    display: inline-block;
  }

  .chapter-block {
    margin: 0 32px;
    border-left: 3px solid var(--accent-color);
    padding-left: 12px;
    display: inline-block;
    height: 100%;
    vertical-align: top;
  }
  .chapter-tag {
    font-size: 0.7em;
    font-weight: bold;
    color: var(--accent-color);
    margin-bottom: 6px;
    letter-spacing: 0.08em;
  }
  .chapter-title {
    margin: 0;
    font-size: 1.25em;
    font-weight: bold;
    color: var(--text-color);
  }

  .page-divider {
    margin: 0 24px;
    padding: 0 8px;
    border-left: 1px dashed var(--divider-color);
    display: inline-flex;
    align-items: center;
    height: 100%;
    vertical-align: middle;
  }
  .page-badge {
    font-size: 0.75em;
    color: var(--secondary-text-color);
    padding: 4px 8px;
    writing-mode: horizontal-tb;
    -webkit-writing-mode: horizontal-tb;
    background: rgba(128, 128, 128, 0.08);
    border-radius: 10px;
  }

  .illust-block {
    margin: 0 20px;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
    height: 100%;
  }
  .novel-img {
    max-height: 72vh;
    max-width: 72vw;
    border-radius: 12px;
    object-fit: contain;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12);
  }
  .pixiv-illust-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
  }
  .illust-caption {
    margin-top: 8px;
    font-size: 0.78em;
    writing-mode: horizontal-tb;
    -webkit-writing-mode: horizontal-tb;
    text-align: center;
    color: var(--accent-color);
  }
  .illust-author {
    color: var(--secondary-text-color);
  }
  .illust-placeholder {
    width: 200px;
    height: 160px;
    background: rgba(128, 128, 128, 0.08);
    border: 1px dashed var(--divider-color);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    writing-mode: horizontal-tb;
    -webkit-writing-mode: horizontal-tb;
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
  .illust-hint {
    font-size: 0.75em;
    color: var(--secondary-text-color);
    writing-mode: horizontal-tb;
    -webkit-writing-mode: horizontal-tb;
  }

  .jump-btn {
    background: rgba(0, 122, 255, 0.08);
    color: var(--accent-color);
    border: 1px solid var(--accent-color);
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 0.88em;
    cursor: pointer;
    writing-mode: horizontal-tb;
    -webkit-writing-mode: horizontal-tb;
  }

  ruby rt {
    font-size: 0.55em;
    color: var(--secondary-text-color);
  }
  a {
    color: var(--accent-color);
    text-decoration: underline;
  }

  .novel-footer-vertical {
    margin: 0 48px 0 24px;
    display: inline-flex;
    flex-direction: row-reverse;
    align-items: center;
    justify-content: center;
    height: 100%;
    vertical-align: top;
    gap: 36px;
  }
  .novel-end-divider-vertical {
    writing-mode: vertical-rl;
    -webkit-writing-mode: vertical-rl;
    text-orientation: upright;
    -webkit-text-orientation: upright;
    font-size: 0.95em;
    letter-spacing: 0.32em;
    color: var(--secondary-text-color);
    white-space: nowrap;
    padding: 0 10px;
    border-right: 1px dashed var(--divider-color);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .series-nav-bar-vertical {
    writing-mode: horizontal-tb !important;
    -webkit-writing-mode: horizontal-tb !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 14px;
    height: 100%;
    max-height: 80vh;
  }
  .series-nav-circle-vertical {
    width: 44px;
    height: 44px;
    border-radius: 22px;
    background: var(--card-bg);
    border: 0.5px solid var(--card-border);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-color);
    cursor: pointer;
    -webkit-backdrop-filter: blur(25px) saturate(190%);
    backdrop-filter: blur(25px) saturate(190%);
    box-shadow: var(--glass-shadow);
    flex-shrink: 0;
    transition: opacity 0.15s ease;
  }
  .series-nav-circle-vertical.hidden {
    visibility: hidden;
    pointer-events: none;
  }
  .series-nav-center-vertical {
    writing-mode: horizontal-tb !important;
    -webkit-writing-mode: horizontal-tb !important;
    width: 44px;
    min-height: 150px;
    max-height: 380px;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 10px;
    padding: 16px 0;
    border-radius: 22px;
    background: var(--card-bg);
    border: 0.5px solid var(--card-border);
    color: var(--accent-color);
    cursor: pointer;
    -webkit-backdrop-filter: blur(25px) saturate(190%);
    backdrop-filter: blur(25px) saturate(190%);
    box-shadow: var(--glass-shadow);
    overflow: hidden;
  }
  .nav-series-symbol-vertical {
    width: 21px;
    height: 21px;
    object-fit: contain;
    flex-shrink: 0;
    margin-bottom: 5px;
  }
  .nav-series-title-vertical {
    writing-mode: vertical-rl;
    -webkit-writing-mode: vertical-rl;
    text-orientation: upright;
    -webkit-text-orientation: upright;
    font-size: 1.08em;
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: 0.06em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-height: 300px;
    display: inline-block;
  }
  .nav-arrow-symbol {
    width: 17px;
    height: 17px;
    object-fit: contain;
    flex-shrink: 0;
    vertical-align: middle;
  }
  .series-nav-circle-vertical .nav-arrow-symbol {
    width: 19px;
    height: 19px;
  }
</style>
</head>
<body>
  <div id="ambient-bg-layer" class="ambient-bg-layer"></div>
  <div class="vertical-container">
    <div id="novel-top-anchor" class="novel-chunk" data-page="1" data-chunk-id="novel-top-anchor" style="width: 1px; height: 100%; display: inline-block; visibility: hidden;"></div>
    <div class="vertical-title-section">
      <h1 class="vertical-header-title">${escapeHtml(title)}</h1>
    </div>
    ${bodyParts.join("\n")}
    ${footerHtml}
  </div>

  <script>
    var targetChunkId = ${safeInitialChunk};
    var targetPage = ${safeInitialPage};
    var isRestoring = true;

    window.updateAmbientBackground = function(bgCss, enabled) {
      var layer = document.getElementById("ambient-bg-layer");
      if (layer) {
        if (enabled && bgCss) {
          layer.style.background = bgCss;
          layer.style.opacity = "1";
          document.documentElement.style.backgroundColor = "transparent";
          document.body.style.backgroundColor = "transparent";
        } else {
          layer.style.opacity = "0";
          document.documentElement.style.backgroundColor = "var(--bg-color)";
          document.body.style.backgroundColor = "var(--bg-color)";
        }
      }
    };

    window.applyTypography = function(config) {
      if (!config) return;
      var container = document.querySelector(".vertical-container");
      if (!container) return;
      if (config.fontFamily) container.style.fontFamily = config.fontFamily;
      if (config.fontSize) container.style.fontSize = config.fontSize + "px";
      if (config.fontWeight) container.style.fontWeight = config.fontWeight;
      if (config.lineHeight) container.style.lineHeight = config.lineHeight;
    };

    function handleOpenIllust(illustId) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openIllust) {
        window.webkit.messageHandlers.openIllust.postMessage({ illustId: illustId });
      }
    }

    function handleJumpToPage(page) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jumpToPage) {
        window.webkit.messageHandlers.jumpToPage.postMessage({ page: page });
      }
    }

    function handleSeriesNav(action, id) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onSeriesNav) {
        window.webkit.messageHandlers.onSeriesNav.postMessage({ action: action, id: id });
      }
    }

    window.updateSeriesNav = function(nav) {
      if (!nav || !nav.seriesID) return;
      var container = document.querySelector(".series-nav-bar-vertical") || document.querySelector(".series-nav-bar");
      if (!container) return;
      var prevBtn = container.querySelector(".series-nav-prev");
      var nextBtn = container.querySelector(".series-nav-next");
      var titleSpan = container.querySelector(".nav-series-title-vertical") || container.querySelector(".nav-series-title");
      if (titleSpan) {
        var epText = nav.episodeNumber != null ? "（第" + nav.episodeNumber + "话）" : "";
        titleSpan.innerText = (nav.seriesTitle || "系列目录") + epText;
      }
      if (prevBtn) {
        if (nav.hasPrev && nav.prevID) {
          prevBtn.classList.remove("hidden");
          prevBtn.onclick = function() { handleSeriesNav("prev", nav.prevID); };
        } else {
          prevBtn.classList.add("hidden");
          prevBtn.onclick = null;
        }
      }
      if (nextBtn) {
        if (nav.hasNext && nav.nextID) {
          nextBtn.classList.remove("hidden");
          nextBtn.onclick = function() { handleSeriesNav("next", nav.nextID); };
        } else {
          nextBtn.classList.add("hidden");
          nextBtn.onclick = null;
        }
      }
    };

    function handleLinkClick(url) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openLink) {
        window.webkit.messageHandlers.openLink.postMessage({ url: url });
      }
    }

    window.pendingImages = window.pendingImages || {};

    function applyImageToDom(chunkId, info) {
      if (!chunkId || !info || !info.dataUrl) return false;
      var container = document.getElementById(chunkId) || document.querySelector('[data-chunk-id="' + chunkId + '"]');
      if (!container) return false;

      if (info.illustId) {
        var captionHtml = '';
        if (info.title) {
          captionHtml = '<div class="illust-caption"><span class="illust-title">' + (info.title || '') + '</span>' + (info.author ? '<span class="illust-author"> · by ' + (info.author || '') + '</span>' : '') + '</div>';
        }
        container.innerHTML = '<div class="pixiv-illust-card" onclick="handleOpenIllust(' + info.illustId + ')">' +
          '<img class="novel-img" src="' + info.dataUrl + '" alt="' + (info.title || '插图') + '" />' +
          captionHtml +
          '</div>';
      } else {
        container.innerHTML = '<img class="novel-img" src="' + info.dataUrl + '" alt="正文插图" />';
      }
      return true;
    }

    function flushPendingImages() {
      if (!window.pendingImages) return;
      var keys = Object.keys(window.pendingImages);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (window.pendingImages[k]) {
          var success = applyImageToDom(k, window.pendingImages[k]);
          if (success) {
            delete window.pendingImages[k];
          }
        }
      }
    }

    window.updateNovelImage = function(chunkId, dataUrl, title, author, illustId) {
      var info = { dataUrl: dataUrl, title: title, author: author, illustId: illustId };
      window.pendingImages[chunkId] = info;
      var success = applyImageToDom(chunkId, info);
      if (!success) {
        setTimeout(flushPendingImages, 100);
        setTimeout(flushPendingImages, 300);
        setTimeout(flushPendingImages, 800);
        setTimeout(flushPendingImages, 1500);
      }
    };

    window.addEventListener("DOMContentLoaded", flushPendingImages);
    window.addEventListener("load", flushPendingImages);

    function scrollToNovelStart() {
      var container = document.querySelector(".vertical-container");
      if (container) {
        var maxScroll = Math.max(container.scrollWidth, 1000000);
        container.scrollLeft = maxScroll;
      }
    }

    function restoreProgress(chunkId) {
      var target = chunkId || targetChunkId;
      if (target && target !== "novel-top-anchor") {
        var el = document.getElementById(target);
        if (el) {
          try {
            el.scrollIntoView({ inline: "start", block: "start", behavior: "instant" });
            return true;
          } catch(e) {
            el.scrollIntoView(true);
            return true;
          }
        }
      }
      scrollToNovelStart();
      return false;
    }

    var scrollStopTimer = null;
    var isScrolling = false;

    var containerEl = document.querySelector(".vertical-container");
    var scrollTarget = containerEl || window;

    scrollTarget.addEventListener("scroll", function() {
      if (!isScrolling) {
        isScrolling = true;
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onScrollState) {
          window.webkit.messageHandlers.onScrollState.postMessage({ scrolling: true });
        }
      }
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      scrollStopTimer = setTimeout(function() {
        isScrolling = false;
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onScrollState) {
          window.webkit.messageHandlers.onScrollState.postMessage({ scrolling: false });
        }
      }, 1400);
    }, { passive: true });

    document.addEventListener("click", function(e) {
      var selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;
      var target = e.target;
      if (target.closest("button") || target.closest("a") || target.closest(".pixiv-illust-card")) {
        return;
      }
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.toggleControls) {
        window.webkit.messageHandlers.toggleControls.postMessage({});
      }
    });

    var progressTimer = null;
    var lastReportedChunk = null;

    function initObserver() {
      if (!window.IntersectionObserver) return;
      var observer = new IntersectionObserver(function(entries) {
        if (isRestoring) return;
        var visibleEntries = entries.filter(function(entry) { return entry.isIntersecting; });
        if (visibleEntries.length === 0) return;

        var rightEntry = visibleEntries[0];
        var chunkId = rightEntry.target.getAttribute("data-chunk-id");
        var pageAttr = rightEntry.target.getAttribute("data-page");
        var page = pageAttr ? parseInt(pageAttr, 10) : 1;

        if (chunkId && chunkId !== lastReportedChunk) {
          lastReportedChunk = chunkId;
          if (progressTimer) clearTimeout(progressTimer);
          progressTimer = setTimeout(function() {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onProgressChange) {
              window.webkit.messageHandlers.onProgressChange.postMessage({ page: page, chunkId: chunkId });
            }
          }, 100);
        }
      }, {
        root: null,
        rootMargin: "0px -15% 0px -50%",
        threshold: 0
      });

      var chunks = document.querySelectorAll(".novel-chunk");
      for (var i = 0; i < chunks.length; i++) {
        observer.observe(chunks[i]);
      }
    }

    window.addEventListener("DOMContentLoaded", function() {
      restoreProgress(targetChunkId);
      setTimeout(function() {
        restoreProgress(targetChunkId);
        isRestoring = false;
        initObserver();
      }, 250);
    });
  </script>
</body>
</html>`
}

/**
 * 统一排版调度引擎：根据 settings.layoutDirection 分发横向流式排版或竖向文库本直书排版
 */
function buildImmersiveHtml(options: BuildHtmlOptions): string {
  if (options.settings.layoutDirection === "vertical") {
    return buildVerticalImmersiveHtml(options)
  }
  return buildHorizontalImmersiveHtml(options)
}

export function NovelImmersiveReaderView(props: NovelImmersiveReaderViewProps) {
  const {
    novelId,
    title,
    text,
    coverUrl,
    textEmbeddedImages,
    markerPage,
    currentPage: propCurrentPage = 1,
    initialChunkId,
    seriesID,
    seriesTitle,
    seriesPrev,
    seriesNext,
    episodeNumber,
    onClose,
    onToggleMarker,
    onJumpToPage,
    onNavigateNovel,
    onNavigateSeries,
  } = props

  // 自治章节状态机：允许在沉浸全屏阅读器内部直接换章连续阅读，绝不退出全屏
  const [activeNovelId, setActiveNovelId] = useState(novelId)
  const [activeTitle, setActiveTitle] = useState(title)
  const [activeText, setActiveText] = useState(text)
  const [activeCoverUrl, setActiveCoverUrl] = useState<string | null | undefined>(coverUrl)
  const [activeImages, setActiveImages] = useState<Record<string, TextEmbeddedImage> | undefined>(
    textEmbeddedImages
  )
  const [switchingEpisode, setSwitchingEpisode] = useState(false)
  const [switchHint, setSwitchHint] = useState<string | null>(null)

  // 接入小说正文同款沉浸光感（设置值与状态跟随“对小说正文页启用”）
  const {
    ambientEnabled,
    ambientBackground,
    ambientPalette,
    ambientAlgorithm,
  } = useNovelExperimentalAmbientPalette(activeCoverUrl)
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const ambientActive = ambientEnabled && (!!ambientBackground || !!ambientPalette)
  const ambientBgCss = generateAmbientBackgroundCss(ambientPalette, ambientAlgorithm, isDark)

  const [settings, setSettings] = useState<NovelReaderSettings>(() => loadNovelReaderSettings())
  const [controlsVisible, setControlsVisible] = useState(true)
  const [showTypography, setShowTypography] = useState(false)
  const [currentPage, setCurrentPage] = useState(propCurrentPage)
  const [markerBusy, setMarkerBusy] = useState(false)

  // 当父组件 textEmbeddedImages 或 coverUrl 异步就绪时同步更新
  useEffect(() => {
    if (activeNovelId === novelId) {
      if (textEmbeddedImages) setActiveImages(textEmbeddedImages)
      if (coverUrl !== undefined) setActiveCoverUrl(coverUrl)
    }
  }, [novelId, textEmbeddedImages, coverUrl, activeNovelId])

  // 监听版式变更（字体、字号、行距、以及横竖排切换）
  useEffect(() => {
    return onNovelReaderSettingsChanged((updated) => {
      setSettings(updated)
    })
  }, [])

  // 直接复用小说正文页的话数导航 Hook，随 activeNovelId 自动异步补齐系列全集链表
  const nav = useSeriesEpisodeNav({
    workID: activeNovelId,
    seriesID,
    seriesTitleFallback: seriesTitle,
    kind: "novel",
    initialPrev: activeNovelId === novelId ? seriesPrev : null,
    initialNext: activeNovelId === novelId ? seriesNext : null,
    initialEpisodeNumber: activeNovelId === novelId ? episodeNumber : null,
  })

  const currentChunkIdRef = useRef<string | null>(initialChunkId ?? null)
  const novelIdRef = useRef(activeNovelId)
  novelIdRef.current = activeNovelId

  const controllerRef = useRef<any>(null)
  if (!controllerRef.current) {
    controllerRef.current = new WebViewController()
  }
  const controller = controllerRef.current

  // 分块解析
  const chunks = useMemo(() => {
    if (!activeText) return []
    return parseNovelToChunks(activeText, activeImages)
  }, [activeText, activeImages])

  const totalPages = useMemo(() => {
    return Math.max(1, groupChunksByPage(chunks).length)
  }, [chunks])

  // 图片缓存
  const [imageCache, setImageCache] = useState<
    Record<string, { dataUrl: string; title?: string; author?: string; illustId?: number }>
  >({})
  const imageCacheRef = useRef(imageCache)
  imageCacheRef.current = imageCache

  // 关闭处理器：回传最终所在的 activeNovelId 与阅读位置
  const handleClose = useCallback(() => {
    onClose(currentChunkIdRef.current, currentPage, activeNovelId)
  }, [onClose, currentPage, activeNovelId])

  // 切换书签
  const handleToggleMarker = useCallback(async () => {
    if (markerBusy || !onToggleMarker) return
    setMarkerBusy(true)
    try {
      await onToggleMarker()
    } finally {
      setMarkerBusy(false)
    }
  }, [markerBusy, onToggleMarker])

  // 跳页
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page)
      onJumpToPage?.(page)
      const ctrl = controllerRef.current
      if (ctrl) {
        const targetId = `page-${page}`
        const script = `
          var el = document.getElementById(${JSON.stringify(targetId)}) || document.querySelector('[data-page="${page}"]');
          if (el) el.scrollIntoView({ inline: 'start', block: 'start', behavior: 'smooth' });
        `
        void ctrl.evaluateJavaScript(script).catch(() => {})
      }
    },
    [onJumpToPage]
  )

  // 沉浸阅读器内部静默换章管线（不退出全屏，瞬时无缝切章）
  const handleSwitchEpisode = useCallback(
    async (targetNovelId: number, direction: "prev" | "next") => {
      if (targetNovelId === activeNovelId || switchingEpisode) return
      setSwitchingEpisode(true)
      setSwitchHint(direction === "next" ? "正在载入下一话..." : "正在载入上一话...")

      try {
        const cached = getCachedNovel(targetNovelId)
        const detailPromise = cached
          ? Promise.resolve(cached)
          : session.call((token) => novelDetail(targetNovelId, token))
        const viewerPromise = session.call((token) => novelViewerData(targetNovelId, token))

        const [detail, viewer] = await Promise.all([detailPromise, viewerPromise])

        if (detail) {
          cacheNovel(detail)
          recordNovelHistory({ ...detail, is_muted: false, visible: true } as any)
        }

        const newTitle = detail?.title || (direction === "next" ? "下一话" : "上一话")
        const newText = viewer?.text || ""
        const newCover = extractNovelCoverUrl(detail)
        const newImages =
          viewer?.textEmbeddedImages ??
          (detail as any)?.textEmbeddedImages ??
          (detail as any)?.text_embedded_images ??
          undefined

        // 读取该新章节的历史进度（默认从开头开始）
        const saved = getNovelProgress(targetNovelId)
        const targetChunk = saved?.chunkId ?? null
        const targetPage = saved?.page ?? 1

        setActiveNovelId(targetNovelId)
        setActiveTitle(newTitle)
        setActiveText(newText)
        setActiveCoverUrl(newCover)
        setActiveImages(newImages)
        setImageCache({})
        setCurrentPage(targetPage)
        currentChunkIdRef.current = targetChunk
        novelIdRef.current = targetNovelId

        // 视口平滑归位至开头
        const ctrl = controllerRef.current
        if (ctrl) {
          void ctrl
            .evaluateJavaScript(
              "if (typeof scrollToNovelStart === 'function') { scrollToNovelStart(); } else { window.scrollTo(0, 0); }"
            )
            .catch(() => {})
        }
      } catch {
        setSwitchHint("载入失败，请重试")
        setTimeout(() => setSwitchHint(null), 2000)
      } finally {
        setSwitchingEpisode(false)
        setSwitchHint(null)
      }
    },
    [activeNovelId, switchingEpisode]
  )

  // 保证 WebViewController 仅在组件彻底卸载（用户退出沉浸全屏）时才 dispose
  useEffect(() => {
    return () => {
      try {
        controllerRef.current?.dispose()
      } catch {}
    }
  }, [])

  // 保证 handler 闭包访问的均为最新引用
  const activeNovelIdRef = useRef(activeNovelId)
  activeNovelIdRef.current = activeNovelId
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onNavigateSeriesRef = useRef(onNavigateSeries)
  onNavigateSeriesRef.current = onNavigateSeries
  const handlePageChangeRef = useRef(handlePageChange)
  handlePageChangeRef.current = handlePageChange
  const handleSwitchEpisodeRef = useRef(handleSwitchEpisode)
  handleSwitchEpisodeRef.current = handleSwitchEpisode

  // 仅在组件挂载时注册一次 scriptMessageHandlers，绝不重复注册也不随切章销毁
  const handlersRegisteredRef = useRef(false)
  useEffect(() => {
    const ctrl = controllerRef.current
    if (!ctrl || handlersRegisteredRef.current) return
    handlersRegisteredRef.current = true

    void ctrl.addScriptMessageHandler("onProgressChange", (data: any) => {
      if (!data) return
      const page = typeof data.page === "number" ? data.page : 1
      const chunkId = typeof data.chunkId === "string" ? data.chunkId : undefined
      if (chunkId) {
        currentChunkIdRef.current = chunkId
      }
      if (page !== currentPageRef.current) {
        setCurrentPage(page)
      }
      const id = activeNovelIdRef.current
      if (id && chunkId) {
        recordNovelProgress(id, page, chunkId)
      }
    }).catch(() => {})

    void ctrl.addScriptMessageHandler("onScrollState", (data: any) => {
      const scrolling = Boolean(data?.scrolling)
      setControlsVisible(!scrolling)
    }).catch(() => {})

    void ctrl.addScriptMessageHandler("toggleControls", () => {
      setControlsVisible((prev) => !prev)
    }).catch(() => {})

    void ctrl.addScriptMessageHandler("openIllust", (data: any) => {
      const illustId =
        typeof data?.illustId === "number" ? data.illustId : parseInt(data?.illustId, 10)
      if (illustId && !isNaN(illustId)) {
        requestPixivRoute(`illust:${illustId}`)
      }
    }).catch(() => {})

    void ctrl.addScriptMessageHandler("jumpToPage", (data: any) => {
      const page = typeof data?.page === "number" ? data.page : parseInt(data?.page, 10)
      if (page && !isNaN(page)) {
        handlePageChangeRef.current(page)
      }
    }).catch(() => {})

    void ctrl.addScriptMessageHandler("onSeriesNav", (data: any) => {
      const action = data?.action
      const id = typeof data?.id === "number" ? data.id : parseInt(data?.id, 10)
      if (!id || isNaN(id)) return
      if (action === "series") {
        onCloseRef.current(currentChunkIdRef.current, currentPageRef.current, activeNovelIdRef.current)
        if (onNavigateSeriesRef.current) {
          onNavigateSeriesRef.current(id)
        } else {
          requestPixivRoute(`novelSeries:${id}`)
        }
      } else if (action === "prev" || action === "next") {
        void handleSwitchEpisodeRef.current(id, action)
      }
    }).catch(() => {})

    void ctrl.addScriptMessageHandler("openLink", (data: any) => {
      const url = typeof data?.url === "string" ? data.url : ""
      if (!url) return
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void presentExternalURL(url)
      } else {
        const target = routeForDescriptionLink(url) ?? url
        requestPixivRoute(target)
      }
    }).catch(() => {})
  }, [])

  // 仅在章节变更、文本分块变更、或横竖排方向切换时载入对应引擎的 HTML
  useEffect(() => {
    const ctrl = controllerRef.current
    if (!ctrl || chunks.length === 0) return

    const html = buildImmersiveHtml({
      chunks,
      settings,
      initialChunkId: currentChunkIdRef.current,
      initialPage: currentPage,
      title: activeTitle,
      seriesNav: nav,
      imageCache: imageCacheRef.current,
      ambientActive,
      ambientBgCss,
    })

    void ctrl.loadHTML(html).catch(() => {})
  }, [activeNovelId, chunks, activeTitle, settings.layoutDirection, ambientActive])

  // 当环境光色板异步就绪、换章或设置变更时，动态平滑热更新 WebKit 内部画布（0 重载、0 滚动跳变）
  useEffect(() => {
    const ctrl = controllerRef.current
    if (!ctrl) return
    const bgCss = generateAmbientBackgroundCss(ambientPalette, ambientAlgorithm, isDark)
    const script = `if (window.updateAmbientBackground) { window.updateAmbientBackground(${JSON.stringify(bgCss)}, ${JSON.stringify(ambientActive)}); }`
    void ctrl.evaluateJavaScript(script).catch(() => {})
  }, [ambientPalette, ambientAlgorithm, isDark, ambientActive])

  // 当系列导航数据异步就绪时，动态更新 HTML 中的系列翻页器状态
  useEffect(() => {
    const ctrl = controllerRef.current
    if (!ctrl || !seriesID || nav.loading) return
    const navPayload = {
      seriesID: nav.seriesID,
      seriesTitle: nav.seriesTitle,
      episodeNumber: nav.episodeNumber,
      hasPrev: nav.hasPrev,
      prevID: nav.prevID,
      hasNext: nav.hasNext,
      nextID: nav.nextID,
    }
    const script = `if (window.updateSeriesNav) { window.updateSeriesNav(${JSON.stringify(navPayload)}); }`
    void ctrl.evaluateJavaScript(script).catch(() => {})
  }, [nav])

  // 版式变更即时生效（字体、字号、字重、行高热更新）
  useEffect(() => {
    const ctrl = controllerRef.current
    if (!ctrl) return

    const fontFamily = resolveFontFamily(settings)
    const weightMap: Record<string, string> = {
      ultraLight: "100",
      thin: "200",
      light: "300",
      regular: "400",
      medium: "500",
      semibold: "600",
      bold: "700",
      heavy: "800",
      black: "900",
    }
    const fontWeight = weightMap[settings.fontWeight] || "400"
    const lineSpacing = calculateLineSpacing(settings.fontSize, settings.lineSpacingLevel)
    const lineHeight = ((settings.fontSize + lineSpacing) / settings.fontSize).toFixed(2)

    const script = `if (window.applyTypography) { window.applyTypography(${JSON.stringify({
      fontFamily,
      fontSize: settings.fontSize,
      fontWeight,
      lineHeight,
    })}); }`

    void ctrl.evaluateJavaScript(script).catch(() => {})
  }, [settings])

  // 异步加载正文插图
  useEffect(() => {
    let active = true

    for (const chunk of chunks) {
      if (chunk.type === "uploadedimage") {
        const url = resolveUploadedImageUrl(chunk, activeImages)
        if (!url || imageCacheRef.current[chunk.id]?.dataUrl) continue

        void (async () => {
          try {
            const path = await loadImage(url, -1000)
            if (!active || !path) return
            const dataUrl = getLocalImageDataUrl(path)
            if (!dataUrl) return
            setImageCache((prev) => ({ ...prev, [chunk.id]: { dataUrl } }))
            const ctrl = controllerRef.current
            if (ctrl) {
              const script = `if (window.updateNovelImage) { window.updateNovelImage(${JSON.stringify(chunk.id)}, ${JSON.stringify(dataUrl)}); }`
              void ctrl.evaluateJavaScript(script).catch(() => {})
            }
          } catch {}
        })()
      } else if (chunk.type === "pixivimage" && chunk.illustId) {
        const illustId = chunk.illustId
        if (imageCacheRef.current[chunk.id]?.dataUrl) continue

        void (async () => {
          try {
            const illust = await session.call((token) => illustrationDetail(illustId, token))
            if (!active || !illust) return
            const pageIdx = Math.max(0, (chunk.page || 1) - 1)
            const url = imageUrlOf(illust, pageIdx, "large")
            if (!url) return
            const path = await loadImage(url, -1000)
            if (!active || !path) return
            const dataUrl = getLocalImageDataUrl(path)
            if (!dataUrl) return
            const illustTitle = illust.title || `Pixiv 插画 #${illustId}`
            const author = illust.user?.name || ""
            setImageCache((prev) => ({
              ...prev,
              [chunk.id]: {
                dataUrl,
                title: illustTitle,
                author,
                illustId,
              },
            }))
            const ctrl = controllerRef.current
            if (ctrl) {
              const script = `if (window.updateNovelImage) { window.updateNovelImage(${JSON.stringify(chunk.id)}, ${JSON.stringify(dataUrl)}, ${JSON.stringify(illustTitle)}, ${JSON.stringify(author)}, ${illustId}); }`
              void ctrl.evaluateJavaScript(script).catch(() => {})
            }
          } catch {}
        })()
      }
    }

    return () => {
      active = false
    }
  }, [chunks, activeImages])

  const metrics = useLayoutMetrics()
  const topInset = metrics.isLandscape ? 24 : (Device.screen.height > 800 ? 50 : 38)
  const bottomInset = metrics.isLandscape ? 18 : (Device.screen.height > 800 ? 32 : 16)
  const horizontalInset = metrics.isLandscape ? 32 : 20

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} ignoresSafeArea={true}>
      {/* 0. 沉浸式环境光大画布（与小说正文页同款，整屏铺满） */}
      {isVirtualNode(ambientBackground) ? (
        ambientBackground
      ) : (
        <Rectangle fill={ambientBackground ?? "clear"} ignoresSafeArea={true} />
      )}

      {/* 1. 核心 WebView 纯净渲染引擎（横竖双引擎无缝调度） */}
      <WebView controller={controller} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />

      {/* 2. 悬浮顶栏控制按钮（自动轻柔淡出） */}
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}>
        <HStack
          alignment="center"
          padding={{ top: topInset, horizontal: horizontalInset }}
          frame={{ maxWidth: "infinity" }}
          opacity={controlsVisible ? 1 : 0}
          animation={{ animation: Animation.smooth({ duration: 0.25 }), value: controlsVisible }}
        >
          {/* 左上角：关闭按钮 */}
          <Button action={handleClose} buttonStyle="plain">
            <ZStack
              alignment="center"
              frame={{ width: 42, height: 42 }}
              glassEffect={appGlass("circle")}
              contentShape="circle"
              shadow={{ color: "#0000001F", radius: 8, y: 2 }}
            >
              <Image
                systemName="xmark"
                font="body"
                fontWeight="semibold"
                foregroundStyle="label"
              />
            </ZStack>
          </Button>

          <Spacer />

          {/* 右上角：版式设置按钮（使用现有同款 a.square 图标） */}
          <Button action={() => setShowTypography(true)} buttonStyle="plain">
            <ZStack
              alignment="center"
              frame={{ width: 42, height: 42 }}
              glassEffect={appGlass("circle")}
              contentShape="circle"
              shadow={{ color: "#0000001F", radius: 8, y: 2 }}
            >
              <Image
                systemName="a.square"
                font="title3"
                fontWeight="regular"
                foregroundStyle="label"
              />
            </ZStack>
          </Button>
        </HStack>
      </VStack>

      {/* 3. 悬浮底栏：页数指示器（多页小说时渲染，带自动轻柔淡出） */}
      {totalPages > 1 ? (
        <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottom" }}>
          <VStack
            padding={{ horizontal: horizontalInset, bottom: bottomInset }}
            frame={{ maxWidth: "infinity" }}
            opacity={controlsVisible ? 1 : 0}
            animation={{ animation: Animation.smooth({ duration: 0.25 }), value: controlsVisible }}
          >
            <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
              {/* 左侧：上一页 */}
              <HStack alignment="center" frame={{ width: 80, alignment: "leading" }}>
                {currentPage > 1 ? (
                  <ZStack
                    alignment="center"
                    frame={{ width: 38, height: 38 }}
                    glassEffect={appGlass("circle")}
                    contentShape="circle"
                    shadow={{ color: "#0000001F", radius: 8, y: 2 }}
                    onTapGesture={() => handlePageChange(currentPage - 1)}
                  >
                    <Image
                      systemName="chevron.left"
                      font="subheadline"
                      fontWeight="semibold"
                      foregroundStyle="#007AFF"
                    />
                  </ZStack>
                ) : null}
              </HStack>

              <Spacer />

              {/* 中间：页码胶囊与跳页 Menu */}
              <Menu
                label={
                  <HStack
                    spacing={6}
                    alignment="center"
                    padding={{ horizontal: 16, vertical: 8 }}
                    glassEffect={appGlass("capsule")}
                    contentShape="capsule"
                    shadow={{ color: "#0000001F", radius: 8, y: 2 }}
                  >
                    <Text font="body" fontWeight="bold">
                      {currentPage} / {totalPages}
                    </Text>
                    <Image
                      systemName="chevron.up.chevron.down"
                      font="caption"
                      foregroundStyle="secondaryLabel"
                    />
                  </HStack>
                }
              >
                {Array.from({ length: totalPages }, (_, i) => totalPages - i).map((p) => (
                  <Button
                    key={p}
                    title={`第 ${p} 页${p === markerPage ? "（书签）" : ""}`}
                    systemImage={
                      p === currentPage
                        ? "checkmark"
                        : p === markerPage
                        ? "book.pages.fill"
                        : undefined
                    }
                    action={() => handlePageChange(p)}
                  />
                ))}
              </Menu>

              <Spacer />

              {/* 右侧：书签打标与下一页 */}
              <HStack spacing={8} alignment="center" frame={{ width: 80, alignment: "trailing" }}>
                {onToggleMarker ? (
                  <ZStack
                    alignment="center"
                    frame={{ width: 38, height: 38 }}
                    glassEffect={appGlass("circle")}
                    contentShape="circle"
                    shadow={{ color: "#0000001F", radius: 8, y: 2 }}
                    onTapGesture={handleToggleMarker}
                  >
                    <Image
                      systemName={markerPage === currentPage ? "book.pages.fill" : "book.pages"}
                      font="subheadline"
                      fontWeight="semibold"
                      foregroundStyle={markerPage === currentPage ? "#007AFF" : "secondaryLabel"}
                    />
                  </ZStack>
                ) : null}

                {currentPage < totalPages ? (
                  <ZStack
                    alignment="center"
                    frame={{ width: 38, height: 38 }}
                    glassEffect={appGlass("circle")}
                    contentShape="circle"
                    shadow={{ color: "#0000001F", radius: 8, y: 2 }}
                    onTapGesture={() => handlePageChange(currentPage + 1)}
                  >
                    <Image
                      systemName="chevron.right"
                      font="subheadline"
                      fontWeight="semibold"
                      foregroundStyle="#007AFF"
                    />
                  </ZStack>
                ) : null}
              </HStack>
            </HStack>
          </VStack>
        </VStack>
      ) : null}

      {/* 4. 章节切换中精致毛玻璃胶囊提示 */}
      {switchingEpisode || switchHint ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}
        >
          <HStack
            spacing={10}
            padding={{ horizontal: 20, vertical: 14 }}
            glassEffect={appGlass("capsule")}
            contentShape="capsule"
            alignment="center"
            shadow={{ color: "#0000002E", radius: 12, y: 3 }}
          >
            {switchingEpisode ? (
              <ProgressView progressViewStyle="circular" controlSize="small" />
            ) : null}
            <Text font="subheadline" fontWeight="medium" foregroundStyle="label">
              {switchHint ?? "正在载入新章节..."}
            </Text>
          </HStack>
        </VStack>
      ) : null}

      {/* 5. 版式设置模态 sheet */}
      <VStack
        frame={{ width: 0, height: 0 }}
        sheet={{
          isPresented: showTypography,
          onChanged: setShowTypography,
          content: <NovelTypographySheet onClose={() => setShowTypography(false)} />,
        }}
      />
    </ZStack>
  )
}
