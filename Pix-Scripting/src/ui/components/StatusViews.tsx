import { Button, HStack, Image, ProgressView, Spacer, Text, VStack, ZStack } from "scripting"

export function LoadingView() {
  return (
    <HStack
      spacing={0}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={40}
    >
      <Spacer />
      <ProgressView progressViewStyle="circular" />
      <Spacer />
    </HStack>
  )
}

// 错误视图
export function ErrorView(props: {
  message: string
  onRetry: () => void
}) {
  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={40}
    >
      <VStack alignment="center" spacing={14}>
        <Image
          systemName="wifi.exclamationmark"
          font="largeTitle"
          foregroundStyle="secondaryLabel"
        />
        <Text
          font="subheadline"
          foregroundStyle="secondaryLabel"
          multilineTextAlignment="center"
        >
          {props.message}
        </Text>
        <Button
          title="重试"
          buttonStyle="glass"
          action={props.onRetry}
        />
      </VStack>
    </ZStack>
  )
}



export function EmptyView(props: { text?: string; systemImage?: string }) {
  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={60}
    >
      <VStack alignment="center" spacing={14}>
        <Image
          systemName={props.systemImage ?? "sparkles"}
          font="largeTitle"
          foregroundStyle="secondaryLabel"
        />
        <Text font="subheadline" foregroundStyle="secondaryLabel">
          {props.text ?? "暂无内容"}
        </Text>
      </VStack>
    </ZStack>
  )
}

// 统一的未知路由/非法深链缺省视图
export function NotFoundRouteView(props?: { rawRoute?: string }) {
  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={40}
      navigationTitle="页面未找到"
      navigationBarTitleDisplayMode="inline"
    >
      <VStack alignment="center" spacing={16}>
        <Image
          systemName="exclamationmark.triangle"
          font="largeTitle"
          foregroundStyle="systemOrange"
        />
        <VStack alignment="center" spacing={6}>
          <Text font="headline" fontWeight="semibold">
            内容链接无效或已过期
          </Text>
          <Text
            font="subheadline"
            foregroundStyle="secondaryLabel"
            multilineTextAlignment="center"
          >
            该页面可能已被删除、参数有误或深层链接已失效
          </Text>
        </VStack>
      </VStack>
    </ZStack>
  )
}

