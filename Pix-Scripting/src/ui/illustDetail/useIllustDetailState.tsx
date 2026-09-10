import {
  Navigation,
  Rectangle,
  useCallback,
  useColorScheme,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"
import {
  addBookmark,
  bookmarkDetail,
  followDetail,
  followUser,
  illustrationDetail,
  removeBookmark,
  unfollowUser,
} from "../../api/pixiv"
import { session } from "../../api/session"
import { triggerHaptic } from "../../utils/haptics"
import {
  downloadIllustToAlbum,
  exportIllustToZip,
  exportMangaToCbz,
  exportMangaToEpub,
  exportUgoiraToAlbum,
  exportUgoiraZip,
} from "../../downloader"
import {
  cachedFilePath,
  cardThumbUrlOf,
  imageUrlOf,
  pageThumbUrlOf,
  prefetch,
  resolveIllustUnderlayUrl,
  seedIllustDetailFromCache,
} from "../../image/imageLoader"
import {
  extractIllustAmbientPalette,
  getCachedIllustAmbientPalette,
  type IllustAmbientPalette,
} from "../../image/colorExtractor"
import {
  getDetailImageQuality,
  getDownloadImageQuality,
  loadSettings,
  onSettingsChanged,
  type AmbientIntensity,
} from "../../store/settings"
import {
  getIllustContentBlockReason,
} from "../../store/contentFilter"
import {
  recordHistory,
  updateHistoryBookmark,
} from "../../store/history"
import {
  getUserFollowRestrict,
  isUserFollowed,
  onUserFollowChanged,
  recordUserFollowed,
  type FollowRestrict,
} from "../../store/userFollow"
import {
  cacheIllust,
  getCachedIllust,
} from "../../store/illustCache"
import { getCachedIllustBookmark } from "../../store/bookmarkSync"
import { getSeriesByWorkID, recordWorkSeriesAssociation } from "../../store/seriesCache"
import { useAsyncGuard, useIllustBookmark, useLatest, useOpenBookmarkDetailListener, useOpenRelatedUsersListener } from "../hooks"
import { renderAmbientBackground } from "../ambient"
import type { PixivIllustration } from "../../types"
import { IllustGalleryView } from "../IllustGalleryView"
import type { IllustAIMode } from "../aiSheet"
import type { IllustDetailActions, IllustDetailState } from "./types"

declare const ShareSheet: any
declare const UIImage: any

const BLOCKED_BY_BLOCKLIST_MESSAGE = "该作品已被屏蔽（标签或作者在黑名单中）"
const BLOCKED_BY_RESTRICTION_MESSAGE = "该作品被内容显示设置过滤，暂时无法显示"

function getInitialIllustPalette(
  illust: PixivIllustration | null,
  isDark: boolean,
  intensity: AmbientIntensity,
  quality: "medium" | "large" | "original"
): IllustAmbientPalette | null {
  if (!illust) return null
  const candidates = [
    cardThumbUrlOf(illust),
    illust.image_urls?.medium,
    illust.image_urls?.square_medium,
    illust.image_urls?.large,
    imageUrlOf(illust, 0, quality),
  ]
  for (const u of candidates) {
    if (!u) continue
    const pal = getCachedIllustAmbientPalette(u, isDark, intensity)
    if (pal) return pal
  }
  return null
}

export function useIllustDetailState(illustID: number): {
  state: IllustDetailState
  actions: IllustDetailActions
} {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const [illust, setIllust] = useState<PixivIllustration | null>(() => {
    const cached = getCachedIllust(illustID)
    if (cached) {
      seedIllustDetailFromCache(cached, getDetailImageQuality())
    }
    return cached
  })
  const [ambientEnabled, setAmbientEnabled] = useState(
    () => loadSettings().ambientImmersion
  )
  const [ambientIntensity, setAmbientIntensity] = useState(
    () => loadSettings().ambientIntensity
  )
  const [ambientAlgorithm, setAmbientAlgorithm] = useState(
    () =>
      loadSettings().experimentalImmersion
        ? loadSettings().experimentalImmersionAlgorithm
        : loadSettings().ambientAlgorithm
  )
  const [ugoiraExportFormat, setUgoiraExportFormat] = useState(
    () => loadSettings().ugoiraExportFormat ?? "mp4"
  )
  const [quickActionEnabled, setQuickActionEnabled] = useState(
    () => loadSettings().quickActionButtonEnabled
  )
  const [quickActionType, setQuickActionType] = useState(
    () => loadSettings().quickActionButtonAction
  )
  const [quickActionPos, setQuickActionPos] = useState(
    () => loadSettings().quickActionButtonPosition
  )
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"
  const [ambientPalette, setAmbientPalette] = useState<IllustAmbientPalette | null>(() => {
    const settings = loadSettings()
    if (!settings.ambientImmersion) return null
    const initial = getCachedIllust(illustID)
    return getInitialIllustPalette(
      initial,
      isDark,
      settings.ambientIntensity,
      getDetailImageQuality(settings)
    )
  })
  const [loading, setLoading] = useState(() => !getCachedIllust(illustID))
  const [error, setError] = useState<string | null>(null)
  const [bookmarked, setBookmarked] = useIllustBookmark(
    illustID,
    getCachedIllust(illustID)?.is_bookmarked ?? false
  )
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [bookmarkLongPressLocked, setBookmarkLongPressLocked] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  useOpenBookmarkDetailListener("illust", illustID, () => {
    setShowBookmarkDetail(true)
  })
  const [followed, setFollowed] = useState(() => {
    const cachedUser = getCachedIllust(illustID)?.user
    if (cachedUser?.id != null) {
      return isUserFollowed(cachedUser.id) ?? cachedUser.is_followed ?? false
    }
    return cachedUser?.is_followed ?? false
  })
  const [followRestrict, setFollowRestrict] = useState<FollowRestrict | null>(() => {
    const cachedUser = getCachedIllust(illustID)?.user
    if (cachedUser?.id != null) {
      return getUserFollowRestrict(cachedUser.id) ?? null
    }
    return null
  })
  const [followLoading, setFollowLoading] = useState(false)
  const [showRelatedUsers, setShowRelatedUsers] = useState(false)
  useOpenRelatedUsersListener(illust?.user?.id, () => {
    setShowRelatedUsers(true)
  })
  const [showComments, setShowComments] = useState(false)
  const [showAISheet, setShowAISheet] = useState(false)
  const [aiMode, setAIMode] = useState<IllustAIMode>("caption")
  const [quality, setQuality] = useState(() => getDetailImageQuality())
  const [mediaReady, setMediaReady] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const guard = useAsyncGuard()
  const illustRef = useLatest(illust)
  const errorRef = useLatest(error)
  // 同一实例只记录一次浏览（下拉刷新/重试不重复刷新 viewedAt）；换作品时重置
  const recordedIDRef = useRef<number | null>(null)

  useEffect(() => {
    const cached = getCachedIllust(illustID)
    if (cached && recordedIDRef.current !== cached.id) {
      recordedIDRef.current = cached.id
      recordHistory(cached)
    }
  }, [illustID])

  const cachedIllust = getCachedIllust(illustID)
  const currentIllust = illust ?? cachedIllust
  const rawSeries = currentIllust?.series ?? (currentIllust as any)?.illust_series
  const rawSeriesObj = Array.isArray(rawSeries) ? rawSeries[0] : rawSeries
  const associatedRef = getSeriesByWorkID(illustID, "manga")
  const resolvedSeriesID = rawSeriesObj?.id ?? associatedRef?.seriesID ?? null
  const resolvedSeriesTitle = rawSeriesObj?.title ?? associatedRef?.seriesTitle ?? null
  const resolvedEpisodeNumber = currentIllust?.episode_number ?? associatedRef?.episodeNumber ?? null

  if (currentIllust && resolvedSeriesID) {
    recordWorkSeriesAssociation(currentIllust.id, "manga", resolvedSeriesID, resolvedSeriesTitle, resolvedEpisodeNumber)
  }

  const pageCount = currentIllust ? Math.max(1, currentIllust.page_count || currentIllust.meta_pages?.length || 1) : 1
  const pageURLs: (string | null)[] = []
  if (currentIllust) {
    for (let k = 0; k < pageCount; k++) {
      pageURLs.push(imageUrlOf(currentIllust, k, quality))
    }
  }

  const ambientPaletteRef = useLatest(ambientPalette)
  const handleMainImageLoaded = useCallback(() => {
    setMediaReady(true)
    if (!ambientPaletteRef.current && ambientEnabled) {
      const bigImageUrl = pageURLs[0]
      if (bigImageUrl) {
        const pal = getCachedIllustAmbientPalette(bigImageUrl, isDark, ambientIntensity)
        if (pal) {
          setAmbientPalette(pal)
        }
      }
    }
  }, [ambientEnabled, isDark, ambientIntensity, pageURLs])

  const pageAspect = useMemo(() => {
    if (!currentIllust) return 0.75
    if (currentIllust.width && currentIllust.height && currentIllust.width > 0 && currentIllust.height > 0) {
      return currentIllust.width / currentIllust.height
    }
    const underlay0 = resolveIllustUnderlayUrl(currentIllust, 0)
    if (underlay0) {
      const cached = cachedFilePath(underlay0)
      if (cached) {
        try {
          const img = UIImage.fromFile(cached)
          if (img && img.width > 0 && img.height > 0) {
            return img.width / img.height
          }
        } catch {}
      }
    }
    const thumb0 = pageThumbUrlOf(currentIllust, 0)
    if (thumb0) {
      const cached = cachedFilePath(thumb0)
      if (cached) {
        try {
          const img = UIImage.fromFile(cached)
          if (img && img.width > 0 && img.height > 0) {
            return img.width / img.height
          }
        } catch {}
      }
    }
    return 0.75
  }, [currentIllust?.id, currentIllust?.width, currentIllust?.height])

  async function load(clear = !illustRef.current) {
    const g = guard()
    if (clear) {
      setLoading(true)
      setError(null)
    }
    setMediaReady(false)
    try {
      const detail = await session.call((token) =>
        illustrationDetail(illustID, token)
      )
      if (!g.isCurrent()) return
      cacheIllust(detail)
      if (detail.user?.id) {
        recordUserFollowed(detail.user.id, detail.user.is_followed ?? false)
      }
      const settings = loadSettings()
      const isExempt =
        settings.exemptFilterForPersonal &&
        (detail.user?.is_followed === true ||
          (detail.user?.id != null && isUserFollowed(detail.user.id) === true) ||
          detail.is_bookmarked === true ||
          getCachedIllustBookmark(detail.id) === true ||
          followed ||
          bookmarked)
      const blockReason = getIllustContentBlockReason(detail, settings, undefined, {
        exemptRestrictions: isExempt,
      })
      if (blockReason !== null) {
        setIllust(null)
        setError(
          blockReason === "blocklist"
            ? BLOCKED_BY_BLOCKLIST_MESSAGE
            : BLOCKED_BY_RESTRICTION_MESSAGE
        )
        return
      }
      const existingCached = getCachedIllust(detail.id)
      if (
        existingCached?.meta_pages &&
        existingCached.meta_pages.length > 1 &&
        (!detail.meta_pages || detail.meta_pages.length <= 1)
      ) {
        detail.meta_pages = existingCached.meta_pages
        detail.page_count = existingCached.page_count
      }
      if (existingCached?.extra_preview_url && !detail.extra_preview_url) {
        detail.extra_preview_url = existingCached.extra_preview_url
      }
      if (quality === "large") {
        const currentHeroUrl =
          existingCached?.extra_preview_url && cachedFilePath(existingCached.extra_preview_url)
            ? existingCached.extra_preview_url
            : existingCached?.image_urls?.large && cachedFilePath(existingCached.image_urls.large)
              ? existingCached.image_urls.large
              : null
        if (currentHeroUrl) {
          detail.image_urls.large = currentHeroUrl
          if (detail.meta_pages && detail.meta_pages.length > 0 && detail.meta_pages[0]?.image_urls) {
            detail.meta_pages[0].image_urls.large = currentHeroUrl
          }
        }
      }
      seedIllustDetailFromCache(detail, quality)
      setIllust(detail)
      setBookmarked(detail.is_bookmarked)
      const isFollowed = detail.user?.is_followed ?? false
      setFollowed(isFollowed)
      if (isFollowed && detail.user?.id) {
        session
          .call((token) => followDetail(detail.user.id, token))
          .then((d) => {
            if (g.isCurrent()) {
              setFollowed(d.is_followed)
              if (d.is_followed) {
                const rest = d.restrict ?? "public"
                setFollowRestrict(rest)
                recordUserFollowed(detail.user.id, true, rest)
              } else {
                setFollowRestrict(null)
              }
            }
          })
          .catch(() => {})
      } else if (!isFollowed) {
        setFollowRestrict(null)
      }
      if (recordedIDRef.current !== detail.id) {
        recordedIDRef.current = detail.id
        recordHistory(detail)
      }
      const prefetchURLs: (string | null | undefined)[] = []
      const detailQuality = getDetailImageQuality()
      const total = Math.min(4, detail.page_count || detail.meta_pages?.length || 1)
      for (let k = 1; k < total; k++) {
        prefetchURLs.push(imageUrlOf(detail, k, detailQuality))
      }
      prefetch(prefetchURLs)
      session
        .call((token) => bookmarkDetail(illustID, token))
        .then((d) => {
          if (g.isCurrent()) setBookmarked(d.is_bookmarked)
        })
        .catch(() => {})
      if (detail.user.is_followed == null) {
        session
          .call((token) => followDetail(detail.user.id, token))
          .then((d) => {
            if (g.isCurrent()) setFollowed(d.is_followed)
          })
          .catch(() => {})
      }
    } catch (err: any) {
      if (g.isCurrent()) {
        if (!illustRef.current) {
          setError(err?.message ?? "加载失败")
        }
      }
    } finally {
      if (g.isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    const cached = getCachedIllust(illustID)
    if (cached) {
      seedIllustDetailFromCache(cached, quality)
      load(false)
    } else {
      setIllust(null)
      load(true)
    }
    const timer = setTimeout(() => {
      setMediaReady(true)
    }, 1200)
    return () => clearTimeout(timer)
  }, [illustID])

  useEffect(() => {
    return onUserFollowChanged((changedUserID, nextFollowed, nextRestrict) => {
      if (changedUserID === illustRef.current?.user.id) {
        setFollowed(nextFollowed)
        setFollowRestrict(nextFollowed ? (nextRestrict ?? "public") : null)
      }
    })
  }, [])

  useEffect(() => {
    if (!ambientEnabled) {
      setAmbientPalette(null)
      return
    }
    const current = illustRef.current
    if (!current) {
      setAmbientPalette(null)
      return
    }
    const candidates = [
      cardThumbUrlOf(current),
      current.image_urls?.medium,
      current.image_urls?.square_medium,
      current.image_urls?.large,
      imageUrlOf(current, 0, quality),
    ].filter((u): u is string => Boolean(u))

    let active = true
    for (const u of candidates) {
      const cached = getCachedIllustAmbientPalette(u, isDark, ambientIntensity)
      if (cached) {
        setAmbientPalette(cached)
        return
      }
    }
    const targetUrl = candidates[0]
    if (targetUrl) {
      void extractIllustAmbientPalette(targetUrl).then((result) => {
        if (!active || !result) return
        const modeObj = isDark ? result.dark : result.light
        setAmbientPalette(modeObj[ambientIntensity] ?? modeObj.medium)
      })
    }
    return () => {
      active = false
    }
  }, [illust?.id, quality, isDark, ambientEnabled, ambientIntensity])

  useEffect(() => {
    return onSettingsChanged(() => {
      const settings = loadSettings()
      setQuality(getDetailImageQuality(settings))
      setAmbientEnabled(settings.ambientImmersion)
      setAmbientIntensity(settings.ambientIntensity)
      setAmbientAlgorithm(
        settings.experimentalImmersion
          ? settings.experimentalImmersionAlgorithm
          : settings.ambientAlgorithm
      )
      setUgoiraExportFormat(settings.ugoiraExportFormat ?? "mp4")
      setQuickActionEnabled(settings.quickActionButtonEnabled)
      setQuickActionType(settings.quickActionButtonAction)
      setQuickActionPos(settings.quickActionButtonPosition)
      setPageLayout(settings.pageLayout)
      const current = illustRef.current
      if (current) {
        const isExempt =
          settings.exemptFilterForPersonal &&
          (current.user?.is_followed === true ||
            (current.user?.id != null && isUserFollowed(current.user.id) === true) ||
            current.is_bookmarked === true ||
            getCachedIllustBookmark(current.id) === true ||
            followed ||
            bookmarked)
        const blockReason = getIllustContentBlockReason(current, settings, undefined, {
          exemptRestrictions: isExempt,
        })
        if (blockReason !== null) {
          guard()
          setIllust(null)
          setError(
            blockReason === "blocklist"
              ? BLOCKED_BY_BLOCKLIST_MESSAGE
              : BLOCKED_BY_RESTRICTION_MESSAGE
          )
          setLoading(false)
        }
      } else if (
        !current &&
        (errorRef.current === BLOCKED_BY_BLOCKLIST_MESSAGE ||
          errorRef.current === BLOCKED_BY_RESTRICTION_MESSAGE)
      ) {
        load()
      }
    })
  }, [bookmarked, followed])

  async function toggleBookmark() {
    if (!currentIllust || bookmarkLoading) return
    triggerHaptic("medium")
    setBookmarkLoading(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeBookmark(currentIllust.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) =>
          addBookmark(currentIllust.id, "public", [], token)
        )
        setBookmarked(true)
      }
      updateHistoryBookmark(currentIllust.id, !bookmarked)
    } catch {
      // ignore
    } finally {
      setBookmarkLoading(false)
    }
  }

  async function bookmarkAndFollow() {
    if (!currentIllust || bookmarkLoading || followLoading) return
    setBookmarkLoading(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addBookmark(currentIllust.id, "public", [], token))
        setBookmarked(true)
        updateHistoryBookmark(currentIllust.id, true)
      }
      if (!followed) {
        await session.call((token) => followUser(currentIllust.user.id, "public", token))
        setFollowed(true)
        if (loadSettings().showRelatedUsersOnFollow) {
          setShowRelatedUsers(true)
        }
      }
    } catch {
      // ignore
    } finally {
      setBookmarkLoading(false)
    }
  }

  function handleBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    triggerHaptic("medium")
    if (action === "follow") {
      void bookmarkAndFollow()
    } else {
      setShowBookmarkDetail(true)
    }
  }

  async function handleDownloadUgoira() {
    if (!currentIllust || downloading) return
    triggerHaptic("light")
    setDownloading(true)
    try {
      const res = await exportUgoiraToAlbum(currentIllust)
      if (res.success) {
        triggerHaptic("success")
      }
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadUgoiraZip() {
    if (!currentIllust || downloading) return
    triggerHaptic("light")
    setDownloading(true)
    try {
      const res = await exportUgoiraZip(currentIllust)
      if (res.success && res.savedPath) {
        triggerHaptic("success")
        await ShareSheet.present([res.savedPath])
      }
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadIllustToAlbum() {
    if (!currentIllust || downloading) return
    triggerHaptic("light")
    setDownloading(true)
    const downloadQuality = getDownloadImageQuality()
    try {
      const ok = await downloadIllustToAlbum(currentIllust, downloadQuality)
      if (ok) {
        triggerHaptic("success")
      }
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadIllustToZip() {
    if (!currentIllust || downloading) return
    triggerHaptic("light")
    setDownloading(true)
    const downloadQuality = getDownloadImageQuality()
    try {
      const urls: string[] = []
      for (let i = 0; i < pageCount; i++) {
        const url = imageUrlOf(currentIllust, i, downloadQuality) ?? pageURLs[i]
        if (url) urls.push(url)
      }
      const res = await exportIllustToZip({
        illust: currentIllust,
        imageUrls: urls,
      })
      if (res.success && res.path) {
        triggerHaptic("success")
        await ShareSheet.present([res.path])
      }
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadManga(format: "cbz" | "epub") {
    if (!currentIllust || downloading) return
    triggerHaptic("light")
    setDownloading(true)
    const downloadQuality = getDownloadImageQuality()
    try {
      const pages: { pageIndex: number; url: string }[] = []
      for (let i = 0; i < pageCount; i++) {
        const url = imageUrlOf(currentIllust, i, downloadQuality) ?? pageURLs[i]
        if (url) pages.push({ pageIndex: i + 1, url })
      }

      let filePath: string | null = null
      const isR18 = (currentIllust.x_restrict ?? 0) > 0 || currentIllust.tags?.some((t) => /r-?18/i.test(t.name))
      if (format === "cbz") {
        const res = await exportMangaToCbz({
          id: currentIllust.id,
          title: currentIllust.title,
          author: currentIllust.user?.name || "Unknown",
          authorId: currentIllust.user?.id,
          seriesTitle: resolvedSeriesTitle ?? undefined,
          description: currentIllust.caption,
          tags: currentIllust.tags?.map((t) => t.name),
          createdDate: currentIllust.create_date,
          isR18,
          pages,
        })
        filePath = res.success ? (res.path ?? null) : null
      } else {
        const res = await exportMangaToEpub({
          id: currentIllust.id,
          title: currentIllust.title,
          author: currentIllust.user?.name || "Unknown",
          authorId: currentIllust.user?.id,
          seriesTitle: resolvedSeriesTitle ?? undefined,
          description: currentIllust.caption,
          tags: currentIllust.tags?.map((t) => t.name),
          createdDate: currentIllust.create_date,
          isR18,
          pages,
        })
        filePath = res.success ? (res.path ?? null) : null
      }

      if (filePath) {
        triggerHaptic("success")
        await ShareSheet.present([filePath])
      }
    } finally {
      setDownloading(false)
    }
  }

  async function followWithVisibility(restrict: "public" | "private") {
    if (!currentIllust || followLoading) return
    triggerHaptic("medium")
    setFollowLoading(true)
    try {
      await session.call((token) => followUser(currentIllust.user.id, restrict, token))
      setFollowed(true)
      setFollowRestrict(restrict)
      if (loadSettings().showRelatedUsersOnFollow) {
        setShowRelatedUsers(true)
      }
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  async function toggleFollow() {
    if (!currentIllust || followLoading) return
    if (!followed) {
      await followWithVisibility("public")
      return
    }
    triggerHaptic("medium")
    setFollowLoading(true)
    try {
      await session.call((token) => unfollowUser(currentIllust.user.id, token))
      setFollowed(false)
      setFollowRestrict(null)
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  async function shareIllust() {
    if (!currentIllust) return
    triggerHaptic("selection")
    await ShareSheet.present([`https://www.pixiv.net/artworks/${currentIllust.id}`])
  }

  function openGallery(pageIndex = 0) {
    if (!currentIllust || currentIllust.type === "ugoira") return
    void Navigation.present({
      element: <IllustGalleryView illust={currentIllust} initialPageIndex={pageIndex} />,
      modalPresentationStyle: "fullScreen",
    })
  }

  const ambientBackgroundNode =
    ambientEnabled && ambientPalette
      ? renderAmbientBackground({
          ambientPalette,
          ambientAlgorithm,
          isDark,
          ambientIntensity,
          active: true,
        })
      : null

  const state: IllustDetailState = {
    illustID,
    illust,
    loading,
    error,
    isDark,
    ambientEnabled,
    ambientPalette,
    ambientBackgroundNode,
    pageLayout,
    isAppleMusic,
    bookmarked,
    bookmarkLoading,
    bookmarkLongPressLocked,
    showBookmarkDetail,
    followed,
    followRestrict,
    followLoading,
    showRelatedUsers,
    showComments,
    showAISheet,
    aiMode,
    quality,
    mediaReady,
    downloading,
    ugoiraExportFormat,
    quickActionEnabled,
    quickActionType,
    quickActionPos,
    resolvedSeriesID,
    resolvedSeriesTitle,
    resolvedEpisodeNumber,
    pageCount,
    pageURLs,
    pageAspect,
  }

  const actions: IllustDetailActions = {
    load,
    toggleBookmark,
    bookmarkAndFollow,
    handleBookmarkLongPress,
    handleDownloadUgoira,
    handleDownloadUgoiraZip,
    handleDownloadIllustToAlbum,
    handleDownloadIllustToZip,
    handleDownloadManga,
    followWithVisibility,
    toggleFollow,
    shareIllust,
    openGallery,
    handleMainImageLoaded,
    setBookmarkLongPressLocked,
    setShowBookmarkDetail,
    setShowComments,
    setShowAISheet,
    setAIMode,
    setShowRelatedUsers,
    setBookmarked,
  }

  return { state, actions }
}
