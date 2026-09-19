import { useEffect, useState } from "scripting"

let globalLastActiveAmbientImageUrl: string | null = null
const activeAmbientListeners = new Set<() => void>()

function notifyActiveAmbientChanged() {
  for (const fn of activeAmbientListeners) {
    try {
      fn()
    } catch {}
  }
}

/**
 * 记录最近一次在前台活跃生效的环境光封面图片 URL
 */
export function recordActiveAmbientImageUrl(url: string | null | undefined): void {
  if (url && typeof url === "string" && url.trim().length > 0) {
    const next = url.trim()
    // 同值不重复通知：本函数会被多个页面在 effect 中反复调用，
    // 若无条件广播，订阅方（右栏空态复用沉浸色）会被自己的回写打成无限循环。
    if (next === globalLastActiveAmbientImageUrl) return
    globalLastActiveAmbientImageUrl = next
    // 延后通知：写入发生在渲染 / effect 期间，同步 setState 会触发「渲染中更新其它组件」告警
    setTimeout(notifyActiveAmbientChanged, 0)
  }
}

/**
 * 获取最近一次在前台活跃生效的环境光封面图片 URL（用于二级页面 Push 转场与加载期间垫底预热）
 */
export function getLastActiveAmbientImageUrl(): string | null {
  return globalLastActiveAmbientImageUrl
}

/** 订阅「最近一次生效的环境光封面」变化 */
export function subscribeActiveAmbientImageUrl(listener: () => void): () => void {
  activeAmbientListeners.add(listener)
  return () => {
    activeAmbientListeners.delete(listener)
  }
}

/**
 * 读取**实时**的「最近一次生效的环境光封面」。
 *
 * 用途：右栏空态（DetailEmptyPlaceholder）复用左栏当前浏览页的沉浸色 ——
 * 左栏换首图时这里会跟着变，而不是只在挂载那一刻取一次。
 */
export function useLastActiveAmbientImageUrl(): string | null {
  const [url, setUrl] = useState(() => getLastActiveAmbientImageUrl())
  useEffect(() => {
    const listener = () => setUrl(getLastActiveAmbientImageUrl())
    return subscribeActiveAmbientImageUrl(listener)
  }, [])
  return url
}
