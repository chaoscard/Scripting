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
  const icon = state.isDone
    ? "checkmark.circle.fill"
    : state.isError
    ? "exclamationmark.triangle.fill"
    : state.categoryIcon || "arrow.down.circle.fill"

  const iconColor = state.isDone
    ? "systemGreen"
    : state.isError
    ? "systemRed"
    : "systemBlue"

  const percentText = `${Math.round(state.progress * 100)}%`

  return (
    <VStack
      spacing={6}
      padding={{ horizontal: 4, vertical: 2 }}
      activityBackgroundTint={{
        light: "rgba(255, 255, 255, 0.9)",
        dark: "rgba(30, 30, 30, 0.85)",
      }}
    >
      <HStack spacing={6}>
        <Image systemName={icon} foregroundStyle={iconColor} font="headline" />
        <VStack alignment="leading" spacing={1}>
          <Text font="subheadline" lineLimit={1}>
            {state.title}
          </Text>
          {state.subtitle ? (
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {state.subtitle}
            </Text>
          ) : null}
        </VStack>
        <Spacer />
        <Text font="caption" foregroundStyle={state.isDone ? "systemGreen" : "secondaryLabel"}>
          {state.isDone ? "已完成" : `${state.current}/${state.total} · ${percentText}`}
        </Text>
      </HStack>

      <ProgressView value={Math.max(0, Math.min(1, state.progress))} total={1.0} />

      <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
        {state.statusText}
      </Text>
    </VStack>
  )
}

const builder: LiveActivityUIBuilder<TaskLiveActivityState> = (state) => {
  const percentText = `${Math.round(state.progress * 100)}%`
  const icon = state.isDone
    ? "checkmark.circle.fill"
    : state.isError
    ? "exclamationmark.triangle.fill"
    : state.categoryIcon || "arrow.down.circle.fill"

  const iconColor = state.isDone
    ? "systemGreen"
    : state.isError
    ? "systemRed"
    : "systemBlue"

  return (
    <LiveActivityUI
      content={<LockScreenContentView {...state} />}
      compactLeading={
        <Image systemName={icon} foregroundStyle={iconColor} font="subheadline" />
      }
      compactTrailing={
        <Text font="caption2" foregroundStyle={state.isDone ? "systemGreen" : "tintColor"}>
          {state.isDone ? "完成" : percentText}
        </Text>
      }
      minimal={<Image systemName={icon} foregroundStyle={iconColor} />}
    >
      <LiveActivityUIExpandedLeading>
        <HStack spacing={6}>
          <Image systemName={icon} foregroundStyle={iconColor} font="title3" />
          <VStack alignment="leading" spacing={2}>
            <Text font="headline" lineLimit={1}>
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
        <VStack alignment="trailing" spacing={2}>
          <Text font="title3" foregroundStyle={state.isDone ? "systemGreen" : "tintColor"}>
            {state.isDone ? "100%" : percentText}
          </Text>
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {state.current}/{state.total}
          </Text>
        </VStack>
      </LiveActivityUIExpandedTrailing>
      <LiveActivityUIExpandedBottom>
        <VStack spacing={4}>
          <ProgressView value={Math.max(0, Math.min(1, state.progress))} total={1.0} />
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
            {state.statusText}
          </Text>
        </VStack>
      </LiveActivityUIExpandedBottom>
    </LiveActivityUI>
  )
}

export const PixivTaskLiveActivity = LiveActivity.register<TaskLiveActivityState>(
  "PixivTaskLiveActivity",
  builder
)
