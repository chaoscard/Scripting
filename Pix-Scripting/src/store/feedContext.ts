import type { PixivIllustration } from "../types"

export interface ActiveFeedContext {
  id: string
  items: PixivIllustration[]
  currentIndex: number
  hasMore?: boolean
  loadMore?: () => Promise<void> | void
}

type FeedContextListener = (context: ActiveFeedContext) => void

const feedRegistry = new Map<string, ActiveFeedContext>()
const illustToFeedMap = new Map<number, string>()
let activeFeedStack: string[] = []
const listeners = new Map<string, Set<FeedContextListener>>()

/**
 * 注册或更新一个 Feed 的数据与状态（每次列表渲染或更新时调用）
 */
export function registerOrUpdateFeedContext(params: {
  id: string
  items: PixivIllustration[]
  hasMore?: boolean
  loadMore?: () => Promise<void> | void
}): void {
  const { id, items, hasMore, loadMore } = params
  if (!id || !items || items.length === 0) return

  let ctx = feedRegistry.get(id)
  if (!ctx) {
    ctx = {
      id,
      items: [...items],
      currentIndex: 0,
      hasMore,
      loadMore,
    }
    feedRegistry.set(id, ctx)
    if (!activeFeedStack.includes(id)) {
      activeFeedStack.push(id)
    }
  } else {
    // 仅当 items 真正增加或变化时才更新
    const prevLen = ctx.items.length
    ctx.items = [...items]
    if (hasMore !== undefined) ctx.hasMore = hasMore
    if (loadMore !== undefined) ctx.loadMore = loadMore

    // 只有当有新 items 追加时才触发通知
    if (ctx.items.length !== prevLen) {
      notifyListeners(ctx)
    }
  }

  // 映射作品 ID 到 feedId
  for (const item of items) {
    if (item && item.id) {
      illustToFeedMap.set(item.id, id)
    }
  }
}

/**
 * 显式激活一个 Feed 上下文（用户点击卡片时调用）
 */
export function setActiveFeedContext(params: {
  id: string
  items: PixivIllustration[]
  initialIndex: number
  hasMore?: boolean
  loadMore?: () => Promise<void> | void
}): ActiveFeedContext {
  const { id, items, initialIndex, hasMore, loadMore } = params
  const validIndex = Math.max(0, Math.min(initialIndex, items.length - 1))
  const ctx: ActiveFeedContext = {
    id,
    items: [...items],
    currentIndex: validIndex,
    hasMore,
    loadMore,
  }

  feedRegistry.set(id, ctx)
  for (const item of items) {
    if (item && item.id) {
      illustToFeedMap.set(item.id, id)
    }
  }

  activeFeedStack = activeFeedStack.filter((k) => k !== id)
  activeFeedStack.push(id)
  if (activeFeedStack.length > 8) {
    const removed = activeFeedStack.shift()
    if (removed) feedRegistry.delete(removed)
  }

  return ctx
}

export function updateFeedContextItems(
  id: string,
  items: PixivIllustration[],
  hasMore?: boolean,
  loadMore?: () => Promise<void> | void
): void {
  registerOrUpdateFeedContext({ id, items, hasMore, loadMore })
}

/**
 * 获取与指定作品 ID 匹配的活跃上下文（返回独立快照，避免状态污染）
 */
export function getActiveFeedContext(targetIllustID?: number): ActiveFeedContext | null {
  if (targetIllustID != null && targetIllustID > 0) {
    // 1. 检查 illustToFeedMap
    const mappedFeedId = illustToFeedMap.get(targetIllustID)
    if (mappedFeedId) {
      const mappedCtx = feedRegistry.get(mappedFeedId)
      if (mappedCtx && mappedCtx.items.some((it) => it.id === targetIllustID)) {
        const foundIndex = mappedCtx.items.findIndex((it) => it.id === targetIllustID)
        return {
          id: mappedCtx.id,
          items: [...mappedCtx.items],
          currentIndex: foundIndex >= 0 ? foundIndex : 0,
          hasMore: mappedCtx.hasMore,
          loadMore: mappedCtx.loadMore,
        }
      }
    }

    // 2. 检查活跃栈
    for (let i = activeFeedStack.length - 1; i >= 0; i--) {
      const id = activeFeedStack[i]
      const ctx = feedRegistry.get(id)
      if (ctx && ctx.items.some((it) => it.id === targetIllustID)) {
        const foundIndex = ctx.items.findIndex((it) => it.id === targetIllustID)
        return {
          id: ctx.id,
          items: [...ctx.items],
          currentIndex: foundIndex >= 0 ? foundIndex : 0,
          hasMore: ctx.hasMore,
          loadMore: ctx.loadMore,
        }
      }
    }
  }

  return null
}

/**
 * 订阅指定上下文的变更通知（仅用于追加 items）
 */
export function subscribeFeedContext(
  id: string,
  listener: FeedContextListener
): () => void {
  let set = listeners.get(id)
  if (!set) {
    set = new Set()
    listeners.set(id, set)
  }
  set.add(listener)

  return () => {
    const currentSet = listeners.get(id)
    if (currentSet) {
      currentSet.delete(listener)
      if (currentSet.size === 0) {
        listeners.delete(id)
      }
    }
  }
}

function notifyListeners(context: ActiveFeedContext): void {
  const set = listeners.get(context.id)
  if (set) {
    const snapshot: ActiveFeedContext = {
      id: context.id,
      items: [...context.items],
      currentIndex: context.currentIndex,
      hasMore: context.hasMore,
      loadMore: context.loadMore,
    }
    for (const listener of set) {
      try {
        listener(snapshot)
      } catch (err) {
        console.error("Error in FeedContextListener:", err)
      }
    }
  }
}
