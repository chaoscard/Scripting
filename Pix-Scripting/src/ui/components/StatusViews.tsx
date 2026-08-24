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

