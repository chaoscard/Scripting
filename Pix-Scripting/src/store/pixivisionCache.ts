import type { PixivisionDetail } from "../types"

const MAX_PIXIVISION_CACHE_SIZE = 50
const pixivisionDetailCache = new Map<number, PixivisionDetail>()

/**
 * 缓存特辑详情数据（支持 LRU 淘汰）
 */
export function cachePixivisionDetail(detail: PixivisionDetail | null | undefined): void {
  if (!detail || !detail.id) return
  if (pixivisionDetailCache.has(detail.id)) {
    pixivisionDetailCache.delete(detail.id)
  } else if (pixivisionDetailCache.size >= MAX_PIXIVISION_CACHE_SIZE) {
    const firstKey = pixivisionDetailCache.keys().next().value
    if (firstKey !== undefined) {
      pixivisionDetailCache.delete(firstKey)
    }
  }
  pixivisionDetailCache.set(detail.id, detail)
}

/**
 * 同步获取内存中已缓存的特辑详情数据（第 0 毫秒直出）
 */
export function getCachedPixivisionDetail(articleID: number): PixivisionDetail | null {
  return pixivisionDetailCache.get(articleID) ?? null
}

/**
 * 清理特辑详情缓存
 */
export function clearPixivisionDetailCache(): void {
  pixivisionDetailCache.clear()
}
