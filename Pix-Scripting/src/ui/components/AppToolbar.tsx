import { Button, Script, Text } from "scripting"
import { loadSettings } from "../../store/settings"

export function appToolbar(dismiss: () => void, title?: string, trailing?: any) {
  return {
    topBarLeading: [
      <Button
        title="关闭"
        systemImage="xmark"
        action={() => {
          if (loadSettings().closeButtonAction === "exit") {
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
    principal: title
      ? [
          <Text font="title2" fontWeight="bold">
            {title}
          </Text>,
        ]
      : undefined,
  }
}

// 框架在 refreshable 的 Promise resolve 后不会自动把滚动位置弹回顶部（列表会
// 停在用户下拉的位置）。本组件在刷新结束后主动把内容滚回顶部，恢复回弹体验。
