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
  const [error, setError] = useState<string | null>(null)
  const [resultText, setResultText] = useState("")
  const [selectedPageIndex, setSelectedPageIndex] = useState(0)
  const [showOriginalCaption, setShowOriginalCaption] = useState(false)
  const [progressInfo, setProgressInfo] = useState<string | null>(null)

  // 生图模式状态
  const [confirmedImageGen, setConfirmedImageGen] = useState(false)
  const [generatedImageBase64, setGeneratedImageBase64] = useState<string | null>(null)
  const [savingPhoto, setSavingPhoto] = useState(false)

  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })
  const pageCount = Math.max(1, illust.page_count || illust.meta_pages?.length || 1)

  const rawCaption = cleanHtmlCaption(illust.caption)

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

  async function execute(forceImageGen = false) {
    if (!isPresented) return

    // 生图模式需要用户主动确认
    if (mode === "vision" && !confirmedImageGen && !forceImageGen) {
      return
    }

    abortRef.current = { aborted: false }
    setLoading(true)
    setError(null)
    setResultText("")
    setProgressInfo(null)
    if (mode === "vision") {
      setGeneratedImageBase64(null)
    }

    try {
      if (mode === "caption") {
        if (!rawCaption) {
          setResultText("该作品作者未填写简介。")
          setLoading(false)
          return
        }
        setStreaming(true)
        await streamTranslateText(rawCaption, {
          onChunk: (text) => setResultText(text),
          signal: abortRef.current,
        })
      } else if (mode === "ocr") {
        setProgressInfo(`正在加载第 ${selectedPageIndex + 1} 页并请求多模态大模型视觉识别气泡…`)
        setStreaming(true)
        await streamVisionTranslateImage(illust, selectedPageIndex, {
          onChunk: (text) => setResultText(text),
          signal: abortRef.current,
        })
      } else if (mode === "vision") {
        setProgressInfo(`正在请求图像生成模型对第 ${selectedPageIndex + 1} 页进行汉化重绘…`)
        setStreaming(true)
        await streamGenerateTranslatedImage(illust, selectedPageIndex, {
          onChunk: (text) => setResultText(text),
          onImageGenerated: (imageData) => {
            setGeneratedImageBase64(imageData.base64)
          },
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

  async function handleSaveGeneratedPhoto() {
    if (!generatedImageBase64) return
    try {
      setSavingPhoto(true)
      const data = Data.fromBase64String(generatedImageBase64)
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
    if (isPresented) {
      if (mode === "vision") {
        // 生图模式重置确认状态
        setConfirmedImageGen(false)
        setGeneratedImageBase64(null)
      } else {
        void execute()
      }
    } else {
      abortRef.current.aborted = true
    }
  }, [isPresented, mode])

  const generatedUIImage = generatedImageBase64
    ? UIImage.fromBase64String(generatedImageBase64)
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
      error={error}
      resultText={resultText}
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
        <Group>
          <VStack
            spacing={8}
            padding={12}
            background={{ light: "#F2F2F7", dark: "#1C1C1E" }}
          >
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
                lineSpacing={3}
              >
                {rawCaption}
              </Text>
            )}
          </VStack>
        </Group>
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
              {Array.from({ length: pageCount }).map((_, idx) => (
                <Button
                  key={String(idx)}
                  title={`P${idx + 1}`}
                  buttonStyle={selectedPageIndex === idx ? "borderedProminent" : "bordered"}
                  action={() => {
                    if (selectedPageIndex !== idx) {
                      handleStop()
                      setSelectedPageIndex(idx)
                      setResultText("")
                      setError(null)
                      setProgressInfo(null)
                      setGeneratedImageBase64(null)
                      setConfirmedImageGen(false)
                    }
                  }}
                />
              ))}
            </HStack>
          </ScrollView>
        </VStack>
      )}

      {/* 生图模式前置确认与提示卡片 */}
      {mode === "vision" && !confirmedImageGen && !loading && (
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
              生图汉化模式提示
            </Text>
          </HStack>
          <Text font="footnote" foregroundStyle="secondaryLabel" lineSpacing={3}>
            1. 本功能需要你在 Scripting 设置中配置支持多模态图像输出或生图的模型。{"\n"}
            2. 单次生图重绘将传输完整高清图像并生成新图，预计消耗较多 Token 与网络流量。
          </Text>
          <Button
            title="确认开始生图汉化"
            buttonStyle="borderedProminent"
            action={() => {
              setConfirmedImageGen(true)
              void execute(true)
            }}
          />
        </VStack>
      )}

      {/* 生图结果大图渲染与保存 */}
      {mode === "vision" && Boolean(generatedUIImage) && (
        <VStack spacing={12}>
          <Text font="headline" fontWeight="bold">
            🎨 生成的汉化重绘图像：
          </Text>
          {generatedUIImage && (
            <Image
              image={generatedUIImage}
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
  mode: NovelAIMode
  isPresented: boolean
  onChanged: (presented: boolean) => void
}) {
  const { novel, fullText, mode, isPresented, onChanged } = props
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
  const cleanedText = cleanNovelTextForAI(fullText)

  function getSheetTitle() {
    switch (mode) {
      case "caption":
        return "AI 简介翻译"
      case "translate":
        return "AI 小说全篇翻译"
      case "summary":
        return "AI 小说导读与总结"
      case "continue":
        return "AI 小说续写与脑洞"
      default:
        return "助手"
    }
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
          setResultText("未获取到小说正文文本。")
          setLoading(false)
          return
        }
        setStreaming(true)
        await streamTranslateNovel(cleanedText, {
          onChunk: (text) => setResultText(text),
          onProgress: ({ chunkIndex, totalChunks, percent }) => {
            setProgressInfo(`正在翻译第 ${chunkIndex}/${totalChunks} 章节块 (${percent}%)`)
          },
          signal: abortRef.current,
        })
      } else if (mode === "summary") {
        if (!cleanedText) {
          setResultText("未获取到小说正文文本。")
          setLoading(false)
          return
        }
        setStreaming(true)
        setProgressInfo("AI 正在通读全篇并提炼大纲与看点…")
        await streamSummarizeNovel(cleanedText, {
          onChunk: (text) => setResultText(text),
          signal: abortRef.current,
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
  }, [isPresented, mode])

  return (
    <AISheetScaffold
      title={getSheetTitle()}
      subtitle={`小说：${novel.title} (@${novel.user?.name})`}
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
        <Group>
          <VStack
            spacing={8}
            padding={12}
            background={{ light: "#F2F2F7", dark: "#1C1C1E" }}
          >
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
                lineSpacing={3}
              >
                {rawCaption}
              </Text>
            )}
          </VStack>
        </Group>
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
