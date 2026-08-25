import {
  Button,
  Divider,
  DragGesture,
  FlowLayout,
  GlassEffectContainer,
  Group,
  HStack,
  Image,
  LazyVStack,
  LongPressGesture,
  Menu,
  NavigationLink,
  ProgressView,
  ScrollView,
  ScrollViewReader,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
  VStack,
  ZStack,
  type ScrollViewProxy,
} from "scripting"
import {
  addNovelBookmark,
  addNovelMarker,
  deleteNovelMarker,
  followUser,
  nextNovels,
  novelBookmarkDetail,
  novelBookmarkTags,
  novelDetail,
  novelViewerData,
  relatedNovels,
  removeNovelBookmark,
  unfollowUser,
} from "../api/pixiv"
import { session } from "../api/session"
import { exportNovelToEpub } from "../downloader"
import {
  currentBatchSize,
  useAsyncGuard,
  useLatest,
  useNovelBookmark,
  useNovelMarker,
  usePagedList,
  waitForNovelLoadingFeedback,
} from "./hooks"
import { novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  recordNovelHistory,
  updateNovelHistoryBookmark,
} from "../store/history"
import {
  flushNovelProgress,
  getNovelProgress,
  recordNovelProgress,
} from "../store/novelProgress"
import { getSeriesByWorkID, recordWorkSeriesAssociation } from "../store/seriesCache"
import {
  isUserFollowed,
  onUserFollowChanged,
  recordUserFollowed,
} from "../store/userFollow"
import {
  getCachedNovelBookmark,
  getCachedNovelMarker,
  recordNovelMarker,
} from "../store/bookmarkSync"
import type { PixivNovel, PixivNovelDetail, TextEmbeddedImage } from "../types"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  getNovelContentBlockReason,
  isNovelContentVisible,
} from "../store/contentFilter"
import {
  AvatarImage,
  BookmarkDetailSheet,
  ErrorView,
  ExpandableIntroduction,
  formatDate,
  formatNumber,
  LoadingView,
  LoadMoreTrigger,
  NovelCard,
  SeriesEpisodePager,
  TagChip,
} from "./components"
import { NovelReaderView, NovelReaderWebView } from "./novelReader"
import { CommentsSheet } from "./comments"
import { NovelAISheet, type NovelAIMode } from "./aiSheet"
import { cleanHtmlCaption } from "../api/aiService"
import { renderDestination } from "./routes"
import { requestPixivRoute } from "./routeNavigation"

const BLOCKED_BY_BLOCKLIST_MESSAGE = "该小说已被屏蔽（标签或作者在黑名单中）"
const BLOCKED_BY_RESTRICTION_MESSAGE = "该小说被内容显示设置过滤，暂时无法显示"

function isNovelChunkId(id: string): boolean {
  return (
    id.startsWith("chunk-") ||
    id.startsWith("ch-") ||
    id.startsWith("page-") ||
    id.startsWith("jump-") ||
    id.startsWith("up-") ||
    id.startsWith("px-")
  )
}

function historyNovelFromDetail(detail: PixivNovelDetail): PixivNovel {
  return { ...detail, is_muted: false, visible: true }
}

export function NovelDetailView(props: { novelID: number }) {
  const { novelID } = props
  const [novel, setNovel] = useState<PixivNovelDetail | null>(null)
  const [text, setText] = useState("")
  const [textEmbeddedImages, setTextEmbeddedImages] = useState<Record<string, TextEmbeddedImage> | undefined>(undefined)
  const [textError, setTextError] = useState<string | null>(null)
  const [readerReady, setReaderReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bookmarked, setBookmarked] = useNovelBookmark(novelID, false)
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [bookmarkLongPressLocked, setBookmarkLongPressLocked] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  const [followed, setFollowed] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [showAISheet, setShowAISheet] = useState(false)
  const [aiMode, setAIMode] = useState<NovelAIMode>("caption")
  const [markerPage, setMarkerPage] = useNovelMarker(novelID, null)
  const initialProgress = useMemo(() => getNovelProgress(novelID), [novelID])
  const scrollPos = useObservable<string | null>(initialProgress?.chunkId ?? null)
  const [currentPage, setCurrentPage] = useState<number>(
    () => initialProgress?.page ?? getCachedNovelMarker(novelID) ?? 1
  )
  const [totalPages, setTotalPages] = useState(1)
  const [pagerVisible, setPagerVisible] = useState(true)
  const [markerBusy, setMarkerBusy] = useState(false)

  const guard = useAsyncGuard()
  const novelRef = useLatest(novel)
  const errorRef = useLatest(error)
  const currentPageRef = useLatest(currentPage)
  const recordedIDRef = useRef<number | null>(null)
  const proxyRef = useRef<ScrollViewProxy | null>(null)
  const initialScrollChunkIdRef = useRef<string | null>(initialProgress?.chunkId ?? null)
  const lastRecordedChunkRef = useRef<string | null>(initialProgress?.chunkId ?? null)
  const isRestoringScrollRef = useRef<boolean>(
    Boolean(
      initialProgress?.chunkId &&
        initialProgress.chunkId !== "novel-top-anchor" &&
        initialProgress.chunkId !== "chunk-0"
    )
  )
  const hasRestoredScrollRef = useRef(false)
  const isUnmountingRef = useRef(false)
  const isDisappearedRef = useRef(false)

  const rawSeries = novel?.series ?? (novel as any)?.novel_series
  const rawSeriesObj = Array.isArray(rawSeries) ? rawSeries[0] : rawSeries
  const associatedRef = getSeriesByWorkID(novelID, "novel")
  const resolvedSeriesID = rawSeriesObj?.id ?? associatedRef?.seriesID ?? null
  const resolvedSeriesTitle = rawSeriesObj?.title ?? associatedRef?.seriesTitle ?? null
  const resolvedEpisodeNumber = novel?.episode_number ?? associatedRef?.episodeNumber ?? null

  const performScrollRestoration = useCallback((targetChunk?: string) => {
    const target = targetChunk ?? getNovelProgress(novelID)?.chunkId
    if (
      !target ||
      target === "novel-top-anchor" ||
      target === "novel-header-content" ||
      target === "chunk-0"
    ) {
      isRestoringScrollRef.current = false
      return
    }

    initialScrollChunkIdRef.current = target
    lastRecordedChunkRef.current = target
    isRestoringScrollRef.current = true
    scrollPos.setValue(target)

    const attempts = [30, 80, 180, 350, 600, 1000]
    attempts.forEach((delay) => {
      setTimeout(() => {
        if (isDisappearedRef.current || isUnmountingRef.current) return
        try {
          scrollPos.setValue(target)
          proxyRef.current?.scrollTo(target, "top")
        } catch {}
      }, delay)
    })

    setTimeout(() => {
      isRestoringScrollRef.current = false
    }, 1800)
  }, [novelID, scrollPos])

  async function load() {
    const g = guard()
    setLoading(true)
    setReaderReady(false)
    setError(null)
    try {
      const [detail, viewer] = await Promise.all([
        session.call((token) => novelDetail(novelID, token)),
        session.call((token) => novelViewerData(novelID, token)),
      ])
      if (!g.isCurrent()) return
      if (detail.user?.id) {
        recordUserFollowed(detail.user.id, detail.user.is_followed ?? false)
      }
      const settings = loadSettings()
      const isExempt =
        settings.exemptFilterForPersonal &&
        (detail.user?.is_followed === true ||
          (detail.user?.id != null && isUserFollowed(detail.user.id) === true) ||
          detail.is_bookmarked === true ||
          getCachedNovelBookmark(detail.id) === true ||
          followed ||
          bookmarked)
      const blockReason = getNovelContentBlockReason(detail, settings, undefined, {
        exemptRestrictions: isExempt,
      })
      if (blockReason !== null) {
        setNovel(null)
        setText("")
        setError(
          blockReason === "blocklist"
            ? BLOCKED_BY_BLOCKLIST_MESSAGE
            : BLOCKED_BY_RESTRICTION_MESSAGE
        )
        return
      }

      setNovel(detail)
      setBookmarked(detail.is_bookmarked)
      setFollowed(detail.user?.is_followed ?? false)
      if (detail.series?.id) {
        recordWorkSeriesAssociation(
          detail.id,
          "novel",
          detail.series.id,
          detail.series.title,
          detail.episode_number
        )
      }
      const detailMarker = (detail as any)?.novel_marker?.page ?? (detail as any)?.marker?.page ?? null
      const existingCached = getCachedNovelMarker(detail.id)
      const savedProgress = getNovelProgress(detail.id)
      let targetMarker = existingCached
      if (detailMarker !== null && detailMarker > 0) {
        if (existingCached == null || existingCached <= 1 || detailMarker > 1) {
          targetMarker = detailMarker
          setMarkerPage(detailMarker)
          recordNovelMarker(detail.id, detailMarker)
        }
      }
      if (savedProgress?.page && savedProgress.page > 0) {
        setCurrentPage(savedProgress.page)
        if (
          savedProgress.chunkId &&
          savedProgress.chunkId !== "novel-top-anchor" &&
          savedProgress.chunkId !== "chunk-0"
        ) {
          initialScrollChunkIdRef.current = savedProgress.chunkId
          lastRecordedChunkRef.current = savedProgress.chunkId
          isRestoringScrollRef.current = true
          scrollPos.setValue(savedProgress.chunkId)
        }
      } else if (targetMarker && targetMarker > 1) {
        setCurrentPage(targetMarker)
      }
      if (recordedIDRef.current !== detail.id) {
        recordedIDRef.current = detail.id
        recordNovelHistory(historyNovelFromDetail(detail))
      }
      const resolvedEmbeddedImages =
        viewer.textEmbeddedImages ??
        (detail as any)?.textEmbeddedImages ??
        (detail as any)?.text_embedded_images ??
        undefined
      setText(viewer.text)
      setTextEmbeddedImages(resolvedEmbeddedImages)
      setTextError(null)
      if (!viewer.text) {
        setReaderReady(true)
      }
    } catch (err: any) {
      if (g.isCurrent()) {
        setError(err?.message ?? "加载失败")
        setReaderReady(true)
      }
    } finally {
      if (g.isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    const saved = getNovelProgress(novelID)
    const cachedMarker = getCachedNovelMarker(novelID)
    const targetPage = saved?.page ?? cachedMarker ?? 1
    setCurrentPage(targetPage)
    initialScrollChunkIdRef.current = saved?.chunkId ?? null
    lastRecordedChunkRef.current = saved?.chunkId ?? null
    isRestoringScrollRef.current = Boolean(
      saved?.chunkId &&
        saved.chunkId !== "novel-top-anchor" &&
        saved.chunkId !== "chunk-0"
    )
    hasRestoredScrollRef.current = false
    if (saved?.chunkId && saved.chunkId !== "chunk-0") {
      scrollPos.setValue(saved.chunkId)
    }
    setPagerVisible(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelID])

  useEffect(() => {
    isUnmountingRef.current = false
    return () => {
      isUnmountingRef.current = true
      flushNovelProgress()
    }
  }, [])

  useEffect(() => {
    return onUserFollowChanged((changedUserID, nextFollowed) => {
      if (changedUserID === novelRef.current?.user?.id) {
        setFollowed(nextFollowed)
      }
    })
  }, [])

  // 屏蔽黑名单变化时撤下或恢复已打开的内容。
  useEffect(() => {
    return onSettingsChanged(() => {
      const settings = loadSettings()
      const current = novelRef.current
      if (current) {
        const isExempt =
          settings.exemptFilterForPersonal &&
          (current.user?.is_followed === true ||
            (current.user?.id != null && isUserFollowed(current.user.id) === true) ||
            current.is_bookmarked === true ||
            getCachedNovelBookmark(current.id) === true ||
            followed ||
            bookmarked)
        const blockReason = getNovelContentBlockReason(current, settings, undefined, {
          exemptRestrictions: isExempt,
        })
        if (blockReason !== null) {
          guard()
          setNovel(null)
          setText("")
          setTextEmbeddedImages(undefined)
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
    if (!novel || bookmarkLoading) return
    void Haptics.transient()
    setBookmarkLoading(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeNovelBookmark(novel.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) =>
          addNovelBookmark(novel.id, "public", token)
        )
        setBookmarked(true)
      }
      updateNovelHistoryBookmark(novel.id, !bookmarked)
    } catch {
      // ignore
    } finally {
      setBookmarkLoading(false)
    }
  }

  async function bookmarkAndFollow() {
    if (!novel || bookmarkLoading) return
    setBookmarkLoading(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addNovelBookmark(novel.id, "public", token))
        setBookmarked(true)
        updateNovelHistoryBookmark(novel.id, true)
      }
      await session.call((token) => followUser(novel.user.id, "public", token))
      setFollowed(true)
    } catch {
      // ignore
    } finally {
      setBookmarkLoading(false)
    }
  }

  function handleBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    void Haptics.transient()
    if (action === "follow") {
      void bookmarkAndFollow()
    } else {
      setShowBookmarkDetail(true)
    }
  }

  async function followWithVisibility(restrict: "public" | "private") {
    if (!novel || followLoading) return
    void Haptics.transient()
    setFollowLoading(true)
    try {
      await session.call((token) => followUser(novel.user.id, restrict, token))
      setFollowed(true)
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  async function toggleFollow() {
    if (!novel || followLoading) return
    if (!followed) {
      await followWithVisibility("public")
      return
    }
    void Haptics.transient()
    setFollowLoading(true)
    try {
      await session.call((token) => unfollowUser(novel.user.id, token))
      setFollowed(false)
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage < 1) return
    setCurrentPage(newPage)
    setPagerVisible(true)
    initialScrollChunkIdRef.current = null
    lastRecordedChunkRef.current = null
    isRestoringScrollRef.current = false
    scrollPos.setValue("novel-top-anchor")
    recordNovelProgress(novelID, newPage, undefined, true)
    try {
      proxyRef.current?.scrollTo("novel-top-anchor", "top")
    } catch {
      // ignore
    }
  }, [novelID, scrollPos])

  const handleReaderReady = useCallback((parsedTotalPages: number) => {
    setTotalPages(parsedTotalPages)
    setReaderReady(true)
    setCurrentPage((prev) => {
      if (prev > parsedTotalPages) return parsedTotalPages
      return prev
    })
    const saved = getNovelProgress(novelID)
    const target = saved?.chunkId
    if (target && target !== "novel-top-anchor" && target !== "chunk-0") {
      performScrollRestoration(target)
    }
  }, [novelID, performScrollRestoration])

  useEffect(() => {
    if (readerReady && !loading) {
      const target = initialScrollChunkIdRef.current
      if (
        target &&
        target !== "novel-top-anchor" &&
        target !== "chunk-0" &&
        !hasRestoredScrollRef.current
      ) {
        hasRestoredScrollRef.current = true
        performScrollRestoration(target)
      } else {
        const t = setTimeout(() => {
          isRestoringScrollRef.current = false
        }, 200)
        return () => clearTimeout(t)
      }
    }
  }, [readerReady, loading, performScrollRestoration])

  async function handleToggleSpecificPageMarker(targetPage: number) {
    if (!novel || markerBusy) return
    void Haptics.transient()
    setMarkerBusy(true)
    try {
      if (markerPage === targetPage) {
        await session.call((token) => deleteNovelMarker(novel.id, token))
        setMarkerPage(null)
      } else {
        await session.call((token) => addNovelMarker(novel.id, targetPage, token))
        setMarkerPage(targetPage)
      }
    } catch (e: any) {
      console.warn("Toggle novel marker failed:", e)
    } finally {
      setMarkerBusy(false)
    }
  }

  async function handleToggleMarker() {
    const target = currentPage || markerPage || 1
    await handleToggleSpecificPageMarker(target)
  }

  const [downloadingEpub, setDownloadingEpub] = useState(false)

  async function handleDownloadNovelEpub() {
    if (downloadingEpub) return
    void Haptics.transient()
    setDownloadingEpub(true)
    try {
      let fullText = text
      const imagesMap: Record<string, string> = {}
      if (textEmbeddedImages) {
        Object.entries(textEmbeddedImages).forEach(([key, imgObj]) => {
          const url = imgObj?.urls?.original || imgObj?.urls?.["1200x1200"] || imgObj?.urls?.["480mw"]
          if (url) imagesMap[key] = url
        })
      }

      let cover = current.image_urls?.large || current.image_urls?.medium

      if (!fullText) {
        const viewer = await session.call((token) => novelViewerData(current.id, token))
        if (viewer && viewer.text) {
          fullText = viewer.text
          if (viewer.coverUrl) cover = viewer.coverUrl
          if (viewer.textEmbeddedImages) {
            Object.entries(viewer.textEmbeddedImages).forEach(([key, imgObj]) => {
              const url = imgObj?.urls?.original || imgObj?.urls?.["1200x1200"] || imgObj?.urls?.["480mw"]
              if (url) imagesMap[key] = url
            })
          }
        }
      }

      if (!fullText) {
        return
      }

      const filePath = await exportNovelToEpub({
        id: current.id,
        title: current.title,
        author: current.user?.name || "Unknown",
        authorId: current.user?.id,
        seriesTitle: resolvedSeriesTitle ?? undefined,
        description: current.caption,
        tags: current.tags?.map((t) => t.name),
        coverUrl: cover,
        chapters: [
          {
            id: current.id,
            title: current.title,
            text: fullText,
            images: imagesMap,
            caption: current.caption,
          },
        ],
      })

      if (filePath) {
        void Haptics.transient()
        await ShareSheet.present([filePath])
      }
    } catch (e: any) {
      console.log("handleDownloadNovelEpub error:", e?.message ?? e)
    } finally {
      setDownloadingEpub(false)
    }
  }

  async function shareNovel() {
    if (!novel) return
    void Haptics.transient()
    await ShareSheet.present([`https://www.pixiv.net/novel/show.php?id=${novel.id}`])
  }

  if (loading) {
    return (
      <ScrollView
        navigationTitle="小说"
        navigationBarTitleDisplayMode="inline"
      >
        <LoadingView />
      </ScrollView>
    )
  }
  if (error || !novel) {
    return (
      <ScrollView
        navigationTitle="小说"
        navigationBarTitleDisplayMode="inline"
      >
        <ErrorView message={error ?? "小说不存在"} onRetry={load} />
      </ScrollView>
    )
  }

  const current = novel

  if (resolvedSeriesID) {
    recordWorkSeriesAssociation(current.id, "novel", resolvedSeriesID, resolvedSeriesTitle, resolvedEpisodeNumber)
  }

  return (
    <ScrollViewReader>
      {(proxy) => {
        proxyRef.current = proxy
        return (
          <ScrollView
            scrollPosition={{
              value: scrollPos,
              anchor: "top",
            }}
            navigationTitle={current.title}
            navigationBarTitleDisplayMode="inline"
            onAppear={() => {
              isDisappearedRef.current = false
              const saved = getNovelProgress(novelID)
              if (saved?.page && saved.page !== currentPageRef.current) {
                setCurrentPage(saved.page)
              }
              const target = saved?.chunkId
              if (target && target !== "novel-top-anchor" && target !== "chunk-0") {
                performScrollRestoration(target)
              }
            }}
            onDisappear={() => {
              isDisappearedRef.current = true
              flushNovelProgress()
            }}
            onScrollTargetVisibilityChange={{
              idType: "string",
              threshold: 0.15,
              onChanged: (rawIds) => {
                if (isUnmountingRef.current || isDisappearedRef.current) return
                const ids = (rawIds as string[]).filter(Boolean)
                if (!ids || ids.length === 0) return

                // 正在恢复滚动位置阶段：若目标 chunk 已经可见，说明跳转成功，解除锁定
                if (isRestoringScrollRef.current) {
                  const target = initialScrollChunkIdRef.current
                  if (target && ids.includes(target)) {
                    isRestoringScrollRef.current = false
                    lastRecordedChunkRef.current = target
                  }
                  return
                }

                // 1. 如果顶部头部内容在视野中，说明用户处于小说开头/简介/标签区
                const isHeaderVisible =
                  ids.includes("novel-header-content") || ids.includes("novel-top-anchor")
                if (isHeaderVisible) {
                  const lastChunk = lastRecordedChunkRef.current
                  const isNearTop =
                    !lastChunk ||
                    lastChunk === "chunk-0" ||
                    lastChunk === "chunk-1" ||
                    lastChunk === "chunk-2"
                  if (isNearTop) {
                    lastRecordedChunkRef.current = null
                    recordNovelProgress(novelID, currentPageRef.current, undefined)
                  }
                  return
                }

                // 2. 头部已完全滚出视野，用户已进入正文段落阅读：记录当前视野最上方的正文块
                const visibleChunkId = ids.find((id) => isNovelChunkId(id))
                if (visibleChunkId) {
                  lastRecordedChunkRef.current = visibleChunkId
                  recordNovelProgress(novelID, currentPageRef.current, visibleChunkId)
                }
              },
            }}
            simultaneousGesture={
              DragGesture({ minDistance: 20, coordinateSpace: "global" })
                .onChanged((e) => {
                  if (e.translation.height < -15) {
                    if (pagerVisible) setPagerVisible(false)
                  } else if (e.translation.height > 15) {
                    if (!pagerVisible) setPagerVisible(true)
                  }
                })
            }
            overlay={
              totalPages > 1 && pagerVisible
                ? {
                    alignment: "bottom",
                    content: (
                      <VStack padding={{ horizontal: 20, bottom: 12 }} frame={{ maxWidth: "infinity" }}>
                        <GlassEffectContainer>
                          <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
                            {/* 左侧区域（固定宽 80，上一页按钮靠左，第一页时隐藏） */}
                            <HStack alignment="center" frame={{ width: 80, alignment: "leading" }}>
                              {currentPage > 1 ? (
                                <ZStack
                                  alignment="center"
                                  frame={{ width: 36, height: 36 }}
                                  glassEffect="circle"
                                  contentShape="circle"
                                  onTapGesture={() => handlePageChange(currentPage - 1)}
                                >
                                  <Image
                                    systemName="chevron.left"
                                    font="subheadline"
                                    fontWeight="semibold"
                                    foregroundStyle="#007AFF"
                                  />
                                </ZStack>
                              ) : null}
                            </HStack>

                            <Spacer />

                            {/* 中间区域（独立页码胶囊选择器，始终严格居中） */}
                            <Menu
                              label={
                                <HStack
                                  spacing={6}
                                  alignment="center"
                                  padding={{ horizontal: 14, vertical: 8 }}
                                  glassEffect="capsule"
                                  contentShape="capsule"
                                >
                                  <Text font="body" fontWeight="bold">
                                    {currentPage} / {totalPages}
                                  </Text>
                                  <Image
                                    systemName="chevron.up.chevron.down"
                                    font="caption"
                                    foregroundStyle="secondaryLabel"
                                  />
                                </HStack>
                              }
                            >
                              {Array.from({ length: totalPages }, (_, i) => totalPages - i).map((p) => (
                                <Button
                                  key={p}
                                  title={`第 ${p} 页${p === markerPage ? "（书签）" : ""}`}
                                  systemImage={
                                    p === currentPage
                                      ? "checkmark"
                                      : p === markerPage
                                      ? "book.pages.fill"
                                      : undefined
                                  }
                                  action={() => handlePageChange(p)}
                                />
                              ))}
                            </Menu>

                            <Spacer />

                            {/* 右侧区域（固定宽 80，书签和下一页按钮靠右，最后一页隐藏下一页按钮） */}
                            <HStack spacing={8} alignment="center" frame={{ width: 80, alignment: "trailing" }}>
                              <ZStack
                                alignment="center"
                                frame={{ width: 36, height: 36 }}
                                glassEffect="circle"
                                contentShape="circle"
                                onTapGesture={
                                  !markerBusy
                                    ? () => {
                                        void handleToggleMarker()
                                      }
                                    : undefined
                                }
                              >
                                <Image
                                  systemName={markerPage === currentPage ? "book.pages.fill" : "book.pages"}
                                  font="subheadline"
                                  fontWeight="semibold"
                                  foregroundStyle={markerPage === currentPage ? "#007AFF" : "secondaryLabel"}
                                />
                              </ZStack>

                              {currentPage < totalPages ? (
                                <ZStack
                                  alignment="center"
                                  frame={{ width: 36, height: 36 }}
                                  glassEffect="circle"
                                  contentShape="circle"
                                  onTapGesture={() => handlePageChange(currentPage + 1)}
                                >
                                  <Image
                                    systemName="chevron.right"
                                    font="subheadline"
                                    fontWeight="semibold"
                                    foregroundStyle="#007AFF"
                                  />
                                </ZStack>
                              ) : null}
                            </HStack>
                          </HStack>
                        </GlassEffectContainer>
                      </VStack>
                    ),
                  }
                : undefined
            }
            toolbar={{
              topBarTrailing: [
                <Button
                  disabled={bookmarkLoading || bookmarkLongPressLocked}
                  action={toggleBookmark}
                  simultaneousGesture={
                    LongPressGesture({ minDuration: 500 }).onEnded(() => {
                      setBookmarkLongPressLocked(true)
                      handleBookmarkLongPress()
                      setTimeout(() => setBookmarkLongPressLocked(false), 1500)
                    })
                  }
                >
                  <Image
                    systemName={bookmarked ? "heart.fill" : "heart"}
                    foregroundStyle={bookmarked ? "#FF375F" : undefined}
                  />
                </Button>,
                <Button
                  disabled={followLoading}
                  action={toggleFollow}
                  contextMenu={{
                    menuItems: (
                      <Group>
                        <Button
                          title={followed ? "设为私密关注" : "私密关注"}
                          systemImage="lock"
                          disabled={followLoading}
                          action={() => void followWithVisibility("private")}
                        />
                      </Group>
                    ),
                  }}
                >
                  <Image
                    systemName={followed ? "person.fill.checkmark" : "person.badge.plus"}
                  />
                </Button>,
                <Menu label={<Image systemName="ellipsis.circle" />}>
                  <Button
                    title="评论"
                    systemImage="bubble.left"
                    action={() => setShowComments(true)}
                  />
                  <Menu title="助手" systemImage="sparkles">
                    {Boolean(current?.caption && cleanHtmlCaption(current.caption)) && (
                      <Button
                        title="翻译简介"
                        systemImage="text.quote"
                        action={() => {
                          setAIMode("caption")
                          setShowAISheet(true)
                        }}
                      />
                    )}
                    <Button
                      title="翻译小说"
                      systemImage="character.book.closed"
                      action={() => {
                        setAIMode("translate")
                        setShowAISheet(true)
                      }}
                    />
                    <Button
                      title="总结小说"
                      systemImage="doc.text.magnifyingglass"
                      action={() => {
                        setAIMode("summary")
                        setShowAISheet(true)
                      }}
                    />
                    {/* 多页小说仅在最后一页显示续写；单页小说始终显示续写 */}
                    {(totalPages <= 1 || currentPage === totalPages) && (
                      <Button
                        title="续写小说"
                        systemImage="wand.and.stars"
                        action={() => {
                          setAIMode("continue")
                          setShowAISheet(true)
                        }}
                      />
                    )}
                  </Menu>
                  <Button
                    title="书签"
                    systemImage={markerPage !== null ? "book.pages.fill" : "book.pages"}
                    disabled={markerBusy}
                    action={handleToggleMarker}
                  />
            {Boolean(resolvedSeriesID) && (
              <Button
                title="系列"
                systemImage="books.vertical"
                action={() => requestPixivRoute(`novelSeries:${resolvedSeriesID}`)}
              />
            )}
            <Button
              title="分享"
              systemImage="square.and.arrow.up"
              action={shareNovel}
            />
            <Button
              title={downloadingEpub ? "下载中…" : "下载"}
              systemImage="square.and.arrow.down"
              disabled={downloadingEpub}
              action={handleDownloadNovelEpub}
            />
            <Divider />
            <Menu title="信息" systemImage="info.circle">
              <Button
                title={`作者：${current.user.name}`}
                action={() => Pasteboard.setString(current.user.name)}
              />
              <Button
                title={`UID：${current.user.id}`}
                action={() => Pasteboard.setString(String(current.user.id))}
              />
              <Button
                title={`标题：${current.title}`}
                action={() => Pasteboard.setString(current.title)}
              />
              <Button
                title={`NID：${current.id}`}
                action={() => Pasteboard.setString(String(current.id))}
              />
              {Boolean(resolvedSeriesID) && (
                <Button
                  title={`系列：${resolvedSeriesTitle || "未命名系列"}`}
                  action={() => Pasteboard.setString(resolvedSeriesTitle ?? "")}
                />
              )}
              {Boolean(resolvedSeriesID) && (
                <Button
                  title={`SID：${resolvedSeriesID}`}
                  action={() => Pasteboard.setString(String(resolvedSeriesID))}
                />
              )}
              {Boolean(current.page_count && current.page_count > 1) && (
                <Button
                  title={`页数：${current.page_count}页`}
                  action={() => Pasteboard.setString(`页数：${current.page_count}页`)}
                />
              )}
              {Boolean(current.text_length || text.length) && (
                <Button
                  title={`字数：${current.text_length || text.length}字`}
                  action={() => Pasteboard.setString(`字数：${current.text_length || text.length}字`)}
                />
              )}
            </Menu>
          </Menu>,
          <NavigationLink value={`user:${current.user.id}`}>
            <AvatarImage
              url={current.user.profile_image_urls?.medium ?? null}
              size={28}
            />
          </NavigationLink>,
        ],
      }}
    >
      <VStack
        alignment="leading"
        spacing={12}
        frame={{ maxWidth: "infinity" }}
        scrollTargetLayout={true}
      >
        <VStack key="novel-header-content" alignment="leading" spacing={8} padding={{ horizontal: 14, top: 12 }}>
          {/* 统计指标 */}
          <HStack spacing={10}>
            <HStack spacing={3}>
              <Image systemName="eye" font="footnote" />
              <Text font="footnote">
                {formatNumber(current.total_view)}
              </Text>
            </HStack>
            <HStack spacing={3}>
              <Image systemName="heart" font="footnote" />
              <Text font="footnote">
                {formatNumber(current.total_bookmarks)}
              </Text>
            </HStack>
            <HStack spacing={3}>
              <Image systemName="bubble.left" font="footnote" />
              <Text font="footnote">
                {formatNumber(current.total_comments)}
              </Text>
            </HStack>
            {Boolean(current.text_length || text.length) && (
              <HStack spacing={3}>
                <Image systemName="character.cursor.ibeam" font="footnote" />
                <Text font="footnote">
                  {current.text_length ?? text.length}
                </Text>
              </HStack>
            )}
            <Text font="footnote">
              {formatDate(current.create_date)}
            </Text>
          </HStack>

          {/* 系列 */}
          {Boolean(resolvedSeriesID) || Boolean(current.series_prev?.id) || Boolean(current.series_next?.id) ? (
            <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
              <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
                系列
              </Text>
              <VStack
                alignment="leading"
                spacing={10}
                padding={{ top: 12, horizontal: 12, bottom: 12 }}
                glassEffect={{ type: "rect", cornerRadius: 14 }}
                frame={{ maxWidth: "infinity" }}
                contentShape="rect"
              >
                {Boolean(resolvedSeriesID) ? (
                  <NavigationLink
                    value={`novelSeries:${resolvedSeriesID}`}
                    frame={{ maxWidth: "infinity" }}
                  >
                    <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
                      <Text
                        font="subheadline"
                        fontWeight="semibold"
                        foregroundStyle="#007AFF"
                        lineLimit={2}
                      >
                        {resolvedSeriesTitle || "系列详情"}
                      </Text>
                      <Spacer />
                      <Image
                        systemName="chevron.right"
                        font="footnote"
                        fontWeight="semibold"
                        foregroundStyle="secondaryLabel"
                      />
                    </HStack>
                  </NavigationLink>
                ) : null}

                {(Boolean(current.series_prev?.id) || Boolean(current.series_next?.id)) &&
                Boolean(resolvedSeriesID) ? (
                  <Divider />
                ) : null}

                {Boolean(current.series_prev?.id) && current.series_prev ? (
                  <NavigationLink value={`novel:${current.series_prev.id}`}>
                    <Text font="subheadline" foregroundStyle="#007AFF" lineLimit={1}>
                      ← 上一话：{current.series_prev.title || "上一话"}
                    </Text>
                  </NavigationLink>
                ) : null}

                {Boolean(current.series_next?.id) && current.series_next ? (
                  <NavigationLink value={`novel:${current.series_next.id}`}>
                    <Text font="subheadline" foregroundStyle="#007AFF" lineLimit={1}>
                      下一话：{current.series_next.title || "下一话"} →
                    </Text>
                  </NavigationLink>
                ) : null}
              </VStack>
            </VStack>
          ) : null}

          {/* 简介 */}
          <ExpandableIntroduction
            title="简介"
            caption={current.caption}
            routeDestination={renderDestination}
          />

          {/* 标签 */}
          {current.tags.length > 0 ? (
            <VStack alignment="leading" spacing={6}>
              <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
                标签
              </Text>
              <FlowLayout spacing={6}>
                {current.tags.map((tag) => (
                  <TagChip
                    key={tag.name}
                    name={tag.name}
                    tagName={tag.name}
                    translatedName={tag.translated_name ?? undefined}
                    value={`novelTag:${encodeURIComponent(tag.name)}`}
                    compact
                  />
                ))}
              </FlowLayout>
            </VStack>
          ) : null}
        </VStack>

        {/* 正文 */}
        {text ? (
          <NovelReaderView
            novelId={current.id}
            text={text}
            title={current.title}
            markerPage={markerPage}
            currentPage={currentPage}
            textEmbeddedImages={textEmbeddedImages}
            onJumpToPage={handlePageChange}
            onReady={handleReaderReady}
          />
        ) : (
          <VStack key="novel-text-empty" padding={{ horizontal: 14 }}>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {textError ?? "（正文为空）"}
            </Text>
          </VStack>
        )}

        {/* 话数翻页器 */}
        <VStack key="novel-series-pager">
          <SeriesEpisodePager
            workID={current.id}
            seriesID={resolvedSeriesID}
            seriesTitle={resolvedSeriesTitle}
            kind="novel"
            seriesPrev={current.series_prev}
            seriesNext={current.series_next}
            episodeNumber={resolvedEpisodeNumber}
          />
        </VStack>

        {/* 相关作品 */}
        <VStack key={`novel-related-${current.id}`}>
          <RelatedNovelsSection
            key={`related-novels-${current.id}`}
            novelID={current.id}
            ready={!loading && readerReady}
          />
        </VStack>
      </VStack>

      <VStack
        sheet={{
          content: (
            <CommentsSheet
              novelID={current.id}
              onClose={() => setShowComments(false)}
            />
          ),
          isPresented: showComments,
          onChanged: setShowComments,
        }}
      />
      <VStack
        sheet={{
          content: (
            <NovelAISheet
              novel={current}
              fullText={text}
              currentPage={currentPage}
              totalPages={totalPages}
              mode={aiMode}
              isPresented={showAISheet}
              onChanged={setShowAISheet}
            />
          ),
          isPresented: showAISheet,
          onChanged: setShowAISheet,
        }}
      />
      <VStack
        sheet={{
          content: (
            <BookmarkDetailSheet
              item={current}
              bookmarked={bookmarked}
              loadDetail={(token) => novelBookmarkDetail(current.id, token)}
              loadTags={(restrict, token) =>
                novelBookmarkTags(restrict, token)
              }
              save={(restrict, tags, token) =>
                addNovelBookmark(current.id, restrict, token, tags)
              }
              onSaved={() => {
                setBookmarked(true)
                updateNovelHistoryBookmark(current.id, true)
              }}
              onClose={() => setShowBookmarkDetail(false)}
            />
          ),
          isPresented: showBookmarkDetail,
          onChanged: setShowBookmarkDetail,
        }}
      />
    </ScrollView>
        )
      }}
    </ScrollViewReader>
  )
}

function RelatedNovelsSection(props: {
  novelID: number
  ready?: boolean
}) {
  const { novelID, ready = true } = props

  // 1. 网络层：主正文就绪后后台请求相关作品，避免与正文抢占网络带宽和调度队列
  const paged = usePagedList<PixivNovel>({
    first: (token) => relatedNovels(novelID, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => filterRelatedNovels(items, novelID),
    deps: [novelID],
    enabled: ready,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })
  const pagedRef = useLatest(paged)

  // 2. UI交互层：正文末尾触底后播放加载动画，人为提供缓冲防止手势滚过
  const [revealed, setRevealed] = useState(false)
  const [animating, setAnimating] = useState(false)
  const animatingTaskRef = useRef<number>(0)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  const handleBottomAppear = useCallback(() => {
    if (revealed || animating) return
    const taskId = ++animatingTaskRef.current
    setAnimating(true)
    void waitForNovelLoadingFeedback().then(() => {
      if (animatingTaskRef.current === taskId) {
        setAnimating(false)
        setRevealed(true)
      }
    })
  }, [revealed, animating])

  if (!ready) {
    return null
  }

  // 尚未触底：正文末尾放置 LazyVStack 触底哨兵，不提前渲染卡片列表，防止用户惯性滚过
  if (!revealed && !animating) {
    return (
      <LazyVStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
        <VStack
          key={`novel-related-trigger:${novelID}`}
          spacing={0}
          frame={{ height: 44, maxWidth: "infinity" }}
          onAppear={handleBottomAppear}
        />
      </LazyVStack>
    )
  }

  // 触底动画播放中（展示设置中的 novelLoadingDuration，默认 2000ms）或数据仍在后台加载中
  const showLoading = animating || paged.initialLoading

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ top: 4, bottom: 32 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <Text
        font="subheadline"
        fontWeight="semibold"
        foregroundStyle="secondaryLabel"
        padding={{ horizontal: 14 }}
      >
        相关作品
      </Text>
      {showLoading ? (
        <HStack spacing={0} frame={{ maxWidth: "infinity", height: 100 }}>
          <Spacer />
          <ProgressView progressViewStyle="circular" />
          <Spacer />
        </HStack>
      ) : paged.error && paged.items.length === 0 ? (
        <VStack alignment="center" spacing={8} padding={16} frame={{ maxWidth: "infinity" }}>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            相关作品加载失败
          </Text>
          <Button
            title="重试"
            buttonStyle="glass"
            action={() => {
              handleBottomAppear()
              paged.refresh()
            }}
          />
        </VStack>
      ) : paged.items.length > 0 ? (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {paged.items.map((novel, index) => (
            <NovelCard key={novel.id} novel={novel} priority={index} />
          ))}
          <LoadMoreTrigger
            anchor={paged.items[paged.items.length - 1].id}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        </LazyVStack>
      ) : (
        <HStack spacing={0} padding={{ horizontal: 14, vertical: 8 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            暂无相关作品
          </Text>
        </HStack>
      )}
    </VStack>
  )
}

function filterRelatedNovels(
  items: PixivNovel[],
  currentNovelID?: number
): PixivNovel[] {
  const settings = loadSettings()
  return items.filter(
    (item) =>
      item.id !== currentNovelID &&
      isNovelContentVisible(item, settings)
  )
}
