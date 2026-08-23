/**
 * AI 弹窗 Sheet 组件：为图片详情页与小说正文页提供沉浸式 AI 辅助交互
 */
import {
  Button,
  Canvas,
  Divider,
  DragGesture,
  Group,
  HStack,
  Image,
  NavigationStack,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  TextField,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  type VirtualNode,
} from "scripting"
import type { PixivIllustration, PixivNovel, PixivNovelDetail } from "../types"
import {
  cleanHtmlCaption,
  cleanNovelTextForAI,
  cleanOCRDisplayMarkdown,
  extractOCRBubbles,
  getNovelPageText,
  isAIAvailable,
  streamContinueNovel,
  streamGenerateTranslatedImage,
  streamSummarizeNovel,
  streamTranslateNovel,
  streamTranslateText,
  streamVisionTranslateImage,
  type OCRBubble,
} from "../api/aiService"
import { saveImageToPixivAlbum } from "../downloader/photoAlbum"
import { ErrorView } from "./components"

export type IllustAIMode = "caption" | "ocr" | "vision"
export type NovelAIMode = "caption" | "translate" | "summary" | "continue"

interface ScreenshotMaker {
  screenshot(): UIImage | null
}

/**
 * 创建高帧率流式节流器（约 14~16 fps，65ms 间隔）
 * 解决大模型高频推送 token 导致的 React/SwiftUI 疯狂重渲染与掉帧卡顿
 */
function createThrottledUpdater(
  onUpdate: (text: string) => void,
  intervalMs = 65
) {
  let timer: any = null
  let lastUpdateTime = 0
  let latestText = ""

  return {
    push(text: string) {
      latestText = text
      const now = Date.now()
      const remaining = intervalMs - (now - lastUpdateTime)
      if (remaining <= 0) {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        lastUpdateTime = now
        onUpdate(latestText)
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null
          lastUpdateTime = Date.now()
          onUpdate(latestText)
        }, remaining)
      }
    },
    flush(text?: string) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (text !== undefined) {
        latestText = text
      }
      lastUpdateTime = Date.now()
      if (latestText) {
        onUpdate(latestText)
      }
    },
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

const PRESET_CONTINUE_PROMPTS = [
  "续写一个温馨甜蜜的日常结局",
  "续写一个意想不到的高能剧情反转",
  "以女主角的第一人称心理活动续写",
  "续写一段战斗高潮与破局时刻",
  "续写若干年后的后日谈与重逢",
]

/**
 * 通用 AI Sheet 基础容器
 */
function AISheetScaffold(props: {
  title: string
  subtitle?: string
  loading: boolean
  streaming: boolean
  error: string | null
  resultText: string
  progressInfo?: string | null
  actionButtonType?: "copy" | "download"
  actionButtonDisabled?: boolean
  onAction?: () => void
  onDismiss: () => void
  onRetry: () => void
  onStop?: () => void
  extraTrailingActions?: any
  children?: any
}) {
  const {
    title,
    subtitle,
    loading,
    streaming,
    error,
    resultText,
    progressInfo,
    actionButtonType = "copy",
    actionButtonDisabled,
    onAction,
    onDismiss,
    onRetry,
    onStop,
    extraTrailingActions,
    children,
  } = props

  const available = isAIAvailable()

  function handleCopy() {
    if (!resultText) return
    Pasteboard.setString(resultText)
    void Haptics.transient()
  }

  const isDownload = actionButtonType === "download"
  const isActionDisabled =
    actionButtonDisabled !== undefined
      ? actionButtonDisabled
      : isDownload
      ? loading || streaming
      : !resultText || loading

  const handleMainAction = onAction ?? handleCopy

  // 长文本按段落拆分，避免单一超大 Text 导致 CoreText 全局重排计算卡顿
  const paragraphs = useMemo(() => {
    if (!resultText) return []
    const list = resultText.split(/\n\n+/).filter(Boolean)
    return list.length > 0 ? list : [resultText]
  }, [resultText])

  return (
    <NavigationStack
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
    >
      <ScrollView
        navigationTitle={title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: [
            <Button
              title="关闭"
              systemImage="xmark"
              action={onDismiss}
            />,
          ],
          topBarTrailing: [
            streaming ? (
              <Button
                title="停止"
                systemImage="stop.fill"
                action={onStop ?? (() => {})}
              />
            ) : (
              <HStack spacing={12}>
                {extraTrailingActions}
                <Button
                  title={isDownload ? "下载" : "复制"}
                  systemImage={isDownload ? "square.and.arrow.down" : "doc.on.doc"}
                  disabled={isActionDisabled}
                  action={handleMainAction}
                />
                <Button
                  title="重新生成"
                  systemImage="arrow.clockwise"
                  disabled={loading || !available}
                  action={onRetry}
                />
              </HStack>
            ),
          ],
        }}
      >
        <VStack spacing={16} padding={{ top: 14, leading: 16, bottom: 28, trailing: 16 }}>
          {!available ? (
            <VStack spacing={14} padding={24} alignment="center">
              <Image
                systemName="sparkles"
                font="largeTitle"
                foregroundStyle="secondaryLabel"
              />
              <Text font="title3" fontWeight="bold">未检测到可用 AI 模型</Text>
              <Text
                font="footnote"
                foregroundStyle="secondaryLabel"
                multilineTextAlignment="center"
              >
                Pix-Scripting 直接调用 Scripting App 的内置 AI 能力。请在 Scripting 设置中配置 AI 提供商（如 OpenAI、Gemini、Claude、DeepSeek 等）后重试。
              </Text>
            </VStack>
          ) : (
            <>
              {Boolean(subtitle) && (
                <Text
                  font="footnote"
                  foregroundStyle="secondaryLabel"
                >
                  {subtitle ?? ""}
                </Text>
              )}

              {/* 自定义顶部内容（如输入框、页码切换、原文折叠等） */}
              {children ? <Group>{children}</Group> : null}

              {/* 进度或加载状态 */}
              {loading && !resultText && (
                <VStack spacing={12} padding={{ top: 32, bottom: 32 }} alignment="center">
                  <ProgressView />
                  <Text
                    font="footnote"
                    foregroundStyle="secondaryLabel"
                  >
                    {progressInfo || "AI 正在深度思考与生成中…"}
                  </Text>
                </VStack>
              )}

              {/* 错误态 */}
              {Boolean(error) && !streaming && (
                <ErrorView
                  message={error || "生成失败，请重试"}
                  onRetry={onRetry}
                />
              )}

              {/* 结果内容展示区（按段落分批呈现，极大降低渲染重排开销） */}
              {Boolean(resultText) && (
                <VStack spacing={14} alignment="leading">
                  {Boolean(progressInfo) && streaming && (
                    <HStack spacing={6} alignment="center">
                      <ProgressView />
                      <Text
                        font="caption"
                        foregroundStyle="#007AFF"
                      >
                        {progressInfo || ""}
                      </Text>
                    </HStack>
                  )}
                  {paragraphs.map((para, idx) => (
                    <Text
                      key={String(idx)}
                      font="body"
                      lineSpacing={5}
                    >
                      {para}
                    </Text>
                  ))}
                </VStack>
              )}
            </>
          )}
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

/**
 * 在 Canvas 画布上绘制原图并覆盖打印白色圆角气泡与自适应排版居中中文
 * 精细化小字号与防互相覆盖约束，保证排版紧凑细腻不溢出
 */
/**
 * 在 Canvas 画布上绘制原图并覆盖贴近原始漫画形态的气泡遮罩与自适应排版居中中文
 * 支持椭圆形 (ellipse)、平滑胶囊圆角 (round_rect)、矩形旁白框 (rectangle) 与透明悬浮字 (transparent)
 */
function drawOCROverlay(
  ctx: any,
  size: { width: number; height: number },
  filePath: string,
  bubbles: OCRBubble[],
  showOverlay: boolean,
  hiddenIndices?: Set<number>
) {
  // 1. 绘制底层原始漫画/插画
  try {
    ctx.drawImage({ filePath }, 0, 0, size.width, size.height)
  } catch (e) {
    // 容错处理
  }

  if (!showOverlay || !bubbles || bubbles.length === 0) {
    return
  }

  // 2. 逐一绘制识别到的气泡遮罩与汉化文字（跳过用户单点隐藏的气泡）
  for (let idx = 0; idx < bubbles.length; idx++) {
    if (hiddenIndices && hiddenIndices.has(idx)) {
      continue
    }

    const bubble = bubbles[idx]
    const { box_2d, translation, shape: rawShape } = bubble
    if (!box_2d || box_2d.length !== 4 || !translation || !translation.trim()) continue

    const [ymin, xmin, ymax, xmax] = box_2d
    // 将 0~1000 归一化坐标转换为当前 Canvas 实际像素
    const rawX = (Math.max(0, Math.min(xmin, 1000)) / 1000) * size.width
    const rawY = (Math.max(0, Math.min(ymin, 1000)) / 1000) * size.height
    const rawW = ((Math.max(0, Math.min(xmax, 1000)) - Math.max(0, Math.min(xmin, 1000))) / 1000) * size.width
    const rawH = ((Math.max(0, Math.min(ymax, 1000)) - Math.max(0, Math.min(ymin, 1000))) / 1000) * size.height

    // 边缘轻微内缩 1.5% 防相邻紧邻气泡粘连
    const shrinkX = Math.min(1.5, rawW * 0.015)
    const shrinkY = Math.min(1.5, rawH * 0.015)
    const x = rawX + shrinkX
    const y = rawY + shrinkY
    const w = Math.max(4, rawW - shrinkX * 2)
    const h = Math.max(4, rawH - shrinkY * 2)

    if (w < 6 || h < 6) continue

    const aspect = w / h
    // 智能判定气泡形状（绝大多数日漫对话气泡为椭圆/大圆角胶囊形）
    const effectiveShape =
      rawShape ||
      (aspect >= 0.35 && aspect <= 2.8 ? "ellipse" : "round_rect")

    ctx.save()

    const isTransparent = effectiveShape === "transparent"

    if (!isTransparent) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.98)"
      ctx.strokeStyle = "rgba(0, 0, 0, 0.28)"
      ctx.lineWidth = 0.85

      if (effectiveShape === "ellipse") {
        // 1. 真实椭圆/圆形气泡：完全契合日漫原画气泡弧度，四角绝不溢出遮挡背景
        const cx = x + w / 2
        const cy = y + h / 2
        const rx = w / 2
        const ry = h / 2
        ctx.beginPath()
        if (ctx.ellipse) {
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        } else {
          // 容错 fallback
          const radius = Math.min(rx, ry)
          ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else if (effectiveShape === "round_rect") {
        // 2. 连续平滑大圆角胶囊气泡（半径为短边的大比例）
        const radius = Math.min(w / 2, h / 2, Math.max(8, Math.min(w, h) * 0.42))
        ctx.beginPath()
        ctx.moveTo(x + radius, y)
        ctx.lineTo(x + w - radius, y)
        ctx.arcTo(x + w, y, x + w, y + radius, radius)
        ctx.lineTo(x + w, y + h - radius)
        ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
        ctx.lineTo(x + radius, y + h)
        ctx.arcTo(x, y + h, x, y + h - radius, radius)
        ctx.lineTo(x, y + radius)
        ctx.arcTo(x, y, x + radius, y, radius)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else {
        // 3. 矩形分镜旁白框
        const radius = Math.min(3.5, Math.min(w, h) * 0.08)
        ctx.beginPath()
        ctx.moveTo(x + radius, y)
        ctx.lineTo(x + w - radius, y)
        ctx.arcTo(x + w, y, x + w, y + radius, radius)
        ctx.lineTo(x + w, y + h - radius)
        ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
        ctx.lineTo(x + radius, y + h)
        ctx.arcTo(x, y + h, x, y + h - radius, radius)
        ctx.lineTo(x, y + radius)
        ctx.arcTo(x, y, x + radius, y, radius)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }

      // 将文字裁剪严格锁在真实气泡内部
      ctx.clip()
    }

    // 文字排版安全边界（椭圆需要内缩约 28% 安全余量避免顶角溢出）
    const insetRatio = effectiveShape === "ellipse" ? 0.28 : 0.1
    const maxTextWidth = Math.max(6, w * (1 - insetRatio))
    const maxTextHeight = Math.max(6, h * (1 - insetRatio))

    // 精细化小字号自适应计算（初始范围 6.5~10.5pt）
    const cleanText = translation.trim()
    const charCount = Math.max(1, cleanText.length)
    let fontSize = Math.min(10.5, Math.max(6.5, Math.floor(Math.sqrt((maxTextWidth * maxTextHeight) / (charCount * 1.8)))))
    let lines: string[] = []
    let lineHeight = fontSize * 1.2

    // 自适应字号收敛循环
    for (let step = 0; step < 8; step++) {
      ctx.font = fontSize
      lines = []
      let currentLine = ""

      for (const char of cleanText) {
        if (char === "\n") {
          if (currentLine) lines.push(currentLine)
          currentLine = ""
          continue
        }
        const testLine = currentLine + char
        const m = ctx.measureText ? ctx.measureText(testLine) : { width: testLine.length * (fontSize * 0.85) }
        if (m.width > maxTextWidth && currentLine.length > 0) {
          lines.push(currentLine)
          currentLine = char
        } else {
          currentLine = testLine
        }
      }
      if (currentLine) {
        lines.push(currentLine)
      }

      lineHeight = fontSize * 1.2
      const totalTextHeight = lines.length * lineHeight
      if (totalTextHeight <= maxTextHeight || fontSize <= 6.5) {
        break
      }
      fontSize = Math.max(6.5, fontSize - 0.6)
    }

    ctx.font = fontSize
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"

    const totalTextHeight = lines.length * lineHeight
    const startY = y + (h - totalTextHeight) / 2 + lineHeight / 2
    const centerX = x + w / 2

    // 针对透明悬浮字：使用柔和白描边 + 黑字呈现
    if (isTransparent) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)"
      ctx.lineWidth = 2.5
      for (let i = 0; i < lines.length; i++) {
        const lineY = startY + i * lineHeight
        if (ctx.strokeText) {
          ctx.strokeText(lines[i], centerX, lineY, maxTextWidth)
        }
      }
    }

    ctx.fillStyle = "#111111"
    for (let i = 0; i < lines.length; i++) {
      const lineY = startY + i * lineHeight
      ctx.fillText(lines[i], centerX, lineY, maxTextWidth)
    }

    ctx.restore()
  }
}

interface PageTranslationCache {
  resultText: string
  generatedImageBase64?: string | null
  error?: string | null
  imageFilePath?: string | null
  bubbles?: OCRBubble[]
  showOverlay?: boolean
  hiddenBubbleIndices?: number[]
}

/**
 * 图片详情页 AI Sheet
 */
export function IllustAISheet(props: {
  illust: PixivIllustration
  mode: IllustAIMode
  isPresented: boolean
  onChanged: (presented: boolean) => void
}) {
  const { illust, mode, isPresented, onChanged } = props
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [selectedPageIndex, setSelectedPageIndex] = useState(0)
  const [showOriginalCaption, setShowOriginalCaption] = useState(false)
  const [progressInfo, setProgressInfo] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  // 记录每一页独立翻译/生图缓存
  const [pageCaches, setPageCaches] = useState<Record<number, PageTranslationCache>>({})

  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })
  const canvasScreenshotRef = useRef<ScreenshotMaker | null>(null)
  const pageCount = Math.max(1, illust.page_count || illust.meta_pages?.length || 1)

  const rawCaption = cleanHtmlCaption(illust.caption)

  const lastCanvasSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })

  // 当前选中页的缓存数据
  const currentPageCache = pageCaches[selectedPageIndex]
  const currentResultText = currentPageCache?.resultText || ""
  const currentGeneratedImageBase64 = currentPageCache?.generatedImageBase64 || null
  const currentImageFilePath = currentPageCache?.imageFilePath || null
  const currentBubbles = currentPageCache?.bubbles || []
  const currentError = currentPageCache?.error || null
  const isCurrentOverlayVisible = currentPageCache?.showOverlay !== false

  const currentHiddenIndices = useMemo(() => {
    return new Set(currentPageCache?.hiddenBubbleIndices || [])
  }, [currentPageCache?.hiddenBubbleIndices])

  const illustWidth = illust.width || 800
  const illustHeight = illust.height || 1200
  const imageAspect = illustWidth / illustHeight

  function handleToggleCurrentOverlay() {
    const nextVal = !isCurrentOverlayVisible
    setPageCaches((prev) => ({
      ...prev,
      [selectedPageIndex]: {
        ...prev[selectedPageIndex],
        showOverlay: nextVal,
        ...(nextVal ? { hiddenBubbleIndices: [] } : {}),
      },
    }))
    void Haptics.transient()
  }

  function handleTapCanvas(touchPoint: { x: number; y: number }) {
    const canvasSize = lastCanvasSizeRef.current
    if (!canvasSize.width || !canvasSize.height || currentBubbles.length === 0) return

    const normX = (touchPoint.x / canvasSize.width) * 1000
    const normY = (touchPoint.y / canvasSize.height) * 1000

    // 从后往前查找命中的气泡
    let hitIndex = -1
    for (let i = currentBubbles.length - 1; i >= 0; i--) {
      const [ymin, xmin, ymax, xmax] = currentBubbles[i].box_2d
      // 热区扩大 15 归一化像素容错
      if (normX >= xmin - 15 && normX <= xmax + 15 && normY >= ymin - 15 && normY <= ymax + 15) {
        hitIndex = i
        break
      }
    }

    if (hitIndex !== -1) {
      setPageCaches((prev) => {
        const prevHidden = prev[selectedPageIndex]?.hiddenBubbleIndices || []
        const nextHidden = prevHidden.includes(hitIndex)
          ? prevHidden.filter((idx) => idx !== hitIndex)
          : [...prevHidden, hitIndex]

        return {
          ...prev,
          [selectedPageIndex]: {
            ...prev[selectedPageIndex],
            hiddenBubbleIndices: nextHidden,
          },
        }
      })
      void Haptics.transient()
    }
  }

  const displayResultText = useMemo(() => {
    if (mode === "ocr") {
      return cleanOCRDisplayMarkdown(currentResultText)
    }
    return currentResultText
  }, [mode, currentResultText])

  function getSheetTitle() {
    switch (mode) {
      case "caption":
        return "AI 简介翻译"
      case "ocr":
        return "AI图片翻译（OCR）"
      case "vision":
        return "AI 翻译图片（生图）"
      default:
        return "助手"
    }
  }

  function handleStop() {
    abortRef.current.aborted = true
    setStreaming(false)
    setLoading(false)
    setProgressInfo(null)
  }

  async function execute(targetIndex = selectedPageIndex, forceImageGen = false) {
    if (!isPresented) return

    // 终止进行中的旧请求
    handleStop()
    abortRef.current = { aborted: false }

    setLoading(true)
    setProgressInfo(null)

    // 清空目标页之前的错误，如果是生图模式则重置图片
    setPageCaches((prev) => ({
      ...prev,
      [targetIndex]: {
        resultText: "",
        generatedImageBase64: mode === "vision" ? null : prev[targetIndex]?.generatedImageBase64,
        error: null,
      },
    }))

    const throttler = createThrottledUpdater((text) => {
      setPageCaches((prev) => ({
        ...prev,
        [targetIndex]: {
          ...prev[targetIndex],
          resultText: text,
          error: null,
        },
      }))
    }, 65)

    try {
      if (mode === "caption") {
        if (!rawCaption) {
          setPageCaches((prev) => ({
            ...prev,
            [targetIndex]: { resultText: "该作品作者未填写简介。", error: null },
          }))
          setLoading(false)
          return
        }
        setStreaming(true)
        const finalResult = await streamTranslateText(rawCaption, {
          onChunk: (text) => throttler.push(text),
          signal: abortRef.current,
        })
        throttler.flush(finalResult)
      } else if (mode === "ocr") {
        setProgressInfo(`正在加载第 ${targetIndex + 1} 页并请求多模态大模型视觉识别气泡…`)
        setStreaming(true)
        const finalResult = await streamVisionTranslateImage(illust, targetIndex, {
          onImageReady: (filePath) => {
            setPageCaches((prev) => ({
              ...prev,
              [targetIndex]: {
                ...prev[targetIndex],
                imageFilePath: filePath,
              },
            }))
          },
          onBubblesParsed: (bubbles) => {
            setPageCaches((prev) => ({
              ...prev,
              [targetIndex]: {
                ...prev[targetIndex],
                bubbles,
              },
            }))
          },
          onChunk: (text) => throttler.push(text),
          signal: abortRef.current,
        })
        throttler.flush(finalResult)
      } else if (mode === "vision") {
        setProgressInfo(`正在请求图像生成模型对第 ${targetIndex + 1} 页进行汉化重绘…`)
        setStreaming(true)
        const finalResult = await streamGenerateTranslatedImage(illust, targetIndex, {
          onChunk: (text) => throttler.push(text),
          onImageGenerated: (imageData) => {
            setPageCaches((prev) => ({
              ...prev,
              [targetIndex]: {
                ...prev[targetIndex],
                generatedImageBase64: imageData.base64,
                error: null,
              },
            }))
          },
          signal: abortRef.current,
        })
        throttler.flush(finalResult)
      }
    } catch (e: any) {
      throttler.cancel()
      if (!abortRef.current.aborted) {
        const errorMsg = e?.message || "AI 请求发生异常"
        setPageCaches((prev) => ({
          ...prev,
          [targetIndex]: {
            ...prev[targetIndex],
            error: errorMsg,
          },
        }))
      }
    } finally {
      setLoading(false)
      setStreaming(false)
      setProgressInfo(null)
    }
  }

  async function handleDownloadCurrent() {
    if (downloading) return
    try {
      setDownloading(true)
      const fileName = `${illust.id}_p${selectedPageIndex}_${mode === "vision" ? "ai_gen" : "ocr"}.jpg`

      if (mode === "vision") {
        if (!currentGeneratedImageBase64) return
        const data = Data.fromBase64String(currentGeneratedImageBase64)
        if (data) {
          const ok = await saveImageToPixivAlbum(data, fileName)
          if (ok) {
            void Haptics.transient()
          }
        }
      } else if (mode === "ocr") {
        // 优先截取带有汉化气泡图层的 Canvas 完整画面
        let imageToSave: Data | string | null = null
        const screenshot = canvasScreenshotRef.current?.screenshot()
        if (screenshot) {
          imageToSave = Data.fromJPEG(screenshot, 0.95) || Data.fromPNG(screenshot)
        }

        if (!imageToSave && currentImageFilePath) {
          imageToSave = currentImageFilePath
        }

        if (!imageToSave) return

        const ok = await saveImageToPixivAlbum(imageToSave, fileName)
        if (ok) {
          void Haptics.transient()
        }
      }
    } catch (e: any) {
      console.log("save photo error:", e?.message || e)
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    setPageCaches({})
    setSelectedPageIndex(0)
  }, [illust.id, mode])

  useEffect(() => {
    if (isPresented) {
      // 仅简介模式在未缓存时自动开始，其余模式（ocr、vision）等待用户手动确认触发
      if (mode === "caption") {
        if (!pageCaches[selectedPageIndex]?.resultText) {
          void execute(selectedPageIndex)
        }
      }
    } else {
      handleStop()
    }
  }, [isPresented, mode, illust.id])

  const currentGeneratedUIImage = currentGeneratedImageBase64
    ? UIImage.fromBase64String(currentGeneratedImageBase64)
    : null

  const canDownload =
    mode === "ocr"
      ? Boolean(currentImageFilePath) && !loading
      : mode === "vision"
      ? Boolean(currentGeneratedImageBase64) && !loading
      : false

  return (
    <AISheetScaffold
      title={getSheetTitle()}
      subtitle={
        mode === "caption"
          ? `作品：${illust.title} (@${illust.user?.name})`
          : undefined
      }
      loading={loading}
      streaming={streaming}
      error={currentError}
      resultText={displayResultText}
      progressInfo={progressInfo}
      actionButtonType={mode === "caption" ? "copy" : "download"}
      actionButtonDisabled={mode === "caption" ? !displayResultText || loading : !canDownload || downloading}
      onAction={mode === "caption" ? undefined : handleDownloadCurrent}
      extraTrailingActions={
        mode === "ocr" && Boolean(currentImageFilePath) ? (
          <Button
            title={isCurrentOverlayVisible ? "隐藏译文" : "显示译文"}
            systemImage={isCurrentOverlayVisible ? "eye" : "eye.slash"}
            action={handleToggleCurrentOverlay}
          />
        ) : null
      }
      onDismiss={() => {
        handleStop()
        onChanged(false)
      }}
      onRetry={() => void execute(selectedPageIndex, true)}
      onStop={handleStop}
    >
      {/* 简介模式：支持折叠查看原文 */}
      {mode === "caption" && Boolean(rawCaption) && (
        <VStack spacing={6}>
          <HStack alignment="center">
            <Text
              font="subheadline"
              fontWeight="semibold"
              foregroundStyle="secondaryLabel"
            >
              原文
            </Text>
            <Spacer />
            <Button
              title={showOriginalCaption ? "收起" : "展开"}
              action={() => setShowOriginalCaption(!showOriginalCaption)}
            />
          </HStack>
          {showOriginalCaption && (
            <Text
              font="footnote"
              foregroundStyle="secondaryLabel"
              lineSpacing={3}
            >
              {rawCaption}
            </Text>
          )}
        </VStack>
      )}

      {/* 多图模式：支持快速切换选中的页码 */}
      {(mode === "ocr" || mode === "vision") && pageCount > 1 && (
        <ScrollView axes="horizontal">
          <HStack spacing={8}>
            {Array.from({ length: pageCount }).map((_, idx) => {
              const isSelected = selectedPageIndex === idx
              const cache = pageCaches[idx]
              const hasResult = Boolean(
                mode === "vision"
                  ? cache?.generatedImageBase64 || cache?.resultText
                  : cache?.resultText
              )
              const title = hasResult && !isSelected ? `P${idx + 1} ✓` : `P${idx + 1}`
              return (
                <Button
                  key={String(idx)}
                  title={title}
                  buttonStyle={isSelected ? "borderedProminent" : "bordered"}
                  action={() => {
                    if (selectedPageIndex !== idx) {
                      handleStop()
                      setSelectedPageIndex(idx)
                    }
                  }}
                />
              )
            })}
          </HStack>
        </ScrollView>
      )}

      {/* OCR 模式未翻译空状态 */}
      {mode === "ocr" && !loading && !currentResultText && !currentError && (
        <VStack
          spacing={14}
          padding={{ top: 28, bottom: 20 }}
          alignment="center"
        >
          <Image
            systemName="text.viewfinder"
            font="largeTitle"
            foregroundStyle="secondaryLabel"
          />
          <VStack spacing={4} alignment="center">
            <Text font="headline" fontWeight="semibold">
              第 {selectedPageIndex + 1} 页尚未翻译
            </Text>
            <Text
              font="footnote"
              foregroundStyle="secondaryLabel"
              multilineTextAlignment="center"
            >
              点击下方按钮开始识别并翻译本页对话气泡
            </Text>
          </VStack>
          <Button
            title={`开始翻译第 ${selectedPageIndex + 1} 页`}
            systemImage="sparkles"
            buttonStyle="borderedProminent"
            action={() => void execute(selectedPageIndex)}
          />
        </VStack>
      )}

      {/* OCR 模式：原图覆盖气泡与自适应排版预览（支持单击气泡独立显隐） */}
      {mode === "ocr" && Boolean(currentImageFilePath) && (
        <Canvas
          screenshotRef={canvasScreenshotRef}
          aspectRatio={{ value: imageAspect, contentMode: "fit" }}
          simultaneousGesture={
            DragGesture({ minDistance: 0, coordinateSpace: "local" })
              .onEnded((details) => {
                const dist = Math.hypot(details.translation.width, details.translation.height)
                if (dist < 10) {
                  handleTapCanvas(details.location)
                }
              })
          }
          draw={(ctx, size) => {
            lastCanvasSizeRef.current = size
            drawOCROverlay(
              ctx,
              size,
              currentImageFilePath!,
              currentBubbles,
              isCurrentOverlayVisible,
              currentHiddenIndices
            )
          }}
        />
      )}

      {/* 生图模式前置确认与提示 */}
      {mode === "vision" && !currentGeneratedImageBase64 && !loading && (
        <VStack
          spacing={14}
          padding={{ top: 24, bottom: 20 }}
          alignment="center"
        >
          <Image
            systemName="photo.badge.magnifyingglass"
            font="largeTitle"
            foregroundStyle="#FF9500"
          />
          <VStack spacing={6} alignment="center">
            <Text font="headline" fontWeight="bold">
              生图汉化模式
            </Text>
            <Text
              font="footnote"
              foregroundStyle="secondaryLabel"
              multilineTextAlignment="center"
              lineSpacing={3}
            >
              需要 Scripting 配置支持图像输出的 AI 模型{"\n"}单次重绘将生成全新图像并消耗较多 Token
            </Text>
          </VStack>
          <Button
            title={pageCount > 1 ? `确认开始第 ${selectedPageIndex + 1} 页生图汉化` : "确认开始生图汉化"}
            systemImage="sparkles"
            buttonStyle="borderedProminent"
            action={() => void execute(selectedPageIndex, true)}
          />
        </VStack>
      )}

      {/* 生图结果大图渲染 */}
      {mode === "vision" && Boolean(currentGeneratedUIImage) && (
        <VStack spacing={12}>
          <Text font="headline" fontWeight="bold">
            🎨 汉化重绘结果：
          </Text>
          {currentGeneratedUIImage && (
            <Image
              image={currentGeneratedUIImage}
              resizable={true}
              aspectRatio={{ contentMode: "fit" }}
            />
          )}
        </VStack>
      )}
    </AISheetScaffold>
  )
}

interface NovelPageCache {
  translateText?: string
  summaryText?: string
  continueText?: string
  error?: string | null
}

/**
 * 小说正文页 AI Sheet
 */
export function NovelAISheet(props: {
  novel: PixivNovel | PixivNovelDetail
  fullText: string
  currentPage?: number
  totalPages?: number
  mode: NovelAIMode
  isPresented: boolean
  onChanged: (presented: boolean) => void
}) {
  const {
    novel,
    fullText,
    currentPage = 1,
    totalPages = 1,
    mode,
    isPresented,
    onChanged,
  } = props

  const isMultiPage = totalPages > 1

  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [progressInfo, setProgressInfo] = useState<string | null>(null)
  const [showOriginalCaption, setShowOriginalCaption] = useState(false)

  // 记录小说各页独立翻译/总结/续写缓存
  const [pageCaches, setPageCaches] = useState<Record<number, NovelPageCache>>({})
  const [captionCache, setCaptionCache] = useState<{ resultText: string; error: string | null }>({
    resultText: "",
    error: null,
  })

  // 续写模式自定义 prompt
  const [continueInstruction, setContinueInstruction] = useState("")

  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })
  const rawCaption = cleanHtmlCaption(novel.caption)

  // 当前页的缓存数据
  const currentPageCache = pageCaches[currentPage] || {}

  function getCurrentResultText(): string {
    switch (mode) {
      case "caption":
        return captionCache.resultText
      case "translate":
        return currentPageCache.translateText || ""
      case "summary":
        return currentPageCache.summaryText || ""
      case "continue":
        return currentPageCache.continueText || ""
      default:
        return ""
    }
  }

  function getCurrentError(): string | null {
    if (mode === "caption") return captionCache.error
    return currentPageCache.error || null
  }

  const currentResultText = getCurrentResultText()
  const currentError = getCurrentError()

  // 对于多页小说的翻译和总结，只取当前页的文本；单页小说或续写取全文
  const targetRawText =
    isMultiPage && (mode === "translate" || mode === "summary")
      ? getNovelPageText(fullText, currentPage)
      : fullText

  const cleanedText = cleanNovelTextForAI(targetRawText)

  function getSheetTitle() {
    switch (mode) {
      case "caption":
        return "AI 简介翻译"
      case "translate":
        return isMultiPage
          ? `AI 小说翻译 (第 ${currentPage} / ${totalPages} 页)`
          : "AI 小说全篇翻译"
      case "summary":
        return isMultiPage
          ? `AI 小说总结 (第 ${currentPage} / ${totalPages} 页)`
          : "AI 小说导读与总结"
      case "continue":
        return "AI 小说续写与脑洞"
      default:
        return "助手"
    }
  }

  function getSheetSubtitle() {
    if (mode === "caption") {
      return `作品：${novel.title} (@${novel.user?.name})`
    }
    if (isMultiPage) {
      return `作品：${novel.title} · 第 ${currentPage} / ${totalPages} 页`
    }
    return `作品：${novel.title} (@${novel.user?.name})`
  }

  function handleStop() {
    abortRef.current.aborted = true
    setStreaming(false)
    setLoading(false)
    setProgressInfo(null)
  }

  async function execute(forceRetry = false) {
    if (!isPresented) return

    // 如果已有缓存且非强制重试，直接展现已有结果
    if (!forceRetry) {
      if (mode === "caption" && captionCache.resultText) {
        return
      }
      if (mode === "translate" && currentPageCache.translateText) {
        return
      }
      if (mode === "summary" && currentPageCache.summaryText) {
        return
      }
      if (mode === "continue" && currentPageCache.continueText) {
        return
      }
    }

    handleStop()
    abortRef.current = { aborted: false }
    setLoading(true)
    setProgressInfo(null)

    // 清空当前模式的旧数据
    if (mode === "caption") {
      setCaptionCache({ resultText: "", error: null })
    } else {
      const field =
        mode === "translate"
          ? "translateText"
          : mode === "summary"
          ? "summaryText"
          : "continueText"
      setPageCaches((prev) => ({
        ...prev,
        [currentPage]: {
          ...prev[currentPage],
          [field]: "",
          error: null,
        },
      }))
    }

    // 引入流式节流器（约 15fps，避免海量 token 推送阻塞 UI 线程）
    const throttler = createThrottledUpdater((text) => {
      if (mode === "caption") {
        setCaptionCache((prev) => ({ ...prev, resultText: text, error: null }))
      } else {
        const field =
          mode === "translate"
            ? "translateText"
            : mode === "summary"
            ? "summaryText"
            : "continueText"
        setPageCaches((prev) => ({
          ...prev,
          [currentPage]: {
            ...prev[currentPage],
            [field]: text,
            error: null,
          },
        }))
      }
    }, 65)

    try {
      if (mode === "caption") {
        if (!rawCaption) {
          setCaptionCache({ resultText: "该小说作者未填写简介。", error: null })
          setLoading(false)
          return
        }
        setStreaming(true)
        const finalResult = await streamTranslateText(rawCaption, {
          onChunk: (text) => throttler.push(text),
          signal: abortRef.current,
        })
        throttler.flush(finalResult)
      } else if (mode === "translate") {
        if (!cleanedText) {
          const msg = isMultiPage ? "当前页小说正文为空。" : "未获取到小说正文文本。"
          setPageCaches((prev) => ({
            ...prev,
            [currentPage]: { ...prev[currentPage], translateText: msg, error: null },
          }))
          setLoading(false)
          return
        }
        setStreaming(true)
        const finalResult = await streamTranslateNovel(cleanedText, {
          onChunk: (text) => throttler.push(text),
          onProgress: ({ chunkIndex, totalChunks, percent }) => {
            const prefix = isMultiPage ? `第 ${currentPage} 页 ` : ""
            setProgressInfo(`正在翻译${prefix}第 ${chunkIndex}/${totalChunks} 部分 (${percent}%)`)
          },
          signal: abortRef.current,
        })
        throttler.flush(finalResult)
      } else if (mode === "summary") {
        if (!cleanedText) {
          const msg = isMultiPage ? "当前页小说正文为空。" : "未获取到小说正文文本。"
          setPageCaches((prev) => ({
            ...prev,
            [currentPage]: { ...prev[currentPage], summaryText: msg, error: null },
          }))
          setLoading(false)
          return
        }
        setStreaming(true)
        setProgressInfo(
          isMultiPage
            ? `AI 正在总结第 ${currentPage} 页核心看点…`
            : "AI 正在通读全篇并提炼大纲与看点…"
        )
        const finalResult = await streamSummarizeNovel(cleanedText, {
          onChunk: (text) => throttler.push(text),
          signal: abortRef.current,
          pageInfo: isMultiPage ? { current: currentPage, total: totalPages } : undefined,
        })
        throttler.flush(finalResult)
      } else if (mode === "continue") {
        if (!cleanedText) {
          setPageCaches((prev) => ({
            ...prev,
            [currentPage]: { ...prev[currentPage], continueText: "未获取到小说正文文本。", error: null },
          }))
          setLoading(false)
          return
        }
        setStreaming(true)
        setProgressInfo("AI 正在根据前文风格与设定续写…")
        const finalResult = await streamContinueNovel(cleanedText, continueInstruction, {
          onChunk: (text) => throttler.push(text),
          signal: abortRef.current,
        })
        throttler.flush(finalResult)
      }
    } catch (e: any) {
      throttler.cancel()
      if (!abortRef.current.aborted) {
        const errorMsg = e?.message || "AI 请求发生异常"
        if (mode === "caption") {
          setCaptionCache((prev) => ({ ...prev, error: errorMsg }))
        } else {
          setPageCaches((prev) => ({
            ...prev,
            [currentPage]: {
              ...prev[currentPage],
              error: errorMsg,
            },
          }))
        }
      }
    } finally {
      setLoading(false)
      setStreaming(false)
      setProgressInfo(null)
    }
  }

  useEffect(() => {
    // 切换小说作品时重置全部缓存
    setPageCaches({})
    setCaptionCache({ resultText: "", error: null })
  }, [novel.id])

  useEffect(() => {
    if (isPresented) {
      // 仅简介模式在未缓存时自动开始，其余模式（translate、summary、continue）等待用户手动确认触发
      if (mode === "caption") {
        void execute(false)
      }
    } else {
      handleStop()
    }
  }, [isPresented, mode, currentPage])

  return (
    <AISheetScaffold
      title={getSheetTitle()}
      subtitle={getSheetSubtitle()}
      loading={loading}
      streaming={streaming}
      error={currentError}
      resultText={currentResultText}
      progressInfo={progressInfo}
      onDismiss={() => {
        handleStop()
        onChanged(false)
      }}
      onRetry={() => void execute(true)}
      onStop={handleStop}
    >
      {/* 简介模式：支持折叠查看日文原文 */}
      {mode === "caption" && Boolean(rawCaption) && (
        <VStack spacing={6}>
          <HStack alignment="center">
            <Text
              font="subheadline"
              fontWeight="semibold"
              foregroundStyle="secondaryLabel"
            >
              原文简介
            </Text>
            <Spacer />
            <Button
              title={showOriginalCaption ? "收起" : "展开"}
              action={() => setShowOriginalCaption(!showOriginalCaption)}
            />
          </HStack>
          {showOriginalCaption && (
            <Text
              font="footnote"
              foregroundStyle="secondaryLabel"
              lineSpacing={3}
            >
              {rawCaption}
            </Text>
          )}
        </VStack>
      )}

      {/* 翻译小说模式确认 */}
      {mode === "translate" && !loading && !currentResultText && !currentError && (
        <VStack
          spacing={14}
          padding={{ top: 28, bottom: 20 }}
          alignment="center"
        >
          <Image
            systemName="character.book.closed"
            font="largeTitle"
            foregroundStyle="secondaryLabel"
          />
          <VStack spacing={4} alignment="center">
            <Text font="headline" fontWeight="semibold">
              {isMultiPage ? `第 ${currentPage} / ${totalPages} 页小说正文` : "全篇小说正文"}
            </Text>
            <Text
              font="footnote"
              foregroundStyle="secondaryLabel"
              multilineTextAlignment="center"
            >
              {cleanedText ? `待翻译文本约 ${cleanedText.length} 字` : "暂无正文内容"}
            </Text>
          </VStack>
          <Button
            title={isMultiPage ? `开始翻译第 ${currentPage} 页` : "开始全篇翻译"}
            systemImage="sparkles"
            buttonStyle="borderedProminent"
            disabled={!cleanedText}
            action={() => void execute(true)}
          />
        </VStack>
      )}

      {/* 总结小说模式确认 */}
      {mode === "summary" && !loading && !currentResultText && !currentError && (
        <VStack
          spacing={14}
          padding={{ top: 28, bottom: 20 }}
          alignment="center"
        >
          <Image
            systemName="doc.text.magnifyingglass"
            font="largeTitle"
            foregroundStyle="secondaryLabel"
          />
          <VStack spacing={4} alignment="center">
            <Text font="headline" fontWeight="semibold">
              {isMultiPage ? `第 ${currentPage} / ${totalPages} 页剧情总结` : "全篇小说导读与总结"}
            </Text>
            <Text
              font="footnote"
              foregroundStyle="secondaryLabel"
              multilineTextAlignment="center"
            >
              {cleanedText ? "点击下方按钮由 AI 深度提炼核心大纲、登场人物与亮点" : "暂无正文内容"}
            </Text>
          </VStack>
          <Button
            title={isMultiPage ? `开始总结第 ${currentPage} 页` : "开始总结"}
            systemImage="sparkles"
            buttonStyle="borderedProminent"
            disabled={!cleanedText}
            action={() => void execute(true)}
          />
        </VStack>
      )}

      {/* 续写模式：支持输入自定义提示词和预设选项 */}
      {mode === "continue" && (
        <VStack spacing={10}>
          <Text
            font="subheadline"
            fontWeight="medium"
            foregroundStyle="secondaryLabel"
          >
            自定义续写要求（可选）：
          </Text>
          <TextField
            title="续写要求"
            prompt="例如：续写男女主表白甜蜜结局 / 以反派视角展开"
            value={continueInstruction}
            onChanged={setContinueInstruction}
          />
          <ScrollView axes="horizontal">
            <HStack spacing={8}>
              {PRESET_CONTINUE_PROMPTS.map((prompt) => (
                <Button
                  key={prompt}
                  title={prompt}
                  buttonStyle="bordered"
                  action={() => {
                    setContinueInstruction(prompt)
                  }}
                />
              ))}
            </HStack>
          </ScrollView>
          <Button
            title="开始续写"
            buttonStyle="borderedProminent"
            disabled={loading || streaming}
            action={execute}
          />
        </VStack>
      )}
    </AISheetScaffold>
  )
}
