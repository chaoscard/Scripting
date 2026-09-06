import type { PixivNovel, PixivNovelDetail } from "../types"

type CachedNovelType = PixivNovel | PixivNovelDetail

const MAX_CACHE_SIZE = 500
const novelCache = new Map<number, CachedNovelType>()

export function cacheNovel(novel: CachedNovelType | null | undefined): void {
  if (!novel || !novel.id) return
  const existing = novelCache.get(novel.id)
  const merged: CachedNovelType = existing
    ? {
        ...existing,
        ...novel,
        image_urls: {
          ...existing.image_urls,
          ...novel.image_urls,
        },
        user: {
          ...existing.user,
          ...novel.user,
          profile_image_urls: {
            ...existing.user?.profile_image_urls,
            ...novel.user?.profile_image_urls,
          },
        },
        tags: novel.tags && novel.tags.length > 0 ? novel.tags : existing.tags,
        caption: novel.caption || existing.caption,
      }
    : novel

  if (novelCache.has(novel.id)) {
    novelCache.delete(novel.id)
  } else if (novelCache.size >= MAX_CACHE_SIZE) {
    const firstKey = novelCache.keys().next().value
    if (firstKey !== undefined) {
      novelCache.delete(firstKey)
    }
  }
  novelCache.set(novel.id, merged)
}

export function cacheNovels(
  novels: (CachedNovelType | null | undefined)[] | null | undefined
): void {
  if (!Array.isArray(novels)) return
  for (const it of novels) {
    if (it) cacheNovel(it)
  }
}

export function getCachedNovel(id: number): CachedNovelType | null {
  if (!id) return null
  const cached = novelCache.get(id)
  if (!cached) return null
  // Refresh LRU order
  novelCache.delete(id)
  novelCache.set(id, cached)
  return cached
}

export function clearNovelMemoryCache(): void {
  novelCache.clear()
}
