import { AISheetScaffold, OriginalCaptionCollapsible } from "./AISheetScaffold"
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

  const [selectedPage, setSelectedPage] = useState(currentPage)
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

  // 当 sheet 未展开或外部 currentPage 变动时，实时同步当前页
  useEffect(() => {
    if (!isPresented) {
      setSelectedPage(currentPage)
    }
  }, [isPresented, currentPage])

  // 当前页的缓存数据
  const currentPageCache = pageCaches[selectedPage] || {}

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

  // 对于多页小说的翻译、总结与续写，取当前选中页的文本；单页小说取全文
  const targetRawText =
    isMultiPage && (mode === "translate" || mode === "summary" || mode === "continue")
      ? getNovelPageText(fullText, selectedPage)
      : fullText

  const cleanedText = cleanNovelTextForAI(targetRawText)

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
        [selectedPage]: {
          ...prev[selectedPage],
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
          [selectedPage]: {
            ...prev[selectedPage],
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
          void Haptics.transient(0.8, 0.8)
        }
      } else if (mode === "translate") {
        if (!cleanedText) {
          if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
            const msg = isMultiPage ? "当前页小说正文为空。" : "未获取到小说正文文本。"
            setPageCaches((prev) => ({
              ...prev,
              [selectedPage]: { ...prev[selectedPage], translateText: msg, error: null },
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
          signal: taskToken,
        })
        if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
          throttler.flush(finalResult)
          void Haptics.transient(0.8, 0.8)
        }
      } else if (mode === "summary") {
        if (!cleanedText) {
          if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
            const msg = isMultiPage ? "当前页小说正文为空。" : "未获取到小说正文文本。"
            setPageCaches((prev) => ({
              ...prev,
              [selectedPage]: { ...prev[selectedPage], summaryText: msg, error: null },
            }))
            setLoading(false)
          }
          return
        }
        setStreaming(true)
        const finalResult = await streamSummarizeNovel(cleanedText, {
          onChunk: (text: string) => {
            if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
              throttler.push(text)
            }
          },
          signal: taskToken,
          pageInfo: isMultiPage ? { current: selectedPage, total: totalPages } : undefined,
        })
        if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
          throttler.flush(finalResult)
          void Haptics.transient(0.8, 0.8)
        }
      } else if (mode === "continue") {
        if (!cleanedText) {
          if (activeTaskTokenRef.current.id === taskToken.id && !taskToken.aborted) {
            setPageCaches((prev) => ({
              ...prev,
              [selectedPage]: { ...prev[selectedPage], continueText: "未获取到小说正文文本。", error: null },
            }))
            setLoading(false)
          }
          return
        }
        setStreaming(true)
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
          void Haptics.transient(0.8, 0.8)
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
            [selectedPage]: {
              ...prev[selectedPage],
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
      // 简介、翻译、总结在未缓存时自动开始触发
      if (mode === "caption" || mode === "translate" || mode === "summary") {
        void execute(false)
      }
    } else {
      handleStop()
    }
  }, [isPresented, mode, selectedPage])

  return (
    <AISheetScaffold
      title=""
      subtitle={undefined}
      loading={loading}
      streaming={streaming}
      error={currentError}
      resultText={currentResultText}
      progressInfo={progressInfo}
      useMarkdown={true}
      onDismiss={() => {
        handleStop()
        onChanged(false)
      }}
      onRetry={() => void execute(true)}
      onStop={handleStop}
    >
      {/* 1. 简介模式：支持折叠查看原文 */}
      {mode === "caption" && Boolean(rawCaption) && (
        <OriginalCaptionCollapsible
          rawCaption={rawCaption}
          showOriginal={showOriginalCaption}
          onToggle={() => setShowOriginalCaption(!showOriginalCaption)}
        />
      )}

      {/* 2. 多页小说的轻量分页胶囊切换栏 */}
      {isMultiPage && mode !== "caption" && (
        <HStack
          padding={{ horizontal: 12, vertical: 8 }}
          background="secondarySystemBackground"
          clipShape={{ type: "rect", cornerRadius: 10 }}
          alignment="center"
        >
          <Button
            title=""
            systemImage="chevron.left"
            disabled={selectedPage <= 1 || loading || streaming}
            action={() => {
              setSelectedPage((p) => Math.max(1, p - 1))
              void Haptics.transient(0.3, 0.3)
            }}
          />
          <Spacer />
          <Text font="subheadline" fontWeight="medium" foregroundStyle="secondaryLabel">
            第 {selectedPage} / {totalPages} 页
          </Text>
          <Spacer />
          <Button
            title=""
            systemImage="chevron.right"
            disabled={selectedPage >= totalPages || loading || streaming}
            action={() => {
              setSelectedPage((p) => Math.min(totalPages, p + 1))
              void Haptics.transient(0.3, 0.3)
            }}
          />
        </HStack>
      )}

      {/* 3. 续写模式：轻量 Chips 预设与走向输入栏 */}
      {mode === "continue" && (
        <VStack spacing={10} frame={{ maxWidth: "infinity" }}>
          <ScrollView axes="horizontal">
            <HStack spacing={8} padding={{ vertical: 2 }}>
              {PRESET_CONTINUE_PROMPTS.map((prompt: string) => {
                const isSelected = continueInstruction === prompt
                return (
                  <Button
                    key={prompt}
                    title={prompt}
                    buttonStyle={isSelected ? "borderedProminent" : "bordered"}
                    action={() => {
                      setContinueInstruction(isSelected ? "" : prompt)
                      void Haptics.transient(0.3, 0.3)
                    }}
                  />
                )
              })}
            </HStack>
          </ScrollView>
          <HStack spacing={8} alignment="center">
            <TextField
              title="续写要求"
              prompt="输入走向提示词（选填）…"
              value={continueInstruction}
              onChanged={setContinueInstruction}
            />
            <Button
              title="续写"
              systemImage="wand.and.stars"
              buttonStyle="borderedProminent"
              disabled={loading || streaming}
              action={() => void execute(true)}
            />
          </HStack>
        </VStack>
      )}
    </AISheetScaffold>
  )
}
