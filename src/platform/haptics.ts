import { isScriptingProUser } from "./pro"

export { isScriptingProUser }

// Scripting 全局运行时原生类型声明
declare const Haptics: any
declare const HapticFeedback: any

export type HapticFeedbackType =
  | "selection"
  | "light"
  | "medium"
  | "heavy"
  | "soft"
  | "rigid"
  | "success"
  | "warning"
  | "error"

/**
 * 触发标准 UIKit 原生触觉反馈（零开销、零延迟、100% 零弹窗）
 */
function triggerStandardUIKitHaptic(type: HapticFeedbackType): void {
  if (typeof HapticFeedback === "undefined") return

  switch (type) {
    case "selection":
      HapticFeedback.selection?.()
      break
    case "light":
      HapticFeedback.lightImpact?.()
      break
    case "medium":
      HapticFeedback.mediumImpact?.()
      break
    case "heavy":
      HapticFeedback.heavyImpact?.()
      break
    case "soft":
      HapticFeedback.softImpact?.()
      break
    case "rigid":
      HapticFeedback.rigidImpact?.()
      break
    case "success":
      HapticFeedback.notificationSuccess?.()
      break
    case "warning":
      HapticFeedback.notificationWarning?.()
      break
    case "error":
      HapticFeedback.notificationError?.()
      break
    default:
      HapticFeedback.lightImpact?.()
      break
  }
}

/**
 * 统一自适应触觉反馈调度器
 *
 * 1. 语义化标准触觉（如 "selection" / "light" / "success" 等）：
 *    - 全员（PRO 与免费用户）统一调用 iOS 原生 UIKit HapticFeedback 接口。
 *    - 响应极快、极清脆，从物理层杜绝 Core Haptics 弹窗风险。
 *
 * 2. 自定义浮点触觉（intensity, sharpness）：
 *    - PRO 用户：完整启用高级 Core Haptics 模式（Haptics.transient），保留自定义锐度与连续精细波形，体验不降级。
 *    - 免费用户：智能自适应降级为最接近的原生 UIKit 触觉，无缝平滑且 100% 零弹窗。
 */
export function triggerHaptic(type?: HapticFeedbackType): void
export function triggerHaptic(intensity?: number, sharpness?: number): void
export function triggerHaptic(arg1?: HapticFeedbackType | number, arg2?: number): void {
  try {
    // A. 浮点自定义触觉模式
    if (typeof arg1 === "number") {
      const intensity = arg1
      const sharpness = typeof arg2 === "number" ? arg2 : undefined

      // 仅在明确具有 PRO 权限且 Haptics API 可用时调用 Core Haptics
      if (isScriptingProUser() && typeof Haptics !== "undefined" && typeof Haptics.transient === "function") {
        void Haptics.transient(intensity, sharpness)
        return
      }

      // 免费用户或环境不可用时自适应平滑分流至 UIKit 基础触觉
      if (typeof HapticFeedback !== "undefined") {
        if (intensity < 0.4) {
          HapticFeedback.lightImpact?.()
        } else if (intensity < 0.75) {
          HapticFeedback.mediumImpact?.()
        } else {
          HapticFeedback.heavyImpact?.()
        }
      }
      return
    }

    // B. 标准语义触觉模式：全员统一走原生 UIKit HapticFeedback，杜绝任何 Core Haptics 误弹窗
    const hapticType = (arg1 as HapticFeedbackType) || "light"
    triggerStandardUIKitHaptic(hapticType)
  } catch {
    // 静默降级，确保任意环境都不会抛出异常或中断交互
  }
}
