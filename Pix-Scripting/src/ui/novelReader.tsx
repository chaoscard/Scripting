import {
  Button,
  Divider,
  Group,
  HStack,
  Image,
  LazyVStack,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  WebView,
  type Color,
  type StyledText,
} from "scripting"
import { requestPixivRoute } from "./routeNavigation"
import { CachedImage, presentExternalURL, routeForDescriptionLink } from "./components"
import { session } from "../api/session"
import { illustrationDetail } from "../api/pixiv"
import { imageUrlOf, pageThumbUrlOf } from "../image/imageLoader"
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

export function parseNovelParagraphSegments(
  rawText: string,
  onNavigate: (url: string) => void
): (string | any)[] {
  const text = formatPixivRubyText(rawText)

  const hasJumpuri = text.includes("[[jumpuri:")
  const hasLink = containsPotentialLink(text)

  if (!hasJumpuri && !hasLink) {
    return [text]
  }

  const jumpuris: { label: string; url: string }[] = []
  const textWithPlaceholders = hasJumpuri
    ? text.replace(
        /\[\[jumpuri:\s*([^\r\n>]+?)\s*(?:>|&gt;)\s*([^\r\n\]]+?)\s*\]\]/g,
        (_, label: string, url: string) => {
          const idx = jumpuris.length
          jumpuris.push({ label: label.trim(), url: url.trim() })
          return `\uE000JUMPURI_${idx}\uE001`
        }
      )
    : text

  const items: (string | any)[] = []
  const jumpParts = hasJumpuri
    ? textWithPlaceholders.split(/(\uE000JUMPURI_\d+\uE001)/g)
    : [textWithPlaceholders]

  for (const part of jumpParts) {
    if (!part) continue
    if (hasJumpuri) {
      const jMatch = part.match(/^\uE000JUMPURI_(\d+)\uE001$/)
      if (jMatch) {
        const jItem = jumpuris[Number(jMatch[1])]
        if (jItem) {
          items.push({
            content: jItem.label,
            foregroundColor: "#007AFF",
            underlineStyle: "single",
            onTapGesture: () => onNavigate(jItem.url),
          })
        }
        continue
      }
    }

    if (!containsPotentialLink(part)) {
      items.push(part)
      continue
    }

    let cursor = 0
    let match: RegExpExecArray | null
    INLINE_LINK_PATTERN.lastIndex = 0

    while ((match = INLINE_LINK_PATTERN.exec(part)) != null) {
      if (match.index > cursor) {
        items.push(part.slice(cursor, match.index))
      }
      const raw = match[0]
      const link = raw.replace(/[),.，。！!？?;；）】》」』、]+$/, "")
      const trailingPunct = raw.slice(link.length)
      if (link) {
        items.push({
          content: link,
          foregroundColor: "#007AFF",
          underlineStyle: "single",
          onTapGesture: () => onNavigate(link),
        })
      }
      if (trailingPunct) {
        items.push(trailingPunct)
      }
      cursor = match.index + raw.length
    }

    if (cursor < part.length) {
      items.push(part.slice(cursor))
    }
  }

  return items
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

function flushTextBuffer(state: NovelParserState) {
  if (state.currentBuffer.length === 0) return
  const combined = state.currentBuffer.join("\n").trim()
  if (combined.length > 0) {
    state.items.push({
      type: "text",
      id: `chunk-${state.items.length}`,
      text: combined,
    })
  }
  state.currentBuffer = []
  state.currentBufferChars = 0
}

function processLineIntoNovelItems(
  line: string,
  state: NovelParserState,
  textEmbeddedImages?: Record<string, TextEmbeddedImage>
) {
  const trimmed = line.trim()

  if (trimmed === "[newpage]") {
    flushTextBuffer(state)
    state.pageIndex += 1
    state.items.push({
      type: "newpage",
      id: `page-${state.pageIndex}`,
      page: state.pageIndex,
    })
    return
  }

  const chapterMatch = trimmed.match(/^\[chapter:\s*(.+?)\]$/)
  if (chapterMatch) {
    flushTextBuffer(state)
    state.chapterIndex += 1
    state.items.push({
      type: "chapter",
      id: `ch-${state.chapterIndex}`,
      title: chapterMatch[1].trim(),
      chapterIndex: state.chapterIndex,
    })
    return
  }

  const jumpMatch = trimmed.match(/^\[jump:(\d+)\]$/)
  if (jumpMatch) {
    flushTextBuffer(state)
    state.items.push({
      type: "jump",
      id: `jump-${state.items.length}`,
      page: parseInt(jumpMatch[1], 10),
    })
    return
  }

  // 4. 行内或整行 [uploadedimage: xxx]
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

  // 5. 行内或整行 [pixivimage: xxx]
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

/**
 * 文本段落渲染（支持多段落连续精准选词、振假名、自定义字体、字重、字号与主题配色）
 */
function NovelChunkTextView(props: {
  text: string
  settings: NovelReaderSettings
  palette: NovelThemePalette
}) {
  const { text, settings, palette } = props
  const hasSpecial = useMemo(() => {
    return text.includes("[[rb:") || text.includes("[[jumpuri:") || containsPotentialLink(text)
  }, [text])

  const fontName = resolveFontName(settings.fontId, settings.customFontPostscriptName)
  const lineSpacing = calculateLineSpacing(settings.fontSize, settings.lineSpacingLevel)

  const resolvedFont = useMemo(() => {
    if (fontName) {
      return { name: fontName, size: settings.fontSize }
    }
    return settings.fontSize
  }, [fontName, settings.fontSize])

  const styledText = useMemo<StyledText | null>(() => {
    if (!hasSpecial) return null
    const items = parseNovelParagraphSegments(text, (rawUrl) => {
      const target = routeForDescriptionLink(rawUrl) ?? rawUrl
      if (target.startsWith("http://") || target.startsWith("https://")) {
        void presentExternalURL(target)
      } else {
        requestPixivRoute(target)
      }
    })

    return {
      font: resolvedFont,
      fontWeight: settings.fontWeight,
      foregroundColor: palette.textColor ?? undefined,
      paragraphStyle: {
        alignment: "left",
        lineBreakMode: "byCharWrapping",
        lineSpacing,
      },
      content: items,
    }
  }, [text, hasSpecial, resolvedFont, settings.fontWeight, palette.textColor, lineSpacing])

  if (!hasSpecial || !styledText) {
    return (
      <Text
        font={resolvedFont}
        fontWeight={settings.fontWeight}
        lineSpacing={lineSpacing}
        foregroundStyle={palette.textColor ?? undefined}
        multilineTextAlignment="leading"
        padding={{ horizontal: 16, vertical: 3 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        {text}
      </Text>
    )
  }

  return (
    <Text
      styledText={styledText}
      multilineTextAlignment="leading"
      padding={{ horizontal: 16, vertical: 3 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    />
  )
}

/**
 * 作者上传的正文插图
 */
function NovelUploadedImageItemView(props: {
  imageId: string
  imageInfo?: TextEmbeddedImage
}) {
  const { imageId, imageInfo } = props

  const highResUrl =
    imageInfo?.urls?.["1200x1200"] ||
    imageInfo?.urls?.original ||
    imageInfo?.urls?.["480mw"] ||
    (imageInfo as any)?.urls?.large ||
    (imageInfo as any)?.urls?.medium ||
    (imageInfo as any)?.url ||
    null

  const previewUrl =
    imageInfo?.urls?.["240mw"] ||
    imageInfo?.urls?.["128x128"] ||
    (imageInfo as any)?.urls?.small ||
    (imageInfo as any)?.urls?.thumb ||
    (imageInfo as any)?.previewUrl ||
    null

  if (!highResUrl && !previewUrl) {
    return (
      <HStack
        spacing={8}
        padding={{ horizontal: 16, vertical: 4 }}
        frame={{ maxWidth: "infinity" }}
      >
        <HStack
          spacing={8}
          padding={10}
          glassEffect={{ type: "rect", cornerRadius: 8 }}
          frame={{ maxWidth: "infinity" }}
        >
          <Image systemName="photo" foregroundStyle="secondaryLabel" />
          <Text font="footnote" foregroundStyle="secondaryLabel">
            [正文插图 #{imageId}]
          </Text>
        </HStack>
      </HStack>
    )
  }

  return (
    <VStack padding={{ horizontal: 16, vertical: 6 }} frame={{ maxWidth: "infinity" }}>
      <CachedImage
        url={highResUrl}
        previewUrl={previewUrl}
        useIntrinsicAspectRatio={true}
        cornerRadius={8}
        contentMode="fit"
        frame={{ maxWidth: "infinity" }}
      />
    </VStack>
  )
}

/**
 * 正文引用的 Pixiv 插画卡片
 */
function NovelPixivImageItemView(props: {
  illustId: number
  page?: number
}) {
  const { illustId, page = 0 } = props
  const [illust, setIllust] = useState<PixivIllustration | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    session
      .call((token) => illustrationDetail(illustId, token))
      .then((detail: PixivIllustration) => {
        if (active) {
          setIllust(detail)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [illustId])

  if (loading) {
    return (
      <HStack spacing={0} frame={{ maxWidth: "infinity", height: 80 }}>
        <Spacer />
        <ProgressView progressViewStyle="circular" />
        <Spacer />
      </HStack>
    )
  }

  if (!illust) {
    return (
      <Button
        action={() => requestPixivRoute(`illust:${illustId}`)}
        buttonStyle="plain"
        frame={{ maxWidth: "infinity" }}
        padding={{ horizontal: 16, vertical: 4 }}
      >
        <HStack
          spacing={8}
          padding={12}
          glassEffect={{ type: "rect", cornerRadius: 10 }}
          frame={{ maxWidth: "infinity" }}
        >
          <Image systemName="photo" foregroundStyle="#007AFF" />
          <Text font="subheadline" foregroundStyle="#007AFF">
            Pixiv 插画 #{illustId}
          </Text>
          <Spacer />
          <Image systemName="chevron.right" font="footnote" foregroundStyle="secondaryLabel" />
        </HStack>
      </Button>
    )
  }

  const pageIdx = Math.max(0, (page || 1) - 1)
  const highResUrl = imageUrlOf(illust, pageIdx, "large")
  const previewUrl = pageThumbUrlOf(illust, pageIdx)
  const aspect = illust.width && illust.height ? illust.width / illust.height : undefined

  return (
    <VStack spacing={2} alignment="center" padding={{ horizontal: 16, vertical: 6 }} frame={{ maxWidth: "infinity" }}>
      <Button
        action={() => requestPixivRoute(`illust:${illustId}`)}
        buttonStyle="plain"
        frame={{ maxWidth: "infinity" }}
      >
        <CachedImage
          url={highResUrl}
          previewUrl={previewUrl}
          aspectRatioValue={aspect}
          useIntrinsicAspectRatio={true}
          cornerRadius={8}
          contentMode="fit"
          frame={{ maxWidth: "infinity" }}
        />
      </Button>
      <Button
        action={() => requestPixivRoute(`illust:${illustId}`)}
        buttonStyle="plain"
        padding={{ top: 2, bottom: 2 }}
      >
        <HStack spacing={4} alignment="center">
          <Text font="caption" foregroundStyle="#007AFF" lineLimit={1}>
            {illust.title}
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            · by {illust.user?.name}
          </Text>
          <Image systemName="chevron.right" font="caption2" foregroundStyle="secondaryLabel" />
        </HStack>
      </Button>
    </VStack>
  )
}

function NovelChunkRenderer(props: {
  item: NovelChunkItem
  markerPage?: number | null
  settings: NovelReaderSettings
  palette: NovelThemePalette
  onJumpToPage?: (page: number) => void
}) {
  const { item, markerPage, settings, palette, onJumpToPage } = props

  if (item.type === "text") {
    return <NovelChunkTextView text={item.text} settings={settings} palette={palette} />
  }

  if (item.type === "chapter") {
    return (
      <VStack
        alignment="leading"
        spacing={4}
        padding={{ horizontal: 16, top: 20, bottom: 6 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <Text font="caption2" fontWeight="bold" foregroundStyle="#007AFF">
          CHAPTER
        </Text>
        <Text
          font={settings.fontSize + 4}
          fontWeight="bold"
          foregroundStyle={palette.textColor ?? undefined}
        >
          {item.title}
        </Text>
        <Divider />
      </VStack>
    )
  }

  if (item.type === "newpage") {
    const isMarked = markerPage === item.page
    return (
      <HStack
        spacing={12}
        padding={{ horizontal: 16, vertical: 14 }}
        alignment="center"
        frame={{ maxWidth: "infinity" }}
      >
        <VStack frame={{ maxWidth: "infinity" }}>
          <Divider />
        </VStack>
        <HStack spacing={4} alignment="center">
          {isMarked ? (
            <Image systemName="book.pages.fill" font="footnote" foregroundStyle="#007AFF" />
          ) : null}
          <Text
            font="footnote"
            fontWeight={isMarked ? "bold" : "semibold"}
            foregroundStyle={isMarked ? "#007AFF" : (palette.secondaryTextColor ?? "secondaryLabel")}
          >
            第 {item.page} 页{isMarked ? "（书签）" : ""}
          </Text>
        </HStack>
        <VStack frame={{ maxWidth: "infinity" }}>
          <Divider />
        </VStack>
      </HStack>
    )
  }

  if (item.type === "jump") {
    return (
      <HStack
        padding={{ horizontal: 16, vertical: 4 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <Button
          action={() => onJumpToPage?.(item.page)}
          buttonStyle="plain"
        >
          <HStack
            spacing={6}
            padding={{ horizontal: 10, vertical: 6 }}
            glassEffect={{ type: "rect", cornerRadius: 8 }}
          >
            <Text font="subheadline" foregroundStyle="#007AFF">
              📄 跳转至第 {item.page} 页
            </Text>
            <Image systemName="chevron.right" font="caption2" foregroundStyle="#007AFF" />
          </HStack>
        </Button>
      </HStack>
    )
  }

  if (item.type === "uploadedimage") {
    return <NovelUploadedImageItemView imageId={item.imageId} imageInfo={item.info} />
  }

  if (item.type === "pixivimage") {
    return <NovelPixivImageItemView illustId={item.illustId} page={item.page} />
  }

  return null
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

/**
 * 竖向文库本文本排版 HTML 生成器
 */
function buildVerticalHtml(
  chunks: NovelChunkItem[],
  settings: NovelReaderSettings,
  palette: NovelThemePalette,
  targetChunkId?: string | null,
  targetPage?: number | null
): string {
  const fontName = resolveFontName(settings.fontId, settings.customFontPostscriptName)
  const fontFamilyCss = fontName
    ? `"${fontName}", "Songti SC", "Hiragino Mincho ProN", "PingFang SC", serif`
    : `"-apple-system", "PingFang SC", "Songti SC", "Hiragino Mincho ProN", serif`

  const weightCss = settings.fontWeight === "bold" ? "bold" : settings.fontWeight === "medium" ? "500" : "normal"
  const bgCss = palette.backgroundColor ?? "transparent"
  const textCss = palette.textColor ?? "#1C1C1E"
  const secondaryTextCss = palette.secondaryTextColor ?? "#8E8E93"
  const dividerCss = palette.dividerColor ?? "rgba(128,128,128,0.2)"
  const lineSpacing = calculateLineSpacing(settings.fontSize, settings.lineSpacingLevel)
  const lineHeight = ((settings.fontSize + lineSpacing) / settings.fontSize).toFixed(2)

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
      const url =
        chunk.info?.urls?.["1200x1200"] ||
        chunk.info?.urls?.original ||
        chunk.info?.urls?.["480mw"] ||
        null
      if (url) {
        bodyHtmlParts.push(
          `<div id="${chunk.id}" class="illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}"><img class="novel-img" src="${escapeHtml(url)}" /></div>`
        )
      }
    } else if (chunk.type === "pixivimage") {
      bodyHtmlParts.push(
        `<div id="${chunk.id}" class="illust-block" data-page="${currentPage}" data-chunk-id="${chunk.id}"><span class="page-badge">Pixiv 插画 #${chunk.illustId}</span></div>`
      )
    } else if (chunk.type === "jump") {
      bodyHtmlParts.push(
        `<div id="${chunk.id}" class="page-divider" data-page="${currentPage}" data-chunk-id="${chunk.id}"><span class="page-badge">跳转至第 ${chunk.page} 页</span></div>`
      )
    } else if (chunk.type === "text") {
      const paragraphs = chunk.text.split("\n")
      const pParts: string[] = []
      for (const p of paragraphs) {
        const trimmed = p.trim()
        if (trimmed.length === 0) {
          pParts.push('<div class="empty-line"></div>')
        } else {
          pParts.push(`<p class="paragraph">${formatPixivRubyToHtml(p)}</p>`)
        }
      }
      bodyHtmlParts.push(
        `<div id="${chunk.id}" class="text-chunk-block" data-page="${currentPage}" data-chunk-id="${chunk.id}">${pParts.join("\n")}</div>`
      )
    }
  }

  const safeTargetId = JSON.stringify(targetChunkId || null)
  const safeTargetPage = JSON.stringify(typeof targetPage === "number" ? targetPage : null)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  * { box-sizing: border-box; -webkit-touch-callout: default; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: ${bgCss};
    color: ${textCss};
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
  }
  .vertical-container {
    height: 100%;
    min-height: 100%;
    padding: 24px 20px;
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
    border-left: 2px solid ${dividerCss};
    padding-left: 12px;
  }
  .chapter-tag {
    font-size: 0.7em;
    font-weight: bold;
    color: #007AFF;
    margin-bottom: 4px;
  }
  .chapter-title {
    margin: 0;
    font-size: 1.25em;
    font-weight: bold;
    color: ${textCss};
  }
  .page-divider {
    margin: 0 20px;
    padding: 0 8px;
    border-left: 1px dashed ${dividerCss};
    display: flex;
    align-items: center;
  }
  .page-badge {
    font-size: 0.75em;
    color: ${secondaryTextCss};
    padding: 4px 8px;
  }
  .illust-block {
    margin: 0 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .novel-img {
    max-height: 80vh;
    max-width: 80vw;
    border-radius: 8px;
    object-fit: contain;
  }
  ruby rt {
    font-size: 0.55em;
    color: ${secondaryTextCss};
  }
  a {
    color: #007AFF;
    text-decoration: underline;
  }
</style>
</head>
<body>
  <div class="vertical-container">
    <div id="novel-start-anchor" style="width: 1px; height: 100%; display: inline-block; visibility: hidden; margin: 0; padding: 0;"></div>
    ${bodyHtmlParts.join("\n")}
  </div>
  <script>
    var targetChunkId = ${safeTargetId};
    var targetPage = ${safeTargetPage};

    function scrollToNovelStart() {
      var anchor = document.getElementById("novel-start-anchor");
      if (anchor && typeof anchor.scrollIntoView === "function") {
        try {
          anchor.scrollIntoView({ inline: "start", block: "start", behavior: "instant" });
        } catch (e) {
          anchor.scrollIntoView(true);
        }
      }
      var maxScroll = Math.max(
        document.documentElement ? document.documentElement.scrollWidth : 0,
        document.body ? document.body.scrollWidth : 0,
        window.innerWidth || 0,
        1000000
      );
      window.scrollTo(maxScroll, 0);
      if (document.documentElement) document.documentElement.scrollLeft = maxScroll;
      if (document.body) document.body.scrollLeft = maxScroll;
    }

    function restoreProgress() {
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

    window.addEventListener("scroll", function() {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(reportProgress, 300);
    }, { passive: true });
  </script>
</body>
</html>`
}

/**
 * 竖排 Web 渲染引擎组件
 */
function NovelVerticalReaderView(props: {
  novelId?: number
  chunks: NovelChunkItem[]
  settings: NovelReaderSettings
  palette: NovelThemePalette
  targetChunkId?: string | null
  targetPage?: number
  onProgressChange?: (page: number, chunkId?: string) => void
}) {
  const {
    novelId,
    chunks,
    settings,
    palette,
    targetChunkId,
    targetPage,
    onProgressChange,
  } = props

  const html = useMemo(() => {
    return buildVerticalHtml(chunks, settings, palette, targetChunkId, targetPage)
  }, [chunks, settings, palette, targetChunkId, targetPage])

  const onProgressChangeRef = useRef(onProgressChange)
  onProgressChangeRef.current = onProgressChange
  const novelIdRef = useRef(novelId)
  novelIdRef.current = novelId

  const controller = useMemo(() => {
    const ctrl = new WebViewController()
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

  return (
    <VStack frame={{ maxWidth: "infinity", height: 600 }}>
      <WebView controller={controller} />
    </VStack>
  )
}

/**
 * 小说正文统一渲染引擎组件：
 * 1. 自动响应全局小说版式与主题设置（字体/字号/字重/行距/横竖排/壁纸）；
 * 2. 横排模式采用 0ms 瞬间上屏、120fps 满帧原生分页分块；
 * 3. 竖排模式采用文库本排版引擎，完美支持日文/中文标点悬挂旋转与注音。
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
  } = props

  const [settings, setSettings] = useState<NovelReaderSettings>(() => loadNovelReaderSettings())

  useEffect(() => {
    return onNovelReaderSettingsChanged((updated) => {
      setSettings(updated)
    })
  }, [])

  const palette = useMemo(() => {
    return NOVEL_THEME_PALETTES[settings.themeId] || NOVEL_THEME_PALETTES.default
  }, [settings.themeId])

  // 同步初始化分块（横排模式）
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

  // 竖向排版模式
  if (settings.layoutDirection === "vertical") {
    if (chunks.length === 0) {
      return (
        <HStack spacing={0} frame={{ maxWidth: "infinity", height: 60 }}>
          <Spacer />
          <ProgressView progressViewStyle="circular" />
          <Spacer />
        </HStack>
      )
    }

    const savedProgress = novelId ? getNovelProgress(novelId) : undefined
    const targetChunkId = savedProgress?.chunkId ?? null
    const targetPage = savedProgress?.page ?? currentPage ?? 1

    return (
      <NovelVerticalReaderView
        novelId={novelId}
        chunks={chunks}
        settings={settings}
        palette={palette}
        targetChunkId={targetChunkId}
        targetPage={targetPage}
        onProgressChange={(page, chunkId) => {
          if (chunkId) onChunkVisible?.(chunkId)
        }}
      />
    )
  }

  // 横向排版模式
  if (pageBlocks.length === 0) {
    return (
      <HStack spacing={0} frame={{ maxWidth: "infinity", height: 60 }}>
        <Spacer />
        <ProgressView progressViewStyle="circular" />
        <Spacer />
      </HStack>
    )
  }

  // 仅获取当前页的数据块
  const currentBlock = pageBlocks.find((b) => b.page === currentPage) ?? pageBlocks[0]

  return (
    <Group>
      {/* 顶部锚点 */}
      <VStack key="novel-top-anchor" frame={{ height: 0 }} />

      {/* 第一页且第一页是书签时显示书签提示 */}
      {currentBlock.page === 1 && markerPage === 1 ? (
        <HStack
          key="novel-marker-top-hint"
          spacing={12}
          padding={{ horizontal: 16, vertical: 14 }}
          alignment="center"
          frame={{ maxWidth: "infinity" }}
        >
          <VStack frame={{ maxWidth: "infinity" }}>
            <Divider />
          </VStack>
          <HStack spacing={4} alignment="center">
            <Image systemName="book.pages.fill" font="footnote" foregroundStyle="#007AFF" />
            <Text
              font="footnote"
              fontWeight="bold"
              foregroundStyle="#007AFF"
            >
              第 1 页（书签）
            </Text>
          </HStack>
          <VStack frame={{ maxWidth: "infinity" }}>
            <Divider />
          </VStack>
        </HStack>
      ) : null}

      {/* 渲染当前页的内容 */}
      {currentBlock.items.map((item) => (
        <VStack
          key={item.id}
          alignment="leading"
          spacing={0}
          frame={{ maxWidth: "infinity" }}
        >
          <NovelChunkRenderer
            item={item}
            markerPage={markerPage}
            settings={settings}
            palette={palette}
            onJumpToPage={onJumpToPage}
          />
        </VStack>
      ))}
    </Group>
  )
}

export const NovelReaderWebView = NovelReaderView
