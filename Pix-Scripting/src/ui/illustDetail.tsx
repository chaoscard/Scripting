import {
  Button,
  Divider,
  FlowLayout,
  Group,
  HStack,
  LongPressGesture,
  Image,
  LazyVStack,
  Menu,
  Navigation,
  NavigationLink,
  ProgressView,
  ScrollView,
  Spacer,
  TabView,
  Text,
  useColorScheme,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import {
  addBookmark,
  bookmarkDetail,
  bookmarkTags,
  followDetail,
  followUser,
  illustrationDetail,
  nextIllustrations,
  relatedIllustrations,
  removeBookmark,
  unfollowUser,
} from "../api/pixiv"
import { session } from "../api/session"
import {
  downloadIllustToAlbum,
  exportIllustToZip,
  exportMangaToCbz,
  exportMangaToEpub,
  exportUgoiraToAlbum,
} from "../downloader"
import { cachedFilePath, cardThumbUrlOf, imageUrlOf, loadImage, pageThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  extractIllustAmbientPalette,
  getCachedIllustAmbientPalette,
  type IllustAmbientPalette,
} from "../image/colorExtractor"
import {
  getDetailImageQuality,
  getDownloadImageQuality,
  loadSettings,
  onSettingsChanged,
  type AmbientIntensity,
} from "../store/settings"
import {
  getIllustContentBlockReason,
  isIllustContentVisible,
} from "../store/contentFilter"
import {
  recordHistory,
  updateHistoryBookmark,
} from "../store/history"
import {
  isUserFollowed,
  onUserFollowChanged,
  recordUserFollowed,
} from "../store/userFollow"
import {
  cacheIllust,
  getCachedIllust,
} from "../store/illustCache"
import { getCachedIllustBookmark } from "../store/bookmarkSync"
import { getSeriesByWorkID, recordWorkSeriesAssociation } from "../store/seriesCache"
import {
  getActiveFeedContext,
  subscribeFeedContext,
  type ActiveFeedContext,
} from "../store/feedContext"
import { useAsyncGuard, useIllustBookmark, useLatest, usePagedList, useUserFollow, currentBatchSize } from "./hooks"
import type { PixivIllustration } from "../types"
import {
  AvatarImage,
  BookmarkDetailSheet,
  CachedImage,
  ErrorView,
  ExpandableIntroduction,
  IllustFlowFeed,
  formatDate,
  formatNumber,
  LoadingView,
  SeriesEpisodePager,
  TagChip,
} from "./components"
import { CommentsSheet } from "./comments"
import { IllustGalleryView } from "./IllustGalleryView"
import { IllustAISheet, type IllustAIMode } from "./aiSheet"
import { cleanHtmlCaption } from "../api/aiService"
import { UgoiraPlayerView } from "./ugoiraView"
import { renderDestination } from "./routes"
import { requestPixivRoute } from "./routeNavigation"

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

/**
 * 插画详情页顶层视图
 * 支持列表上下文左右连续左右滑动切图与单图直达
 */
export function IllustDetailView(props: { illustID: number }) {
  const { illustID } = props
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"

  // 1. 获取关联 Feed 上下文快照
  const feedCtx = useMemo(() => getActiveFeedContext(illustID), [illustID])
  const [items, setItems] = useState<PixivIllustration[]>(() => {
    if (feedCtx && feedCtx.items.length > 0) {
      return feedCtx.items
    }
    const cached = getCachedIllust(illustID)
    return cached ? [cached] : []
  })

  const targetIndex = useMemo(() => {
    if (!feedCtx || !feedCtx.items || feedCtx.items.length === 0) return 0
    const idx = feedCtx.items.findIndex((it) => it.id === illustID)
    return idx >= 0 ? idx : 0
  }, [feedCtx, illustID])

  const [currentIndex, setCurrentIndex] = useState<number>(targetIndex)
  const isPagingMode = Boolean(feedCtx && items.length > 1)

  // 严格校准当前索引与传入作品对齐
  useEffect(() => {
    setCurrentIndex(targetIndex)
  }, [illustID, targetIndex])

  // 监听后台列表追加新数据（仅追加末尾，不影响当前浏览）
  useEffect(() => {
    if (!feedCtx) return
    return subscribeFeedContext(feedCtx.id, (ctx) => {
      setItems((prev) => {
        if (ctx.items.length > prev.length) {
          return [...ctx.items]
        }
        return prev
      })
    })
  }, [feedCtx?.id])

  // 当前激活插画对象
  const currentItem = isPagingMode ? items[currentIndex] ?? null : (items[0] ?? getCachedIllust(illustID))
  const activeIllustID = currentItem?.id ?? illustID
  const activeIllust = getCachedIllust(activeIllustID) ?? currentItem

  // 导航栏状态与 Sheet
  const [ambientEnabled, setAmbientEnabled] = useState(() => loadSettings().ambientImmersion)
  const [ambientIntensity, setAmbientIntensity] = useState(() => loadSettings().ambientIntensity)
  const [ambientPalette, setAmbientPalette] = useState<IllustAmbientPalette | null>(() => {
    const settings = loadSettings()
    if (!settings.ambientImmersion || !activeIllust) return null
    return getInitialIllustPalette(activeIllust, isDark, settings.ambientIntensity, getDetailImageQuality(settings))
  })

  const [bookmarked, setBookmarked] = useIllustBookmark(
    activeIllustID,
    activeIllust?.is_bookmarked ?? false
  )
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [bookmarkLongPressLocked, setBookmarkLongPressLocked] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)

  const [followed, setFollowed] = useUserFollow(
    activeIllust?.user?.id ?? 0,
    activeIllust?.user?.is_followed ?? false
  )
  const [followLoading, setFollowLoading] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [showAISheet, setShowAISheet] = useState(false)
  const [aiMode, setAIMode] = useState<IllustAIMode>("caption")
  const [downloading, setDownloading] = useState(false)

  // 环境光平滑更新（防抖提取）
  useEffect(() => {
    if (!ambientEnabled || !activeIllust) {
      setAmbientPalette(null)
      return
    }
    const quality = getDetailImageQuality()
    const candidates = [
      cardThumbUrlOf(activeIllust),
      activeIllust.image_urls?.medium,
      activeIllust.image_urls?.square_medium,
      activeIllust.image_urls?.large,
      imageUrlOf(activeIllust, 0, quality),
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
  }, [activeIllust?.id, isDark, ambientEnabled, ambientIntensity])

  useEffect(() => {
    return onSettingsChanged(() => {
      const settings = loadSettings()
      setAmbientEnabled(settings.ambientImmersion)
      setAmbientIntensity(settings.ambientIntensity)
    })
  }, [])

  // 左右翻页事件回调
  const handleTabChanged = (newIdx: number) => {
    if (typeof newIdx !== "number" || newIdx < 0 || newIdx >= items.length) return
    setCurrentIndex(newIdx)
    // 触碰末尾时触发加载更多
    if (feedCtx && newIdx >= items.length - 3 && feedCtx.hasMore && feedCtx.loadMore) {
      void feedCtx.loadMore()
    }
  }

  // 收藏操作
  async function toggleBookmark() {
    if (!activeIllust || bookmarkLoading) return
    void Haptics.transient()
    setBookmarkLoading(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeBookmark(activeIllust.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) => addBookmark(activeIllust.id, "public", [], token))
        setBookmarked(true)
      }
      updateHistoryBookmark(activeIllust.id, !bookmarked)
    } catch {
      // ignore
    } finally {
      setBookmarkLoading(false)
    }
  }

  async function bookmarkAndFollow() {
    if (!activeIllust || bookmarkLoading) return
    setBookmarkLoading(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addBookmark(activeIllust.id, "public", [], token))
        setBookmarked(true)
        updateHistoryBookmark(activeIllust.id, true)
      }
      if (activeIllust.user?.id) {
        await session.call((token) => followUser(activeIllust.user.id, "public", token))
        setFollowed(true)
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
    void Haptics.transient()
    if (action === "follow") {
      void bookmarkAndFollow()
    } else {
      setShowBookmarkDetail(true)
    }
  }

  async function followWithVisibility(restrict: "public" | "private") {
    if (!activeIllust?.user?.id || followLoading) return
    void Haptics.transient()
    setFollowLoading(true)
    try {
      await session.call((token) => followUser(activeIllust.user.id, restrict, token))
      setFollowed(true)
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  async function toggleFollow() {
    if (!activeIllust?.user?.id || followLoading) return
    if (!followed) {
      await followWithVisibility("public")
      return
    }
    void Haptics.transient()
    setFollowLoading(true)
    try {
      await session.call((token) => unfollowUser(activeIllust.user.id, token))
      setFollowed(false)
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  async function shareIllust() {
    if (!activeIllust) return
    void Haptics.transient()
    await ShareSheet.present([`https://www.pixiv.net/artworks/${activeIllust.id}`])
  }

  async function handleDownloadUgoira() {
    if (!activeIllust || downloading) return
    void Haptics.transient()
    setDownloading(true)
    try {
      const res = await exportUgoiraToAlbum(activeIllust)
      if (res.success) void Haptics.transient()
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadIllustToAlbum() {
    if (!activeIllust || downloading) return
    void Haptics.transient()
    setDownloading(true)
    const downloadQuality = getDownloadImageQuality()
    try {
      const ok = await downloadIllustToAlbum(activeIllust, downloadQuality)
      if (ok) void Haptics.transient()
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadIllustToZip() {
    if (!activeIllust || downloading) return
    void Haptics.transient()
    setDownloading(true)
    const downloadQuality = getDownloadImageQuality()
    const pageCount = Math.max(1, activeIllust.page_count || activeIllust.meta_pages?.length || 1)
    try {
      const urls: string[] = []
      for (let i = 0; i < pageCount; i++) {
        const url = imageUrlOf(activeIllust, i, downloadQuality)
        if (url) urls.push(url)
      }
      const res = await exportIllustToZip({ illust: activeIllust, imageUrls: urls })
      if (res.success && res.path) {
        void Haptics.transient()
        await ShareSheet.present([res.path])
      }
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadManga(format: "cbz" | "epub") {
    if (!activeIllust || downloading) return
    void Haptics.transient()
    setDownloading(true)
    const downloadQuality = getDownloadImageQuality()
    const pageCount = Math.max(1, activeIllust.page_count || activeIllust.meta_pages?.length || 1)
    try {
      const pages: { pageIndex: number; url: string }[] = []
      for (let i = 0; i < pageCount; i++) {
        const url = imageUrlOf(activeIllust, i, downloadQuality)
        if (url) pages.push({ pageIndex: i + 1, url })
      }
      let filePath: string | null = null
      if (format === "cbz") {
        const res = await exportMangaToCbz({
          id: activeIllust.id,
          title: activeIllust.title,
          author: activeIllust.user?.name || "Unknown",
          authorId: activeIllust.user?.id,
          description: activeIllust.caption,
          tags: activeIllust.tags?.map((t) => t.name),
          pages,
        })
        filePath = res.success ? (res.path ?? null) : null
      } else {
        const res = await exportMangaToEpub({
          id: activeIllust.id,
          title: activeIllust.title,
          author: activeIllust.user?.name || "Unknown",
          authorId: activeIllust.user?.id,
          description: activeIllust.caption,
          tags: activeIllust.tags?.map((t) => t.name),
          pages,
        })
        filePath = res.success ? (res.path ?? null) : null
      }
      if (filePath) {
        void Haptics.transient()
        await ShareSheet.present([filePath])
      }
    } finally {
      setDownloading(false)
    }
  }

  const rawSeries = activeIllust?.series ?? (activeIllust as any)?.illust_series
  const rawSeriesObj = Array.isArray(rawSeries) ? rawSeries[0] : rawSeries
  const associatedRef = activeIllust ? getSeriesByWorkID(activeIllust.id, "manga") : null
  const resolvedSeriesID = rawSeriesObj?.id ?? associatedRef?.seriesID ?? null
  const resolvedSeriesTitle = rawSeriesObj?.title ?? associatedRef?.seriesTitle ?? null
  const pageCount = Math.max(1, activeIllust?.page_count || activeIllust?.meta_pages?.length || 1)

  const navToolbar = {
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
          {Boolean(activeIllust?.caption && cleanHtmlCaption(activeIllust.caption)) && (
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
            title="翻译图片（OCR）"
            systemImage="text.viewfinder"
            action={() => {
              setAIMode("ocr")
              setShowAISheet(true)
            }}
          />
          <Button
            title="翻译图片（生图）"
            systemImage="photo.badge.magnifyingglass"
            action={() => {
              setAIMode("vision")
              setShowAISheet(true)
            }}
          />
        </Menu>
        {Boolean(resolvedSeriesID) && (
          <Button
            title="系列"
            systemImage="books.vertical"
            action={() => requestPixivRoute(`mangaSeries:${resolvedSeriesID}`)}
          />
        )}
        <Button
          title="分享"
          systemImage="square.and.arrow.up"
          action={shareIllust}
        />
        {activeIllust?.type === "ugoira" ? (
          <Button
            title={downloading ? "下载中…" : "下载"}
            systemImage="square.and.arrow.down"
            disabled={downloading}
            action={handleDownloadUgoira}
          />
        ) : activeIllust?.type === "manga" ? (
          <Menu title="下载" systemImage="square.and.arrow.down">
            <Button
              title="下载为 CBZ 漫画包"
              systemImage="doc.zipper"
              disabled={downloading}
              action={() => void handleDownloadManga("cbz")}
            />
            <Button
              title="下载为 EPUB 电子书"
              systemImage="book"
              disabled={downloading}
              action={() => void handleDownloadManga("epub")}
            />
          </Menu>
        ) : pageCount > 1 ? (
          <Menu title="下载" systemImage="square.and.arrow.down">
            <Button
              title="下载全部至相簿"
              systemImage="photo.on.rectangle.angled"
              disabled={downloading}
              action={handleDownloadIllustToAlbum}
            />
            <Button
              title="打包为 ZIP 归档"
              systemImage="doc.zipper"
              disabled={downloading}
              action={handleDownloadIllustToZip}
            />
          </Menu>
        ) : (
          <Button
            title={downloading ? "下载中…" : "下载"}
            systemImage="square.and.arrow.down"
            disabled={downloading}
            action={handleDownloadIllustToAlbum}
          />
        )}
        <Divider />
        <Menu title="信息" systemImage="info.circle">
          <Button
            title={`作者：${activeIllust?.user?.name ?? "未知"}`}
            action={() => Pasteboard.setString(activeIllust?.user?.name ?? "")}
          />
          <Button
            title={`UID：${activeIllust?.user?.id ?? 0}`}
            action={() => Pasteboard.setString(String(activeIllust?.user?.id ?? ""))}
          />
          <Button
            title={`标题：${activeIllust?.title ?? "未命名"}`}
            action={() => Pasteboard.setString(activeIllust?.title ?? "")}
          />
          <Button
            title={`PID：${activeIllust?.id ?? 0}`}
            action={() => Pasteboard.setString(String(activeIllust?.id ?? ""))}
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
          {pageCount > 1 && (
            <Button
              title={`页数：${pageCount}页`}
              action={() => Pasteboard.setString(`页数：${pageCount}页`)}
            />
          )}
          {Boolean(activeIllust?.width && activeIllust?.height) && (
            <Button
              title={`分辨率：${activeIllust?.width}×${activeIllust?.height}`}
              action={() => Pasteboard.setString(`分辨率：${activeIllust?.width}×${activeIllust?.height}`)}
            />
          )}
        </Menu>
      </Menu>,
      <NavigationLink value={`user:${activeIllust?.user?.id ?? 0}`}>
        <AvatarImage
          url={activeIllust?.user?.profile_image_urls?.medium ?? null}
          size={28}
        />
      </NavigationLink>,
    ],
  }

  const sheetsElement = activeIllust ? (
    <Group>
      <VStack
        sheet={{
          content: (
            <CommentsSheet
              illustID={activeIllust.id}
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
            <IllustAISheet
              illust={activeIllust}
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
              item={activeIllust}
              bookmarked={bookmarked}
              loadDetail={(token) => bookmarkDetail(activeIllust.id, token)}
              loadTags={(restrict, token) =>
                bookmarkTags(session.userID ?? 0, restrict, token)
              }
              save={(restrict, tags, token) =>
                addBookmark(activeIllust.id, restrict, tags, token)
              }
              onSaved={() => {
                setBookmarked(true)
                updateHistoryBookmark(activeIllust.id, true)
              }}
              onClose={() => setShowBookmarkDetail(false)}
            />
          ),
          isPresented: showBookmarkDetail,
          onChanged: setShowBookmarkDetail,
        }}
      />
    </Group>
  ) : null

  // 单图展示模式
  if (!isPagingMode) {
    return (
      <ScrollView
        navigationTitle={activeIllust?.title ?? "作品详情"}
        navigationBarTitleDisplayMode="inline"
        ignoresSafeArea={{ edges: "bottom" }}
        toolbarBackground={
          ambientEnabled && ambientPalette
            ? { style: ambientPalette.topColor, bars: ["navigationBar"] }
            : undefined
        }
        toolbarBackgroundVisibility={
          ambientEnabled && ambientPalette
            ? { visibility: "visible", bars: ["navigationBar"] }
            : { visibility: "hidden", bars: ["navigationBar"] }
        }
        background={
          ambientEnabled && ambientPalette
            ? {
                colors: [
                  ambientPalette.topColor,
                  ambientPalette.midColor,
                  ambientPalette.backgroundColor,
                  ambientPalette.backgroundColor,
                ],
                startPoint: "top",
                endPoint: "bottom",
              }
            : undefined
        }
        toolbar={navToolbar}
      >
        <IllustDetailPageContent illustID={illustID} isActive={true} />
        {sheetsElement}
      </ScrollView>
    )
  }

  // 多图 TabView 翻页模式（常驻 Page 槽位，绝对不闪屏、绝对不切回）
  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <TabView
        tabIndex={currentIndex}
        onTabIndexChanged={handleTabChanged}
        tabViewStyle="pageNeverDisplayIndex"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        navigationTitle={activeIllust?.title ?? "作品详情"}
        navigationBarTitleDisplayMode="inline"
        ignoresSafeArea={{ edges: "bottom" }}
        toolbarBackground={
          ambientEnabled && ambientPalette
            ? { style: ambientPalette.topColor, bars: ["navigationBar"] }
            : undefined
        }
        toolbarBackgroundVisibility={
          ambientEnabled && ambientPalette
            ? { visibility: "visible", bars: ["navigationBar"] }
            : { visibility: "hidden", bars: ["navigationBar"] }
        }
        background={
          ambientEnabled && ambientPalette
            ? {
                colors: [
                  ambientPalette.topColor,
                  ambientPalette.midColor,
                  ambientPalette.backgroundColor,
                  ambientPalette.backgroundColor,
                ],
                startPoint: "top",
                endPoint: "bottom",
              }
            : undefined
        }
        toolbar={navToolbar}
      >
        {items.map((item, idx) => (
          <VStack
            key={`page-slot-${item.id}`}
            tag={idx}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          >
            <IllustDetailPageContent
              illustID={item.id}
              initialIllust={item}
              isActive={idx === currentIndex}
            />
          </VStack>
        ))}
      </TabView>
      {sheetsElement}
    </ZStack>
  )
}

/**
 * 单张作品的详情页内容组件
 */
function IllustDetailPageContent(props: {
  illustID: number
  initialIllust?: PixivIllustration | null
  isActive: boolean
}) {
  const { illustID, initialIllust, isActive } = props

  const [illust, setIllust] = useState<PixivIllustration | null>(
    () => initialIllust ?? getCachedIllust(illustID)
  )
  const [loading, setLoading] = useState(() => !initialIllust && !getCachedIllust(illustID))
  const [error, setError] = useState<string | null>(null)
  const [mediaReady, setMediaReady] = useState(false)
  const [quality, setQuality] = useState(() => getDetailImageQuality())
  const guard = useAsyncGuard()
  const illustRef = useLatest(illust)
  const recordedIDRef = useRef<number | null>(null)

  const cachedIllust = getCachedIllust(illustID)
  const currentIllust = illust ?? cachedIllust ?? initialIllust
  const rawSeries = currentIllust?.series ?? (currentIllust as any)?.illust_series
  const rawSeriesObj = Array.isArray(rawSeries) ? rawSeries[0] : rawSeries
  const associatedRef = getSeriesByWorkID(illustID, "manga")
  const resolvedSeriesID = rawSeriesObj?.id ?? associatedRef?.seriesID ?? null
  const resolvedSeriesTitle = rawSeriesObj?.title ?? associatedRef?.seriesTitle ?? null
  const resolvedEpisodeNumber = currentIllust?.episode_number ?? associatedRef?.episodeNumber ?? null

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
          getCachedIllustBookmark(detail.id) === true)
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
      setIllust(detail)
      if (isActive && recordedIDRef.current !== detail.id) {
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

  // 仅在激活时发起网络加载完整详情
  useEffect(() => {
    const cached = getCachedIllust(illustID)
    if (isActive) {
      if (cached && (cached.meta_pages || cached.meta_single_page)) {
        load(false)
      } else {
        load(true)
      }
    }
    const timer = setTimeout(() => {
      setMediaReady(true)
    }, 1200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [illustID, isActive])

  useEffect(() => {
    if (isActive && illust && recordedIDRef.current !== illust.id) {
      recordedIDRef.current = illust.id
      recordHistory(illust)
    }
  }, [isActive, illust])

  useEffect(() => {
    return onSettingsChanged(() => {
      const settings = loadSettings()
      setQuality(getDetailImageQuality(settings))
    })
  }, [])

  if (loading && !currentIllust) {
    return <LoadingView />
  }
  if (error && !currentIllust) {
    return <ErrorView message={error} onRetry={() => load(true)} />
  }
  if (!currentIllust) {
    return <ErrorView message="作品不存在" onRetry={() => load(true)} />
  }

  const current = currentIllust

  if (resolvedSeriesID) {
    recordWorkSeriesAssociation(current.id, "manga", resolvedSeriesID, resolvedSeriesTitle, resolvedEpisodeNumber)
  }

  const pageCount = Math.max(1, current.page_count || current.meta_pages?.length || 1)
  const pageURLs: (string | null)[] = []
  for (let k = 0; k < pageCount; k++) {
    pageURLs.push(imageUrlOf(current, k, quality))
  }
  const pageAspect = useMemo(() => {
    if (current.width && current.height && current.width > 0 && current.height > 0) {
      return current.width / current.height
    }
    const thumb0 = pageThumbUrlOf(current, 0)
    if (thumb0) {
      const cached = cachedFilePath(thumb0)
      if (cached) {
        try {
          const img = UIImage.fromFile(cached)
          if (img && img.width > 0 && img.height > 0) {
            return img.width / img.height
          }
        } catch {
        }
      }
    }
    return 0.75
  }, [current.id, current.width, current.height])

  useEffect(() => {
    if (!isActive || !current || pageCount <= 1) return
    for (let idx = 0; idx < pageCount; idx++) {
      const thumb = pageThumbUrlOf(current, idx)
      if (thumb && !cachedFilePath(thumb)) {
        void loadImage(thumb, idx === 0 ? -6000 : -1000 + idx)
      }
    }
  }, [isActive, current, pageCount])

  function openGallery(pageIndex = 0) {
    if (!current || current.type === "ugoira") return
    void Navigation.present({
      element: <IllustGalleryView illust={current} initialPageIndex={pageIndex} />,
      modalPresentationStyle: "fullScreen",
    })
  }

  return (
    <ScrollView
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={{ edges: "bottom" }}
    >
      <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {/* 大图区 */}
        <VStack
          alignment="center"
          spacing={4}
          frame={{ maxWidth: "infinity" }}
          padding={{ top: 0, bottom: 6 }}
        >
          {current.type === "ugoira" ? (
            isActive ? (
              <UgoiraPlayerView
                illustID={current.id}
                previewUrl={pageThumbUrlOf(current, 0)}
                aspectRatioValue={pageAspect}
                cornerRadius={8}
                onLoaded={() => setMediaReady(true)}
              />
            ) : (
              <CachedImage
                key={`ugoira-preview-${current.id}`}
                url={pageThumbUrlOf(current, 0)}
                aspectRatioValue={pageAspect}
                cornerRadius={8}
                contentMode="fit"
                frame={{ maxWidth: "infinity" }}
              />
            )
          ) : pageCount > 1 ? (
            <LazyVStack spacing={0} alignment="center">
              {pageURLs.map((url, idx) => {
                const preview = pageThumbUrlOf(current, idx)
                const isFirst = idx === 0
                const isLast = idx === pageCount - 1
                const cornerRadii = isFirst
                  ? { topLeading: 8, topTrailing: 8, bottomLeading: 0, bottomTrailing: 0 }
                  : isLast
                    ? { topLeading: 0, topTrailing: 0, bottomLeading: 8, bottomTrailing: 8 }
                    : 0
                return (
                  <CachedImage
                    key={`illust-page-${current.id}-${idx}`}
                    url={url}
                    previewUrl={preview}
                    aspectRatioValue={pageAspect}
                    useIntrinsicAspectRatio={true}
                    cornerRadius={cornerRadii}
                    contentMode="fit"
                    frame={{ maxWidth: "infinity" }}
                    priority={idx === 0 ? -5000 : idx}
                    onLoaded={idx === 0 ? () => setMediaReady(true) : undefined}
                    onTapGesture={() => openGallery(idx)}
                  />
                )
              })}
            </LazyVStack>
          ) : (
            <CachedImage
              key={`illust-single-${current.id}`}
              url={pageURLs[0] ?? null}
              previewUrl={pageThumbUrlOf(current, 0)}
              aspectRatioValue={pageAspect}
              useIntrinsicAspectRatio={true}
              cornerRadius={8}
              contentMode="fit"
              frame={{ maxWidth: "infinity" }}
              priority={-5000}
              onLoaded={() => setMediaReady(true)}
              onTapGesture={() => openGallery(0)}
            />
          )}
        </VStack>

        <VStack alignment="leading" spacing={8} padding={{ horizontal: 14 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
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
            {pageCount > 1 && (
              <HStack spacing={3}>
                <Image systemName="rectangle.stack" font="footnote" />
                <Text font="footnote">
                  {pageCount}P
                </Text>
              </HStack>
            )}
            <Text font="footnote">
              {formatDate(current.create_date)}
            </Text>
          </HStack>

          {/* 简介 */}
          <ExpandableIntroduction
            title="简介"
            caption={current.caption}
            routeDestination={renderDestination}
          />

          {/* 标签 */}
          {Array.isArray(current.tags) && current.tags.length > 0 ? (
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
                    value={`tag:${encodeURIComponent(tag.name)}`}
                    compact
                  />
                ))}
              </FlowLayout>
            </VStack>
          ) : null}
        </VStack>

        {/* 话数翻页器 */}
        <SeriesEpisodePager
          workID={current.id}
          seriesID={resolvedSeriesID}
          seriesTitle={resolvedSeriesTitle}
          kind="manga"
          episodeNumber={resolvedEpisodeNumber}
        />

        {/* 相关作品 */}
        <RelatedIllustrationsSection
          illustID={current.id}
          enabled={mediaReady && isActive}
        />
      </VStack>
    </ScrollView>
  )
}

function RelatedIllustrationsSection(props: {
  illustID: number
  enabled?: boolean
}) {
  const { enabled = true } = props
  const paged = usePagedList<PixivIllustration>({
    first: (token) => relatedIllustrations(props.illustID, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => filterRelatedIllustrations(items, props.illustID),
    deps: [props.illustID],
    enabled,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })
  const pagedRef = useLatest(paged)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  if (paged.initialLoading && !enabled) {
    return null
  }

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ top: 4 }}
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
      {paged.initialLoading ? (
        <HStack spacing={0} frame={{ maxWidth: "infinity", height: 80 }}>
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
            action={() => paged.refresh()}
          />
        </VStack>
      ) : paged.items.length > 0 ? (
        <IllustFlowFeed
          items={paged.items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
        />
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

function filterRelatedIllustrations(
  items: PixivIllustration[],
  currentIllustID?: number
): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter(
    (item) =>
      item.id !== currentIllustID &&
      isIllustContentVisible(item, settings)
  )
}
