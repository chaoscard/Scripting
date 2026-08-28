import { AISheetScaffold } from "./AISheetScaffold"
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
import { imageUrlOf } from "../../image/imageLoader"
import { drawOCROverlay } from "./OCRCanvas"
import { createThrottledUpdater } from "./throttle"
import type { IllustAIMode, PageTranslationCache, ScreenshotMaker } from "./types"

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

  const pageTokensRef = useRef<Record<number, { id: number; aborted: boolean }>>({})
  const taskSeqRef = useRef(0)
  const canvasScreenshotRefs = useRef<Record<number, ScreenshotMaker | null>>({})
  const canvasSizesRef = useRef<Record<number, { width: number; height: number }>>({})

  const pageCount = Math.max(1, illust.page_count || illust.meta_pages?.length || 1)
  const rawCaption = cleanHtmlCaption(illust.caption)

  const illustWidth = illust.width || 800
  const illustHeight = illust.height || 1200
  const defaultAspect = illustWidth / illustHeight

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
      token.aborted = true
    }
    setTranslatingIndices((prev) => prev.filter((i) => i !== pageIndex))
  }

  // 停止所有正在进行的翻译
  function handleStopAll() {
    for (const key of Object.keys(pageTokensRef.current)) {
      const idx = Number(key)
      if (pageTokensRef.current[idx]) {
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
      if (normX >= xmin - 20 && normX <= xmax + 20 && normY >= ymin - 20 && normY <= ymax + 20) {
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

    const taskToken = { id: ++taskSeqRef.current, aborted: false }
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

  // 一键翻译所有未翻译的页面
  async function handleTranslateAll() {
    void Haptics.transient(0.6, 0.6)
    for (let idx = 0; idx < pageCount; idx++) {
      const cache = pageCaches[idx]
      const hasTranslation = Boolean(cache?.bubbles && cache.bubbles.length > 0)
      if (!hasTranslation && !translatingIndices.includes(idx)) {
        await executePage(idx)
      }
    }
  }

  // 下载保存相册
  async function handleDownload() {
    if (downloading) return
    try {
      setDownloading(true)
      let savedCount = 0

      if (mode === "vision") {
        const cache = pageCaches[selectedPageIndex]
        if (cache?.generatedImageBase64) {
          const data = Data.fromBase64String(cache.generatedImageBase64)
          if (data) {
            const fileName = `${illust.id}_p${selectedPageIndex}_ai_gen.jpg`
            const ok = await saveImageToPixivAlbum(data, fileName)
            if (ok) savedCount++
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

  // 计算是否有已翻译的页面可供下载
  const hasDownloadableContent = useMemo(() => {
    if (mode === "ocr") {
      return Object.values(pageCaches).some(
        (c) => Boolean(c?.imageFilePath) || (c?.bubbles && c.bubbles.length > 0)
      )
    }
    if (mode === "vision") {
      return Boolean(pageCaches[selectedPageIndex]?.generatedImageBase64)
    }
    return false
  }, [mode, pageCaches, selectedPageIndex])

  // 是否有尚未翻译的页面
  const hasUntranslatedPages = useMemo(() => {
    if (mode !== "ocr") return false
    for (let i = 0; i < pageCount; i++) {
      if (!pageCaches[i]?.bubbles?.length) return true
    }
    return false
  }, [mode, pageCount, pageCaches])

  // 简介模式展示的翻译结果
  const currentCaptionResult = pageCaches[0]?.resultText || ""

  const visionImage = useMemo(() => {
    const b64 = pageCaches[selectedPageIndex]?.generatedImageBase64
    return b64 ? UIImage.fromBase64String(b64) : null
  }, [pageCaches, selectedPageIndex])

  return (
    <GeometryReader>
      {(proxy) => {
        const containerWidth = proxy.size.width || 390
        const pageRenderHeight = containerWidth / defaultAspect

        return (
          <AISheetScaffold
            title={mode === "ocr" ? "" : getSheetTitle()}
            subtitle={
              mode === "caption"
                ? `作品：${illust.title} (@${illust.user?.name})`
                : undefined
            }
            loading={mode === "caption" ? isAnyTranslating : false}
            streaming={isAnyTranslating}
            hideResultText={mode === "ocr"}
            noHorizontalPadding={mode === "ocr"}
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
              mode === "ocr" && !isAnyTranslating ? (
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
              <VStack spacing={6}>
                <HStack alignment="center">
                  <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
                    原文
                  </Text>
                  <Spacer />
                  <Button
                    title={showOriginalCaption ? "收起" : "展开"}
                    action={() => setShowOriginalCaption(!showOriginalCaption)}
                  />
                </HStack>
                {showOriginalCaption && (
                  <Text font="footnote" foregroundStyle="secondaryLabel" lineSpacing={3}>
                    {rawCaption}
                  </Text>
                )}
              </VStack>
            )}

            {/* ────────────────── 2. OCR 漫画翻译模式 ────────────────── */}
            {mode === "ocr" && (
              <VStack spacing={12} frame={{ maxWidth: "infinity" }}>
                {/* 顶部：小说排版同款字号调节器 */}
                <VStack padding={{ horizontal: 16 }} frame={{ maxWidth: "infinity" }}>
                  <VStack
                    spacing={8}
                    padding={{ horizontal: 16, vertical: 10 }}
                    background="secondarySystemBackground"
                    clipShape={{ type: "rect", cornerRadius: 14 }}
                  >
                    <HStack alignment="center">
                      <HStack spacing={6} alignment="center">
                        <Image
                          systemName="textformat.size"
                          font="subheadline"
                          foregroundStyle="#007AFF"
                        />
                        <Text font="subheadline" fontWeight="semibold">
                          气泡字号调节
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

                {/* 下方全图平铺连贯漫画流：0 间隔、0 冗余文字、精准可点气泡与顺畅滚动 */}
                <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
                  {Array.from({ length: pageCount }).map((_, idx) => {
                    const pageUrl = imageUrlOf(illust, idx, "large")
                    const cache = pageCaches[idx]
                    const isPageTranslating = translatingIndices.includes(idx)
                    const hasBubbles = Boolean(cache?.bubbles && cache.bubbles.length > 0)
                    const imageFilePath = cache?.imageFilePath || null
                    const isOverlayVisible = cache?.showOverlay !== false && showAllOverlay
                    const hiddenIndices = new Set(cache?.hiddenBubbleIndices || [])
                    const pageError = cache?.error || null

                    return (
                      <Group key={String(idx)}>
                        {/* 状态 A: 翻译完成 -> Canvas 图层 + 精准气泡透明按钮热区（保证ScrollView丝滑滚动同时精准响应点击） */}
                        {hasBubbles && imageFilePath ? (
                          <ZStack
                            alignment="topLeading"
                            frame={{ width: containerWidth, height: pageRenderHeight }}
                          >
                            <Canvas
                              screenshotRef={{
                                set current(val: ScreenshotMaker | null) {
                                  canvasScreenshotRefs.current[idx] = val
                                },
                                get current() {
                                  return canvasScreenshotRefs.current[idx] || null
                                },
                              }}
                              aspectRatio={{ value: defaultAspect, contentMode: "fit" }}
                              onTapGesture={{
                                count: 1,
                                coordinateSpace: "local",
                                perform: (point?: any) => {
                                  if (point && typeof point.x === "number" && typeof point.y === "number") {
                                    handleTapCanvasBubble(idx, point)
                                  }
                                },
                              }}
                              draw={(ctx, size) => {
                                canvasSizesRef.current[idx] = size
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

                            {/* 叠加各气泡透明热区 Button（Native Button 完美兼顾 ScrollView 滚动让位与轻点响应） */}
                            {cache!.bubbles!.map((bubble, bIdx) => {
                              const [ymin, xmin, ymax, xmax] = bubble.box_2d || [0, 0, 0, 0]
                              const rawW = ((Math.max(0, Math.min(xmax, 1000)) - Math.max(0, Math.min(xmin, 1000))) / 1000) * containerWidth
                              const rawH = ((Math.max(0, Math.min(ymax, 1000)) - Math.max(0, Math.min(ymin, 1000))) / 1000) * pageRenderHeight
                              const bLeft = (Math.max(0, Math.min(xmin, 1000)) / 1000) * containerWidth
                              const bTop = (Math.max(0, Math.min(ymin, 1000)) / 1000) * pageRenderHeight

                              return (
                                <Button
                                  key={String(bIdx)}
                                  buttonStyle="plain"
                                  offset={{ x: bLeft, y: bTop }}
                                  action={() => handleToggleBubbleIndex(idx, bIdx)}
                                >
                                  <VStack
                                    frame={{
                                      width: Math.max(30, rawW),
                                      height: Math.max(30, rawH),
                                    }}
                                    background="rgba(0, 0, 0, 0.001)"
                                    contentShape="rect"
                                  />
                                </Button>
                              )
                            })}
                          </ZStack>
                        ) : (
                          /* 状态 B: 未翻译 / 翻译中 / 失败 -> 底图 + 正中心悬浮 Sparkles */
                          <ZStack alignment="center" frame={{ maxWidth: "infinity" }}>
                            <CachedImage
                              url={pageUrl}
                              aspectRatioValue={defaultAspect}
                              cornerRadius={0}
                              contentMode="fit"
                            />

                            {/* 1. 未翻译状态：原始图片正中心悬浮金色 sparkles 图标（加大一号，纯图标） */}
                            {!hasBubbles && !isPageTranslating && !pageError && (
                              <Button
                                buttonStyle="plain"
                                action={() => {
                                  if (!isPageTranslating) {
                                    void executePage(idx)
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

                            {/* 2. 正在翻译中：正中心悬浮半透明光晕 + ProgressView 特效动效（加大一号） */}
                            {isPageTranslating && (
                              <ZStack
                                alignment="center"
                                frame={{ width: 66, height: 66 }}
                                background="rgba(0, 0, 0, 0.6)"
                                clipShape={{ type: "capsule", style: "continuous" }}
                              >
                                <ProgressView />
                              </ZStack>
                            )}

                            {/* 3. 翻译失败：正中心悬浮重试图标（加大一号） */}
                            {Boolean(pageError) && !isPageTranslating && (
                              <Button
                                buttonStyle="plain"
                                action={() => void executePage(idx, true)}
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
                  })}
                </VStack>
              </VStack>
            )}

            {/* ────────────────── 3. 生图汉化模式 ────────────────── */}
            {mode === "vision" && (
              <VStack spacing={16} padding={{ horizontal: 16 }}>
                {pageCount > 1 && (
                  <ScrollView axes="horizontal">
                    <HStack spacing={8}>
                      {Array.from({ length: pageCount }).map((_, idx) => {
                        const isSelected = selectedPageIndex === idx
                        const cache = pageCaches[idx]
                        const hasResult = Boolean(cache?.generatedImageBase64)
                        const title = hasResult && !isSelected ? `P${idx + 1} ✓` : `P${idx + 1}`
                        return (
                          <Button
                            key={String(idx)}
                            title={title}
                            buttonStyle={isSelected ? "borderedProminent" : "bordered"}
                            action={() => {
                              if (selectedPageIndex !== idx) {
                                handleStopAll()
                                setSelectedPageIndex(idx)
                              }
                            }}
                          />
                        )
                      })}
                    </HStack>
                  </ScrollView>
                )}

                {!pageCaches[selectedPageIndex]?.generatedImageBase64 && !isAnyTranslating && (
                  <VStack spacing={14} padding={{ top: 24, bottom: 20 }} alignment="center">
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
                      action={() => void executePage(selectedPageIndex, true)}
                    />
                  </VStack>
                )}

                {Boolean(visionImage) && (
                  <VStack spacing={12}>
                    <Text font="headline" fontWeight="bold">
                      🎨 汉化重绘结果：
                    </Text>
                    <Image
                      image={visionImage!}
                      resizable={true}
                      aspectRatio={{ contentMode: "fit" }}
                    />
                  </VStack>
                )}
              </VStack>
            )}
          </AISheetScaffold>
        )
      }}
    </GeometryReader>
  )
}
