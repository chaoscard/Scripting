import { Button, HStack, ProgressView, Spacer, Text, VStack } from "scripting"
import { loadSettings } from "../../store/settings"

export interface RelatedSectionProps<T> {
  title?: string
  initialLoading?: boolean
  error?: string | null
  items: T[]
  emptyText?: string
  errorText?: string
  bottomInset?: number
  onRetry: () => void
  renderContent: (items: T[]) => any
}

/**
 * 通用相关推荐区块组件
 * 统一管理：标题、加载中骨架、加载失败重试（自带底栏避让）、空状态、以及流内容渲染
 */
export function RelatedSection<T>(props: RelatedSectionProps<T>) {
  const {
    title = "相关作品",
    emptyText = "暂无相关作品",
    errorText = "相关作品加载失败",
    bottomInset,
    initialLoading = false,
    error = null,
    items,
    onRetry,
    renderContent,
  } = props
  const effectiveBottomInset = bottomInset ?? loadSettings().feedBottomInset

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ top: 4, bottom: effectiveBottomInset }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <Text
        font="subheadline"
        fontWeight="semibold"
        foregroundStyle="secondaryLabel"
        padding={{ horizontal: 14 }}
      >
        {title}
      </Text>

      {initialLoading ? (
        <HStack spacing={0} frame={{ maxWidth: "infinity", height: 80 }}>
          <Spacer />
          <ProgressView progressViewStyle="circular" />
          <Spacer />
        </HStack>
      ) : error && items.length === 0 ? (
        <VStack alignment="center" spacing={12} padding={{ top: 20, bottom: 20, horizontal: 16 }} frame={{ maxWidth: "infinity" }}>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            {errorText}
          </Text>
          <Button
            title="重试"
            buttonStyle="glass"
            action={onRetry}
          />
        </VStack>
      ) : items.length > 0 ? (
        renderContent(items)
      ) : (
        <HStack
          spacing={0}
          padding={{ horizontal: 14, vertical: 8 }}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <Text font="footnote" foregroundStyle="secondaryLabel">
            {emptyText}
          </Text>
        </HStack>
      )}
    </VStack>
  )
}
