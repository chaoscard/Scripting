import { AISheetScaffold, OriginalCaptionCollapsible } from "./AISheetScaffold"
import {
  Button,
  Canvas,
  Divider,
  GeometryReader,
  Group,
  HStack,
  Image,
  NavigationStack,
  ProgressView,
  ScrollView,
  Slider,
  Spacer,
  Text,
  TextField,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
  type Color,
  type VirtualNode,
} from "scripting"
import type { PixivIllustration } from "../../types"
import {
  cleanHtmlCaption,
  cleanOCRDisplayMarkdown,
  isAIAvailable,
  streamGenerateTranslatedImage,
  streamVisionTranslateImage,
  streamTranslateText,
} from "../../api/aiService"
import { saveImageToPixivAlbum } from "../../downloader/photoAlbum"
import { CachedImage, ErrorView } from "../components"
import { cachedFilePath, imageUrlOf, loadImage, pageThumbUrlOf } from "../../image/imageLoader"
import { loadSettings } from "../../store/settings"
import { drawOCROverlay } from "./OCRCanvas"
import { createThrottledUpdater } from "./throttle"
import type { IllustAIMode, PageTranslationCache, ScreenshotMaker } from "./types"

/** Google 经典四色配置与流光动效 */
const GOOGLE_COLORS: Color[] = ["#4285F4", "#EA4335", "#FBBC05", "#34A853", "#4285F4"]

function GoogleSparklesLoading() {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    let timerId: number
    let isMounted = true

    const tick = () => {
      if (!isMounted) return
      setPhase((prev) => (prev + 1) % 4)
      timerId = setTimeout(tick, 450)
    }

    timerId = setTimeout(tick, 450)

    return () => {
      isMounted = false
      clearTimeout(timerId)
    }
  }, [])

  // 随 phase 轮转的高亮明亮纯色与外圈光晕（确保在黑底上 100% 清晰耀眼）
  const colorConfigs = [
    {
      color: "#4285F4" as Color, // Google 蓝
      shadow: "rgba(66, 133, 244, 0.85)" as Color,
    },
    {
      color: "#FF453A" as Color, // Google 亮红
      shadow: "rgba(255, 69, 58, 0.85)" as Color,
    },
    {
      color: "#FFD60A" as Color, // Google 亮黄
      shadow: "rgba(255, 214, 10, 0.85)" as Color,
    },
    {
      color: "#30D158" as Color, // Google 亮绿
      shadow: "rgba(48, 209, 88, 0.85)" as Color,
    },
  ]

  const current = colorConfigs[phase]
  const angleValue = phase * 90

  return (
    <ZStack
      alignment="center"
      frame={{ width: 68, height: 68 }}
      background={{
        colors: GOOGLE_COLORS,
        center: "center",
        startAngle: { type: "degrees", value: angleValue },
        endAngle: { type: "degrees", value: angleValue + 360 },
      }}
      clipShape={{ type: "capsule", style: "continuous" }}
      shadow={{ color: current.shadow, radius: 14, x: 0, y: 0 }}
      animation={{
        animation: Animation.smooth({ duration: 0.4 }),
        value: phase,
      }}
    >
      <ZStack
        alignment="center"
        frame={{ width: 60, height: 60 }}
        background="rgba(16, 16, 20, 0.94)"
        clipShape={{ type: "capsule", style: "continuous" }}
      >
        <Image
          systemName="sparkles"
          font="largeTitle"
          foregroundStyle={current.color}
          symbolEffect={{
            effect: "breathe",
            value: phase,
          }}
          animation={{
            animation: Animation.smooth({ duration: 0.35 }),
            value: phase,
          }}
        />
      </ZStack>
    </ZStack>
  )
}

function IllustAIPageRow(props: {
  illust: PixivIllustration
  pageIndex: number
  mode: IllustAIMode
  containerWidth: number
  defaultAspect: number
  cache: PageTranslationCache | undefined
  isPageTranslating: boolean
  showAllOverlay: boolean
  fontScale: number
  onToggleBubbleIndex: (pageIndex: number, hitIndex: number) => void
  onTapCanvasBubble: (pageIndex: number, touchPoint: { x: number; y: number }) => void
  onExecutePage: (pageIndex: number, force?: boolean) => void
  onRegisterScreenshot: (pageIndex: number, maker: ScreenshotMaker | null) => void
  onRegisterCanvasSize: (pageIndex: number, size: { width: number; height: number }) => void
}) {
  const {
    illust,
    pageIndex,
    mode,
    containerWidth,
    defaultAspect,
    cache,
    isPageTranslating,
    showAllOverlay,
    fontScale,
    onToggleBubbleIndex,
    onTapCanvasBubble,
    onExecutePage,
    onRegisterScreenshot,
    onRegisterCanvasSize,
  } = props

  const pageUrl = imageUrlOf(illust, pageIndex, "large")
  const thumbUrl = pageThumbUrlOf(illust, pageIndex)

  const [measuredAspect, setMeasuredAspect] = useState<number | null>(() => {
    const targetFile =
      cache?.imageFilePath ||
      (pageUrl ? cachedFilePath(pageUrl) : null) ||
      (thumbUrl ? cachedFilePath(thumbUrl) : null)
    if (targetFile) {
      try {
        const img = UIImage.fromFile(targetFile)
        if (img && img.width > 0 && img.height > 0) {
          return img.width / img.height
        }
      } catch {}
    }
    if (pageIndex === 0 && illust.width && illust.height && illust.width > 0 && illust.height > 0) {
      return illust.width / illust.height
    }
    return null
  })

  useEffect(() => {
    const targetFile =
      cache?.imageFilePath ||
      (pageUrl ? cachedFilePath(pageUrl) : null) ||
      (thumbUrl ? cachedFilePath(thumbUrl) : null)
    if (targetFile) {
      try {
        const img = UIImage.fromFile(targetFile)
        if (img && img.width > 0 && img.height > 0) {
          const ratio = img.width / img.height
          setMeasuredAspect((prev) => (prev && Math.abs(prev - ratio) < 0.005 ? prev : ratio))
        }
      } catch {}
    }
  }, [cache?.imageFilePath, pageUrl, thumbUrl])

  const hasBubbles = Boolean(cache?.bubbles && cache.bubbles.length > 0)
  const imageFilePath = cache?.imageFilePath || null
  const isOverlayVisible = cache?.showOverlay !== false && showAllOverlay
  const hiddenIndices = useMemo(
    () => new Set(cache?.hiddenBubbleIndices || []),
    [cache?.hiddenBubbleIndices]
  )
  const pageError = cache?.error || null

  const hasVisionResult = Boolean(cache?.generatedImageBase64)
  const visionUIImage = useMemo(() => {
    if (hasVisionResult && isOverlayVisible && cache?.generatedImageBase64) {
      try {
        return UIImage.fromBase64String(cache.generatedImageBase64)
      } catch {
        return null
      }
    }
    return null
  }, [hasVisionResult, isOverlayVisible, cache?.generatedImageBase64])

  const pageAspect = useMemo(() => {
    if (mode === "vision" && visionUIImage && visionUIImage.width > 0 && visionUIImage.height > 0) {
      return visionUIImage.width / visionUIImage.height
    }
    if (measuredAspect && measuredAspect > 0) {
      return measuredAspect
    }
    return defaultAspect
  }, [mode, visionUIImage, measuredAspect, defaultAspect])

  const pageRenderHeight = containerWidth / pageAspect

  return (
    <Group>
      {mode === "ocr" && hasBubbles && imageFilePath ? (
        <ZStack
          alignment="topLeading"
          frame={{ width: containerWidth, height: pageRenderHeight }}
        >
          <Canvas
            screenshotRef={{
              set current(val: ScreenshotMaker | null) {
                onRegisterScreenshot(pageIndex, val)
              },
              get current() {
                return null
              },
            }}
            aspectRatio={{ value: pageAspect, contentMode: "fit" }}
            onTapGesture={{
              count: 1,
              coordinateSpace: "local",
              perform: (point?: any) => {
                if (point && typeof point.x === "number" && typeof point.y === "number") {
                  onTapCanvasBubble(pageIndex, point)
                }
              },
            }}
            draw={(ctx, size) => {
              onRegisterCanvasSize(pageIndex, size)
              drawOCROverlay(
                ctx,
                size,
                imageFilePath,
                cache!.bubbles!,
                isOverlayVisible,
                hiddenIndices,
                fontScale
              )
            }}
          />

          {cache!.bubbles!.map((bubble, bIdx) => {
            const [ymin, xmin, ymax, xmax] = bubble.box_2d || [0, 0, 0, 0]
            const rawW =
              ((Math.max(0, Math.min(xmax, 1000)) - Math.max(0, Math.min(xmin, 1000))) / 1000) *
              containerWidth
            const rawH =
              ((Math.max(0, Math.min(ymax, 1000)) - Math.max(0, Math.min(ymin, 1000))) / 1000) *
              pageRenderHeight
            const rawX = (Math.max(0, Math.min(xmin, 1000)) / 1000) * containerWidth
            const rawY = (Math.max(0, Math.min(ymin, 1000)) / 1000) * pageRenderHeight

            const cX = rawX + rawW / 2
            const cY = rawY + rawH / 2
            const hitW = Math.max(30, rawW * fontScale)
            const hitH = Math.max(30, rawH * fontScale)
            const hitLeft = cX - hitW / 2
            const hitTop = cY - hitH / 2

            return (
              <Button
                key={String(bIdx)}
                buttonStyle="plain"
                offset={{ x: hitLeft, y: hitTop }}
                action={() => onToggleBubbleIndex(pageIndex, bIdx)}
              >
                <VStack
                  frame={{
                    width: hitW,
                    height: hitH,
                  }}
                  background="rgba(0, 0, 0, 0.001)"
                  contentShape="rect"
                />
              </Button>
            )
          })}
        </ZStack>
      ) : mode === "vision" && hasVisionResult && visionUIImage ? (
        <ZStack alignment="center" frame={{ width: containerWidth, height: pageRenderHeight }}>
          <Image
            image={visionUIImage}
            resizable={true}
            aspectRatio={{ value: pageAspect, contentMode: "fit" }}
          />
        </ZStack>
      ) : (
        <ZStack alignment="center" frame={{ maxWidth: "infinity" }}>
          <CachedImage
            url={pageUrl}
            previewUrl={thumbUrl}
            aspectRatioValue={pageAspect}
            useIntrinsicAspectRatio={true}
            cornerRadius={0}
            contentMode="fit"
            onLoaded={(ok) => {
              if (ok) {
                const p =
                  (pageUrl ? cachedFilePath(pageUrl) : null) ||
                  (thumbUrl ? cachedFilePath(thumbUrl) : null)
                if (p) {
                  try {
                    const img = UIImage.fromFile(p)
                    if (img && img.width > 0 && img.height > 0) {
                      setMeasuredAspect(img.width / img.height)
                    }
                  } catch {}
                }
              }
            }}
          />

          {/* 1. 未翻译状态：原始图片正中心悬浮金色 sparkles 图标（加大一号，纯图标） */}
          {((mode === "ocr" && !hasBubbles) || (mode === "vision" && !hasVisionResult)) &&
            !isPageTranslating &&
            !pageError && (
              <Button
                buttonStyle="plain"
                action={() => {
                  if (!isPageTranslating) {
                    void onExecutePage(pageIndex)
                  }
                }}
              >
                <ZStack
                  alignment="center"
                  frame={{ width: 66, height: 66 }}
                  background="rgba(0, 0, 0, 0.52)"
                  clipShape={{ type: "capsule", style: "continuous" }}
                >
                  <Image
                    systemName="sparkles"
                    font="largeTitle"
                    foregroundStyle="#FFD60A"
                  />
                </ZStack>
              </Button>
            )}

          {/* 2. 正在翻译/生图中：Google 四色流光边框 + 原生 SF Symbol 星光动效 */}
          {isPageTranslating && <GoogleSparklesLoading />}

          {/* 3. 翻译/生图失败：正中心悬浮重试图标（加大一号） */}
          {Boolean(pageError) && !isPageTranslating && (
            <Button
              buttonStyle="plain"
              action={() => void onExecutePage(pageIndex, true)}
            >
              <ZStack
                alignment="center"
                frame={{ width: 60, height: 60 }}
                background="rgba(255, 69, 58, 0.85)"
                clipShape={{ type: "capsule", style: "continuous" }}
              >
                <Image
                  systemName="arrow.clockwise"
                  font="title"
                  foregroundStyle="white"
                />
              </ZStack>
            </Button>
          )}
        </ZStack>
      )}
    </Group>
  )
}

export function IllustAISheet(props: {
  illust: PixivIllustration
  mode: IllustAIMode
  isPresented: boolean
  onChanged: (presented: boolean) => void
}) {
  const { illust, mode, isPresented, onChanged } = props

  // 基础状态
  const [selectedPageIndex, setSelectedPageIndex] = useState(0)
  const [showOriginalCaption, setShowOriginalCaption] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [fontScale, setFontScale] = useState(1.0)
  const [showAllOverlay, setShowAllOverlay] = useState(true)

  // 记录每一页独立翻译/生图缓存
  const [pageCaches, setPageCaches] = useState<Record<number, PageTranslationCache>>({})
  const [translatingIndices, setTranslatingIndices] = useState<number[]>([])

  interface TaskToken {
    id: number
    aborted: boolean
    onAbort?: (cb: () => void) => () => void
    triggerAbort?: () => void
  }

  const pageTokensRef = useRef<Record<number, TaskToken>>({})
  const taskSeqRef = useRef(0)
  const isPresentedRef = useRef(isPresented)
  const canvasScreenshotRefs = useRef<Record<number, ScreenshotMaker | null>>({})
  const canvasSizesRef = useRef<Record<number, { width: number; height: number }>>({})

  useEffect(() => {
    isPresentedRef.current = isPresented
  }, [isPresented])

  const pageCount = Math.max(1, illust.page_count || illust.meta_pages?.length || 1)
  const rawCaption = cleanHtmlCaption(illust.caption)

  const illustWidth = illust.width || 800
  const illustHeight = illust.height || 1200
  const defaultAspect = illustWidth / illustHeight

  // 当为多页作品时，在打开 AI 弹窗时高优先级预热所有页面的中等缩略图，
  // 确保所有页面在翻译前首帧 0 延迟命中真实物理比例与模糊底图
  useEffect(() => {
    if (!isPresented || !illust || pageCount <= 1) return
    for (let idx = 0; idx < pageCount; idx++) {
      const thumb = pageThumbUrlOf(illust, idx)
      if (thumb && !cachedFilePath(thumb)) {
        void loadImage(thumb, -2000 + idx)
      }
    }
  }, [isPresented, illust, pageCount])

  const isAnyTranslating = translatingIndices.length > 0

  function getSheetTitle() {
    switch (mode) {
      case "caption":
        return "AI 简介翻译"
      case "ocr":
        return "AI 漫画翻译（OCR）"
      case "vision":
        return "AI 翻译图片（生图）"
      default:
        return "AI 助手"
    }
  }

  // 停止指定页翻译
  function handleStopPage(pageIndex: number) {
    const token = pageTokensRef.current[pageIndex]
    if (token) {
      token.triggerAbort?.()
      token.aborted = true
    }
    setTranslatingIndices((prev) => prev.filter((i) => i !== pageIndex))
  }

  // 停止所有正在进行的翻译
  function handleStopAll() {
    for (const key of Object.keys(pageTokensRef.current)) {
      const idx = Number(key)
      if (pageTokensRef.current[idx]) {
        pageTokensRef.current[idx].triggerAbort?.()
        pageTokensRef.current[idx].aborted = true
      }
    }
    setTranslatingIndices([])
  }

  // 切换指定页气泡的独立显隐（通过气泡下标）
  function handleToggleBubbleIndex(pageIndex: number, hitIndex: number) {
    setPageCaches((prev) => {
      const prevHidden = prev[pageIndex]?.hiddenBubbleIndices || []
      const nextHidden = prevHidden.includes(hitIndex)
        ? prevHidden.filter((i: number) => i !== hitIndex)
        : [...prevHidden, hitIndex]

      return {
        ...prev,
        [pageIndex]: {
          ...prev[pageIndex],
          hiddenBubbleIndices: nextHidden,
        },
      }
    })
    void Haptics.transient(0.3, 0.3)
  }

  // 点击坐标碰撞检测气泡（备用兜底）
  function handleTapCanvasBubble(pageIndex: number, touchPoint: { x: number; y: number }) {
    const canvasSize = canvasSizesRef.current[pageIndex]
    const bubbles = pageCaches[pageIndex]?.bubbles || []
    if (!canvasSize || !canvasSize.width || !canvasSize.height || bubbles.length === 0) return

    const normX = (touchPoint.x / canvasSize.width) * 1000
    const normY = (touchPoint.y / canvasSize.height) * 1000

    let hitIndex = -1
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const [ymin, xmin, ymax, xmax] = bubbles[i].box_2d
      const cX = (xmin + xmax) / 2
      const cY = (ymin + ymax) / 2
      const halfW = ((xmax - xmin) / 2) * fontScale + 20
      const halfH = ((ymax - ymin) / 2) * fontScale + 20
      if (
        normX >= cX - halfW &&
        normX <= cX + halfW &&
        normY >= cY - halfH &&
        normY <= cY + halfH
      ) {
        hitIndex = i
        break
      }
    }

    if (hitIndex !== -1) {
      handleToggleBubbleIndex(pageIndex, hitIndex)
    }
  }

  // 执行单页 OCR / 生图 / 简介翻译
  async function executePage(targetIndex: number, force = false) {
    if (!isPresented) return
    if (translatingIndices.includes(targetIndex) && !force) return

    // 触感反馈
    void Haptics.transient(0.6, 0.6)

    // 中止该页的旧任务
    handleStopPage(targetIndex)

    const abortListeners = new Set<() => void>()
    const taskToken: TaskToken = {
      id: ++taskSeqRef.current,
      aborted: false,
      onAbort: (cb: () => void) => {
        abortListeners.add(cb)
        return () => abortListeners.delete(cb)
      },
      triggerAbort: () => {
        taskToken.aborted = true
        for (const listener of abortListeners) {
          try {
            listener()
          } catch {}
        }
      },
    }
    pageTokensRef.current[targetIndex] = taskToken

    setTranslatingIndices((prev) => (prev.includes(targetIndex) ? prev : [...prev, targetIndex]))

    // 清除该页先前的错误
    setPageCaches((prev) => ({
      ...prev,
      [targetIndex]: {
        ...prev[targetIndex],
        resultText: "",
        generatedImageBase64: mode === "vision" ? null : prev[targetIndex]?.generatedImageBase64,
        error: null,
      },
    }))

    const throttler = createThrottledUpdater((text) => {
      if (pageTokensRef.current[targetIndex]?.id !== taskToken.id || taskToken.aborted) return
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
          if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
            setPageCaches((prev) => ({
              ...prev,
              [targetIndex]: { resultText: "该作品作者未填写简介。", error: null },
            }))
          }
          return
        }
        const finalResult = await streamTranslateText(rawCaption, {
          onChunk: (text: string) => {
            if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
              throttler.push(text)
            }
          },
          signal: taskToken,
        })
        if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
          throttler.flush(finalResult)
          void Haptics.transient(0.8, 0.8)
        }
      } else if (mode === "ocr") {
        const finalResult = await streamVisionTranslateImage(illust, targetIndex, {
          onImageReady: (filePath) => {
            if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
              setPageCaches((prev) => ({
                ...prev,
                [targetIndex]: {
                  ...prev[targetIndex],
                  imageFilePath: filePath,
                },
              }))
            }
          },
          onBubblesParsed: (bubbles) => {
            if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
              setPageCaches((prev) => ({
                ...prev,
                [targetIndex]: {
                  ...prev[targetIndex],
                  bubbles,
                },
              }))
            }
          },
          onChunk: (text: string) => {
            if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
              throttler.push(text)
            }
          },
          signal: taskToken,
        })
        if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
          throttler.flush(finalResult)
          void Haptics.transient(0.9, 0.9)
        }
      } else if (mode === "vision") {
        const finalResult = await streamGenerateTranslatedImage(illust, targetIndex, {
          onChunk: (text: string) => {
            if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
              throttler.push(text)
            }
          },
          onImageGenerated: (imageData) => {
            if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
              setPageCaches((prev) => ({
                ...prev,
                [targetIndex]: {
                  ...prev[targetIndex],
                  generatedImageBase64: imageData.base64,
                  error: null,
                },
              }))
            }
          },
          signal: taskToken,
        })
        if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
          throttler.flush(finalResult)
          void Haptics.transient(0.9, 0.9)
        }
      }
    } catch (e: any) {
      throttler.cancel()
      if (pageTokensRef.current[targetIndex]?.id === taskToken.id && !taskToken.aborted) {
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
      if (pageTokensRef.current[targetIndex]?.id === taskToken.id) {
        setTranslatingIndices((prev) => prev.filter((i) => i !== targetIndex))
      }
    }
  }

  // 判断某一页是否已有翻译/生成结果
  function hasPageTranslation(idx: number): boolean {
    const cache = pageCaches[idx]
    if (mode === "ocr") {
      return Boolean(cache?.bubbles && cache.bubbles.length > 0)
    }
    if (mode === "vision") {
      return Boolean(cache?.generatedImageBase64)
    }
    return Boolean(cache?.resultText)
  }

  // 一键并发翻译所有未翻译的页面（OCR / 生图模式共用）
  async function handleTranslateAll() {
    void Haptics.transient(0.6, 0.6)

    // 1. 找出所有尚未完成翻译/生成的页面
    const targetIndices = Array.from({ length: pageCount }, (_, i) => i).filter(
      (idx) => !hasPageTranslation(idx)
    )

    if (targetIndices.length === 0) return

    // 2. 只要点击了全部翻译，所有未完成页面立刻开始播放动效
    setTranslatingIndices((prev) => Array.from(new Set([...prev, ...targetIndices])))

    // 清空待处理页面的历史错误
    setPageCaches((prev) => {
      const next = { ...prev }
      for (const idx of targetIndices) {
        next[idx] = {
          ...next[idx],
          resultText: "",
          generatedImageBase64: mode === "vision" ? null : next[idx]?.generatedImageBase64,
          error: null,
        }
      }
      return next
    })

    // 3. 从设置中读取图片翻译并发数配置（范围 1-6，默认值 4）
    const concurrencyLimit = Math.max(
      1,
      Math.min(6, loadSettings().aiTranslateConcurrency ?? 4)
    )

    // 4. 并发任务池调度
    const queue = [...targetIndices]
    const activeWorkers = Math.min(concurrencyLimit, queue.length)

    const workers = Array.from({ length: activeWorkers }, async () => {
      while (queue.length > 0) {
        if (!isPresentedRef.current) break
        const nextIndex = queue.shift()
        if (nextIndex === undefined) break
        await executePage(nextIndex, true)
      }
    })

    await Promise.all(workers)
  }

  // 下载保存相册
  async function handleDownload() {
    if (downloading) return
    try {
      setDownloading(true)
      let savedCount = 0

      if (mode === "vision") {
        for (let idx = 0; idx < pageCount; idx++) {
          const cache = pageCaches[idx]
          if (cache?.generatedImageBase64) {
            const data = Data.fromBase64String(cache.generatedImageBase64)
            if (data) {
              const fileName = `${illust.id}_p${idx}_ai_gen.jpg`
              const ok = await saveImageToPixivAlbum(data, fileName)
              if (ok) savedCount++
            }
          }
        }
      } else if (mode === "ocr") {
        // 保存所有已翻译/已渲染的 Canvas 截图
        for (let idx = 0; idx < pageCount; idx++) {
          const cache = pageCaches[idx]
          if (!cache?.imageFilePath && !cache?.bubbles?.length) continue

          const fileName = `${illust.id}_p${idx}_ocr.jpg`
          let imageToSave: Data | string | null = null

          const screenshot = canvasScreenshotRefs.current[idx]?.screenshot()
          if (screenshot) {
            imageToSave = Data.fromJPEG(screenshot, 0.95) || Data.fromPNG(screenshot)
          }

          if (!imageToSave && cache.imageFilePath) {
            imageToSave = cache.imageFilePath
          }

          if (imageToSave) {
            const ok = await saveImageToPixivAlbum(imageToSave, fileName)
            if (ok) savedCount++
          }
        }
      }

      if (savedCount > 0) {
        void Haptics.transient(0.8, 0.8)
      }
    } catch (e: any) {
      console.log("save photo error:", e?.message || e)
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    return () => {
      handleStopAll()
    }
  }, [])

  useEffect(() => {
    setPageCaches({})
    setSelectedPageIndex(0)
    setTranslatingIndices([])
    setShowAllOverlay(true)
  }, [illust.id, mode])

  useEffect(() => {
    if (isPresented) {
      if (mode === "caption") {
        if (!pageCaches[0]?.resultText) {
          void executePage(0)
        }
      }
    } else {
      handleStopAll()
    }
  }, [isPresented, mode, illust.id])

  // 计算是否有已翻译/已生成的页面可供下载
  const hasDownloadableContent = useMemo(() => {
    if (mode === "ocr") {
      return Object.values(pageCaches).some(
        (c) => Boolean(c?.imageFilePath) || (c?.bubbles && c.bubbles.length > 0)
      )
    }
    if (mode === "vision") {
      return Object.values(pageCaches).some(
        (c) => Boolean(c?.generatedImageBase64)
      )
    }
    return false
  }, [mode, pageCaches])

  // 是否有尚未翻译/生成的页面
  const hasUntranslatedPages = useMemo(() => {
    if (mode === "ocr") {
      for (let i = 0; i < pageCount; i++) {
        if (!pageCaches[i]?.bubbles?.length) return true
      }
      return false
    }
    if (mode === "vision") {
      for (let i = 0; i < pageCount; i++) {
        if (!pageCaches[i]?.generatedImageBase64) return true
      }
      return false
    }
    return false
  }, [mode, pageCount, pageCaches])

  // 简介模式展示的翻译结果
  const currentCaptionResult = pageCaches[0]?.resultText || ""

  return (
    <GeometryReader>
      {(proxy) => {
        const containerWidth = proxy.size.width || 390
        const pageRenderHeight = containerWidth / defaultAspect

        return (
          <AISheetScaffold
            title=""
            subtitle={undefined}
            loading={mode === "caption" ? isAnyTranslating : false}
            streaming={isAnyTranslating}
            hideResultText={mode === "ocr" || mode === "vision"}
            noHorizontalPadding={mode === "ocr" || mode === "vision"}
            error={mode === "caption" ? pageCaches[0]?.error || null : null}
            resultText={mode === "caption" ? currentCaptionResult : ""}
            actionButtonType={mode === "caption" ? "copy" : "download"}
            actionButtonDisabled={
              mode === "caption"
                ? !currentCaptionResult || isAnyTranslating
                : !hasDownloadableContent || downloading
            }
            onAction={mode === "caption" ? undefined : handleDownload}
            extraTrailingActions={
              (mode === "ocr" || mode === "vision") && !isAnyTranslating ? (
                <HStack spacing={12}>
                  {hasDownloadableContent && (
                    <Button
                      title={showAllOverlay ? "隐藏译文" : "显示译文"}
                      systemImage={showAllOverlay ? "eye" : "eye.slash"}
                      action={() => {
                        setShowAllOverlay(!showAllOverlay)
                        void Haptics.transient(0.4, 0.4)
                      }}
                    />
                  )}
                  {pageCount > 1 && hasUntranslatedPages && (
                    <Button
                      title="全部翻译"
                      systemImage="wand.and.stars"
                      action={handleTranslateAll}
                    />
                  )}
                </HStack>
              ) : null
            }
            onDismiss={() => {
              handleStopAll()
              onChanged(false)
            }}
            onRetry={() => {
              if (mode === "caption") {
                void executePage(0, true)
              } else if (mode === "vision") {
                void executePage(selectedPageIndex, true)
              }
            }}
            onStop={handleStopAll}
          >
            {/* ────────────────── 1. 简介翻译模式 ────────────────── */}
            {mode === "caption" && Boolean(rawCaption) && (
              <OriginalCaptionCollapsible
                rawCaption={rawCaption}
                showOriginal={showOriginalCaption}
                onToggle={() => setShowOriginalCaption(!showOriginalCaption)}
              />
            )}

            {/* ────────────────── 2. OCR 漫画翻译模式 / 生图汉化模式 ────────────────── */}
            {(mode === "ocr" || mode === "vision") && (
              <VStack spacing={12} frame={{ maxWidth: "infinity" }}>
                {/* 仅 OCR 模式展示：顶部小说排版同款字号调节器 */}
                {mode === "ocr" && (
                  <VStack padding={{ horizontal: 16 }} frame={{ maxWidth: "infinity" }}>
                    <VStack
                      spacing={8}
                      padding={{ horizontal: 16, vertical: 10 }}
                      glassEffect={{ type: "rect", cornerRadius: 14 }}
                      contentShape={{ type: "rect", cornerRadius: 14 }}
                      frame={{ maxWidth: "infinity" }}
                    >
                      <HStack alignment="center">
                        <HStack spacing={6} alignment="center">
                          <Image
                            systemName="textformat.size"
                            font="subheadline"
                            foregroundStyle="#007AFF"
                          />
                          <Text font="subheadline" fontWeight="semibold">
                            气泡与文字大小
                          </Text>
                        </HStack>
                        <Spacer />
                        <Text font="subheadline" fontWeight="medium" foregroundStyle="secondaryLabel">
                          {Math.round(fontScale * 100)}%
                        </Text>
                      </HStack>

                      <HStack spacing={14} alignment="center">
                        <Button
                          buttonStyle="plain"
                          action={() => {
                            const next = Math.max(0.7, Number((fontScale - 0.05).toFixed(2)))
                            setFontScale(next)
                            void Haptics.transient(0.3, 0.3)
                          }}
                        >
                          <Text font="subheadline" fontWeight="bold" foregroundStyle="#007AFF">
                            A -
                          </Text>
                        </Button>

                        <Slider
                          min={0.7}
                          max={1.5}
                          step={0.05}
                          value={fontScale}
                          onChanged={(val) => setFontScale(Number(val.toFixed(2)))}
                        />

                        <Button
                          buttonStyle="plain"
                          action={() => {
                            const next = Math.min(1.5, Number((fontScale + 0.05).toFixed(2)))
                            setFontScale(next)
                            void Haptics.transient(0.3, 0.3)
                          }}
                        >
                          <Text font="subheadline" fontWeight="bold" foregroundStyle="#007AFF">
                            A +
                          </Text>
                        </Button>
                      </HStack>
                    </VStack>
                  </VStack>
                )}

                {/* 下方全图平铺连贯漫画流：0 间隔、0 冗余文字、精准滚动 */}
                <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
                  {Array.from({ length: pageCount }).map((_, idx) => (
                    <IllustAIPageRow
                      key={String(idx)}
                      illust={illust}
                      pageIndex={idx}
                      mode={mode}
                      containerWidth={containerWidth}
                      defaultAspect={defaultAspect}
                      cache={pageCaches[idx]}
                      isPageTranslating={translatingIndices.includes(idx)}
                      showAllOverlay={showAllOverlay}
                      fontScale={fontScale}
                      onToggleBubbleIndex={handleToggleBubbleIndex}
                      onTapCanvasBubble={handleTapCanvasBubble}
                      onExecutePage={executePage}
                      onRegisterScreenshot={(pIdx, maker) => {
                        canvasScreenshotRefs.current[pIdx] = maker
                      }}
                      onRegisterCanvasSize={(pIdx, size) => {
                        canvasSizesRef.current[pIdx] = size
                      }}
                    />
                  ))}
                </VStack>
              </VStack>
            )}
          </AISheetScaffold>
        )
      }}
    </GeometryReader>
  )
}
