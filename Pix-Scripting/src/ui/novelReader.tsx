import {
  Button,
  Divider,
  Group,
  HStack,
  Image,
  ProgressView,
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
import { imageUrlOf, pageThumbUrlOf, cachedFilePath, loadImage } from "../image/imageLoader"
import { saveImageToPixivAlbum } from "../downloader/photoAlbum"
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
  if (!rawText) return ""
  if (!rawText.includes("[[rb:")) return escapeHtml(rawText)
  const parts = rawText.split(/(\[\[rb:\s*[^>\r\n]+?\s*(?:>|&gt;)\s*[^\]\r\n]+?\s*\]\])/g)
  return parts
    .map((part) => {
      const match = part.match(/^\[\[rb:\s*([^>\r\n]+?)\s*(?:>|&gt;)\s*([^\]\r\n]+?)\s*\]\]$/)
      if (match) {
        return `<ruby>${escapeHtml(match[1].trim())}<rt>${escapeHtml(match[2].trim())}</rt></ruby>`
      }
      return escapeHtml(part)
    })
    .join("")
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

function flushTextBuffer(state: NovelParserState): void {
  if (state.currentBuffer.length === 0) return
  const rawJoined = state.currentBuffer.join("\n")
  // 检查是否全为空白（包括全角/半角空格和换行）
  if (rawJoined.replace(/[\s\r\n\u3000]/g, "").length > 0) {
    // 保留每一行的行首缩进与空格，仅去除 chunk 头尾的多余换行
    const text = rawJoined.replace(/^(?:[\r\n]+)/, "").replace(/(?:[\r\n]+)$/, "")
    if (text.length > 0) {
      state.items.push({
        type: "text",
        id: `chunk-${state.items.length}`,
        text,
      })
    }
  }
  state.currentBuffer = []
  state.currentBufferChars = 0
}

function processLineIntoNovelItems(
  rawLine: string,
  state: NovelParserState,
  textEmbeddedImages?: Record<string, TextEmbeddedImage>
): void {
  const trimmedLine = rawLine.trim()

  // 1. [newpage]
  if (/^\[newpage\]$/i.test(trimmedLine)) {
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
  const chapterMatch = trimmedLine.match(/^\[chapter\s*[:：]\s*(.+?)\]$/i)
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
  const jumpMatch = trimmedLine.match(/^\[jump\s*[:：]\s*(\d+)\]$/i)
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
  if (UP_IMG_INLINE.test(rawLine)) {
    UP_IMG_INLINE.lastIndex = 0
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = UP_IMG_INLINE.exec(rawLine)) != null) {
      const before = rawLine.slice(cursor, match.index)
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
    if (cursor < rawLine.length) {
      const remaining = rawLine.slice(cursor)
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
  if (PX_IMG_INLINE.test(rawLine)) {
    PX_IMG_INLINE.lastIndex = 0
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = PX_IMG_INLINE.exec(rawLine)) != null) {
      const before = rawLine.slice(cursor, match.index)
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
    if (cursor < rawLine.length) {
      const remaining = rawLine.slice(cursor)
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

  // 普通文本行：保留原始缩进和空格
  state.currentBuffer.push(rawLine)
  state.currentBufferChars += rawLine.length + 1

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
    flushTextBuffer(state)
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

/**
 * 文本段落渲染（纯原生 Text 渲染，整页流畅划词选区）
 */
function NovelChunkTextView(props: {
  text: string
  settings: NovelReaderSettings
  palette: NovelThemePalette
}) {
  const { text, settings, palette } = props

  const fontName = resolveFontName(settings.fontId, settings.customFontPostscriptName)
  const lineSpacing = calculateLineSpacing(settings.fontSize, settings.lineSpacingLevel)

  const resolvedFont = useMemo(() => {
    if (fontName) {
      return { name: fontName, size: settings.fontSize }
    }
    return settings.fontSize
  }, [fontName, settings.fontSize])

  // 格式化注音为标准文本 汉字(假名)
  const plainFormattedText = useMemo(() => formatPixivRubyText(text), [text])

  const hasLink = useMemo(() => {
    return text.includes("[[jumpuri:") || containsPotentialLink(text)
  }, [text])

  if (!hasLink) {
    return (
      <Text
        font={resolvedFont}
        fontWeight={settings.fontWeight}
        lineSpacing={lineSpacing}
        foregroundStyle={palette.textColor ?? undefined}
        multilineTextAlignment="leading"
        textSelection={true}
        padding={{ horizontal: 16, vertical: 3 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        {plainFormattedText}
      </Text>
    )
  }

  const styledText = useMemo<StyledText>(() => {
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
  }, [text, resolvedFont, settings.fontWeight, palette.textColor, lineSpacing])

  return (
    <Text
      styledText={styledText}
      multilineTextAlignment="leading"
      textSelection={true}
      padding={{ horizontal: 16, vertical: 3 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    />
  )
}

/**
 * 作者上传的正文插图（带系统级长按菜单与圆角卡片）
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
        padding={{ horizontal: 16, vertical: 8 }}
        alignment="center"
        frame={{ maxWidth: "infinity" }}
      >
        <HStack
          spacing={8}
          padding={{ horizontal: 14, vertical: 10 }}
          glassEffect={{ type: "rect", cornerRadius: 10 }}
          alignment="center"
        >
          <Image systemName="photo" foregroundStyle="secondaryLabel" />
          <Text font="footnote" foregroundStyle="secondaryLabel">
            正文插图 #{imageId}
          </Text>
        </HStack>
      </HStack>
    )
  }

  return (
    <VStack
      spacing={6}
      alignment="center"
      padding={{ horizontal: 16, vertical: 10 }}
      frame={{ maxWidth: "infinity" }}
      contextMenu={
        highResUrl
          ? {
              menuItems: (
                <Group>
                  <Button
                    title="保存至相册"
                    systemImage="square.and.arrow.down"
                    action={() => {
                      void saveImageToPixivAlbum(highResUrl, `novel_img_${imageId}.jpg`)
                    }}
                  />
                  <Button
                    title="复制图片链接"
                    systemImage="link"
                    action={() => {
                      void Pasteboard.setString(highResUrl)
                    }}
                  />
                </Group>
              ),
            }
          : undefined
      }
    >
      <CachedImage
        url={highResUrl}
        previewUrl={previewUrl}
        useIntrinsicAspectRatio={true}
        cornerRadius={10}
        contentMode="fit"
        frame={{ maxWidth: "infinity" }}
      />
    </VStack>
  )
}

/**
 * 正文引用的 Pixiv 插画卡片（带系统级长按菜单与跳转）
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
      <HStack
        spacing={8}
        padding={{ horizontal: 16, vertical: 10 }}
        alignment="center"
        frame={{ maxWidth: "infinity" }}
      >
        <HStack
          spacing={8}
          padding={{ horizontal: 14, vertical: 10 }}
          glassEffect={{ type: "rect", cornerRadius: 10 }}
          alignment="center"
        >
          <ProgressView progressViewStyle="circular" controlSize="small" />
          <Text font="footnote" foregroundStyle="secondaryLabel">
            正在载入 Pixiv 插画 #{illustId}...
          </Text>
        </HStack>
      </HStack>
    )
  }

  if (!illust) {
    return (
      <HStack padding={{ horizontal: 16, vertical: 6 }} frame={{ maxWidth: "infinity" }}>
        <Button
          action={() => requestPixivRoute(`illust:${illustId}`)}
          buttonStyle="plain"
          frame={{ maxWidth: "infinity" }}
        >
          <HStack
            spacing={8}
            padding={{ horizontal: 14, vertical: 10 }}
            glassEffect={{ type: "rect", cornerRadius: 10 }}
            frame={{ maxWidth: "infinity" }}
            alignment="center"
          >
            <Image systemName="photo" foregroundStyle="#007AFF" />
            <Text font="subheadline" foregroundStyle="#007AFF">
              Pixiv 插画 #{illustId}
            </Text>
            <Spacer />
            <Image systemName="chevron.right" font="footnote" foregroundStyle="secondaryLabel" />
          </HStack>
        </Button>
      </HStack>
    )
  }

  const pageIdx = Math.max(0, (page || 1) - 1)
  const highResUrl = imageUrlOf(illust, pageIdx, "large")
  const previewUrl = pageThumbUrlOf(illust, pageIdx)
  const aspect = illust.width && illust.height ? illust.width / illust.height : undefined

  return (
    <VStack
      spacing={8}
      alignment="center"
      padding={{ horizontal: 16, vertical: 10 }}
      frame={{ maxWidth: "infinity" }}
    >
      <Button
        action={() => requestPixivRoute(`illust:${illustId}`)}
        buttonStyle="plain"
        frame={{ maxWidth: "infinity" }}
        contextMenu={
          highResUrl
            ? {
                menuItems: (
                  <Group>
                    <Button
                      title="查看插画详情"
                      systemImage="photo"
                      action={() => requestPixivRoute(`illust:${illustId}`)}
                    />
                    <Button
                      title="保存至相册"
                      systemImage="square.and.arrow.down"
                      action={() => {
                        void saveImageToPixivAlbum(highResUrl, `illust_${illustId}_p${pageIdx}.jpg`)
                      }}
                    />
                    <Button
                      title="复制图片链接"
                      systemImage="link"
                      action={() => {
                        void Pasteboard.setString(highResUrl)
                      }}
                    />
                  </Group>
                ),
              }
            : undefined
        }
      >
        <VStack spacing={8} alignment="center" frame={{ maxWidth: "infinity" }}>
          <CachedImage
            url={highResUrl}
            previewUrl={previewUrl}
            aspectRatioValue={aspect}
            useIntrinsicAspectRatio={true}
            cornerRadius={10}
            contentMode="fit"
            frame={{ maxWidth: "infinity" }}
          />
          <HStack spacing={4} alignment="center">
            <Text font="subheadline" fontWeight="medium" foregroundStyle="#007AFF" lineLimit={1}>
              {illust.title}
            </Text>
            {illust.user?.name ? (
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                · by {illust.user.name}
              </Text>
            ) : null}
            <Image systemName="chevron.right" font="caption2" foregroundStyle="secondaryLabel" />
          </HStack>
        </VStack>
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
        spacing={2}
        alignment="leading"
        padding={{ horizontal: 16, top: 16, bottom: 6 }}
        frame={{ maxWidth: "infinity" }}
      >
        <HStack spacing={6} alignment="center">
          <Text font="caption" fontWeight="bold" foregroundStyle="#007AFF">
            CHAPTER
          </Text>
        </HStack>
        <Text
          font="title3"
          fontWeight="bold"
          foregroundStyle={palette.textColor ?? undefined}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {item.title}
        </Text>
        <Divider />
      </VStack>
    )
  }

  if (item.type === "newpage") {
    const isBookmark = markerPage === item.page
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
          <Image
            systemName={isBookmark ? "book.pages.fill" : "book.pages"}
            font="footnote"
            foregroundStyle={isBookmark ? "#007AFF" : "secondaryLabel"}
          />
          <Text
            font="footnote"
            fontWeight={isBookmark ? "bold" : "regular"}
            foregroundStyle={isBookmark ? "#007AFF" : "secondaryLabel"}
          >
            第 {item.page} 页{isBookmark ? "（书签）" : ""}
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
        spacing={8}
        padding={{ horizontal: 16, vertical: 4 }}
        frame={{ maxWidth: "infinity" }}
      >
        <Button
          action={() => onJumpToPage?.(item.page)}
          buttonStyle="plain"
          frame={{ maxWidth: "infinity" }}
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
 * 计算竖排文库本排版样式与主题 CSS 变量配置
 */
function computeVerticalTypographyConfig(
  settings: NovelReaderSettings,
  palette: NovelThemePalette
) {
  const fontName = resolveFontName(settings.fontId, settings.customFontPostscriptName)
  const fontFamily = fontName
    ? `"${fontName}", "Songti SC", "Hiragino Mincho ProN", "PingFang SC", serif`
    : `"-apple-system", "PingFang SC", "Songti SC", "Hiragino Mincho ProN", serif`

  const fontWeight =
    settings.fontWeight === "bold"
      ? "bold"
      : settings.fontWeight === "medium"
      ? "500"
      : "normal"
  const lineSpacing = calculateLineSpacing(settings.fontSize, settings.lineSpacingLevel)
  const lineHeight = ((settings.fontSize + lineSpacing) / settings.fontSize).toFixed(2)

  let themeConfig: {
    colorScheme?: string
    bgColor?: string
    textColor?: string
    secondaryTextColor?: string
    dividerColor?: string
    accentColor?: string
  } = {}

  let themeCssVars = ""
  let colorSchemeMeta = '<meta name="color-scheme" content="light dark">'

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
    themeConfig = {
      colorScheme: "light dark",
      bgColor: "transparent",
      textColor: "",
      secondaryTextColor: "",
      dividerColor: "",
      accentColor: "",
    }
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
    themeConfig = {
      colorScheme: isDarkMask ? "dark" : "light",
      bgColor: "transparent",
      textColor: isDarkMask ? "#F2F2F7" : "#1C1C1E",
      secondaryTextColor: isDarkMask ? "#A0A0A5" : "#8E8E93",
      dividerColor: isDarkMask ? "rgba(255, 255, 255, 0.2)" : "rgba(128, 128, 128, 0.2)",
      accentColor: isDarkMask ? "#0A84FF" : "#007AFF",
    }
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
    themeConfig = {
      colorScheme: isDark ? "dark" : "light",
      bgColor: bg,
      textColor: text,
      secondaryTextColor: secondaryText,
      dividerColor: divider,
      accentColor: accent,
    }
  }

  return {
    fontFamily,
    fontSize: settings.fontSize,
    fontWeight,
    lineHeight,
    colorSchemeMeta,
    themeCssVars,
    themeConfig,
  }
}

/**
 * 竖向文库本文本排版 HTML 生成器
 */
function buildVerticalHtml(
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
  const typo = computeVerticalTypographyConfig(settings, palette)
  const fontFamilyCss = typo.fontFamily
  const weightCss = typo.fontWeight
  const lineHeight = typo.lineHeight
  const colorSchemeMeta = typo.colorSchemeMeta
  const themeCssVars = typo.themeCssVars

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
        if (p.replace(/[\s\u3000]/g, "").length === 0) {
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
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-color);
    color: var(--text-color);
  }
  .vertical-container {
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
  <div class="vertical-container">
    <div id="novel-start-anchor" style="width: 1px; height: 100%; display: inline-block; visibility: hidden; margin: 0; padding: 0;"></div>
    ${bodyHtmlParts.join("\n")}
  </div>
  <script>
    var targetChunkId = ${safeTargetId};
    var targetPage = ${safeTargetPage};

    window.applyTypography = function(config) {
      if (!config) return;
      var root = document.documentElement;
      var container = document.querySelector(".vertical-container");
      if (config.fontFamily && container) {
        container.style.fontFamily = config.fontFamily;
      }
      if (config.fontSize && container) {
        container.style.fontSize = config.fontSize + "px";
      }
      if (config.fontWeight && container) {
        container.style.fontWeight = config.fontWeight;
      }
      if (config.lineHeight && container) {
        container.style.lineHeight = config.lineHeight;
      }
      if (config.theme) {
        if (config.theme.colorScheme) {
          root.style.colorScheme = config.theme.colorScheme;
        }
        if (config.theme.bgColor !== undefined) {
          root.style.setProperty("--bg-color", config.theme.bgColor);
        }
        if (config.theme.textColor) {
          root.style.setProperty("--text-color", config.theme.textColor);
        } else {
          root.style.removeProperty("--text-color");
        }
        if (config.theme.secondaryTextColor) {
          root.style.setProperty("--secondary-text-color", config.theme.secondaryTextColor);
        } else {
          root.style.removeProperty("--secondary-text-color");
        }
        if (config.theme.dividerColor) {
          root.style.setProperty("--divider-color", config.theme.dividerColor);
        } else {
          root.style.removeProperty("--divider-color");
        }
        if (config.theme.accentColor) {
          root.style.setProperty("--accent-color", config.theme.accentColor);
        } else {
          root.style.removeProperty("--accent-color");
        }
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
    };

    function scrollToNovelStart() {
      var anchor = document.getElementById("novel-start-anchor");
      if (anchor && typeof anchor.scrollIntoView === "function") {
        try {
          anchor.scrollIntoView({ inline: "start", block: "start", behavior: "instant" });
        } catch (e) {
          anchor.scrollIntoView(true);
        }
      }
      var container = document.querySelector(".vertical-container");
      var maxScroll = Math.max(
        container ? container.scrollWidth : 0,
        document.documentElement ? document.documentElement.scrollWidth : 0,
        document.body ? document.body.scrollWidth : 0,
        window.innerWidth || 0,
        1000000
      );
      if (container) container.scrollLeft = maxScroll;
      window.scrollTo(maxScroll, 0);
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

    var vContainer = document.querySelector(".vertical-container");
    if (vContainer) {
      vContainer.addEventListener("scroll", function() {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(reportProgress, 250);
      }, { passive: true });
    }
    window.addEventListener("scroll", function() {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(reportProgress, 250);
    }, { passive: true });
  </script>
</body>
</html>`
}

/**
 * 竖排 Web 渲染引擎组件（文库本直书）
 */
function NovelVerticalReaderView(props: {
  novelId?: number
  chunks: NovelChunkItem[]
  settings: NovelReaderSettings
  palette: NovelThemePalette
  targetChunkId?: string | null
  targetPage?: number
  onProgressChange?: (page: number, chunkId?: string) => void
  onJumpToPage?: (page: number) => void
}) {
  const {
    novelId,
    chunks,
    settings,
    palette,
    targetChunkId,
    targetPage,
    onProgressChange,
    onJumpToPage,
  } = props

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

  const onProgressChangeRef = useRef(onProgressChange)
  onProgressChangeRef.current = onProgressChange
  const onJumpToPageRef = useRef(onJumpToPage)
  onJumpToPageRef.current = onJumpToPage
  const novelIdRef = useRef(novelId)
  novelIdRef.current = novelId

  // 保持稳定的 WebViewController 单例
  const controllerRef = useRef<WebViewController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = new WebViewController()
  }
  const controller = controllerRef.current

  // 初始化设置 message handler 并加载 HTML
  useEffect(() => {
    const ctrl = controllerRef.current
    if (!ctrl) return

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

    void ctrl.addScriptMessageHandler("jumpToPage", (data: any) => {
      const page = typeof data?.page === "number" ? data.page : parseInt(data?.page, 10)
      if (page && !isNaN(page)) {
        onJumpToPageRef.current?.(page)
      }
    }).catch(() => {})

    const html = buildVerticalHtml(
      chunks,
      settings,
      palette,
      targetChunkId,
      targetPage,
      imageCacheRef.current
    )

    void ctrl.loadHTML(html).catch(() => {})

    return () => {
      try {
        ctrl.dispose()
      } catch {
        // ignore dispose error
      }
    }
  }, [novelId, chunks])

  // 实时响应字体、字号、字重、行距与主题变更（0ms 毫秒级即时生效）
  useEffect(() => {
    const ctrl = controllerRef.current
    if (!ctrl) return

    const typo = computeVerticalTypographyConfig(settings, palette)
    const script = `if (window.applyTypography) { window.applyTypography(${JSON.stringify({
      fontFamily: typo.fontFamily,
      fontSize: typo.fontSize,
      fontWeight: typo.fontWeight,
      lineHeight: typo.lineHeight,
      theme: typo.themeConfig,
    })}); }`

    void ctrl.evaluateJavaScript(script).catch(() => {})
  }, [settings, palette])

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

  return (
    <VStack
      key="novel-webview-vertical"
      frame={{ maxWidth: "infinity", height: 620 }}
    >
      <WebView controller={controller} />
    </VStack>
  )
}

/**
 * 小说正文统一渲染引擎组件：
 * 1. 自动响应全局小说版式与主题设置（字体/字号/字重/行距/横竖排/夜间模式）；
 * 2. 横排模式采用原生虚拟节点树，整页一体化滚动，完全杜绝嵌套滚动，支持 0ms 滚动恢复与精准划词；
 * 3. 竖排模式采用文库本排版引擎，支持日文/中文标点悬挂旋转、右对齐注音假名与横向翻阅。
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

  // 竖向排版模式（独立 WebKit 文库本直书引擎，横向翻阅）
  if (settings.layoutDirection === "vertical") {
    if (chunks.length === 0) {
      return (
        <VStack spacing={0} frame={{ maxWidth: "infinity", height: 60 }} alignment="center">
          <Spacer />
          <ProgressView progressViewStyle="circular" />
          <Spacer />
        </VStack>
      )
    }

    const savedProgress = novelId ? getNovelProgress(novelId) : undefined
    const targetChunkId = savedProgress?.chunkId ?? null
    const targetPage = savedProgress?.page ?? currentPage ?? markerPage ?? 1

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
        onJumpToPage={onJumpToPage}
      />
    )
  }

  // 横向排版模式（原生 SwiftUI 节点树，直接融入外层 ScrollView 参与整页连续平滑滚动与 0ms 精确跳转）
  if (pageBlocks.length === 0) {
    return (
      <VStack spacing={0} frame={{ maxWidth: "infinity", height: 60 }} alignment="center">
        <Spacer />
        <ProgressView progressViewStyle="circular" />
        <Spacer />
      </VStack>
    )
  }

  // 仅获取当前页的数据块
  const currentBlock =
    pageBlocks.find((b) => b.page === currentPage) ?? pageBlocks[0]

  return (
    <VStack
      scrollTargetLayout={true}
      alignment="leading"
      spacing={0}
      frame={{ maxWidth: "infinity" }}
    >
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
            <Text font="footnote" fontWeight="bold" foregroundStyle="#007AFF">
              第 1 页（书签）
            </Text>
          </HStack>
          <VStack frame={{ maxWidth: "infinity" }}>
            <Divider />
          </VStack>
        </HStack>
      ) : null}

      {/* 渲染当前页的内容，每个分块挂载精准 key (SwiftUI .id)，直接作为 scrollTargetLayout 的直接子节点，支持 ScrollViewReader 0ms 精确定位与实时进度感知 */}
      {currentBlock.items.map((item) => (
        <VStack
          key={item.id}
          alignment="leading"
          spacing={0}
          frame={{ maxWidth: "infinity" }}
          textSelection={true}
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
    </VStack>
  )
}

export const NovelReaderWebView = NovelReaderView
