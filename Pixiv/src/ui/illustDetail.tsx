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
  NavigationLink,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  useColorScheme,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  addBookmark,
  bookmarkDetail,
  bookmarkTags,
  followDetail,
  followUser,
  illustrationDetail,
  illustrationSeries,
  nextIllustrations,
  relatedIllustrations,
  removeBookmark,
  unfollowUser,
} from "../api/pixiv"
import { session } from "../api/session"
import { cardThumbUrlOf, imageUrlOf, loadImage, prefetch } from "../image/imageLoader"
import {
  extractIllustAmbientPalette,
  getCachedIllustAmbientPalette,
  type IllustAmbientPalette,
} from "../image/colorExtractor"
import {
  isIllustContentVisible,
  isR18ContentVisible,
  loadSettings,
  onSettingsChanged,
  type AmbientIntensity,
  type AppSettings,
} from "../store/settings"
import {
  hasHistory,
  onHistoryChanged,
  recordHistory,
  updateHistoryBookmark,
} from "../store/history"
import { onUserFollowChanged } from "../store/userFollow"
import { isSeriesWatched, onWatchlistChanged, recordWatchedSeries } from "../store/watchlist"
import { cacheIllust, getCachedIllust } from "../store/illustCache"
import { useAsyncGuard, useLatest, usePagedList, currentBatchSize } from "./hooks"
import type { PixivIllustration } from "../types"
import {
  AvatarImage,
  BookmarkDetailSheet,
  CachedImage,
  ErrorView,
  IllustFlowFeed,
  formatDate,
  formatNumber,
  htmlToPlainText,
  LinkedDescription,
  LoadingView,
  TagChip,
} from "./components"
import { CommentsSheet } from "./comments"
import { UgoiraPlayerView } from "./ugoiraView"
import { buildUgoira } from "../ugoira/ugoira"
import { renderDestination } from "./routes"
import { requestPixivRoute } from "./routeNavigation"

const RESTRICTED_CONTENT_MESSAGE = "该作品已被内容分级设置隐藏"

function isIllustExempt(
  detail: PixivIllustration,
  settings: AppSettings,
  isBookmarked = false,
  isFollowed = false
): boolean {
  if (settings.followFilterExempt) {
    if (isFollowed || detail.user?.is_followed) return true
    if (detail.series?.id != null && isSeriesWatched(detail.series.id)) return true
  }
  if (settings.libraryFilterExempt) {
    if (isBookmarked || detail.is_bookmarked) return true
    if (hasHistory(detail.id, "illust")) return true
  }
  return false
}

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

export function IllustDetailView(props: { illustID: number }) {
  const { illustID } = props
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const [illust, setIllust] = useState<PixivIllustration | null>(() => getCachedIllust(illustID))
  const [ambientEnabled, setAmbientEnabled] = useState(
    () => loadSettings().ambientImmersion
  )
  const [ambientIntensity, setAmbientIntensity] = useState(
    () => loadSettings().ambientIntensity
  )
  const [ambientPalette, setAmbientPalette] = useState<IllustAmbientPalette | null>(() => {
    const settings = loadSettings()
    if (!settings.ambientImmersion) return null
    const initial = getCachedIllust(illustID)
    return getInitialIllustPalette(
      initial,
      isDark,
      settings.ambientIntensity,
      settings.detailImageQuality
    )
  })
  const [loading, setLoading] = useState(() => !getCachedIllust(illustID))
  const [error, setError] = useState<string | null>(null)
  const [bookmarked, setBookmarked] = useState(() => getCachedIllust(illustID)?.is_bookmarked ?? false)
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [bookmarkLongPressLocked, setBookmarkLongPressLocked] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  const [followed, setFollowed] = useState(() => getCachedIllust(illustID)?.user?.is_followed ?? false)
  const [followLoading, setFollowLoading] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [quality, setQuality] = useState(loadSettings().detailImageQuality)
  const [mediaReady, setMediaReady] = useState(false)
  const guard = useAsyncGuard()
  const illustRef = useLatest(illust)
  const errorRef = useLatest(error)
  const restrictedLevelRef = useRef<number | null>(null)
  // 同一实例只记录一次浏览（下拉刷新/重试不重复刷新 viewedAt）；换作品时重置
  const recordedIDRef = useRef<number | null>(null)

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
      const settings = loadSettings()
      let isExempt = isIllustExempt(detail, settings, detail.is_bookmarked, detail.user.is_followed ?? false)
      if (!isIllustContentVisible(detail, settings, isExempt)) {
        if (settings.followFilterExempt && detail.series?.id != null && !isSeriesWatched(detail.series.id)) {
          try {
            const seriesData = await session.call((token) => illustrationSeries(detail.series!.id, token))
            const seriesWatched = Boolean(
              seriesData.illust_series_detail?.watchlist_added ??
              (seriesData.illust_series_detail as any)?.is_watched
            )
            recordWatchedSeries(detail.series!.id, seriesWatched)
            if (seriesWatched && isIllustContentVisible(detail, settings, true)) {
              isExempt = true
            }
          } catch {}
        }
      }
      if (
        !isIllustContentVisible(detail, settings, isExempt)
      ) {
        restrictedLevelRef.current = detail.x_restrict
        setIllust(null)
        setError(RESTRICTED_CONTENT_MESSAGE)
        return
      }
      restrictedLevelRef.current = null
      setIllust(detail)
      setBookmarked(detail.is_bookmarked)
      setFollowed(detail.user.is_followed ?? false)
      // 本地浏览记录：同一实例只记一次（与 Hanairo 的 didRecordHistory 一致）
      if (recordedIDRef.current !== detail.id) {
        recordedIDRef.current = detail.id
        recordHistory(detail)
      }
      // 预取前几页图片（由 imageUrlOf 统一处理画质设置与 1:3 极窄长图原图兜底）
      const prefetchURLs: (string | null | undefined)[] = []
      const detailQuality = loadSettings().detailImageQuality
      const total = Math.min(4, detail.page_count || detail.meta_pages?.length || 1)
      for (let k = 0; k < total; k++) {
        prefetchURLs.push(imageUrlOf(detail, k, detailQuality))
      }
      prefetch(prefetchURLs)
      // 并行加载收藏状态与关注状态（与主请求共用序号：页面切换后全部作废）
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
      setIllust(cached)
      setBookmarked(cached.is_bookmarked)
      setFollowed(cached.user?.is_followed ?? false)
      const settings = loadSettings()
      if (settings.ambientImmersion) {
        const pal = getInitialIllustPalette(
          cached,
          isDark,
          settings.ambientIntensity,
          settings.detailImageQuality
        )
        if (pal) setAmbientPalette(pal)
      }
      setLoading(false)
      load(false)
    } else {
      setIllust(null)
      load(true)
    }
    // 保底机制：若本体大图文件较大在 1.2 秒内仍在下载，自动放行相关作品请求，避免下方留白卡死
    const timer = setTimeout(() => {
      setMediaReady(true)
    }, 1200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [illustID])

  useEffect(() => {
    return onUserFollowChanged((changedUserID, nextFollowed) => {
      if (changedUserID === illustRef.current?.user.id) {
        setFollowed(nextFollowed)
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

  // 设置变化时更新图片质量与沉浸式开关；关闭 R18 后立即撤下已打开的受限内容。
  useEffect(() => {
    return onSettingsChanged(() => {
      const settings = loadSettings()
      setQuality(settings.detailImageQuality)
      setAmbientEnabled(settings.ambientImmersion)
      setAmbientIntensity(settings.ambientIntensity)
      const current = illustRef.current
      if (current) {
        const isExempt = isIllustExempt(current, settings, bookmarked, followed)
        if (
          !isIllustContentVisible(current, settings, isExempt)
        ) {
          restrictedLevelRef.current = current.x_restrict
          guard()
          setIllust(null)
          setError(RESTRICTED_CONTENT_MESSAGE)
          setLoading(false)
        }
      } else if (
        !current &&
        errorRef.current === RESTRICTED_CONTENT_MESSAGE
      ) {
        load()
      }
    })
  }, [bookmarked, followed])

  useEffect(() => {
    return onWatchlistChanged((seriesID) => {
      const current = illustRef.current
      if (current?.series?.id === seriesID) {
        const settings = loadSettings()
        const isExempt = isIllustExempt(current, settings, bookmarked, followed)
        if (!isIllustContentVisible(current, settings, isExempt)) {
          restrictedLevelRef.current = current.x_restrict
          guard()
          setIllust(null)
          setError(RESTRICTED_CONTENT_MESSAGE)
          setLoading(false)
        }
      } else if (!current && errorRef.current === RESTRICTED_CONTENT_MESSAGE) {
        load()
      }
    })
  }, [bookmarked, followed])

  useEffect(() => {
    return onHistoryChanged(() => {
      if (!illustRef.current && errorRef.current === RESTRICTED_CONTENT_MESSAGE) {
        const settings = loadSettings()
        if (settings.libraryFilterExempt && hasHistory(illustID, "illust")) {
          load()
        }
      }
    })
  }, [illustID])

  if (loading && !illust) {
    return (
      <ScrollView navigationTitle="作品详情" navigationBarTitleDisplayMode="inline">
        <LoadingView />
      </ScrollView>
    )
  }
  if (error && !illust) {
    return (
      <ScrollView navigationTitle="作品详情" navigationBarTitleDisplayMode="inline">
        <ErrorView message={error} onRetry={() => load(true)} />
      </ScrollView>
    )
  }
  if (!illust) {
    return (
      <ScrollView navigationTitle="作品详情" navigationBarTitleDisplayMode="inline">
        <ErrorView message="作品不存在" onRetry={() => load(true)} />
      </ScrollView>
    )
  }

  const current = illust
  const pageCount = Math.max(1, current.page_count || current.meta_pages.length || 1)
  // 无限滚动：一次性生成所有页的图片 URL（meta_pages 缺失时由 imageUrlOf 推导）
  const pageURLs: (string | null)[] = []
  for (let k = 0; k < pageCount; k++) {
    pageURLs.push(imageUrlOf(current, k, quality))
  }
  const pageAspect =
    current.width && current.height ? current.width / current.height : 0.75

  async function toggleBookmark() {
    if (bookmarkLoading) return
    void Haptics.transient()
    setBookmarkLoading(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeBookmark(current.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) =>
          addBookmark(current.id, "public", [], token)
        )
        setBookmarked(true)
      }
      // 同步本地浏览记录中的收藏状态（若该作品在历史中）
      updateHistoryBookmark(current.id, !bookmarked)
    } catch {
      // ignore
    } finally {
      setBookmarkLoading(false)
    }
  }

  async function bookmarkAndFollow() {
    if (bookmarkLoading) return
    setBookmarkLoading(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addBookmark(current.id, "public", [], token))
        setBookmarked(true)
        updateHistoryBookmark(current.id, true)
      }
      await session.call((token) => followUser(current.user.id, "public", token))
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

  async function savePages() {
    void Haptics.transient()
    // 动图：保存合成后的 mp4
    if (current.type === "ugoira") {
      try {
        const result = await buildUgoira(current.id)
        await Photos.saveVideo(result.mp4Path, {
          fileName: `pixiv_${current.id}`,
        })
      } catch {
        // ignore
      }
      return
    }
    // 图片：按下载质量保存单页或全部页（单页失败不中断整批）
    const downloadQuality = loadSettings().downloadImageQuality
    for (let i = 0; i < pageCount; i++) {
      const url = imageUrlOf(current, i, downloadQuality) ?? pageURLs[i]
      if (!url) continue
      try {
        const path = await loadImage(url)
        if (path) {
          await Photos.savePhoto(path, {
            fileName: `pixiv_${current.id}_p${i + 1}`,
          })
        }
      } catch {
        // 该页失败继续下一页
      }
    }
  }

  async function followWithVisibility(restrict: "public" | "private") {
    if (followLoading) return
    void Haptics.transient()
    setFollowLoading(true)
    try {
      await session.call((token) => followUser(current.user.id, restrict, token))
      setFollowed(true)
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  async function toggleFollow() {
    if (followLoading) return
    if (!followed) {
      await followWithVisibility("public")
      return
    }
    void Haptics.transient()
    setFollowLoading(true)
    try {
      await session.call((token) => unfollowUser(current.user.id, token))
      setFollowed(false)
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  async function shareIllust() {
    void Haptics.transient()
    await ShareSheet.present([`https://www.pixiv.net/artworks/${current.id}`])
  }

  return (
    <ScrollView
      navigationTitle={current.title}
      navigationBarTitleDisplayMode="inline"
      ignoresSafeArea={{ edges: "bottom" }}
      toolbarBackground={
        ambientEnabled && ambientPalette
          ? {
              style: ambientPalette.topColor,
              bars: ["navigationBar"],
            }
          : undefined
      }
      toolbarBackgroundVisibility={
        ambientEnabled && ambientPalette
          ? {
              visibility: "visible",
              bars: ["navigationBar"],
            }
          : {
              visibility: "hidden",
              bars: ["navigationBar"],
            }
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
            {Boolean(current.series?.id) && (
              <Button
                title="系列"
                systemImage="books.vertical"
                action={() => requestPixivRoute(`mangaSeries:${current.series!.id}`)}
              />
            )}
            <Button
              title="下载"
              systemImage="square.and.arrow.down"
              action={savePages}
            />
            <Button
              title="分享"
              systemImage="square.and.arrow.up"
              action={shareIllust}
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
                title={`PID：${current.id}`}
                action={() => Pasteboard.setString(String(current.id))}
              />
              {Boolean(current.series?.id) && (
                <Button
                  title={`系列：${current.series?.title || "未命名系列"}`}
                  action={() => Pasteboard.setString(current.series?.title ?? "")}
                />
              )}
              {Boolean(current.series?.id) && (
                <Button
                  title={`SID：${current.series?.id}`}
                  action={() => Pasteboard.setString(String(current.series?.id))}
                />
              )}
              {pageCount > 1 && (
                <Button
                  title={`页数：${pageCount}页`}
                  action={() => Pasteboard.setString(`页数：${pageCount}页`)}
                />
              )}
              {Boolean(current.width && current.height) && (
                <Button
                  title={`分辨率：${current.width}×${current.height}`}
                  action={() => Pasteboard.setString(`分辨率：${current.width}×${current.height}`)}
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
      <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity" }}>
        {/* 大图区：动图走播放器；图片无限向下滚动展示全部页 */}
        <VStack
          alignment="center"
          spacing={4}
          frame={{ maxWidth: "infinity" }}
          padding={{ top: 0, bottom: 6 }}
        >
          {current.type === "ugoira" ? (
            <UgoiraPlayerView
              illustID={current.id}
              aspectRatioValue={pageAspect}
              onLoaded={() => setMediaReady(true)}
            />
          ) : pageCount > 1 ? (
            <LazyVStack spacing={4} alignment="center">
              {pageURLs.map((url, idx) => (
                <CachedImage
                  key={idx}
                  url={url}
                  aspectRatioValue={pageAspect}
                  cornerRadius={6}
                  contentMode="fit"
                  frame={{ width: Device.screen.width, height: Device.screen.width / pageAspect }}
                  priority={idx}
                  onLoaded={idx === 0 ? () => setMediaReady(true) : undefined}
                />
              ))}
            </LazyVStack>
          ) : (
            <CachedImage
              url={pageURLs[0] ?? null}
              aspectRatioValue={pageAspect}
              cornerRadius={8}
              contentMode="fit"
              frame={{ width: Device.screen.width, height: Device.screen.width / pageAspect }}
              priority={0}
              onLoaded={() => setMediaReady(true)}
            />
          )}
        </VStack>

        <VStack alignment="leading" spacing={8} padding={{ horizontal: 14 }}>
          {/* 信息 */}
          <VStack alignment="leading" spacing={6}>
            <Text font="subheadline" fontWeight="semibold">
              信息
            </Text>
            <HStack spacing={10}>
              <HStack spacing={3}>
                <Image systemName="eye" font="footnote" foregroundStyle="secondaryLabel" />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  {formatNumber(current.total_view)}
                </Text>
              </HStack>
              <HStack spacing={3}>
                <Image systemName="heart" font="footnote" foregroundStyle="secondaryLabel" />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  {formatNumber(current.total_bookmarks)}
                </Text>
              </HStack>
              <HStack spacing={3}>
                <Image systemName="bubble.left" font="footnote" foregroundStyle="secondaryLabel" />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  {formatNumber(current.total_comments)}
                </Text>
              </HStack>
              {pageCount > 1 && (
                <HStack spacing={3}>
                  <Image systemName="rectangle.stack" font="footnote" foregroundStyle="secondaryLabel" />
                  <Text font="footnote" foregroundStyle="secondaryLabel">
                    {pageCount}P
                  </Text>
                </HStack>
              )}
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {formatDate(current.create_date)}
              </Text>
            </HStack>
          </VStack>

          {/* 系列 */}
          {Boolean(current.series?.id) && current.series ? (
            <VStack alignment="leading" spacing={4}>
              <Text font="subheadline" fontWeight="semibold">
                系列
              </Text>
              <NavigationLink value={`mangaSeries:${current.series.id}`}>
                <Text font="footnote" foregroundStyle="#007AFF">
                  {current.series.title || "系列详情"}
                </Text>
              </NavigationLink>
            </VStack>
          ) : null}

          {/* 简介（Pixiv caption 为 HTML，转纯文本显示） */}
          {current.caption ? (
            <VStack alignment="leading" spacing={4}>
              <Text font="subheadline" fontWeight="semibold">
                简介
              </Text>
              <LinkedDescription
                html={current.caption}
                routeDestination={renderDestination}
              />
            </VStack>
          ) : null}

          {/* 标签：原生流式换行展示所有标签 */}
          {current.tags.length > 0 ? (
            <VStack alignment="leading" spacing={6}>
              <Text font="subheadline" fontWeight="semibold">
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

        <RelatedIllustrationsSection
          illustID={current.id}
          enabled={mediaReady}
        />
      </VStack>

      <VStack
        sheet={{
          content: <CommentsSheet illustID={current.id} />,
          isPresented: showComments,
          onChanged: setShowComments,
        }}
      />
      <VStack
        sheet={{
          content: (
            <BookmarkDetailSheet
              item={current}
              bookmarked={bookmarked}
              loadDetail={(token) => bookmarkDetail(current.id, token)}
              loadTags={(restrict, token) =>
                bookmarkTags(session.userID ?? 0, restrict, token)
              }
              save={(restrict, tags, token) =>
                addBookmark(current.id, restrict, tags, token)
              }
              onSaved={() => {
                setBookmarked(true)
                updateHistoryBookmark(current.id, true)
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
      frame={{ maxWidth: "infinity" }}
    >
      <Text font="subheadline" fontWeight="semibold" padding={{ horizontal: 14 }}>
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
        <HStack spacing={0} padding={{ horizontal: 14, vertical: 8 }}>
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
