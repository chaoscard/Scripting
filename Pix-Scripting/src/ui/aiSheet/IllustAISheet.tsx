import { AISheetScaffold } from "./AISheetScaffold"
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
import { ErrorView } from "../components"
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
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [selectedPageIndex, setSelectedPageIndex] = useState(0)
  const [showOriginalCaption, setShowOriginalCaption] = useState(false)
  const [progressInfo, setProgressInfo] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  // 记录每一页独立翻译/生图缓存
  const [pageCaches, setPageCaches] = useState<Record<number, PageTranslationCache>>({})

  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })
  const taskSeqRef = useRef(0)
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
          ? prevHidden.filter((idx: number) => idx !== hitIndex)
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
    const currentSeq = ++taskSeqRef.current

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
          onChunk: (text: string) => throttler.push(text),
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
          onChunk: (text: string) => throttler.push(text),
          signal: abortRef.current,
        })
        throttler.flush(finalResult)
      } else if (mode === "vision") {
        setProgressInfo(`正在请求图像生成模型对第 ${targetIndex + 1} 页进行汉化重绘…`)
        setStreaming(true)
        const finalResult = await streamGenerateTranslatedImage(illust, targetIndex, {
          onChunk: (text: string) => throttler.push(text),
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
      if (taskSeqRef.current === currentSeq) {
        setLoading(false)
        setStreaming(false)
        setProgressInfo(null)
      }
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

  const currentGeneratedUIImage = useMemo(() => {
    return currentGeneratedImageBase64
      ? UIImage.fromBase64String(currentGeneratedImageBase64)
      : null
  }, [currentGeneratedImageBase64])

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
