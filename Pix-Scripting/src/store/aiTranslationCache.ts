import type { IllustAIMode, PageTranslationCache, NovelPageCache } from "../ui/aiSheet/types"

/**
 * AI 翻译与识别全局会话缓存管理器 (LRU In-Memory Store)
 * 作用：
 * 1. 在切后台、组件重新渲染或手势关闭/重开 Sheet 时，保留已生成的 OCR 气泡、翻译译文和生图结果；
 * 2. 避免重复调用远程大模型 API 消耗 Token 和等待时间；
 * 3. 采用 LRU 容量保护（上限 60 部作品），防止内存无限增长。
 */

const MAX_CACHE_ENTRIES = 60

interface NovelAICacheEntry {
  captionCache?: { resultText: string; error: string | null }
  pageCaches?: Record<number, NovelPageCache>
}

// 插画/漫画缓存：key 格式为 `${illustID}:${mode}`
const illustAICacheMap = new Map<string, Record<number, PageTranslationCache>>()

// 小说缓存：key 为 novelID
const novelAICacheMap = new Map<number, NovelAICacheEntry>()

function makeIllustKey(illustID: number, mode: IllustAIMode): string {
  return `${illustID}:${mode}`
}

function enforceLRU<K, V>(map: Map<K, V>, max: number) {
  if (map.size > max) {
    const oldestKey = map.keys().next().value
    if (oldestKey !== undefined) {
      map.delete(oldestKey)
    }
  }
}

// ----------------- 插画 / 漫画 缓存操作 -----------------

/** 获取指定插画特定模式的全页翻译缓存 */
export function getIllustAICache(
  illustID: number,
  mode: IllustAIMode
): Record<number, PageTranslationCache> | undefined {
  const key = makeIllustKey(illustID, mode)
  const val = illustAICacheMap.get(key)
  if (val) {
    // 刷新 LRU 活跃度
    illustAICacheMap.delete(key)
    illustAICacheMap.set(key, val)
    return { ...val }
  }
  return undefined
}

/** 获取指定插画特定模式特定页的翻译缓存 */
export function getIllustPageAICache(
  illustID: number,
  mode: IllustAIMode,
  pageIndex: number
): PageTranslationCache | undefined {
  const all = getIllustAICache(illustID, mode)
  return all ? all[pageIndex] : undefined
}

/** 设置指定插画特定模式的全页翻译缓存 */
export function setIllustAICache(
  illustID: number,
  mode: IllustAIMode,
  cache: Record<number, PageTranslationCache>
): void {
  const key = makeIllustKey(illustID, mode)
  illustAICacheMap.delete(key)
  illustAICacheMap.set(key, { ...cache })
  enforceLRU(illustAICacheMap, MAX_CACHE_ENTRIES)
}

/** 更新指定插画特定模式特定页的翻译缓存 */
export function updateIllustPageAICache(
  illustID: number,
  mode: IllustAIMode,
  pageIndex: number,
  updater: Partial<PageTranslationCache> | ((prev: PageTranslationCache) => PageTranslationCache)
): void {
  const key = makeIllustKey(illustID, mode)
  const current = illustAICacheMap.get(key) || {}
  const prevPage = current[pageIndex] || { resultText: "" }
  const nextPage = typeof updater === "function" ? updater(prevPage) : { ...prevPage, ...updater }

  const nextAll = {
    ...current,
    [pageIndex]: nextPage,
  }

  illustAICacheMap.delete(key)
  illustAICacheMap.set(key, nextAll)
  enforceLRU(illustAICacheMap, MAX_CACHE_ENTRIES)
}

/** 清理插画翻译缓存（可清理指定作品、指定模式或全量） */
export function clearIllustAICache(illustID?: number, mode?: IllustAIMode): void {
  if (illustID !== undefined && mode !== undefined) {
    illustAICacheMap.delete(makeIllustKey(illustID, mode))
  } else if (illustID !== undefined) {
    const prefix = `${illustID}:`
    for (const key of Array.from(illustAICacheMap.keys())) {
      if (key.startsWith(prefix)) {
        illustAICacheMap.delete(key)
      }
    }
  } else {
    illustAICacheMap.clear()
  }
}

// ----------------- 小说 缓存操作 -----------------

/** 获取小说 AI 缓存 */
export function getNovelAICache(novelID: number): NovelAICacheEntry | undefined {
  const val = novelAICacheMap.get(novelID)
  if (val) {
    novelAICacheMap.delete(novelID)
    novelAICacheMap.set(novelID, val)
    return {
      captionCache: val.captionCache ? { ...val.captionCache } : undefined,
      pageCaches: val.pageCaches ? { ...val.pageCaches } : undefined,
    }
  }
  return undefined
}

/** 设置小说 AI 缓存 */
export function setNovelAICache(novelID: number, data: NovelAICacheEntry): void {
  novelAICacheMap.delete(novelID)
  novelAICacheMap.set(novelID, {
    captionCache: data.captionCache ? { ...data.captionCache } : undefined,
    pageCaches: data.pageCaches ? { ...data.pageCaches } : undefined,
  })
  enforceLRU(novelAICacheMap, MAX_CACHE_ENTRIES)
}

/** 更新小说简介翻译缓存 */
export function updateNovelAICaption(
  novelID: number,
  caption: { resultText: string; error: string | null }
): void {
  const current = novelAICacheMap.get(novelID) || {}
  setNovelAICache(novelID, {
    ...current,
    captionCache: { ...caption },
  })
}

/** 更新小说分页正文 AI 缓存 */
export function updateNovelPageAICache(
  novelID: number,
  pageIndex: number,
  updater: Partial<NovelPageCache> | ((prev: NovelPageCache) => NovelPageCache)
): void {
  const current = novelAICacheMap.get(novelID) || {}
  const pages = current.pageCaches || {}
  const prev = pages[pageIndex] || {}
  const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater }

  setNovelAICache(novelID, {
    ...current,
    pageCaches: {
      ...pages,
      [pageIndex]: next,
    },
  })
}

/** 清理小说 AI 缓存 */
export function clearNovelAICache(novelID?: number): void {
  if (novelID !== undefined) {
    novelAICacheMap.delete(novelID)
  } else {
    novelAICacheMap.clear()
  }
}
