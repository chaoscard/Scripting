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
  useMemo,
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
  nextIllustrations,
  relatedIllustrations,
  removeBookmark,
  unfollowUser,
} from "../api/pixiv"
import { session } from "../api/session"
import { cachedFilePath, cardThumbUrlOf, imageUrlOf, loadImage, pageThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  extractIllustAmbientPalette,
  getCachedIllustAmbientPalette,
  type IllustAmbientPalette,
} from "../image/colorExtractor"
import {
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
import { useAsyncGuard, useIllustBookmark, useLatest, usePagedList, currentBatchSize } from "./hooks"
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
import { UgoiraPlayerView } from "./ugoiraView"
import { buildUgoira } from "../ugoira/ugoira"
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
  const [bookmarked, setBookmarked] = useIllustBookmark(
    illustID,
    getCachedIllust(illustID)?.is_bookmarked ?? false
  )
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
      setIllust(detail)
      setBookmarked(detail.is_bookmarked)
      setFollowed(detail.user.is_followed ?? false)
      // 本地浏览记录：同一实例只记一次（与 Hanairo 的 didRecordHistory 一致）
      if (recordedIDRef.current !== detail.id) {
        recordedIDRef.current = detail.id
        recordHistory(detail)
      }
      // 预取后续几页大图（从第 1 页开始预取；第 0 页由前台 CachedImage 赋予最高优先级 -5000 极速直出）
      const prefetchURLs: (string | null | undefined)[] = []
      const detailQuality = loadSettings().detailImageQuality
      const total = Math.min(4, detail.page_count || detail.meta_pages?.length || 1)
      for (let k = 1; k < total; k++) {
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

  // 设置变化时更新图片质量与沉浸式开关；屏蔽黑名单变化时撤下或恢复已打开的内容。
  useEffect(() => {
    return onSettingsChanged(() => {
      const settings = loadSettings()
      setQuality(settings.detailImageQuality)
      setAmbientEnabled(settings.ambientImmersion)
      setAmbientIntensity(settings.ambientIntensity)
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
  const rawSeries = current.series ?? (current as any).illust_series
  const rawSeriesObj = Array.isArray(rawSeries) ? rawSeries[0] : rawSeries
  const associatedRef = getSeriesByWorkID(current.id, "manga")
  const resolvedSeriesID = rawSeriesObj?.id ?? associatedRef?.seriesID ?? null
  const resolvedSeriesTitle = rawSeriesObj?.title ?? associatedRef?.seriesTitle ?? null
  const resolvedEpisodeNumber = current.episode_number ?? associatedRef?.episodeNumber ?? null

  if (resolvedSeriesID) {
    recordWorkSeriesAssociation(current.id, "manga", resolvedSeriesID, resolvedSeriesTitle, resolvedEpisodeNumber)
  }

  const pageCount = Math.max(1, current.page_count || current.meta_pages.length || 1)
  // 无限滚动：一次性生成所有页的图片 URL（meta_pages 缺失时由 imageUrlOf 推导）
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

  // 当为多页作品时，在详情页挂载的第一时间高优先级并发预热所有页面的中等缩略图（每张仅约 15KB），
  // 确保用户滚动到后续各页之前所有缩略图已写入本地磁盘，首帧 0 延迟命中真实物理比例与模糊底图
  useEffect(() => {
    if (!current || pageCount <= 1) return
    for (let idx = 0; idx < pageCount; idx++) {
      const thumb = pageThumbUrlOf(current, idx)
      if (thumb && !cachedFilePath(thumb)) {
        void loadImage(thumb, idx === 0 ? -6000 : -1000 + idx)
      }
    }
  }, [current, pageCount])

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
            {Boolean(resolvedSeriesID) && (
              <Button
                title="系列"
                systemImage="books.vertical"
                action={() => requestPixivRoute(`mangaSeries:${resolvedSeriesID}`)}
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
      <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
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
              previewUrl={pageThumbUrlOf(current, 0)}
              aspectRatioValue={pageAspect}
              cornerRadius={8}
              onLoaded={() => setMediaReady(true)}
            />
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

          {/* 标签：原生流式换行展示所有标签 */}
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
