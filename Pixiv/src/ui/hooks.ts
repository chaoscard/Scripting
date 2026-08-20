import { useCallback, useEffect, useRef, useState, useColorScheme, type Color } from "scripting"
import { session } from "../api/session"
import { getImageBatchSize, loadSettings, onSettingsChanged, type AmbientIntensity } from "../store/settings"
import {
  extractUserAmbientPalette,
  getCachedUserAmbientPalette,
  type UserAmbientPalette,
} from "../image/colorExtractor"

// 触底回弹缓冲：由高级设置配置（默认 1000ms），确保触底橡皮筋回弹完整展示转圈，随后平滑展开新批次卡片
export function paginationFeedbackDuration(): number {
  return loadSettings().loadingAnimationDuration ?? 1000
}

export function waitForPaginationFeedback(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, paginationFeedbackDuration()))
}

// ---------- 氛围色 Hook ----------

export function useUserAmbientPalette(imageUrl: string | null | undefined): {
  ambientEnabled: boolean
  ambientIntensity: AmbientIntensity
  ambientPalette: UserAmbientPalette | null
  ambientBackground: { colors: Color[]; startPoint: "top"; endPoint: "bottom" } | undefined
} {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const [ambientEnabled, setAmbientEnabled] = useState(
    () => loadSettings().ambientImmersion
  )
  const [ambientIntensity, setAmbientIntensity] = useState<AmbientIntensity>(
    () => loadSettings().ambientIntensity
  )
  const [ambientPalette, setAmbientPalette] = useState<UserAmbientPalette | null>(() => {
    if (!loadSettings().ambientImmersion || !imageUrl) return null
    return getCachedUserAmbientPalette(imageUrl, isDark, loadSettings().ambientIntensity)
  })

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      setAmbientEnabled(nextSettings.ambientImmersion)
      setAmbientIntensity(nextSettings.ambientIntensity)
    })
  }, [])

  useEffect(() => {
    if (!ambientEnabled || !imageUrl) {
      setAmbientPalette(null)
      return
    }
    let active = true
    const cached = getCachedUserAmbientPalette(imageUrl, isDark, ambientIntensity)
    if (cached) {
      setAmbientPalette(cached)
    }
    void extractUserAmbientPalette(imageUrl).then((result) => {
      if (!active || !result) return
      const modeObj = isDark ? result.dark : result.light
      setAmbientPalette(modeObj[ambientIntensity] ?? modeObj.medium)
    })
    return () => {
      active = false
    }
  }, [imageUrl, isDark, ambientEnabled, ambientIntensity])

  const ambientBackground =
    ambientEnabled && ambientPalette
      ? {
          colors: [
            ambientPalette.topColor,
            ambientPalette.midColor,
            ambientPalette.worksColor,
            ambientPalette.worksColor,
          ],
          startPoint: "top" as const,
          endPoint: "bottom" as const,
        }
      : undefined

  return { ambientEnabled, ambientIntensity, ambientPalette, ambientBackground }
}

// ---------- 通用 hooks ----------

// 始终持有最新值的 ref（供订阅/异步回调读取，避免闭包捕获旧渲染值）
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

// 防竞态守卫：每次调用返回一个新的"序号令牌"，异步回调返回后
// 调用 isCurrent() 判断自己是否仍是最近一次发起者，否则丢弃结果。
// 用法：
//   const guard = useAsyncGuard()
//   async function load() {
//     const g = guard()
//     const page = await fetch()
//     if (!g.isCurrent()) return   // 已被更新的请求取代
//     setItems(page.items)
//   }
export function useAsyncGuard() {
  const seqRef = useRef(0)
  return useCallback(() => {
    const seq = ++seqRef.current
    return {
      isCurrent: () => seq === seqRef.current,
      // 主动使在途请求全部失效（例如组件卸载时）
      invalidate: () => {
        seqRef.current++
      },
    }
  }, [])
}

// 防抖：delay 毫秒内的连续调用只触发最后一次
export function useDebouncedCallback<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): T {
  const fnRef = useLatest(fn)
  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [])
  return useCallback(
    ((...args: any[]) => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        fnRef.current(...args)
      }, delay)
    }) as T,
    [delay]
  )
}

// 定时翻转状态：setOn 后 duration 毫秒自动复位；组件卸载自动清理定时器
export function useTimedFlag(duration = 2000): [boolean, () => void] {
  const [flag, setFlag] = useState(false)
  const timerRef = useRef<number | null>(null)
  const setOn = useCallback(() => {
    if (timerRef.current != null) clearTimeout(timerRef.current)
    setFlag(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setFlag(false)
    }, duration)
  }, [duration])
  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [])
  return [flag, setOn]
}

// 按渲染 key 稳定合并：保留第一次出现，扫描时立即登记，
// 同时消除基线内、当前响应内和跨页重复。key 统一字符串化，
// 与 JSX key 的身份语义一致（数字 1 与字符串 "1" 视为同一项）。
export function mergeUniqueByKey<T>(
  base: T[],
  incoming: T[],
  keyOf: (item: T) => number | string
): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of [...base, ...incoming]) {
    const key = String(keyOf(item))
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export function dedupeByKey<T>(
  items: T[],
  keyOf: (item: T) => number | string
): T[] {
  return mergeUniqueByKey([], items, keyOf)
}

export function mergeUniqueByID<T extends { id: number | string }>(
  base: T[],
  incoming: T[]
): T[] {
  return mergeUniqueByKey(base, incoming, (item) => item.id)
}

export function dedupeByID<T extends { id: number | string }>(items: T[]): T[] {
  return mergeUniqueByID([], items)
}

// 仅保留最近使用的完整视图树。调用方仍可保留自身 Hook 状态，
// 但超过上限的流会卸载 ScrollView/卡片，防止大量隐藏原生列表持续驻留。
export function useRetainedKeys(currentKey: string, limit: number): ReadonlySet<string> {
  const [keys, setKeys] = useState<string[]>([currentKey])
  useEffect(() => {
    setKeys((current) =>
      [currentKey, ...current.filter((key) => key !== currentKey)].slice(0, limit)
    )
  }, [currentKey, limit])
  return new Set(keys)
}

// ---------- 分页列表 hook ----------

export function currentBatchSize(): number {
  return getImageBatchSize(loadSettings().imageBatchConcurrency)
}

export interface PageResult<T> {
  items: T[]
  nextURL: string | null
}

export interface UsePagedListOptions<T> {
  // 第一页加载（已由调用方指定参数，如 kind/scope/tag）
  first: (token: string) => Promise<PageResult<T>>
  // 下一页加载；缺省则不支持分页
  more?: (nextURL: string, token: string) => Promise<PageResult<T>>
  // 每页统一过滤（R18/AI 等，数组级），first 与 more 都生效
  filter?: (items: T[]) => T[]
  // 依赖变化（如切换 kind/scope）时重新加载第一页
  deps: unknown[]
  // 仅在激活时触发首次加载；用于保留隐藏列表的已加载状态和滚动位置。
  enabled?: boolean
  // 每次发布 UI 批次后通知调用方；pendingItems 是紧随本批的待展示项目，
  // 用于只预取下一批缩略图。返回的 cleanup 会在下一批、刷新或失活时调用。
  onBatchPublished?: (items: T[], pendingItems: T[]) => void | (() => void)
}

// 统一分页状态机：防竞态（请求序号）+ loadMore in-flight 守卫 + 按 id 去重 +
// first/more 统一过滤 + 加载/错误状态管理
export function usePagedList<T extends { id: number | string }>(
  opts: UsePagedListOptions<T>
) {
  const { first, more, filter, deps, enabled = true, onBatchPublished } = opts
  const [items, setItems] = useState<T[]>([])
  const [pendingItems, setPendingItems] = useState<T[]>([])
  const [nextURL, setNextURL] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // 未激活的常驻流在首次显示前也应保持首屏加载态，避免切换时先短暂渲染空态。
  const [initialLoading, setInitialLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seqRef = useRef(0)
  const moreTaskIDRef = useRef(0)
  const loadingMoreTaskRef = useRef<{ id: number; seq: number; url: string } | null>(null)
  const firstRef = useLatest(first)
  const moreRef = useLatest(more)
  const filterRef = useLatest(filter)
  const onBatchPublishedRef = useLatest(onBatchPublished)
  const nextURLRef = useLatest(nextURL)
  const pendingItemsRef = useLatest(pendingItems)
  const enabledRef = useLatest(enabled)
  const itemsRef = useLatest(items)
  const initialLoadingRef = useLatest(initialLoading)
  const hasLoadedRef = useRef(false)
  const loadedDepsRef = useRef<unknown[] | null>(null)
  const activationRef = useRef(0)
  const batchPublishedCleanupRef = useRef<(() => void) | null>(null)
  const consumedTailRef = useRef<string | null>(null)

  const clearBatchPublishedEffects = () => {
    const cleanup = batchPublishedCleanupRef.current
    batchPublishedCleanupRef.current = null
    cleanup?.()
  }

  const notifyBatchPublished = (published: T[], pending: T[]) => {
    clearBatchPublishedEffects()
    const cleanup = onBatchPublishedRef.current?.(published, pending)
    batchPublishedCleanupRef.current =
      typeof cleanup === "function" ? cleanup : null
  }

  const invalidateInactiveWork = () => {
    activationRef.current++
    seqRef.current++
    loadingMoreTaskRef.current = null
    setLoadingMore(false)
    consumedTailRef.current = null
    clearBatchPublishedEffects()
    // 首次加载尚未完成就离开时，下次激活必须重新请求，不能停在加载中。
    if (itemsRef.current.length === 0 && initialLoadingRef.current) {
      hasLoadedRef.current = false
      setHasLoaded(false)
    }
  }

  const applyFilter = (list: T[]): T[] => {
    const f = filterRef.current
    return f ? f(list) : list
  }

  const splitPage = (incoming: T[], existing: T[] = []) => {
    const batchSize = currentBatchSize()
    const candidates = mergeUniqueByID(existing, applyFilter(incoming)).slice(existing.length)
    return {
      published: candidates.slice(0, batchSize),
      pending: candidates.slice(batchSize),
    }
  }

  // 核心加载逻辑：clear=true 时清空旧数据并显示全屏加载（首次/参数切换）；
  // clear=false 时保留旧列表后台更新（下拉刷新/设置变更），避免页面闪烁
  const load = useCallback(async (clear: boolean) => {
    const seq = ++seqRef.current
    const activation = activationRef.current
    // 首屏/刷新具有更高优先级：立即废弃旧翻页锁。旧任务完成时只能
    // 清理自身，不能释放之后新任务持有的锁。
    loadingMoreTaskRef.current = null
    setLoadingMore(false)
    setError(null)
    if (clear) {
      setInitialLoading(true)
      setHasLoaded(false)
      setItems([])
      setPendingItems([])
      setNextURL(null)
      consumedTailRef.current = null
    }
    try {
      let page = await session.call((token) => firstRef.current(token))
      if (
        seq !== seqRef.current ||
        activation !== activationRef.current ||
        !enabledRef.current
      ) return

      // 首页可能部分或全部被 R18/AI/屏蔽规则过滤。
      // 若首屏有效条目不足一个批次且仍有 nextURL，向前多页探测收集满一个批次，
      // 保证首屏卡片充实且有充足的滑动缓冲。
      const batchSize = currentBatchSize()
      let collected: T[] = []
      let nextPageURL: string | null = page.nextURL
      const visitedURLs = new Set<string>()
      const existingSet = new Set<string>()

      for (const item of applyFilter(page.items)) {
        const idKey = String(item.id)
        if (!existingSet.has(idKey)) {
          existingSet.add(idKey)
          collected.push(item)
        }
      }

      while (
        collected.length < batchSize &&
        nextPageURL &&
        moreRef.current &&
        !visitedURLs.has(nextPageURL)
      ) {
        const url = nextPageURL
        visitedURLs.add(url)
        page = await session.call((token) => moreRef.current!(url, token))
        if (
          seq !== seqRef.current ||
          activation !== activationRef.current ||
          !enabledRef.current
        ) return
        nextPageURL = page.nextURL
        for (const item of applyFilter(page.items)) {
          const idKey = String(item.id)
          if (!existingSet.has(idKey)) {
            existingSet.add(idKey)
            collected.push(item)
          }
        }
      }

      const published = collected.slice(0, batchSize)
      const pending = collected.slice(batchSize)
      setItems(published)
      setPendingItems(pending)
      setNextURL(nextPageURL)
      consumedTailRef.current = null
      notifyBatchPublished(published, pending)
      setHasLoaded(true)
    } catch (err: any) {
      if (
        seq !== seqRef.current ||
        activation !== activationRef.current ||
        !enabledRef.current
      ) return
      setError(err?.message ?? "加载失败")
    } finally {
      if (
        seq === seqRef.current &&
        activation === activationRef.current &&
        enabledRef.current
      ) {
        setInitialLoading(false)
      }
    }
  }, [])

  // 下拉刷新 / 设置变更：保留旧列表，新数据到达后整体替换（不闪全屏）
  const refresh = useCallback(() => load(false), [load])

  // 设置变化时先对已发布项和当前页缓冲立即重过滤，不能依赖后台刷新成功后才撤下受限内容。
  const reapplyFilter = useCallback(() => {
    setItems((current) => dedupeByID(applyFilter(current)))
    setPendingItems((current) => dedupeByID(applyFilter(current)))
    consumedTailRef.current = null
  }, [])

  // 触底时优先发布当前服务端页的本地缓冲；缓冲耗尽后才请求下一页。
  // anchor 为触发者的稳定尾项 ID，同一尾项只允许推进一次，避免多个 onAppear 跳批。
  const loadMore = useCallback(async (anchor?: number | string) => {
    if (!enabledRef.current) return
    const tail = itemsRef.current[itemsRef.current.length - 1]
    const tailKey = String(anchor ?? tail?.id ?? "")
    if (!tail || (anchor != null && tailKey !== String(tail.id))) return
    if (consumedTailRef.current === tailKey) return
    consumedTailRef.current = tailKey

    const pending = pendingItemsRef.current
    if (pending.length > 0) {
      if (loadingMoreTaskRef.current) return
      const task = { id: ++moreTaskIDRef.current, seq: seqRef.current, url: "pending" }
      loadingMoreTaskRef.current = task
      setLoadingMore(true)
      try {
        // 缓冲 1500ms：确保触底橡皮筋回弹完整展示转圈，随后平滑展开新批次卡片
        await waitForPaginationFeedback()
        if (loadingMoreTaskRef.current !== task || !enabledRef.current) {
          consumedTailRef.current = null
          return
        }
        const batchSize = currentBatchSize()
        const nextBatch = pending.slice(0, batchSize)
        setItems((current) => mergeUniqueByID(current, nextBatch))
        setPendingItems(pending.slice(batchSize))
        notifyBatchPublished(nextBatch, pending.slice(batchSize))
      } finally {
        if (loadingMoreTaskRef.current === task) {
          loadingMoreTaskRef.current = null
          setLoadingMore(false)
        }
      }
      return
    }

    const moreFn = moreRef.current
    const url = nextURLRef.current
    if (!moreFn || !url || loadingMoreTaskRef.current) return
    const seq = seqRef.current
    const activation = activationRef.current
    const task = { id: ++moreTaskIDRef.current, seq, url }
    loadingMoreTaskRef.current = task
    setLoadingMore(true)
    try {
      const batchSize = currentBatchSize()
      const currentItems = itemsRef.current
      const existingSet = new Set(currentItems.map((i) => String(i.id)))
      const collectedNewItems: T[] = []
      let nextPageURL: string | null = url
      const visitedURLs = new Set<string>()
      let attempts = 0
      const MAX_ATTEMPTS = 6

      // 若当前返回的页全部被过滤或与已有列表部分重复（如相关推荐高度重叠），
      // 在单次加载任务内部向前自动探测并累积后续游标，直到凑满一个批次或游标耗尽。
      while (
        collectedNewItems.length < batchSize &&
        nextPageURL &&
        !visitedURLs.has(nextPageURL) &&
        attempts < MAX_ATTEMPTS
      ) {
        attempts++
        const fetchUrl: string = nextPageURL
        visitedURLs.add(fetchUrl)
        const [page]: [PageResult<T>, unknown] = await Promise.all([
          session.call((token) => moreFn(fetchUrl, token)),
          attempts === 1
            ? waitForPaginationFeedback()
            : Promise.resolve(),
        ])
        if (
          seq !== seqRef.current ||
          activation !== activationRef.current ||
          !enabledRef.current ||
          loadingMoreTaskRef.current !== task
        ) {
          consumedTailRef.current = null
          return
        }

        nextPageURL = page.nextURL
        for (const item of applyFilter(page.items)) {
          const idKey = String(item.id)
          if (!existingSet.has(idKey)) {
            existingSet.add(idKey)
            collectedNewItems.push(item)
          }
        }
      }

      const published = collectedNewItems.slice(0, batchSize)
      const pending = collectedNewItems.slice(batchSize)

      if (published.length > 0) {
        setItems((current) => mergeUniqueByID(current, published))
        setPendingItems(pending)
        notifyBatchPublished(published, pending)
      }
      setNextURL(nextPageURL)
      // 若经过多页探测后依然没有产出新卡片且后续游标已耗尽，保持 consumedTailRef 避免重复自激；
      // 若还有后续游标但达到本轮批次尝试上限，重置 consumedTailRef 允许下次触底再尝试。
      if (published.length === 0 && nextPageURL && attempts >= MAX_ATTEMPTS) {
        consumedTailRef.current = null
      }
    } catch {
      // 加载更多失败静默，允许同一尾项再次触发。
      consumedTailRef.current = null
    } finally {
      // 只有当前锁的所有者可以释放它；旧任务不得清除刷新后新建的锁。
      if (loadingMoreTaskRef.current === task) {
        loadingMoreTaskRef.current = null
        setLoadingMore(false)
      }
    }
  }, [])

  // 依赖变化（如切换 kind/scope）时重新加载第一页。enabled=false 的常驻隐藏
  // 流不请求；再次激活时仅首次加载，随后复用其分页和滚动状态。
  useEffect(() => {
    if (!enabled) {
      invalidateInactiveWork()
      return
    }
    activationRef.current++
    consumedTailRef.current = null
    const prev = loadedDepsRef.current
    const changed =
      prev == null ||
      prev.length !== deps.length ||
      prev.some((d, i) => !Object.is(d, deps[i]))
    if (changed || !hasLoadedRef.current) {
      loadedDepsRef.current = deps
      hasLoadedRef.current = true
      load(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled])

  useEffect(() => {
    return () => {
      invalidateInactiveWork()
    }
  }, [])

  return {
    items,
    nextURL,
    loadingMore,
    initialLoading,
    hasLoaded,
    error,
    refresh,
    reapplyFilter,
    loadMore,
    hasMore: pendingItems.length > 0 || nextURL != null,
  }
}
