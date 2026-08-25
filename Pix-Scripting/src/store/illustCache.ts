import type { PixivIllustration } from "../types"

const MAX_CACHE_SIZE = 500
const illustCache = new Map<number, PixivIllustration>()

export function cacheIllust(illust: PixivIllustration | null | undefined): void {
  if (!illust || !illust.id) return
  const existing = illustCache.get(illust.id)
  const merged: PixivIllustration = existing
    ? {
        ...existing,
        ...illust,
        image_urls: {
          ...existing.image_urls,
          ...illust.image_urls,
        },
        meta_pages:
          illust.meta_pages && illust.meta_pages.length > 0
            ? illust.meta_pages
            : existing.meta_pages,
        meta_single_page:
          illust.meta_single_page?.original_image_url
            ? illust.meta_single_page
            : existing.meta_single_page,
        user: {
          ...existing.user,
          ...illust.user,
          profile_image_urls: {
            ...existing.user?.profile_image_urls,
            ...illust.user?.profile_image_urls,
          },
        },
        tags: illust.tags && illust.tags.length > 0 ? illust.tags : existing.tags,
        caption: illust.caption || existing.caption,
      }
    : illust

  if (illustCache.has(illust.id)) {
    illustCache.delete(illust.id)
  } else if (illustCache.size >= MAX_CACHE_SIZE) {
    const firstKey = illustCache.keys().next().value
    if (firstKey !== undefined) {
      illustCache.delete(firstKey)
    }
  }
  illustCache.set(illust.id, merged)
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

export function clearIllustMemoryCache(): void {
  illustCache.clear()
}
