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
  /** 是否处于 iPad 分栏外壳（由调用方从 useDualRoute() 取得） */
  isSplitViewActive?: boolean
  /**
   * 是否渲染在**右栏详情内胆**里（由调用方从 useDualRoute() 取得）。
   * 右栏栏首是内胆自绘的返回箭头（DetailPaneRouteView），不再重复放关闭按钮。
   */
  isDetailPane?: boolean
}

/**
 * 关闭 / 最小化应用 —— 顶栏 × 的唯一行为与设置出口。
 *
 * 位置约定（2026-09-17 定稿）：分栏外壳下**只在中间栏顶栏**渲染 ×；
 * 右栏用返回箭头（isDetailPane），侧边栏不再放关闭入口。
 *
 * ⚠️ 不要把它写成 hook，也不要让 appToolbar 变成 hook 消费者：
 *    appToolbar 存在「按条件调用」的调用点（如 downloadManager 的三元表达式），
 *    在它内部读 context 会让 hook 数量随分支变化。
 */
export function performAppClose(dismiss: () => void) {
  abortAllAITasks()
  if (loadSettings().closeButtonAction === "exit") {
    try {
      dismiss()
    } catch {}
    Script.exit()
  } else {
    Script.minimize()
  }
}

export function appToolbar(
  dismiss: () => void,
  title?: any,
  trailing?: any,
  principal?: any,
  options?: AppToolbarOptions
) {
  const isHomeScreen = Script.env === "home_screen"
  const isSplit = options?.isSplitViewActive ?? false

  let leadingButton: any = (
    <Button
      key="app-toolbar-close"
      title="关闭"
      systemImage="xmark"
      action={() => performAppClose(dismiss)}
    />
  )

  if (isHomeScreen) {
    leadingButton = <FullScreenToggleButton key="app-toolbar-fullscreen-toggle-host" />
  } else if (isSplit && options?.isDetailPane) {
    // 分栏外壳的**右栏**：栏首已经是内胆自绘的返回箭头，不再重复放 ×。
    //（中栏：isDetailPane 为 false → 保留顶栏 ×，这是分栏下唯一的关闭入口。）
    leadingButton = undefined
  }

  return {
    topBarLeading: leadingButton ? [leadingButton] : undefined,
    topBarTrailing: trailing
      ? Array.isArray(trailing)
        ? trailing
        : [trailing]
      : undefined,
    // 仅当显式传入自定义 principal 视图时才挂载；
    // 页面标题统一由根容器上的 navigationTitle 属性由系统原生接管，
    // 自动在「TabBar在底部时居中显示 / TabBar升至顶栏时自动隐藏」，实现 0 阈值硬编码。
    principal: principal
      ? Array.isArray(principal)
        ? principal
        : [principal]
      : undefined,
  }
}

// 框架在 refreshable 的 Promise resolve 后不会自动把滚动位置弹回顶部（列表会
// 停在用户下拉的位置）。本组件在刷新结束后主动把内容滚回顶部，恢复回弹体验。
