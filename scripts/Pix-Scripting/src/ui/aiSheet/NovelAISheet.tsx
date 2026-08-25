import { AISheetScaffold } from "./AISheetScaffold"
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
  useMemo,
  useRef,
  useState,
  VStack,
  type VirtualNode,
} from "scripting"
import type { PixivNovel, PixivNovelDetail } from "../../types"
import {
  cleanHtmlCaption,
  cleanNovelTextForAI,
  getNovelPageText,
  isAIAvailable,
  streamContinueNovel,
  streamSummarizeNovel,
  streamTranslateNovel,
  streamTranslateText,
} from "../../api/aiService"
import { ErrorView } from "../components"
import { createThrottledUpdater } from "./throttle"
import { PRESET_CONTINUE_PROMPTS, type NovelAIMode } from "./types"

interface NovelPageCache {
  translateText?: string
  summaryText?: string
  continueText?: string
  error?: string | null
}

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

  const activeTaskTokenRef = useRef<{ id: number; aborted: boolean }>({ id: 0, aborted: false })
  const activeThrottlerRef = useRef<{ cancel: () => void } | null>(null)
  const taskSeqRef = useRef(0)
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
    activeTaskTokenRef.current.aborted = true
    activeThrottlerRef.current?.cancel()
    activeThrottlerRef.current = null
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
    const taskToken = { id: ++taskSeqRef.current, aborted: false }
    activeTaskTokenRef.current = taskToken
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
      if (activeTaskTokenRef.current.id !== taskToken.id || taskToken.aborted) return
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
    activeThrottlerRef.current = throttler

    try {
      if (mode === "caption") {
        if (!rawCaption) {
          if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
            setCaptionCache({ resultText: "该小说作者未填写简介。", error: null })
            setLoading(false)
          }
          return
        }
        setStreaming(true)
        const finalResult = await streamTranslateText(rawCaption, {
          onChunk: (text: string) => {
            if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
              throttler.push(text)
            }
          },
          signal: taskToken,
        })
        if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
          throttler.flush(finalResult)
        }
      } else if (mode === "translate") {
        if (!cleanedText) {
          if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
            const msg = isMultiPage ? "当前页小说正文为空。" : "未获取到小说正文文本。"
            setPageCaches((prev) => ({
              ...prev,
              [currentPage]: { ...prev[currentPage], translateText: msg, error: null },
            }))
            setLoading(false)
          }
          return
        }
        setStreaming(true)
        const finalResult = await streamTranslateNovel(cleanedText, {
          onChunk: (text: string) => {
            if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
              throttler.push(text)
            }
          },
          onProgress: ({ chunkIndex, totalChunks, percent }) => {
            if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
              const prefix = isMultiPage ? `第 ${currentPage} 页 ` : ""
              setProgressInfo(`正在翻译${prefix}第 ${chunkIndex}/${totalChunks} 部分 (${percent}%)`)
            }
          },
          signal: taskToken,
        })
        if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
          throttler.flush(finalResult)
        }
      } else if (mode === "summary") {
        if (!cleanedText) {
          if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
            const msg = isMultiPage ? "当前页小说正文为空。" : "未获取到小说正文文本。"
            setPageCaches((prev) => ({
              ...prev,
              [currentPage]: { ...prev[currentPage], summaryText: msg, error: null },
            }))
            setLoading(false)
          }
          return
        }
        setStreaming(true)
        setProgressInfo(
          isMultiPage
            ? `AI 正在总结第 ${currentPage} 页核心看点…`
            : "AI 正在通读全篇并提炼大纲与看点…"
        )
        const finalResult = await streamSummarizeNovel(cleanedText, {
          onChunk: (text: string) => {
            if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
              throttler.push(text)
            }
          },
          signal: taskToken,
          pageInfo: isMultiPage ? { current: currentPage, total: totalPages } : undefined,
        })
        if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
          throttler.flush(finalResult)
        }
      } else if (mode === "continue") {
        if (!cleanedText) {
          if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
            setPageCaches((prev) => ({
              ...prev,
              [currentPage]: { ...prev[currentPage], continueText: "未获取到小说正文文本。", error: null },
            }))
            setLoading(false)
          }
          return
        }
        setStreaming(true)
        setProgressInfo("AI 正在根据前文风格与设定续写…")
        const finalResult = await streamContinueNovel(cleanedText, continueInstruction, {
          onChunk: (text: string) => {
            if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
              throttler.push(text)
            }
          },
          signal: taskToken,
        })
        if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
          throttler.flush(finalResult)
        }
      }
    } catch (e: any) {
      throttler.cancel()
      if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
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
      if (activeTaskTokenRef.current.id === taskToken.id) {
        setLoading(false)
        setStreaming(false)
        setProgressInfo(null)
      }
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
              {PRESET_CONTINUE_PROMPTS.map((prompt: string) => (
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
