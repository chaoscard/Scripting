import { Script } from "scripting"

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
 * 判断当前环境是否具备 Scripting PRO 完整会员权限
 */
export function isScriptingProUser(): boolean {
  try {
    return (
      typeof Script !== "undefined" &&
      typeof Script.hasFullAccess === "function" &&
      Boolean(Script.hasFullAccess())
    )
  } catch {
    return false
  }
}

/**
 * 统一自适应触觉反馈调度器
 *
 * - 纯净无感运行：无需用户手动配置或开关，自适应分流。
 * - 自动检测用户 Pro 权限：
 *   - PRO 用户：自动启用高级 Core Haptics 模式，支持浮点强度/锐度调节与自定义精细波形，体验不降级。
 *   - 免费版用户：自动分流至 iOS 系统标准 UIKit HapticFeedback 接口，100% 零弹窗、零打扰。
 */
export function triggerHaptic(type?: HapticFeedbackType): void
export function triggerHaptic(intensity?: number, sharpness?: number): void
export function triggerHaptic(arg1?: HapticFeedbackType | number, arg2?: number): void {
  try {
    // 1. PRO 用户自动启用 Core Haptics 模式
    if (isScriptingProUser()) {
      if (typeof Haptics !== "undefined") {
        if (typeof arg1 === "number") {
          const intensity = arg1
          const sharpness = typeof arg2 === "number" ? arg2 : undefined
          void Haptics.transient(intensity, sharpness)
          return
        }

        switch (arg1) {
          case "selection":
            void Haptics.transient(0.25, 0.25)
            break
          case "light":
            void Haptics.transient(0.4, 0.4)
            break
          case "medium":
            void Haptics.transient(0.6, 0.7)
            break
          case "heavy":
            void Haptics.transient(0.9, 0.9)
            break
          case "soft":
            void Haptics.transient(0.4, 0.1)
            break
          case "rigid":
            void Haptics.transient(0.8, 0.9)
            break
          case "success":
            if (typeof (Haptics as any).notification === "function") {
              void (Haptics as any).notification("success")
            } else {
              void Haptics.transient(0.7, 0.8)
            }
            break
          case "warning":
            if (typeof (Haptics as any).notification === "function") {
              void (Haptics as any).notification("warning")
            } else {
              void Haptics.transient(0.8, 0.5)
            }
            break
          case "error":
            if (typeof (Haptics as any).notification === "function") {
              void (Haptics as any).notification("error")
            } else {
              void Haptics.transient(1.0, 0.9)
            }
            break
          default:
            void Haptics.transient()
            break
        }
        return
      }
    }

    // 2. 免费版用户自动使用 UIKit HapticFeedback 模式（零弹窗保障）
    if (typeof HapticFeedback === "undefined") return

    if (typeof arg1 === "number") {
      const intensity = arg1
      if (intensity < 0.4) {
        HapticFeedback.lightImpact?.()
      } else if (intensity < 0.75) {
        HapticFeedback.mediumImpact?.()
      } else {
        HapticFeedback.heavyImpact?.()
      }
      return
    }

    switch (arg1) {
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
  } catch {
    // 静默降级，确保任意环境都不会抛出异常或中断交互
  }
}
