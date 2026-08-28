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
  VStack,
  useMemo,
  type VirtualNode,
} from "scripting"
import { isAIAvailable } from "../../api/aiService"
import { ErrorView } from "../components"

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
              {Boolean(resultText) && !hideResultText && (
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
