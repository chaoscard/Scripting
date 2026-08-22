import {
  Button,
  Divider,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  WebView,
} from "scripting"
import { requestPixivRoute } from "./routeNavigation"
import { CachedImage, presentExternalURL, routeForDescriptionLink } from "./components"
import { session } from "../api/session"
import { illustrationDetail } from "../api/pixiv"
import { imageUrlOf, pageThumbUrlOf } from "../image/imageLoader"
import type { PixivIllustration, TextEmbeddedImage } from "../types"

export function escapeHtml(text: string): string {
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
  return rawText.replace(
    /\[\[rb:\s*([^\r\n>]+?)\s*(?:>|&gt;)\s*([^\r\n\]]+?)\s*\]\]/g,
    (_, kanji: string, ruby: string) => `${kanji.trim()}(${ruby.trim()})`
  )
}

/**
 * 将 Pixiv 小说正文标记转换为标准语义化 HTML5。
 * 支持：
 * - [[rb: 汉字 > 假名]] / [[rb:汉字>假名]] -> 振假名 / 注音
 * - [chapter: 章节名称] -> 章节标题
 * - [newpage] -> 分页换页标线
 * - [jump: 页码] -> 页码跳转按钮
 * - [[jumpuri: 标题 > 链接]] -> 站内外跳转链接
 * - [pixivimage: 12345(-1)] -> 站内插画卡片
 * - [uploadedimage: 12345] -> 上传插图占位
 */
export function parsePixivNovelToHtml(rawText: string): string {
  if (!rawText) return ""

  // 1. 转义 HTML 基础字符防 XSS 与字符冲突
  let escaped = escapeHtml(rawText)

  // 2. 状态计数
  let pageIndex = 1
  let chapterIndex = 0

  // 3. 解析振假名 / 注音：[[rb: 汉字 > 假名]]
  escaped = escaped.replace(
    /\[\[rb:\s*([^\r\n>]+?)\s*(?:>|&gt;)\s*([^\r\n\]]+?)\s*\]\]/g,
    (_, kanji: string, ruby: string) => {
      return `<ruby class="novel-ruby">${kanji.trim()}<rp>(</rp><rt>${ruby.trim()}</rt><rp>)</rp></ruby>`
    }
  )

  // 4. 解析跳转链接：[[jumpuri: 标题 > 链接]]
  escaped = escaped.replace(
    /\[\[jumpuri:\s*([^\r\n>]+?)\s*(?:>|&gt;)\s*([^\r\n\]]+?)\s*\]\]/g,
    (_, label: string, url: string) => {
      const cleanUrl = url.trim().replace(/"/g, "&quot;")
      return `<a class="novel-link" href="javascript:void(0)" onclick="handleAction({type:'openLink',url:'${cleanUrl}'})">${label.trim()}</a>`
    }
  )

  // 5. 解析章节：[chapter: 章节名称]
  escaped = escaped.replace(
    /\[chapter:\s*([^\r\n\]]+?)\s*\]/g,
    (_, title: string) => {
      chapterIndex++
      return `\n<div class="novel-chapter-block" id="chapter-${chapterIndex}"><div class="novel-chapter-badge">Chapter ${chapterIndex}</div><h2 class="novel-chapter-title">${title.trim()}</h2></div>\n`
    }
  )

  // 6. 解析分页：[newpage]
  escaped = escaped.replace(
    /\[newpage\]/g,
    () => {
      pageIndex++
      return `\n<div class="novel-newpage" id="page-${pageIndex}"><div class="novel-newpage-line"></div><div class="novel-newpage-badge">第 ${pageIndex} 页</div><div class="novel-newpage-line"></div></div>\n`
    }
  )

  // 7. 解析页码跳转：[jump: 页码]
  escaped = escaped.replace(
    /\[jump:\s*(\d+)\s*\]/g,
    (_, targetPage: string) => {
      return `<button class="novel-jump-btn" onclick="handleAction({type:'jumpPage',page:${targetPage}})">📄 跳转至第 ${targetPage} 页</button>`
    }
  )

  // 8. 解析站内插画：[pixivimage: 12345(-1)]
  escaped = escaped.replace(
    /\[pixivimage:\s*(\d+)(?:-(\d+))?\s*\]/g,
    (_, illustId: string, pageNum?: string) => {
      const pageText = pageNum ? ` · P${pageNum}` : ""
      return `\n<div class="novel-illust-card" onclick="handleAction({type:'openIllust',id:'${illustId}'})"><span class="novel-illust-icon">🎨</span><div class="novel-illust-info"><div class="novel-illust-title">Pixiv 插画 #${illustId}${pageText}</div><div class="novel-illust-hint">点击查看插画作品 →</div></div></div>\n`
    }
  )

  // 9. 解析上传插图：[uploadedimage: 12345]
  escaped = escaped.replace(
    /\[uploadedimage:\s*(\d+)\s*\]/g,
    (_, imageId: string) => {
      return `\n<div class="novel-uploaded-card"><span class="novel-uploaded-icon">🖼️</span><span>[正文插图 #${imageId}]</span></div>\n`
    }
  )

  // 10. 段落换行拆分与清洗
  const rawLines = escaped.split(/\r?\n/)
  const htmlLines: string[] = []

  for (const line of rawLines) {
    const trimmed = line.trim()
    if (!trimmed) {
      htmlLines.push(`<p class="novel-blank-p">&nbsp;</p>`)
    } else if (
      trimmed.startsWith("<div") ||
      trimmed.startsWith("<h2") ||
      trimmed.startsWith("<button")
    ) {
      htmlLines.push(trimmed)
    } else {
      htmlLines.push(`<p class="novel-p">${trimmed}</p>`)
    }
  }

  // 清除文本块首尾的多余空白段落，防止与相邻插图产生叠加留白
  while (htmlLines.length > 0 && htmlLines[0] === `<p class="novel-blank-p">&nbsp;</p>`) {
    htmlLines.shift()
  }
  while (htmlLines.length > 0 && htmlLines[htmlLines.length - 1] === `<p class="novel-blank-p">&nbsp;</p>`) {
    htmlLines.pop()
  }

  return htmlLines.join("\n")
}

/**
 * 组装完整且自适应系统的阅读器 HTML 文档
 */
export function buildNovelHtmlDocument(parsedContentHtml: string, title?: string): string {
  const safeTitle = escapeHtml(title || "Pixiv Novel")

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${safeTitle}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    :root {
      --text-color: #1C1C1E;
      --text-secondary: #8E8E93;
      --card-bg: rgba(0, 0, 0, 0.04);
      --card-border: rgba(0, 0, 0, 0.08);
      --link-color: #007AFF;
      --chapter-title-color: #000000;
      --badge-bg: rgba(0, 122, 255, 0.12);
      --badge-text: #007AFF;
      --line-color: rgba(0, 0, 0, 0.08);
      --selection-bg: rgba(0, 122, 255, 0.28);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --text-color: #EBEBF5;
        --text-secondary: #8E8E93;
        --card-bg: rgba(255, 255, 255, 0.08);
        --card-border: rgba(255, 255, 255, 0.12);
        --link-color: #0A84FF;
        --chapter-title-color: #FFFFFF;
        --badge-bg: rgba(10, 132, 255, 0.2);
        --badge-text: #0A84FF;
        --line-color: rgba(255, 255, 255, 0.12);
        --selection-bg: rgba(10, 132, 255, 0.38);
      }
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      background-color: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Microsoft YaHei", sans-serif;
      -webkit-text-size-adjust: 100%;
      -webkit-user-select: text;
      user-select: text;
      -webkit-touch-callout: default;
      overflow-x: hidden;
      overflow-y: hidden;
    }
    ::selection {
      background: var(--selection-bg);
    }
    .novel-container {
      padding: 0 14px 4px 14px;
      color: var(--text-color);
      font-size: 16.5px;
      line-height: 1.85;
      letter-spacing: 0.02em;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .novel-p {
      margin: 0;
      padding: 0.35em 0;
      text-align: justify;
      line-height: 1.85;
    }
    .novel-blank-p {
      margin: 0;
      height: 1.2em;
    }
    .novel-ruby {
      ruby-position: over;
      -webkit-ruby-position: before;
    }
    .novel-ruby rt {
      font-size: 0.58em;
      color: var(--text-secondary);
      user-select: none;
      -webkit-user-select: none;
    }
    .novel-link {
      color: var(--link-color);
      text-decoration: underline;
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .novel-chapter-block {
      margin: 28px 0 16px 0;
      padding-bottom: 8px;
      border-bottom: 1.5px solid var(--line-color);
    }
    .novel-chapter-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--badge-text);
      background: var(--badge-bg);
      padding: 2px 7px;
      border-radius: 5px;
      margin-bottom: 6px;
    }
    .novel-chapter-title {
      font-size: 19px;
      font-weight: 700;
      color: var(--chapter-title-color);
      line-height: 1.4;
    }
    .novel-newpage {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 32px 0;
      gap: 12px;
    }
    .novel-newpage-line {
      flex: 1;
      height: 1px;
      background: var(--line-color);
    }
    .novel-newpage-badge {
      font-size: 12px;
      color: var(--text-secondary);
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      padding: 3px 10px;
      border-radius: 10px;
    }
    .novel-jump-btn {
      display: inline-flex;
      align-items: center;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--link-color);
      font-size: 13.5px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 8px;
      margin: 8px 0;
      cursor: pointer;
    }
    .novel-illust-card {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 10px 12px;
      margin: 14px 0;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }
    .novel-illust-icon {
      font-size: 22px;
    }
    .novel-illust-info {
      flex: 1;
      min-width: 0;
    }
    .novel-illust-title {
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .novel-illust-hint {
      font-size: 11.5px;
      color: var(--link-color);
      margin-top: 2px;
    }
    .novel-uploaded-card {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 5px 10px;
      margin: 6px 0;
      font-size: 12.5px;
      color: var(--text-secondary);
      user-select: none;
      -webkit-user-select: none;
    }
  </style>
</head>
<body>
  <div class="novel-container" id="novel-root">
    ${parsedContentHtml}
  </div>

  <script>
    function handleAction(payload) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.novelAction) {
        window.webkit.messageHandlers.novelAction.postMessage(payload);
      }
    }

    function reportHeight() {
      var root = document.getElementById("novel-root");
      var height = 0;
      if (root) {
        height = Math.ceil(root.getBoundingClientRect().height);
      }
      if (!height || height < 10) {
        height = Math.ceil(document.body.scrollHeight || document.documentElement.scrollHeight || 0);
      }
      handleAction({ type: "resize", height: height });
    }

    window.addEventListener("load", function() {
      reportHeight();
      setTimeout(reportHeight, 80);
      setTimeout(reportHeight, 250);
      setTimeout(reportHeight, 600);
    });

    if (typeof ResizeObserver !== "undefined") {
      var ro = new ResizeObserver(function() {
        reportHeight();
      });
      var root = document.getElementById("novel-root") || document.body;
      ro.observe(root);
    }

    function scrollToPage(pageIndex) {
      var el = document.getElementById("page-" + pageIndex);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  </script>
</body>
</html>`
}

/**
 * 小说正文专用内嵌式 WebView 组件（纯文本小说全量排版）
 */
export function NovelReaderWebView(props: {
  text: string
  title?: string
  onReady?: () => void
}) {
  const { text, title, onReady } = props
  const controller = useMemo(() => new WebViewController({ ephemeral: true }), [])
  const [contentHeight, setContentHeight] = useState<number>(() => {
    return Math.max(60, Math.ceil((text.length || 200) * 0.9))
  })
  const isMountedRef = useRef(true)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    isMountedRef.current = true
    let active = true

    const setup = async () => {
      try {
        await controller.addScriptMessageHandler("novelAction", (payload: any) => {
          if (!active || !isMountedRef.current) return
          if (payload?.type === "resize" && typeof payload.height === "number") {
            const nextHeight = Math.max(20, Math.ceil(payload.height))
            setContentHeight((prev) => {
              if (Math.abs(prev - nextHeight) > 2) {
                return nextHeight
              }
              return prev
            })
            onReadyRef.current?.()
          } else if (payload?.type === "openIllust" && payload.id) {
            requestPixivRoute(`illust:${payload.id}`)
          } else if (payload?.type === "openLink" && payload.url) {
            const pixivRoute = routeForDescriptionLink(payload.url)
            if (pixivRoute) {
              requestPixivRoute(pixivRoute)
            } else {
              void presentExternalURL(payload.url)
            }
          } else if (payload?.type === "jumpPage" && payload.page) {
            void controller.evaluateJavaScript(`scrollToPage(${Number(payload.page)})`)
          }
        })

        const parsedHtml = parsePixivNovelToHtml(text)
        const documentHtml = buildNovelHtmlDocument(parsedHtml, title)
        await controller.loadHTML(documentHtml, "https://www.pixiv.net")
      } catch {
        // ignore
      }
    }

    void setup()

    return () => {
      active = false
      isMountedRef.current = false
      controller.dispose()
    }
  }, [controller, text, title])

  return (
    <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
      <WebView
        controller={controller}
        frame={{
          maxWidth: "infinity",
          height: contentHeight,
        }}
      />
    </VStack>
  )
}

export interface NativeTextBlock {
  type: "paragraph" | "chapter" | "newpage" | "jump"
  text?: string
  title?: string
  page?: number
}

/**
 * 将连续文本块解析为结构化的原子段落与标记列表
 */
export function parseNativeTextBlocks(rawText: string): NativeTextBlock[] {
  if (!rawText) return []
  const lines = rawText.split(/\r?\n/)
  const blocks: NativeTextBlock[] = []
  let currentParagraphLines: string[] = []

  const flushParagraph = () => {
    if (currentParagraphLines.length > 0) {
      const pText = currentParagraphLines.join("\n").trim()
      if (pText.length > 0) {
        blocks.push({ type: "paragraph", text: pText })
      }
      currentParagraphLines = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    if (!trimmed) {
      flushParagraph()
      continue
    }

    const chapterMatch = trimmed.match(/^\[chapter:\s*([^\]]+)\]$/i)
    if (chapterMatch) {
      flushParagraph()
      blocks.push({ type: "chapter", title: chapterMatch[1].trim() })
      continue
    }

    if (/^\[newpage\]$/i.test(trimmed)) {
      flushParagraph()
      blocks.push({ type: "newpage" })
      continue
    }

    const jumpMatch = trimmed.match(/^\[jump:\s*(\d+)\]$/i)
    if (jumpMatch) {
      flushParagraph()
      blocks.push({ type: "jump", page: Number(jumpMatch[1]) })
      continue
    }

    currentParagraphLines.push(rawLine)
  }

  flushParagraph()
  return blocks
}

/**
 * 图文混排小说中的原生文本段落渲染组件（零延迟、零跳变、支持全局精准选词）
 */
export function NovelNativeTextSegment(props: {
  text: string
}) {
  const { text } = props
  const blocks = useMemo(() => parseNativeTextBlocks(text), [text])

  if (blocks.length === 0) return null

  return (
    <VStack
      alignment="leading"
      spacing={12}
      padding={{ horizontal: 14, vertical: 6 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      {blocks.map((block, idx) => {
        if (block.type === "paragraph" && block.text) {
          const cleanText = formatPixivRubyText(block.text)
          return (
            <Text
              key={`p-${idx}`}
              font="body"
              lineSpacing={6}
              textSelection={true}
              multilineTextAlignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {cleanText}
            </Text>
          )
        }

        if (block.type === "chapter" && block.title) {
          return (
            <VStack
              key={`ch-${idx}`}
              alignment="leading"
              spacing={4}
              padding={{ top: 16, bottom: 4 }}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              <Text font="caption2" fontWeight="bold" foregroundStyle="#007AFF">
                CHAPTER
              </Text>
              <Text font="title3" fontWeight="bold">
                {block.title}
              </Text>
              <Divider />
            </VStack>
          )
        }

        if (block.type === "newpage") {
          return (
            <HStack
              key={`page-${idx}`}
              spacing={10}
              padding={{ vertical: 10 }}
              alignment="center"
              frame={{ maxWidth: "infinity" }}
            >
              <Divider />
              <Text font="caption" foregroundStyle="secondaryLabel">
                下一页
              </Text>
              <Divider />
            </HStack>
          )
        }

        if (block.type === "jump" && block.page) {
          return (
            <HStack
              key={`jump-${idx}`}
              padding={{ vertical: 2 }}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              <HStack
                spacing={6}
                padding={{ horizontal: 10, vertical: 6 }}
                glassEffect={{ type: "rect", cornerRadius: 8 }}
              >
                <Text font="subheadline" foregroundStyle="#007AFF">
                  📄 跳转至第 {block.page} 页
                </Text>
              </HStack>
            </HStack>
          )
        }

        return null
      })}
    </VStack>
  )
}

export type NovelImageItem =
  | {
      type: "uploadedimage"
      imageId: string
      info?: TextEmbeddedImage
    }
  | {
      type: "pixivimage"
      illustId: number
      page?: number
    }

export type NovelSegment =
  | { type: "text"; text: string }
  | { type: "images"; images: NovelImageItem[] }

/**
 * 将小说正文拆解为连续文字块与连续插图组序列
 */
export function parseNovelContentSegments(
  rawText: string,
  textEmbeddedImages?: Record<string, TextEmbeddedImage>
): NovelSegment[] {
  if (!rawText) return []

  const segments: NovelSegment[] = []
  const pattern = /\[(uploadedimage|pixivimage):\s*(\d+)(?:-(\d+))?\s*\]/gi
  let lastIndex = 0
  let match: RegExpExecArray | null
  let currentImages: NovelImageItem[] = []

  const flushImages = () => {
    if (currentImages.length > 0) {
      segments.push({ type: "images", images: currentImages })
      currentImages = []
    }
  }

  while ((match = pattern.exec(rawText)) !== null) {
    const start = match.index
    const end = pattern.lastIndex
    const kind = match[1].toLowerCase()
    const idStr = match[2]
    const pageStr = match[3]

    if (start > lastIndex) {
      const textChunk = rawText.slice(lastIndex, start)
      if (textChunk.trim().length > 0) {
        flushImages()
        segments.push({ type: "text", text: textChunk })
      }
    }

    if (kind === "uploadedimage") {
      const info = textEmbeddedImages?.[idStr]
      currentImages.push({
        type: "uploadedimage",
        imageId: idStr,
        info,
      })
    } else if (kind === "pixivimage") {
      const illustId = Number(idStr)
      const page = pageStr ? Number(pageStr) : undefined
      if (illustId > 0) {
        currentImages.push({
          type: "pixivimage",
          illustId,
          page,
        })
      }
    }

    lastIndex = end
  }

  if (lastIndex < rawText.length) {
    const trailing = rawText.slice(lastIndex)
    if (trailing.trim().length > 0) {
      flushImages()
      segments.push({ type: "text", text: trailing })
    }
  }

  flushImages()

  return segments.length > 0 ? segments : [{ type: "text", text: rawText }]
}

/**
 * 作者上传的正文插图大图项
 */
function NovelUploadedImageItemView(props: {
  imageId: string
  imageInfo?: TextEmbeddedImage
  cornerRadius?: any
}) {
  const { imageId, imageInfo, cornerRadius = 8 } = props

  const highResUrl =
    imageInfo?.urls?.["1200x1200"] ||
    imageInfo?.urls?.original ||
    imageInfo?.urls?.["480mw"] ||
    null

  const previewUrl =
    imageInfo?.urls?.["240mw"] ||
    imageInfo?.urls?.["128x128"] ||
    null

  if (!highResUrl && !previewUrl) {
    return (
      <HStack
        spacing={8}
        padding={{ horizontal: 0, vertical: 4 }}
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
    <CachedImage
      url={highResUrl}
      previewUrl={previewUrl}
      useIntrinsicAspectRatio={true}
      cornerRadius={cornerRadius}
      contentMode="fit"
      frame={{ maxWidth: "infinity" }}
    />
  )
}

/**
 * 正文引用的 Pixiv 插画大图项
 */
function NovelPixivImageItemView(props: {
  illustId: number
  page?: number
  cornerRadius?: any
  showBottomLink?: boolean
}) {
  const { illustId, page = 0, cornerRadius = 8, showBottomLink = true } = props
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
      <HStack spacing={0} frame={{ maxWidth: "infinity", height: 120 }}>
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
        padding={{ vertical: 4 }}
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
    <VStack spacing={2} alignment="center" frame={{ maxWidth: "infinity" }}>
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
          cornerRadius={cornerRadius}
          contentMode="fit"
          frame={{ maxWidth: "infinity" }}
        />
      </Button>
      {showBottomLink ? (
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
      ) : null}
    </VStack>
  )
}

/**
 * 连续插图组渲染组件：
 * 支持单图四角圆角、多图顶部/底部圆角且图间 0 间距无缝贴合（参考插画详情页）
 */
function NovelImagesBlockView(props: {
  images: NovelImageItem[]
  isFirstInArticle?: boolean
  isLastInArticle?: boolean
}) {
  const { images, isFirstInArticle = false, isLastInArticle = false } = props
  const count = images.length
  if (count === 0) return null

  return (
    <VStack
      spacing={0}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      padding={{
        horizontal: 14,
        top: isFirstInArticle ? 0 : 6,
        bottom: isLastInArticle ? 0 : 6,
      }}
    >
      <VStack spacing={0} alignment="center" frame={{ maxWidth: "infinity" }}>
        {images.map((item, idx) => {
          const isFirst = idx === 0
          const isLast = idx === count - 1
          const cornerRadii =
            count === 1
              ? 8
              : isFirst
                ? { topLeading: 8, topTrailing: 8, bottomLeading: 0, bottomTrailing: 0 }
                : isLast
                  ? { topLeading: 0, topTrailing: 0, bottomLeading: 8, bottomTrailing: 8 }
                  : 0

          if (item.type === "uploadedimage") {
            return (
              <NovelUploadedImageItemView
                key={`uploaded-${item.imageId}-${idx}`}
                imageId={item.imageId}
                imageInfo={item.info}
                cornerRadius={cornerRadii}
              />
            )
          }

          if (item.type === "pixivimage") {
            return (
              <NovelPixivImageItemView
                key={`pixiv-${item.illustId}-${idx}`}
                illustId={item.illustId}
                page={item.page}
                cornerRadius={cornerRadii}
                showBottomLink={isLast}
              />
            )
          }

          return null
        })}
      </VStack>
    </VStack>
  )
}

/**
 * 小说正文复合阅读组件：
 * - 纯文本小说：采用标准 WebView 渲染完整排版与跨段落长文选择
 * - 图文混排小说：采用高流畅度 Native Segment + 高清原比例插图流式排版，彻底解决多 WebView 性能卡顿与排版塌陷
 */
export function NovelReaderView(props: {
  text: string
  title?: string
  textEmbeddedImages?: Record<string, TextEmbeddedImage>
  onReady?: () => void
}) {
  const { text, title, textEmbeddedImages, onReady } = props
  const segments = useMemo(
    () => parseNovelContentSegments(text, textEmbeddedImages),
    [text, textEmbeddedImages]
  )

  const firstSeg = segments[0]
  const isPureText = segments.length === 1 && firstSeg?.type === "text"

  useEffect(() => {
    if (!isPureText) {
      onReady?.()
    }
  }, [isPureText, onReady])

  if (isPureText && firstSeg?.type === "text") {
    return (
      <NovelReaderWebView
        text={firstSeg.text}
        title={title}
        onReady={onReady}
      />
    )
  }

  return (
    <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return (
            <NovelNativeTextSegment
              key={`text-${index}`}
              text={segment.text}
            />
          )
        }
        if (segment.type === "images") {
          return (
            <NovelImagesBlockView
              key={`images-${index}`}
              images={segment.images}
              isFirstInArticle={index === 0}
              isLastInArticle={index === segments.length - 1}
            />
          )
        }
        return null
      })}
    </VStack>
  )
}
