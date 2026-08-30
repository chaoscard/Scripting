import {
  LiveActivity,
  LiveActivityUI,
  type LiveActivityUIBuilder,
  LiveActivityUIExpandedLeading,
  LiveActivityUIExpandedTrailing,
  LiveActivityUIExpandedBottom,
  HStack,
  VStack,
  Text,
  Image,
  Spacer,
  ProgressView,
} from "scripting"

export type TaskLiveActivityState = {
  title: string
  subtitle?: string
  statusText: string
  progress: number // 0.0 ~ 1.0
  current: number
  total: number
  isDone?: boolean
  isError?: boolean
  categoryIcon?: string
}

function LockScreenContentView(state: TaskLiveActivityState) {
  const isDone = Boolean(state.isDone)
  const isError = Boolean(state.isError)
  const percentVal = Math.max(0, Math.min(100, Math.round((state.progress || 0) * 100)))
  const percentText = `${percentVal}%`

  const iconName = isDone
    ? "checkmark.circle.fill"
    : isError
    ? "exclamationmark.triangle.fill"
    : state.categoryIcon || "arrow.down.circle.fill"

  const tintColor = isDone
    ? "systemGreen"
    : isError
    ? "systemRed"
    : "systemBlue"

  const cleanSubtitle = state.subtitle ? state.subtitle.replace(/^用户[:：]\s*/, "") : ""
  const titleText = cleanSubtitle ? `${state.title} · ${cleanSubtitle}` : state.title

  return (
    <VStack
      spacing={6}
      padding={{ horizontal: 12, vertical: 8 }}
    >
      {/* 1. 顶行：左侧图标 + 主副标题；右侧醒目大号百分比与数字 */}
      <HStack spacing={8}>
        <Image
          systemName={iconName}
          foregroundStyle={tintColor}
          font="headline"
        />
        <Text font="headline" fontWeight="semibold" lineLimit={1}>
          {titleText}
        </Text>

        <Spacer />

        <HStack spacing={4} alignment="lastTextBaseline">
          <Text
            font="title3"
            fontWeight="bold"
            foregroundStyle={isDone ? "systemGreen" : isError ? "systemRed" : "tintColor"}
          >
            {isDone ? "完成" : isError ? "失败" : percentText}
          </Text>
          {state.total > 0 && !isDone ? (
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {state.current}/{state.total}
            </Text>
          ) : null}
        </HStack>
      </HStack>

      {/* 2. 中行：系统原生进度指示条 */}
      <ProgressView value={Math.max(0, Math.min(1, state.progress || 0))} total={1.0} />

      {/* 3. 底行：实时动态状态文字 */}
      <HStack>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {state.statusText || (isDone ? "全部任务处理完毕" : "正在处理…")}
        </Text>
        <Spacer />
      </HStack>
    </VStack>
  )
}

const builder: LiveActivityUIBuilder<TaskLiveActivityState> = (state) => {
  const isDone = Boolean(state.isDone)
  const isError = Boolean(state.isError)
  const percentVal = Math.max(0, Math.min(100, Math.round((state.progress || 0) * 100)))
  const percentText = `${percentVal}%`

  const iconName = isDone
    ? "checkmark.circle.fill"
    : isError
    ? "exclamationmark.triangle.fill"
    : state.categoryIcon || "arrow.down.circle.fill"

  const iconColor = isDone
    ? "systemGreen"
    : isError
    ? "systemRed"
    : "systemBlue"

  return (
    <LiveActivityUI
      content={<LockScreenContentView {...state} />}
      compactLeading={
        <HStack spacing={4}>
          <Image systemName={iconName} foregroundStyle={iconColor} font="subheadline" />
          <Text font="caption2" fontWeight="semibold">
            {isDone ? "完成" : isError ? "错误" : percentText}
          </Text>
        </HStack>
      }
      compactTrailing={
        <Text font="caption2" foregroundStyle="secondaryLabel">
          {state.total > 0 && !isDone ? `${state.current}/${state.total}` : "Pixiv"}
        </Text>
      }
      minimal={
        <Image systemName={iconName} foregroundStyle={iconColor} font="subheadline" />
      }
    >
      <LiveActivityUIExpandedLeading>
        <HStack spacing={6}>
          <Image
            systemName={iconName}
            foregroundStyle={iconColor}
            font="title3"
          />
          <VStack alignment="leading" spacing={1}>
            <Text font="headline" fontWeight="semibold" lineLimit={1}>
              {state.title}
            </Text>
            {state.subtitle ? (
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                {state.subtitle}
              </Text>
            ) : null}
          </VStack>
        </HStack>
      </LiveActivityUIExpandedLeading>
      <LiveActivityUIExpandedTrailing>
        <VStack alignment="trailing" spacing={1}>
          <Text
            font="title3"
            fontWeight="bold"
            foregroundStyle={isDone ? "systemGreen" : isError ? "systemRed" : "tintColor"}
          >
            {isDone ? "100%" : isError ? "失败" : percentText}
          </Text>
          {state.total > 0 && !isDone ? (
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {state.current}/{state.total}
            </Text>
          ) : null}
        </VStack>
      </LiveActivityUIExpandedTrailing>
      <LiveActivityUIExpandedBottom>
        <VStack spacing={4}>
          <ProgressView value={Math.max(0, Math.min(1, state.progress || 0))} total={1.0} />
          <HStack>
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {state.statusText || (isDone ? "任务已完成" : "正在处理…")}
            </Text>
            <Spacer />
          </HStack>
        </VStack>
      </LiveActivityUIExpandedBottom>
    </LiveActivityUI>
  )
}

export const PixivTaskLiveActivity = LiveActivity.register<TaskLiveActivityState>(
  "PixivTaskLiveActivity",
  builder
)
