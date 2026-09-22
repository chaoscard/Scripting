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
 * 检查当前运行时是否真正支持并允许调用 Core Haptics 引擎
 * 严格门禁：
 * 1. 必须是 PRO 权限用户（且未开启「模拟普通用户」调试开关）；
 * 2. Haptics 全局对象与 transient 方法必须存在；
 * 3. 若硬件明确上报不支持触觉（如全系 iPad 等无马达设备），安全判定为 false。
 */
function isCoreHapticsAvailable(): boolean {
  try {
    if (!isScriptingProUser()) return false
    if (typeof Haptics === "undefined" || typeof Haptics.transient !== "function") return false
    if (typeof Haptics.supportsHaptics === "boolean" && !Haptics.supportsHaptics) return false
    return true
  } catch {
    return false
  }
}

/**
 * 触发标准 UIKit 原生触觉反馈（轻量、低功耗、全员 100% 零弹窗）
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
 * 触发 PRO 专属 Core Haptics 细腻微调波形（高精瞬态 + 复合脉冲）
 * 所有调用均通过 void 异步抛出，严禁 await，保证 UI 线程 120fps 零丢帧。
 */
function triggerProCoreHaptic(type: HapticFeedbackType): void {
  switch (type) {
    case "selection":
      // 精密钟表齿轮咬合感（极高锐度 + 极低强度）
      void Haptics.transient(0.28, 0.95)
      break
    case "light":
      // 微晶按键清脆回弹
      void Haptics.transient(0.48, 0.70)
      break
    case "medium":
      // 笃定磁吸碰撞感（用于收藏、点赞、下载等主要操作）
      void Haptics.transient(0.72, 0.60)
      break
    case "heavy":
      // 深沉低频顿挫（用于清空、删除、终止等高权重操作）
      void Haptics.transient(1.0, 0.35)
      break
    case "soft":
      // 液态气垫阻尼（极低锐度，弹性吸收）
      void Haptics.transient(0.55, 0.15)
      break
    case "rigid":
      // 陶瓷微敲击（高刚性清脆碰撞）
      void Haptics.transient(0.88, 1.0)
      break
    case "success":
      // Apple Pay 风格升调双脉冲（「哒-叮」仪式感成功确认）
      void Haptics.transient(0.40, 0.70)
      setTimeout(() => {
        try {
          void Haptics.transient?.(0.85, 0.90)
        } catch {}
      }, 110)
      break
    case "warning":
      // 双低频顿促警示
      void Haptics.transient(0.65, 0.30)
      setTimeout(() => {
        try {
          void Haptics.transient?.(0.65, 0.30)
        } catch {}
      }, 130)
      break
    case "error":
      // 刚性三连拒斥拍击
      void Haptics.transient(0.85, 0.50)
      setTimeout(() => {
        try {
          void Haptics.transient?.(0.85, 0.50)
        } catch {}
      }, 90)
      setTimeout(() => {
        try {
          void Haptics.transient?.(0.85, 0.50)
        } catch {}
      }, 180)
      break
    default:
      void Haptics.transient(0.48, 0.70)
      break
  }
}

/**
 * 统一自适应触觉反馈调度器
 *
 * 1. 语义化标准触觉（如 "selection" / "light" / "success" 等）：
 *    - PRO 用户：静默升级为 Core Haptics 引擎的高级微调波形与升调复合脉冲，大幅提升触觉质感。
 *    - 普通用户（及模拟普通用户状态）：保持 iOS 原生 UIKit HapticFeedback 基础触觉，从物理层杜绝内购弹窗。
 *
 * 2. 自定义浮点触觉（intensity, sharpness）：
 *    - PRO 用户：完整启用高级 Core Haptics 模式（Haptics.transient），保留自定义锐度波形。
 *    - 普通用户：自适应降级为最接近的原生 UIKit 触觉，无缝平滑且 100% 零弹窗。
 */
export function triggerHaptic(type?: HapticFeedbackType): void
export function triggerHaptic(intensity?: number, sharpness?: number): void
export function triggerHaptic(arg1?: HapticFeedbackType | number, arg2?: number): void {
  try {
    const coreHapticsReady = isCoreHapticsAvailable()

    // A. 浮点自定义触觉模式
    if (typeof arg1 === "number") {
      const intensity = arg1
      const sharpness = typeof arg2 === "number" ? arg2 : undefined

      if (coreHapticsReady) {
        void Haptics.transient(intensity, sharpness)
        return
      }

      // 免费用户或硬件不可用时自适应平滑分流至 UIKit 基础触觉
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

    // B. 标准语义触觉模式
    const hapticType = (arg1 as HapticFeedbackType) || "light"

    if (coreHapticsReady) {
      triggerProCoreHaptic(hapticType)
      return
    }

    triggerStandardUIKitHaptic(hapticType)
  } catch {
    // 静默降级，确保任意极端环境都不会抛出异常或中断交互
  }
}
