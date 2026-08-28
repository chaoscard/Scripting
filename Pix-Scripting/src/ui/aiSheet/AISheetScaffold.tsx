import {
  Button,
  Divider,
  GeometryReader,
  Group,
  HStack,
  Image,
  Markdown,
  NavigationStack,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  VStack,
  useEffect,
  useMemo,
  useState,
  type VirtualNode,
} from "scripting"
import { isAIAvailable } from "../../api/aiService"
import { ErrorView } from "../components"

/**
 * 极简微光骨架呼吸条
 */
export function AISkeletonParagraph() {
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    let timerId: number
    let isMounted = true

    const tick = () => {
      if (!isMounted) return
      setPulse((prev) => !prev)
      timerId = setTimeout(tick, 750)
    }

    timerId = setTimeout(tick, 750)

    return () => {
      isMounted = false
      clearTimeout(timerId)
    }
  }, [])

  return (
    <GeometryReader>
      {(proxy) => {
        const fullW = proxy.size.width || 340
        const p1 = [fullW, fullW * 0.9, fullW * 0.72]
        const p2 = [fullW * 0.95, fullW * 0.58]

        return (
          <VStack spacing={20} alignment="leading" padding={{ vertical: 8 }}>
            {/* 段落 1 骨架 */}
            <VStack spacing={10} alignment="leading">
              {p1.map((w, idx) => (
                <HStack
                  key={String(idx)}
                  frame={{ width: w, height: 14 }}
                  background="tertiarySystemFill"
                  clipShape={{ type: "rect", cornerRadius: 7 }}
                  opacity={pulse ? 0.35 : 0.85}
                />
              ))}
            </VStack>
            {/* 段落 2 骨架 */}
            <VStack spacing={10} alignment="leading">
              {p2.map((w, idx) => (
                <HStack
                  key={String(idx)}
                  frame={{ width: w, height: 14 }}
                  background="tertiarySystemFill"
                  clipShape={{ type: "rect", cornerRadius: 7 }}
                  opacity={pulse ? 0.4 : 0.9}
                />
              ))}
            </VStack>
          </VStack>
        )
      }}
    </GeometryReader>
  )
}

/**
 * 优雅的原文折叠卡片组件
 */
export function OriginalCaptionCollapsible(props: {
  rawCaption: string
  showOriginal: boolean
  onToggle: () => void
}) {
  const { rawCaption, showOriginal, onToggle } = props
  if (!rawCaption) return null

  return (
    <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
      <Button
        action={() => {
          onToggle()
          void Haptics.transient(0.3, 0.3)
        }}
      >
        <HStack spacing={6} alignment="center">
          <Image
            systemName={showOriginal ? "chevron.down" : "chevron.right"}
            font="caption2"
            foregroundStyle="secondaryLabel"
          />
          <Text font="footnote" fontWeight="medium" foregroundStyle="secondaryLabel">
            原文
          </Text>
          <Spacer />
          <Text font="caption2" foregroundStyle="tertiaryLabel">
            {showOriginal ? "点击收起" : "点击展开"}
          </Text>
        </HStack>
      </Button>

      {showOriginal && (
        <VStack
          padding={12}
          background="secondarySystemBackground"
          clipShape={{ type: "rect", cornerRadius: 10 }}
          frame={{ maxWidth: "infinity" }}
          alignment="leading"
        >
          <Text
            font="footnote"
            foregroundStyle="secondaryLabel"
            lineSpacing={4}
          >
            {rawCaption}
          </Text>
        </VStack>
      )}
    </VStack>
  )
}

export function AISheetScaffold(props: {
  title: string
  subtitle?: string
  loading: boolean
  streaming: boolean
  error: string | null
  resultText: string
  progressInfo?: string | null
  hideResultText?: boolean
  noHorizontalPadding?: boolean
  useMarkdown?: boolean
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
    hideResultText = false,
    noHorizontalPadding = false,
    useMarkdown = false,
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
        <VStack
          spacing={16}
          padding={{
            top: 14,
            leading: noHorizontalPadding ? 0 : 16,
            bottom: 28,
            trailing: noHorizontalPadding ? 0 : 16,
          }}
        >
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

              {/* 进度或骨架屏加载状态 */}
              {loading && !resultText && !hideResultText && !error && (
                progressInfo ? (
                  <VStack spacing={12} padding={{ top: 32, bottom: 32 }} alignment="center">
                    <ProgressView />
                    <Text
                      font="footnote"
                      foregroundStyle="secondaryLabel"
                    >
                      {progressInfo}
                    </Text>
                  </VStack>
                ) : (
                  <AISkeletonParagraph />
                )
              )}

              {/* 错误态 */}
              {Boolean(error) && !streaming && (
                <ErrorView
                  message={error || "生成失败，请重试"}
                  onRetry={onRetry}
                />
              )}

              {/* 结果内容展示区（支持原生 Markdown 渲染或分段纯文本） */}
              {Boolean(resultText) && !hideResultText && (
                <VStack spacing={14} alignment="leading" frame={{ maxWidth: "infinity" }}>
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
                  {useMarkdown ? (
                    <Markdown
                      content={resultText}
                      theme="basic"
                      scrollable={false}
                    />
                  ) : (
                    paragraphs.map((para, idx) => (
                      <Text
                        key={String(idx)}
                        font="body"
                        lineSpacing={5}
                      >
                        {para}
                      </Text>
                    ))
                  )}
                </VStack>
              )}
            </>
          )}
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}
