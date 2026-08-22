import type { PixivIllustration } from "../types"

const MAX_CACHE_SIZE = 500
const illustCache = new Map<number, PixivIllustration>()

export function cacheIllust(illust: PixivIllustration | null | undefined): void {
  if (!illust || !illust.id) return
  if (illustCache.has(illust.id)) {
    illustCache.delete(illust.id)
  } else if (illustCache.size >= MAX_CACHE_SIZE) {
    const firstKey = illustCache.keys().next().value
    if (firstKey !== undefined) {
      illustCache.delete(firstKey)
    }
  }
  illustCache.set(illust.id, illust)
}

export function cacheIllusts(illusts: PixivIllustration[] | null | undefined): void {
  if (!Array.isArray(illusts)) return
  for (const it of illusts) {
    cacheIllust(it)
  }
}

export function getCachedIllust(id: number): PixivIllustration | null {
  if (!id) return null
  const cached = illustCache.get(id)
  if (!cached) return null
  // Refresh LRU order
  illustCache.delete(id)
  illustCache.set(id, cached)
  return cached
}
