/**
 * AI 弹窗 Sheet 组件：为图片详情页与小说正文页提供沉浸式 AI 辅助交互
 */
import {
  Button,
  Divider,
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
  useRef,
  useState,
  VStack,
  type VirtualNode,
} from "scripting"
import type { PixivIllustration, PixivNovel, PixivNovelDetail } from "../types"
import {
  cleanHtmlCaption,
  cleanNovelTextForAI,
  getNovelPageText,
  isAIAvailable,
  streamContinueNovel,
  streamGenerateTranslatedImage,
  streamSummarizeNovel,
  streamTranslateNovel,
  streamTranslateText,
  streamVisionTranslateImage,
} from "../api/aiService"
import { ErrorView } from "./components"

export type IllustAIMode = "caption" | "ocr" | "vision"
export type NovelAIMode = "caption" | "translate" | "summary" | "continue"

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
  onDismiss: () => void
  onRetry: () => void
  onStop?: () => void
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
    onDismiss,
    onRetry,
    onStop,
    children,
  } = props

  const available = isAIAvailable()

  function handleCopy() {
    if (!resultText) return
    Pasteboard.setString(resultText)
    void Haptics.transient()
  }

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
                <Button
                  title="复制"
                  systemImage="doc.on.doc"
                  disabled={!resultText || loading}
                  action={handleCopy}
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

              {/* 结果内容展示区 */}
              {Boolean(resultText) && (
                <VStack spacing={12} alignment="leading">
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
                  <Text
                    font="body"
                    lineSpacing={5}
                  >
                    {resultText}
                  </Text>
                </VStack>
              )}
            </>
          )}
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

interface PageTranslationCache {
  resultText: string
  generatedImageBase64?: string | null
  error?: string | null
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
  const [savingPhoto, setSavingPhoto] = useState(false)

  // 记录每一页独立翻译/生图缓存
  const [pageCaches, setPageCaches] = useState<Record<number, PageTranslationCache>>({})

  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })
  const pageCount = Math.max(1, illust.page_count || illust.meta_pages?.length || 1)

  const rawCaption = cleanHtmlCaption(illust.caption)

  // 当前选中页的缓存数据
  const currentPageCache = pageCaches[selectedPageIndex]
  const currentResultText = currentPageCache?.resultText || ""
  const currentGeneratedImageBase64 = currentPageCache?.generatedImageBase64 || null
  const currentError = currentPageCache?.error || null

  function getSheetTitle() {
    switch (mode) {
      case "caption":
        return "AI 简介翻译"
      case "ocr":
        return "AI 图片翻译 (多模态视觉)"
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
        await streamTranslateText(rawCaption, {
          onChunk: (text) => {
            setPageCaches((prev) => ({
              ...prev,
              [targetIndex]: {
                ...prev[targetIndex],
                resultText: text,
                error: null,
              },
            }))
          },
          signal: abortRef.current,
        })
      } else if (mode === "ocr") {
        setProgressInfo(`正在加载第 ${targetIndex + 1} 页并请求多模态大模型视觉识别气泡…`)
        setStreaming(true)
        await streamVisionTranslateImage(illust, targetIndex, {
          onChunk: (text) => {
            setPageCaches((prev) => ({
              ...prev,
              [targetIndex]: {
                ...prev[targetIndex],
                resultText: text,
                error: null,
              },
            }))
          },
          signal: abortRef.current,
        })
      } else if (mode === "vision") {
        setProgressInfo(`正在请求图像生成模型对第 ${targetIndex + 1} 页进行汉化重绘…`)
        setStreaming(true)
        await streamGenerateTranslatedImage(illust, targetIndex, {
          onChunk: (text) => {
            setPageCaches((prev) => ({
              ...prev,
              [targetIndex]: {
                ...prev[targetIndex],
                resultText: text,
                error: null,
              },
            }))
          },
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
      }
    } catch (e: any) {
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

  async function handleSaveGeneratedPhoto() {
    if (!currentGeneratedImageBase64) return
    try {
      setSavingPhoto(true)
      const data = Data.fromBase64String(currentGeneratedImageBase64)
      if (data && typeof Photos !== "undefined" && Photos.savePhoto) {
        await Photos.savePhoto(data)
        void Haptics.transient()
      }
    } catch (e: any) {
      console.log("save photo error:", e?.message || e)
    } finally {
      setSavingPhoto(false)
    }
  }

  useEffect(() => {
    setPageCaches({})
    setSelectedPageIndex(0)
  }, [illust.id, mode])

  useEffect(() => {
    if (isPresented) {
      if (mode !== "vision") {
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

  return (
    <AISheetScaffold
      title={getSheetTitle()}
      subtitle={
        mode === "caption"
          ? `作品：${illust.title} (@${illust.user?.name})`
          : `第 ${selectedPageIndex + 1} / ${pageCount} 页`
      }
      loading={loading}
      streaming={streaming}
      error={currentError}
      resultText={currentResultText}
      progressInfo={progressInfo}
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
        <VStack spacing={8}>
          <Text
            font="subheadline"
            fontWeight="medium"
            foregroundStyle="secondaryLabel"
          >
            选择待翻译的页码（共 {pageCount} 页）：
          </Text>
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
        </VStack>
      )}

      {/* OCR 模式未翻译空状态卡片 */}
      {mode === "ocr" && !loading && !currentResultText && !currentError && (
        <VStack
          spacing={12}
          padding={20}
          alignment="center"
          background={{ light: "#F2F2F7", dark: "#1C1C1E" }}
        >
          <Image
            systemName="doc.text.magnifyingglass"
            font="title"
            foregroundStyle="secondaryLabel"
          />
          <Text font="headline" fontWeight="medium">
            第 {selectedPageIndex + 1} 页尚未翻译
          </Text>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            点击下方按钮开始识别并翻译本页对话气泡
          </Text>
          <Button
            title={`开始翻译第 ${selectedPageIndex + 1} 页`}
            systemImage="sparkles"
            buttonStyle="borderedProminent"
            action={() => void execute(selectedPageIndex)}
          />
        </VStack>
      )}

      {/* 生图模式前置确认与提示卡片 */}
      {mode === "vision" && !currentGeneratedImageBase64 && !loading && (
        <VStack
          spacing={12}
          padding={16}
          background={{ light: "#FFF9E6", dark: "#2C2414" }}
        >
          <HStack spacing={8} alignment="center">
            <Image
              systemName="exclamationmark.triangle.fill"
              font="body"
              foregroundStyle="#FF9500"
            />
            <Text font="headline" fontWeight="bold" foregroundStyle="#FF9500">
              生图汉化模式提示（第 {selectedPageIndex + 1} 页）
            </Text>
          </HStack>
          <Text font="footnote" foregroundStyle="secondaryLabel" lineSpacing={3}>
            1. 本功能需要你在 Scripting 设置中配置支持多模态图像输出或生图的模型。{"\n"}
            2. 单次生图重绘将传输完整高清图像并生成新图，预计消耗较多 Token 与网络流量。
          </Text>
          <Button
            title={`确认开始第 ${selectedPageIndex + 1} 页生图汉化`}
            buttonStyle="borderedProminent"
            action={() => void execute(selectedPageIndex, true)}
          />
        </VStack>
      )}

      {/* 生图结果大图渲染与保存 */}
      {mode === "vision" && Boolean(currentGeneratedUIImage) && (
        <VStack spacing={12}>
          <Text font="headline" fontWeight="bold">
            🎨 生成的汉化重绘图像（第 {selectedPageIndex + 1} 页）：
          </Text>
          {currentGeneratedUIImage && (
            <Image
              image={currentGeneratedUIImage}
              resizable={true}
              aspectRatio={{ contentMode: "fit" }}
            />
          )}
          <HStack spacing={12}>
            <Button
              title={savingPhoto ? "正在保存…" : "保存至相册"}
              systemImage="square.and.arrow.down"
              buttonStyle="borderedProminent"
              disabled={savingPhoto}
              action={handleSaveGeneratedPhoto}
            />
          </HStack>
        </VStack>
      )}
    </AISheetScaffold>
  )
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
  const [error, setError] = useState<string | null>(null)
  const [resultText, setResultText] = useState("")
  const [progressInfo, setProgressInfo] = useState<string | null>(null)
  const [showOriginalCaption, setShowOriginalCaption] = useState(false)

  // 续写模式自定义 prompt
  const [continueInstruction, setContinueInstruction] = useState("")

  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })
  const rawCaption = cleanHtmlCaption(novel.caption)

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

  async function execute() {
    if (!isPresented) return
    abortRef.current = { aborted: false }
    setLoading(true)
    setError(null)
    setResultText("")
    setProgressInfo(null)

    try {
      if (mode === "caption") {
        if (!rawCaption) {
          setResultText("该小说作者未填写简介。")
          setLoading(false)
          return
        }
        setStreaming(true)
        await streamTranslateText(rawCaption, {
          onChunk: (text) => setResultText(text),
          signal: abortRef.current,
        })
      } else if (mode === "translate") {
        if (!cleanedText) {
          setResultText(isMultiPage ? "当前页小说正文为空。" : "未获取到小说正文文本。")
          setLoading(false)
          return
        }
        setStreaming(true)
        await streamTranslateNovel(cleanedText, {
          onChunk: (text) => setResultText(text),
          onProgress: ({ chunkIndex, totalChunks, percent }) => {
            const prefix = isMultiPage ? `第 ${currentPage} 页 ` : ""
            setProgressInfo(`正在翻译${prefix}第 ${chunkIndex}/${totalChunks} 部分 (${percent}%)`)
          },
          signal: abortRef.current,
        })
      } else if (mode === "summary") {
        if (!cleanedText) {
          setResultText(isMultiPage ? "当前页小说正文为空。" : "未获取到小说正文文本。")
          setLoading(false)
          return
        }
        setStreaming(true)
        setProgressInfo(
          isMultiPage
            ? `AI 正在总结第 ${currentPage} 页核心看点…`
            : "AI 正在通读全篇并提炼大纲与看点…"
        )
        await streamSummarizeNovel(cleanedText, {
          onChunk: (text) => setResultText(text),
          signal: abortRef.current,
          pageInfo: isMultiPage ? { current: currentPage, total: totalPages } : undefined,
        })
      } else if (mode === "continue") {
        if (!cleanedText) {
          setResultText("未获取到小说正文文本。")
          setLoading(false)
          return
        }
        setStreaming(true)
        setProgressInfo("AI 正在根据前文风格与设定续写…")
        await streamContinueNovel(cleanedText, continueInstruction, {
          onChunk: (text) => setResultText(text),
          signal: abortRef.current,
        })
      }
    } catch (e: any) {
      if (!abortRef.current.aborted) {
        setError(e?.message || "AI 请求发生异常")
      }
    } finally {
      setLoading(false)
      setStreaming(false)
      setProgressInfo(null)
    }
  }

  function handleStop() {
    abortRef.current.aborted = true
    setStreaming(false)
    setLoading(false)
    setProgressInfo(null)
  }

  useEffect(() => {
    if (isPresented) {
      void execute()
    } else {
      abortRef.current.aborted = true
    }
  }, [isPresented, mode, currentPage])

  return (
    <AISheetScaffold
      title={getSheetTitle()}
      subtitle={getSheetSubtitle()}
      loading={loading}
      streaming={streaming}
      error={error}
      resultText={resultText}
      progressInfo={progressInfo}
      onDismiss={() => {
        handleStop()
        onChanged(false)
      }}
      onRetry={execute}
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
