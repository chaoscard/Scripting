import { Script } from "scripting"

/**
 * Scripting PRO 权限探测工具
 * 严格通过 Script.hasFullAccess() 进行安全门禁拦截，
 * 防止非 PRO 用户触发宿主环境弹出原生的“解锁 Scripting PRO”内购模态窗。
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
