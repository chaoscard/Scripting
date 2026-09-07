import { Button, Device, Script, Text } from "scripting"
import { loadSettings } from "../../store/settings"
import { abortAllAITasks } from "../../api/aiService"

export function appToolbar(
  dismiss: () => void,
  title?: any,
  trailing?: any,
  principal?: any
) {
  const isiPad = Device.isiPad

  return {
    topBarLeading: [
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
      />,
    ],
    topBarTrailing: trailing
      ? Array.isArray(trailing)
        ? trailing
        : [trailing]
      : undefined,
    principal: isiPad
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
                  <Text font="title2" fontWeight="bold">
                    {title}
                  </Text>,
                ]
              : [title]
          : undefined,
  }
}

// 框架在 refreshable 的 Promise resolve 后不会自动把滚动位置弹回顶部（列表会
// 停在用户下拉的位置）。本组件在刷新结束后主动把内容滚回顶部，恢复回弹体验。
