import {
  Button,
  HStack,
  Image,
  LazyVStack,
  NavigationLink,
  ScrollView,
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
  extractUserAmbientPalette,
  getCachedUserAmbientPalette,
  type UserAmbientPalette,
} from "../image/colorExtractor"
import { cardThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  addWatchlistSeries,
  deleteWatchlistSeries,
  illustrationSeries,
  nextIllustrationSeries,
  nextNovelSeries,
  novelSeries,
} from "../api/pixiv"
import { session } from "../api/session"
import {
  isIllustContentVisible,
  isR18ContentVisible,
  isUserBlocked,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import type {
  PixivIllustration,
  PixivIllustrationSeriesItem,
  PixivImageUrls,
  PixivNovel,
  PixivUser,
} from "../types"
import {
  AvatarImage,
  CachedImage,
  EmptyView,
  ErrorView,
  htmlToPlainText,
  ImageNumberBadge,
  LinkedDescription,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"
import { renderDestination } from "./routes"

type SeriesKind = "manga" | "novel"

const UI_BATCH_SIZE = 10

function seriesIllust(item: PixivIllustrationSeriesItem, authorFallback: PixivUser | null = null): PixivIllustration {
  const raw = item as any
  const illustType = item.illust_type ?? raw.type ?? (raw.illustType === 1 ? "manga" : raw.illustType === 2 ? "ugoira" : "illust")
  return {
    id: Number(item.id),
    title: item.title ?? raw.workTitle ?? "",
    type: illustType === "ugoira" ? "ugoira" : illustType === "manga" ? "manga" : "illust",
    image_urls: item.image_urls ?? (raw.urls ? {
      square_medium: raw.urls["250x250"] ?? raw.url,
      medium: raw.urls["540x540"] ?? raw.urls["360x360"] ?? raw.url,
      large: raw.urls["1200x1200"] ?? raw.url,
    } : { medium: raw.url }),
    caption: item.caption ?? raw.description ?? "",
    user: item.user ?? raw.user ?? (raw.userId ? {
      id: Number(raw.userId),
      name: raw.userName ?? "",
      account: raw.userAccount ?? raw.userName ?? "",
      profile_image_urls: raw.profileImageUrl ? { medium: raw.profileImageUrl } : undefined,
    } : authorFallback ?? { id: 0, name: "", account: "" }),
    tags: Array.isArray(item.tags)
      ? item.tags.map((t: any) => typeof t === "string" ? { name: t } : { name: t.name ?? t.tag ?? "", translated_name: t.translated_name })
      : [],
    create_date: item.create_date ?? raw.createDate ?? "",
    page_count: item.page_count ?? raw.pageCount ?? 1,
    width: item.width ?? 0,
    height: item.height ?? 0,
    x_restrict: item.x_restrict ?? raw.x_restrict ?? raw.xRestrict ?? 0,
    meta_single_page: item.meta_single_page ?? {},
    meta_pages: item.meta_pages ?? (raw.meta_pages ? raw.meta_pages : []),
    total_view: item.total_view ?? raw.total_view ?? raw.totalView ?? 0,
    total_bookmarks: item.total_bookmarks ?? raw.total_bookmarks ?? raw.totalBookmarks ?? 0,
    is_bookmarked: item.is_bookmarked ?? raw.is_bookmarked ?? false,
    is_muted: item.is_muted ?? raw.is_muted ?? false,
    illust_ai_type: item.illust_ai_type ?? raw.illust_ai_type ?? raw.aiType ?? raw.ai_type ?? 0,
    total_comments: item.total_comments ?? raw.total_comments ?? raw.totalComments ?? 0,
    comment_access_control: item.comment_access_control ?? raw.comment_access_control ?? 0,
  }
}

function filterSeriesIllusts(items: PixivIllustration[], isExempt = false): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings, isExempt || settings.followFilterExempt))
}

function filterSeriesNovels(items: PixivNovel[], isExempt = false): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) =>
    (isExempt || settings.followFilterExempt || (
      isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G) &&
      (settings.showAI || item.novel_ai_type !== 2)
    )) &&
    !isUserBlocked(item.user?.id ?? 0, settings.blockedUsers)
  )
}

function extractCoverUrl(
  detailCover?: PixivImageUrls | string | null,
  firstItemUrls?: PixivImageUrls | null,
  fallbackUrls?: PixivImageUrls | null
): string | null {
  if (typeof detailCover === "string" && detailCover) return detailCover
  if (detailCover && typeof detailCover === "object") {
    const url = detailCover.large ?? detailCover.medium ?? detailCover.square_medium
    if (url) return url
  }
  const first = firstItemUrls?.large ?? firstItemUrls?.medium ?? firstItemUrls?.square_medium
  if (first) return first
  const fallback = fallbackUrls?.large ?? fallbackUrls?.medium ?? fallbackUrls?.square_medium
  if (fallback) return fallback
  return null
}

function SeriesIntroduction(props: {
  caption: string
  routeDestination: (route: string) => any
}) {
  const [expanded, setExpanded] = useState(false)
  const plainText = useMemo(
    () => htmlToPlainText(props.caption).trim(),
    [props.caption]
  )

  const lines = useMemo(() => plainText.split(/\r?\n/), [plainText])
  const exceedsFiveLines = lines.length > 5 || plainText.length > 220

  if (!plainText) return null

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ top: 12, horizontal: 12, bottom: exceedsFiveLines ? 10 : 12 }}
      glassEffect={{ type: "rect", cornerRadius: 14 }}
      shadow={{ color: "#0000000F", radius: 18, y: 8 }}
      frame={{ maxWidth: "infinity" }}
      contentShape="rect"
      onTapGesture={
        exceedsFiveLines
          ? () => {
              setExpanded((prev) => !prev)
            }
          : undefined
      }
    >
      <LinkedDescription
        html={props.caption}
        routeDestination={props.routeDestination}
        lineLimit={!expanded && exceedsFiveLines ? 5 : undefined}
      />

      {exceedsFiveLines ? (
        <HStack
          alignment="center"
          spacing={4}
          frame={{ maxWidth: "infinity", alignment: "center" }}
          padding={{ top: 4, bottom: 2 }}
        >
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {expanded ? "点击收起" : "点击展开全文"}
          </Text>
          <Image
            systemName={expanded ? "chevron.up" : "chevron.down"}
            font="caption2"
            foregroundStyle="secondaryLabel"
          />
        </HStack>
      ) : null}
    </VStack>
  )
}

export function SeriesView(props: { kind: SeriesKind; seriesID: number }) {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const [ambientPalette, setAmbientPalette] = useState<UserAmbientPalette | null>(
    null
  )
  const [ambientEnabled, setAmbientEnabled] = useState(
    () => loadSettings().ambientImmersion
  )

  const [title, setTitle] = useState("系列")
  const [caption, setCaption] = useState("")
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [author, setAuthor] = useState<PixivUser | null>(null)
  const [workCount, setWorkCount] = useState<number | null>(null)
  const [isWatched, setIsWatched] = useState(false)
  const [watchLoading, setWatchLoading] = useState(false)
  const [isAscending, setIsAscending] = useState(true)

  // 全量已获取且过滤后的数据池（支持正序/倒序切换与分批派发）
  const allIllustsRef = useRef<PixivIllustration[]>([])
  const allNovelsRef = useRef<PixivNovel[]>([])

  // 当前已发布到 UI 的分批数据（初始严格为前 10 条）
  const [publishedIllusts, setPublishedIllusts] = useState<PixivIllustration[]>([])
  const [pendingIllusts, setPendingIllusts] = useState<PixivIllustration[]>([])

  const [publishedNovels, setPublishedNovels] = useState<PixivNovel[]>([])
  const [pendingNovels, setPendingNovels] = useState<PixivNovel[]>([])

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nextURL, setNextURL] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingMoreLockRef = useRef(false)
  const prefetchTaskRef = useRef<{ cancel: () => void } | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    loadingMoreLockRef.current = false
    setLoadingMore(false)
    try {
      if (props.kind === "manga") {
        const result = await session.call((token) => illustrationSeries(props.seriesID, token))
        const detail = result.illust_series_detail
        setTitle(detail.title || "漫画系列")
        setCaption(detail.caption || "")
        const isExempt = Boolean(detail.watchlist_added ?? (detail as any).is_watched)
        setIsWatched(isExempt)

        const seriesAuthor =
          detail.user ??
          result.illust_series_first_illust?.user ??
          result.illusts?.[0]?.user ??
          null
        setAuthor(seriesAuthor)

        const cover = extractCoverUrl(
          detail.cover_image_urls ?? detail.url,
          result.illust_series_first_illust?.image_urls,
          result.illusts?.[0]?.image_urls
        )
        setCoverUrl(cover)

        const rawIllusts = Array.isArray(result.illusts) ? result.illusts : []
        const mappedIllusts = rawIllusts.map((it) => seriesIllust(it, seriesAuthor))
        const filtered = filterSeriesIllusts(mappedIllusts, isExempt)
        allIllustsRef.current = filtered
        setWorkCount(detail.series_work_count ?? rawIllusts.length)

        const sorted = isAscending ? filtered : [...filtered].reverse()
        const pub = sorted.slice(0, UI_BATCH_SIZE)
        const pend = sorted.slice(UI_BATCH_SIZE)

        setPublishedIllusts(pub)
        setPendingIllusts(pend)
        setPublishedNovels([])
        setPendingNovels([])
        setNextURL(result.next_url ?? null)

        prefetchTaskRef.current?.cancel()
        prefetchTaskRef.current = prefetch([
          ...pub.map(cardThumbUrlOf),
          ...pend.slice(0, UI_BATCH_SIZE).map(cardThumbUrlOf),
        ])
      } else {
        const result = await session.call((token) => novelSeries(props.seriesID, token))
        const detail = result.novel_series_detail
        setTitle(detail.title || "小说系列")
        setCaption(detail.caption || "")
        const isExempt = Boolean(detail.watchlist_added ?? (detail as any).is_watched)
        setIsWatched(isExempt)

        const seriesAuthor =
          detail.user ??
          result.novel_series_first_novel?.user ??
          result.novels?.[0]?.user ??
          null
        setAuthor(seriesAuthor)

        const cover = extractCoverUrl(
          detail.cover_image_urls ?? detail.url,
          result.novel_series_first_novel?.image_urls,
          result.novels?.[0]?.image_urls
        )
        setCoverUrl(cover)

        const rawNovels = Array.isArray(result.novels) ? result.novels : []
        const filtered = filterSeriesNovels(rawNovels, isExempt)
        allNovelsRef.current = filtered
        setWorkCount(detail.content_count ?? rawNovels.length)

        const sorted = isAscending ? filtered : [...filtered].reverse()
        const pub = sorted.slice(0, UI_BATCH_SIZE)
        const pend = sorted.slice(UI_BATCH_SIZE)

        setPublishedNovels(pub)
        setPendingNovels(pend)
        setPublishedIllusts([])
        setPendingIllusts([])
        setNextURL(result.next_url ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "系列加载失败")
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (loadingMoreLockRef.current) return
    if (props.kind === "manga") {
      if (pendingIllusts.length === 0 && !nextURL) return
      loadingMoreLockRef.current = true
      setLoadingMore(true)
      try {
        if (pendingIllusts.length > 0) {
          // 缓冲 1300ms：确保触底橡皮筋回弹完整展示转圈，随后平滑展开新批次卡片
          await new Promise((resolve) => setTimeout(() => resolve(undefined), 1300))
          const nextBatch = pendingIllusts.slice(0, UI_BATCH_SIZE)
          const remaining = pendingIllusts.slice(UI_BATCH_SIZE)
          setPublishedIllusts((current) => [...current, ...nextBatch])
          setPendingIllusts(remaining)
          prefetchTaskRef.current?.cancel()
          prefetchTaskRef.current = prefetch(remaining.slice(0, UI_BATCH_SIZE).map(cardThumbUrlOf))
        } else if (nextURL) {
          const [result] = await Promise.all([
            session.call((token) => nextIllustrationSeries(nextURL, token)),
            new Promise((resolve) => setTimeout(() => resolve(undefined), 1300)),
          ])
          const rawIllusts = Array.isArray(result.illusts) ? result.illusts : []
          const mappedIllusts = rawIllusts.map((it) => seriesIllust(it, author))
          const filtered = filterSeriesIllusts(mappedIllusts, isWatched)
          allIllustsRef.current = [...allIllustsRef.current, ...filtered]
          const nextBatch = filtered.slice(0, UI_BATCH_SIZE)
          const remaining = filtered.slice(UI_BATCH_SIZE)
          setPublishedIllusts((current) => [...current, ...nextBatch])
          setPendingIllusts(remaining)
          setNextURL(result.next_url ?? null)
          prefetchTaskRef.current?.cancel()
          prefetchTaskRef.current = prefetch(remaining.slice(0, UI_BATCH_SIZE).map(cardThumbUrlOf))
        }
      } catch {
        // 出错静默，允许用户再次触底重试
      } finally {
        loadingMoreLockRef.current = false
        setLoadingMore(false)
      }
    } else {
      if (pendingNovels.length === 0 && !nextURL) return
      loadingMoreLockRef.current = true
      setLoadingMore(true)
      try {
        if (pendingNovels.length > 0) {
          await new Promise((resolve) => setTimeout(() => resolve(undefined), 1300))
          const nextBatch = pendingNovels.slice(0, UI_BATCH_SIZE)
          const remaining = pendingNovels.slice(UI_BATCH_SIZE)
          setPublishedNovels((current) => [...current, ...nextBatch])
          setPendingNovels(remaining)
        } else if (nextURL) {
          const [result] = await Promise.all([
            session.call((token) => nextNovelSeries(nextURL, token)),
            new Promise((resolve) => setTimeout(() => resolve(undefined), 1300)),
          ])
          const rawNovels = Array.isArray(result.novels) ? result.novels : []
          const filtered = filterSeriesNovels(rawNovels, isWatched)
          allNovelsRef.current = [...allNovelsRef.current, ...filtered]
          const nextBatch = filtered.slice(0, UI_BATCH_SIZE)
          const remaining = filtered.slice(UI_BATCH_SIZE)
          setPublishedNovels((current) => [...current, ...nextBatch])
          setPendingNovels(remaining)
          setNextURL(result.next_url ?? null)
        }
      } catch {
        // 出错静默
      } finally {
        loadingMoreLockRef.current = false
        setLoadingMore(false)
      }
    }
  }

  async function toggleWatchlist() {
    if (watchLoading) return
    setWatchLoading(true)
    const nextState = !isWatched
    try {
      if (nextState) {
        await session.call((token) => addWatchlistSeries(props.seriesID, props.kind, token))
        setIsWatched(true)
        void Haptics.transient()
      } else {
        await session.call((token) => deleteWatchlistSeries(props.seriesID, props.kind, token))
        setIsWatched(false)
        void Haptics.transient()
      }
    } catch {
      // 保持当前状态
    } finally {
      setWatchLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [props.kind, props.seriesID])

  useEffect(() => {
    if (!ambientEnabled) {
      setAmbientPalette(null)
      return
    }
    if (!coverUrl) {
      setAmbientPalette(null)
      return
    }
    let active = true
    const cached = getCachedUserAmbientPalette(coverUrl, isDark)
    if (cached) {
      setAmbientPalette(cached)
    }
    void extractUserAmbientPalette(coverUrl).then((result) => {
      if (!active || !result) return
      setAmbientPalette(isDark ? result.dark : result.light)
    })
    return () => {
      active = false
    }
  }, [coverUrl, isDark, ambientEnabled])

  useEffect(() => {
    return onSettingsChanged(() => {
      setAmbientEnabled(loadSettings().ambientImmersion)
      void load()
    })
  }, [])

  if (loading) {
    return (
      <ScrollView
        navigationTitle="系列详情"
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      >
        <LoadingView />
      </ScrollView>
    )
  }

  if (error) {
    return (
      <ScrollView
        navigationTitle="系列详情"
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      >
        <ErrorView message={error} onRetry={load} />
      </ScrollView>
    )
  }

  return (
    <RefreshableScrollView
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      ignoresSafeArea={{ edges: "top" }}
      refreshable={load}
      background={
        ambientEnabled && ambientPalette
          ? {
              colors: [
                ambientPalette.topColor,
                ambientPalette.midColor,
                ambientPalette.worksColor,
                ambientPalette.worksColor,
              ],
              startPoint: "top",
              endPoint: "bottom",
            }
          : undefined
      }
      toolbar={{
        topBarTrailing: [
          <Button
            buttonStyle="glass"
            disabled={watchLoading}
            frame={{ width: 30, height: 30 }}
            clipShape={{ type: "rect", cornerRadius: 15 }}
            contentShape="rect"
            action={toggleWatchlist}
          >
            <Image
              systemName={isWatched ? "bookmark.fill" : "bookmark"}
              foregroundStyle={isWatched ? "#FF9500" : undefined}
            />
          </Button>,
          <Button
            buttonStyle="glass"
            frame={{ width: 30, height: 30 }}
            clipShape={{ type: "rect", cornerRadius: 15 }}
            contentShape="rect"
            action={() => {
              void Haptics.transient()
              setIsAscending((prev) => {
                const nextAsc = !prev
                if (props.kind === "manga") {
                  const sorted = nextAsc ? allIllustsRef.current : [...allIllustsRef.current].reverse()
                  const pub = sorted.slice(0, UI_BATCH_SIZE)
                  const pend = sorted.slice(UI_BATCH_SIZE)
                  setPublishedIllusts(pub)
                  setPendingIllusts(pend)
                  prefetchTaskRef.current?.cancel()
                  prefetchTaskRef.current = prefetch([
                    ...pub.map(cardThumbUrlOf),
                    ...pend.slice(0, UI_BATCH_SIZE).map(cardThumbUrlOf),
                  ])
                } else {
                  const sorted = nextAsc ? allNovelsRef.current : [...allNovelsRef.current].reverse()
                  setPublishedNovels(sorted.slice(0, UI_BATCH_SIZE))
                  setPendingNovels(sorted.slice(UI_BATCH_SIZE))
                }
                return nextAsc
              })
            }}
          >
            <Image systemName={isAscending ? "arrow.up" : "arrow.down"} />
          </Button>,
          ...(author ? [
            <NavigationLink
              key="series-author"
              value={`user:${author.id}`}
              buttonStyle="glass"
              frame={{ width: 30, height: 30 }}
              clipShape={{ type: "rect", cornerRadius: 15 }}
              contentShape="rect"
            >
              <AvatarImage
                url={author.profile_image_urls?.medium ?? null}
                size={28}
              />
            </NavigationLink>
          ] : []),
        ],
      }}
    >
      <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
        {/* 沉浸式顶部背景图与居中悬浮胶囊标题 */}
        <ZStack alignment="bottom" frame={{ maxWidth: "infinity" }}>
          {coverUrl ? (
            <CachedImage
              url={coverUrl}
              useIntrinsicAspectRatio={true}
              aspectRatioValue={2.4}
              contentMode="fill"
              cornerRadius={0}
              priority={0}
              frame={{ maxWidth: "infinity" }}
            />
          ) : (
            <VStack
              frame={{ maxWidth: "infinity", height: 160 }}
              background={{
                colors: ["rgba(0, 150, 250, 0.18)", "rgba(0, 150, 250, 0.04)"],
                startPoint: "topLeading",
                endPoint: "bottomTrailing",
              }}
            />
          )}

          {/* 胶囊状液态玻璃标题：垂直中心线对齐封面底边（参考用户主页头像位置） */}
          <HStack
            alignment="center"
            padding={{ horizontal: 20, vertical: 9 }}
            glassEffect={{ type: "capsule", style: "continuous" }}
            clipShape={{ type: "capsule", style: "continuous" }}
            shadow={{ color: "#00000028", radius: 10, y: 4 }}
            offset={{ x: 0, y: 19 }}
          >
            <Text
              font="headline"
              fontWeight="bold"
              multilineTextAlignment="center"
              lineLimit={2}
            >
              {title}
            </Text>
          </HStack>
        </ZStack>

        {/* 系列信息 */}
        <VStack
          alignment="center"
          spacing={6}
          padding={{ top: 28, horizontal: 16, bottom: 8 }}
          frame={{ maxWidth: "infinity" }}
        >
          {/* 共多少话居中显示，放在标题下方，字体加大一号 (caption) */}
          {workCount != null ? (
            <Text
              font="caption"
              foregroundStyle="secondaryLabel"
              multilineTextAlignment="center"
              frame={{ maxWidth: "infinity", alignment: "center" }}
            >
              {`共 ${workCount} 话`}
            </Text>
          ) : null}

          {/* 如果有简介，用玻璃卡片包裹起来，要求和用户主页简介样式一致，没有不显示 */}
          {caption.trim() ? (
            <VStack
              alignment="leading"
              frame={{ maxWidth: "infinity" }}
              padding={{ top: 6 }}
            >
              <SeriesIntroduction
                caption={caption}
                routeDestination={renderDestination}
              />
            </VStack>
          ) : null}
        </VStack>

        {/* 章节列表 */}
        {props.kind === "novel" ? (
          <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10, top: 4 }}>
            {publishedNovels.length === 0 ? (
              <EmptyView
                text="暂无可显示的小说章节"
                systemImage="book"
              />
            ) : (
              <>
                {publishedNovels.map((novel, index) => (
                  <NovelCard key={novel.id} novel={novel} priority={index} />
                ))}
                <LoadMoreTrigger
                  anchor={publishedNovels[publishedNovels.length - 1].id}
                  onLoadMore={loadMore}
                  hasMore={pendingNovels.length > 0 || nextURL != null}
                  isLoading={loadingMore}
                />
              </>
            )}
          </LazyVStack>
        ) : (
          <VStack alignment="leading" spacing={8} padding={{ top: 4 }} frame={{ maxWidth: "infinity" }}>
            {publishedIllusts.length === 0 ? (
              <EmptyView
                text="暂无可显示的漫画章节"
                systemImage="photo.on.rectangle"
              />
            ) : (
              <IllustFlowFeed
                items={publishedIllusts}
                onLoadMore={loadMore}
                hasMore={pendingIllusts.length > 0 || nextURL != null}
                isLoading={loadingMore}
                cornerBadgeOf={(_, index) => (
                  <ImageNumberBadge
                    number={
                      isAscending
                        ? index + 1
                        : (workCount ?? allIllustsRef.current.length) - index
                    }
                  />
                )}
              />
            )}
          </VStack>
        )}
      </VStack>
    </RefreshableScrollView>
  )
}
