let launchReadySignaled = false
const launchReadyListeners = new Set<() => void>()

/**
 * 触发启动就绪信号（首图下载完成/命中缓存，或首屏数据加载完成/失败）。
 * 启动动画监听此信号后，可在兼顾最小品牌展示时长（minDuration）的前提下，
 * 提前或在就绪瞬间平滑揭幕，杜绝揭幕时显示空白骨架屏。
 */
export function notifyLaunchReady(): void {
  if (launchReadySignaled) return
  launchReadySignaled = true
  for (const listener of launchReadyListeners) {
    try {
      listener()
    } catch {}
  }
  launchReadyListeners.clear()
}

export function isLaunchReady(): boolean {
  return launchReadySignaled
}

export function onLaunchReady(listener: () => void): () => void {
  if (launchReadySignaled) {
    listener()
    return () => {}
  }
  launchReadyListeners.add(listener)
  return () => {
    launchReadyListeners.delete(listener)
  }
}

export function resetLaunchReady(): void {
  launchReadySignaled = false
  launchReadyListeners.clear()
}
