import { createContext, useContext } from "scripting"

/**
 * 沉浸阅读（收栏）
 *
 * 为什么单独成模块：`columnVisibility` 是**分栏外壳级**状态，而触发它的按钮在**右栏内部的页面**里，
 * 中间隔着好几层。用一个极轻的 context 下发，既避免把外壳状态塞进 DualRouteContext（语义不同），
 * 也避免 novelDetail → splitShell 的直接依赖（会有循环导入风险）。
 */
export interface ImmersiveReadContextValue {
  /** 当前是否处于沉浸（系统已收起左栏，右栏占满） */
  isImmersive: boolean
  /**
   * 是否支持「收栏沉浸」。
   * · iPad 分栏外壳 → true（向更宽争取空间，有意义）
   * · 单栏 / iPhone → false（本来就已是满宽，按钮无意义，页面应隐藏入口）
   */
  supportsColumnImmersive: boolean
  setImmersive: (value: boolean) => void
}

export const ImmersiveReadContext = createContext<ImmersiveReadContextValue | null>()

export function useImmersiveRead(): ImmersiveReadContextValue {
  const ctx = useContext(ImmersiveReadContext)
  if (ctx) return ctx
  return {
    isImmersive: false,
    supportsColumnImmersive: false,
    setImmersive: () => {},
  }
}
