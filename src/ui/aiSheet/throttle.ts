/**
 * 创建高帧率流式节流器（约 14~16 fps，65ms 间隔）
 * 解决大模型高频推送 token 导致的 React/SwiftUI 疯狂重渲染与掉帧卡顿
 */
export function createThrottledUpdater(
  onUpdate: (text: string) => void,
  intervalMs = 65
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastUpdateTime = 0
  let latestText = ""

  return {
    push(text: string) {
      latestText = text
      const now = Date.now()
      const remaining = intervalMs - (now - lastUpdateTime)
      if (remaining <= 0) {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        lastUpdateTime = now
        onUpdate(latestText)
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null
          lastUpdateTime = Date.now()
          onUpdate(latestText)
        }, remaining)
      }
    },
    flush(text?: string) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (text !== undefined) {
        latestText = text
      }
      lastUpdateTime = Date.now()
      if (latestText) {
        onUpdate(latestText)
      }
    },
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
