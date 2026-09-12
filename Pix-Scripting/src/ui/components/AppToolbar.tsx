import { Button, Device, Script, Text } from "scripting"
import { loadSettings } from "../../store/settings"
import { abortAllAITasks } from "../../api/aiService"
import { useIsFullScreen, toggleFullScreen } from "../fullScreenState"

export function FullScreenToggleButton() {
  const isFull = useIsFullScreen()
  return (
    <Button
      key="app-toolbar-fullscreen-toggle"
      title={isFull ? "收缩" : "全屏"}
      systemImage={
        isFull
          ? "arrow.down.left.and.arrow.up.right"
          : "arrow.up.right.and.arrow.down.left"
      }
      action={() => {
        toggleFullScreen()
      }}
    />
  )
}

export interface AppToolbarOptions {
  isCompact?: boolean
  hidePrincipalOnWide?: boolean
}

export function appToolbar(
  dismiss: () => void,
  title?: any,
  trailing?: any,
  principal?: any,
  options?: AppToolbarOptions
) {
  const isHomeScreen = Script.env === "home_screen"
  const isCompact = options?.isCompact ?? (!Device.isiPad)
  const shouldHidePrincipal = !isCompact && options?.hidePrincipalOnWide === true

  let leadingButton = (
    <Button
      key="app-toolbar-close"
      title="关闭"
      systemImage="xmark"
      action={() => {
        abortAllAITasks()
        if (loadSettings().closeButtonAction === "exit") {
          try {
            dismiss()
          } catch {}
          Script.exit()
        } else {
          Script.minimize()
        }
      }}
    />
  )

  if (isHomeScreen) {
    leadingButton = <FullScreenToggleButton key="app-toolbar-fullscreen-toggle-host" />
  }

  return {
    topBarLeading: [leadingButton],
    topBarTrailing: trailing
      ? Array.isArray(trailing)
        ? trailing
        : [trailing]
      : undefined,
    principal: shouldHidePrincipal
      ? undefined
      : principal
        ? Array.isArray(principal)
          ? principal
          : [principal]
        : title
          ? Array.isArray(title)
            ? title
            : typeof title === "string"
              ? [
                  <Text font={isCompact ? "title2" : "headline"} fontWeight="bold">
                    {title}
                  </Text>,
                ]
              : [title]
          : undefined,
  }
}

// 框架在 refreshable 的 Promise resolve 后不会自动把滚动位置弹回顶部（列表会
// 停在用户下拉的位置）。本组件在刷新结束后主动把内容滚回顶部，恢复回弹体验。
