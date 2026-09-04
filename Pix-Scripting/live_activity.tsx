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
  Button,
} from "scripting"
import { PauseDownloadIntent, ResumeDownloadIntent, CancelDownloadIntent } from "./app_intents"

export type TaskLiveActivityState = {
  taskId?: string
  title: string
  subtitle?: string
  statusText: string
  progress: number // 0.0 ~ 1.0
  current: number
  total: number
  isDone?: boolean
  isError?: boolean
  isPaused?: boolean
  categoryIcon?: string
}

function LockScreenContentView(state: TaskLiveActivityState) {
  const isDone = Boolean(state.isDone)
  const isError = Boolean(state.isError)
  const isPaused = Boolean(state.isPaused)
  const percentVal = Math.max(0, Math.min(100, Math.round((state.progress || 0) * 100)))
  const percentText = `${percentVal}%`

  const iconName = isDone
    ? "checkmark.circle.fill"
    : isError
    ? "exclamationmark.triangle.fill"
    : isPaused
    ? "pause.circle.fill"
    : state.categoryIcon || "arrow.down.circle.fill"

  const tintColor = isDone
    ? "systemGreen"
    : isError
    ? "systemRed"
    : isPaused
    ? "systemOrange"
    : "systemBlue"

  const cleanSubtitle = state.subtitle ? state.subtitle.replace(/^用户[:：]\s*/, "") : ""
  const titleText = cleanSubtitle ? `${state.title} · ${cleanSubtitle}` : state.title

  return (
    <VStack
      spacing={8}
      padding={{ horizontal: 14, vertical: 10 }}
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
            foregroundStyle={
              isDone
                ? "systemGreen"
                : isError
                ? "systemRed"
                : isPaused
                ? "systemOrange"
                : "tintColor"
            }
          >
            {isDone ? "完成" : isError ? "失败" : isPaused ? "已暂停" : percentText}
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

      {/* 3. 底行：实时动态状态文字 + 交互控制按钮 */}
      <HStack spacing={10}>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {state.statusText || (isDone ? "全部任务处理完毕" : isPaused ? "任务已暂停" : "正在处理…")}
        </Text>
        <Spacer />

        {!isDone && !isError && state.taskId ? (
          <HStack spacing={6}>
            {isPaused ? (
              <Button
                title="继续"
                systemImage="play.fill"
                intent={ResumeDownloadIntent(state.taskId)}
                buttonStyle="borderedProminent"
                buttonBorderShape="capsule"
                controlSize="small"
              />
            ) : (
              <Button
                title="暂停"
                systemImage="pause.fill"
                intent={PauseDownloadIntent(state.taskId)}
                buttonStyle="bordered"
                buttonBorderShape="capsule"
                controlSize="small"
              />
            )}
            <Button
              title="取消"
              systemImage="xmark"
              intent={CancelDownloadIntent(state.taskId)}
              buttonStyle="bordered"
              buttonBorderShape="capsule"
              controlSize="small"
              role="destructive"
            />
          </HStack>
        ) : null}
      </HStack>
    </VStack>
  )
}

const builder: LiveActivityUIBuilder<TaskLiveActivityState> = (state) => {
  const isDone = Boolean(state.isDone)
  const isError = Boolean(state.isError)
  const isPaused = Boolean(state.isPaused)
  const percentVal = Math.max(0, Math.min(100, Math.round((state.progress || 0) * 100)))
  const percentText = `${percentVal}%`

  const iconName = isDone
    ? "checkmark.circle.fill"
    : isError
    ? "exclamationmark.triangle.fill"
    : isPaused
    ? "pause.circle.fill"
    : state.categoryIcon || "arrow.down.circle.fill"

  const iconColor = isDone
    ? "systemGreen"
    : isError
    ? "systemRed"
    : isPaused
    ? "systemOrange"
    : "systemBlue"

  return (
    <LiveActivityUI
      content={<LockScreenContentView {...state} />}
      compactLeading={
        <HStack spacing={4}>
          <Image systemName={iconName} foregroundStyle={iconColor} font="subheadline" />
          <Text font="caption2" fontWeight="semibold">
            {isDone ? "完成" : isError ? "错误" : isPaused ? "暂停" : percentText}
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
            foregroundStyle={
              isDone
                ? "systemGreen"
                : isError
                ? "systemRed"
                : isPaused
                ? "systemOrange"
                : "tintColor"
            }
          >
            {isDone ? "100%" : isError ? "失败" : isPaused ? "暂停" : percentText}
          </Text>
          {state.total > 0 && !isDone ? (
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {state.current}/{state.total}
            </Text>
          ) : null}
        </VStack>
      </LiveActivityUIExpandedTrailing>
      <LiveActivityUIExpandedBottom>
        <VStack spacing={6}>
          <ProgressView value={Math.max(0, Math.min(1, state.progress || 0))} total={1.0} />
          <HStack>
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {state.statusText || (isDone ? "任务已完成" : isPaused ? "已暂停" : "正在处理…")}
            </Text>
            <Spacer />
            {!isDone && !isError && state.taskId ? (
              <HStack spacing={6}>
                {isPaused ? (
                  <Button
                    title="继续"
                    systemImage="play.fill"
                    intent={ResumeDownloadIntent(state.taskId)}
                    buttonStyle="borderedProminent"
                    buttonBorderShape="capsule"
                    controlSize="mini"
                  />
                ) : (
                  <Button
                    title="暂停"
                    systemImage="pause.fill"
                    intent={PauseDownloadIntent(state.taskId)}
                    buttonStyle="bordered"
                    buttonBorderShape="capsule"
                    controlSize="mini"
                  />
                )}
                <Button
                  title="取消"
                  systemImage="xmark"
                  intent={CancelDownloadIntent(state.taskId)}
                  buttonStyle="bordered"
                  buttonBorderShape="capsule"
                  controlSize="mini"
                  role="destructive"
                />
              </HStack>
            ) : null}
          </HStack>
        </VStack>
      </LiveActivityUIExpandedBottom>
    </LiveActivityUI>
  )
}

const GLOBAL_LIVE_ACTIVITY_FACTORY_KEY = "__PIXIV_TASK_LIVE_ACTIVITY_FACTORY__"
declare const globalThis: any

function getOrCreateLiveActivityFactory(): () => LiveActivity<TaskLiveActivityState> {
  if (globalThis[GLOBAL_LIVE_ACTIVITY_FACTORY_KEY]) {
    return globalThis[GLOBAL_LIVE_ACTIVITY_FACTORY_KEY]
  }
  try {
    const factory = LiveActivity.register<TaskLiveActivityState>(
      "PixivTaskLiveActivity",
      builder
    )
    globalThis[GLOBAL_LIVE_ACTIVITY_FACTORY_KEY] = factory
    return factory
  } catch (err: any) {
    console.log("LiveActivity.register caught warning:", err?.message ?? err)
    return () => {
      try {
        if (globalThis[GLOBAL_LIVE_ACTIVITY_FACTORY_KEY]) {
          return globalThis[GLOBAL_LIVE_ACTIVITY_FACTORY_KEY]()
        }
      } catch {}
      return null as any
    }
  }
}

export const PixivTaskLiveActivity = getOrCreateLiveActivityFactory()
