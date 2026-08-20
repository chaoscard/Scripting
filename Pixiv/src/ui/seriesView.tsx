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
  cachedFileExists,
  cardThumbUrlOf,
  loadImage,
  novelThumbUrlOf,
  prefetch,
  upgradeHighQualityCoverUrl,
} from "../image/imageLoader"
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
  loadSettings,
  onSettingsChanged,
  updateSettings,
} from "../store/settings"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import { isUserFollowed, onUserFollowChanged } from "../store/userFollow"
import { onWatchlistChanged } from "../store/watchlist"
import { cacheIllusts } from "../store/illustCache"
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
  ExpandableIntroduction,
  htmlToPlainText,
  ImageNumberBadge,
  ImmersiveHeaderBanner,
  LinkedDescription,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
} from "./components"
import { renderDestination } from "./routes"
import {
  currentBatchSize,
  useLatest,
  usePagedList,
  useUserAmbientPalette,
} from "./hooks"

type SeriesKind = "manga" | "novel"

function seriesIllust(
  item: PixivIllustrationSeriesItem,
  authorFallback: PixivUser | null = null,
  episodeNumber?: number
): PixivIllustration {
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
    episode_number: episodeNumber,
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

function filterSeriesIllusts(
  items: PixivIllustration[],
  isSeriesWatched = false,
  author?: PixivUser | null
): PixivIllustration[] {
  const settings = loadSettings()
  const isAuthorFollowed =
    author?.is_followed ?? (author?.id ? isUserFollowed(author.id) : false)
  return items.filter((item) =>
    isIllustContentVisible(item, settings, {
      isSeriesWatched,
      isAuthorFollowed,
    })
  )
}

function filterSeriesNovels(
  items: PixivNovel[],
  isSeriesWatched = false,
  author?: PixivUser | null
): PixivNovel[] {
  const settings = loadSettings()
  const isAuthorFollowed =
    author?.is_followed ?? (author?.id ? isUserFollowed(author.id) : false)
  return items.filter((item) =>
    isNovelContentVisible(item, settings, {
      isSeriesWatched,
      isAuthorFollowed,
    })
  )
}

function candidateUrlOf(item: any): string | null {
  if (!item) return null
  if (typeof item === "string") return item
  if (typeof item !== "object") return null

  // 1. cover?.urls: 优先最高画质 original -> 1200x1200 -> 480mw -> large -> 240mw -> medium -> square_medium -> 128x128
  const coverUrls = item.cover?.urls ?? item.cover_image_urls ?? item.cover
  if (coverUrls && typeof coverUrls === "object") {
    const url =
      coverUrls.original ??
      coverUrls["1200x1200"] ??
      coverUrls["480mw"] ??
      coverUrls.large ??
      coverUrls["240mw"] ??
      coverUrls.medium ??
      coverUrls.square_medium ??
      coverUrls["128x128"]
    if (url && typeof url === "string") return url
  }

  // 2. meta_single_page.original_image_url
  if (item.meta_single_page?.original_image_url) {
    return item.meta_single_page.original_image_url
  }

  // 3. meta_pages[0].image_urls
  if (Array.isArray(item.meta_pages) && item.meta_pages.length > 0) {
    const firstPage = item.meta_pages[0]?.image_urls
    if (firstPage) {
      const url =
        firstPage.original ??
        firstPage.large ??
        firstPage.medium ??
        firstPage.square_medium
      if (url) return url
    }
  }

  // 4. image_urls: original -> large -> medium -> square_medium
  if (item.image_urls && typeof item.image_urls === "object") {
    const url =
      item.image_urls.original ??
      item.image_urls.large ??
      item.image_urls.medium ??
      item.image_urls.square_medium
    if (url && typeof url === "string") return url
  }

  // 5. item.url
  if (typeof item.url === "string" && item.url) {
    return item.url
  }

  return null
}

function extractRawCoverCandidate(
  detail?: any,
  firstItem?: any,
  fallbackItem?: any
): string | null {
  return (
    candidateUrlOf(detail) ??
    candidateUrlOf(firstItem) ??
    candidateUrlOf(fallbackItem)
  )
}

export function SeriesView(props: { kind: SeriesKind; seriesID: number }) {
  const [title, setTitle] = useState("系列")
  const [caption, setCaption] = useState("")
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [author, setAuthor] = useState<PixivUser | null>(null)
  const authorRef = useRef<PixivUser | null>(null)
  authorRef.current = author
  const [workCount, setWorkCount] = useState<number | null>(null)
  const [isWatched, setIsWatched] = useState(false)
  const isWatchedRef = useRef(isWatched)
  isWatchedRef.current = isWatched
  const [watchLoading, setWatchLoading] = useState(false)
  const [isAscending, setIsAscending] = useState(
    () => loadSettings().watchlistSortOrder === "asc"
  )
  const isAscendingRef = useRef(isAscending)
  isAscendingRef.current = isAscending

  const { ambientBackground } = useUserAmbientPalette(coverPreviewUrl || coverUrl)

  // 全量已获取未过滤的原始数据映射池（按自然正序 1..N 存储）
  const rawMappedIllustsRef = useRef<PixivIllustration[]>([])
  const rawMappedNovelsRef = useRef<PixivNovel[]>([])

  // 1. 漫画系列分页流
  const illustPaged = usePagedList<PixivIllustration>({
    first: async (token) => {
      // 若已有缓存原始数据且只是切换了排序，直接快速复用
      if (rawMappedIllustsRef.current.length > 0) {
        const sorted = isAscendingRef.current
          ? rawMappedIllustsRef.current
          : [...rawMappedIllustsRef.current].reverse()
        return { items: sorted, nextURL: null }
      }

      const result = await illustrationSeries(props.seriesID, token)
      const detail = result.illust_series_detail
      setTitle(detail.title || "漫画系列")
      setCaption(detail.caption || "")
      const isExempt = Boolean(detail.watchlist_added ?? (detail as any).is_watched)
      setIsWatched(isExempt)
      isWatchedRef.current = isExempt

      const seriesAuthor =
        detail.user ??
        result.illust_series_first_illust?.user ??
        result.illusts?.[0]?.user ??
        null
      setAuthor(seriesAuthor)
      authorRef.current = seriesAuthor

      const rawCover = extractRawCoverCandidate(
        detail,
        result.illust_series_first_illust,
        result.illusts?.[0]
      )
      const cover = upgradeHighQualityCoverUrl(rawCover)
      setCoverPreviewUrl(rawCover)
      setCoverUrl(cover)

      const allRawIllusts: PixivIllustrationSeriesItem[] = Array.isArray(result.illusts) ? [...result.illusts] : []
      let currentNextURL = result.next_url ?? null

      while (currentNextURL && allRawIllusts.length < 500) {
        try {
          const nextResult = await nextIllustrationSeries(currentNextURL!, token)
          if (Array.isArray(nextResult.illusts) && nextResult.illusts.length > 0) {
            allRawIllusts.push(...nextResult.illusts)
            currentNextURL = nextResult.next_url ?? null
          } else {
            break
          }
        } catch {
          break
        }
      }

      const rawAscending = [...allRawIllusts].reverse()
      const mappedIllusts = rawAscending.map((it, idx) =>
        seriesIllust(it, seriesAuthor, idx + 1)
      )
      cacheIllusts(mappedIllusts)
      rawMappedIllustsRef.current = mappedIllusts
      setWorkCount(detail.series_work_count ?? allRawIllusts.length)

      const sorted = isAscendingRef.current ? mappedIllusts : [...mappedIllusts].reverse()
      return { items: sorted, nextURL: null }
    },
    filter: (items) => filterSeriesIllusts(items, isWatchedRef.current, authorRef.current),
    deps: [props.seriesID, isAscending],
    enabled: props.kind === "manga",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 小说系列分页流
  const novelPaged = usePagedList<PixivNovel>({
    first: async (token) => {
      // 若已有缓存原始数据且只是切换了排序，直接快速复用
      if (rawMappedNovelsRef.current.length > 0) {
        const sorted = isAscendingRef.current
          ? rawMappedNovelsRef.current
          : [...rawMappedNovelsRef.current].reverse()
        return { items: sorted, nextURL: null }
      }

      const result = await novelSeries(props.seriesID, token)
      const detail = result.novel_series_detail
      setTitle(detail.title || "小说系列")
      setCaption(detail.caption || "")
      const isExempt = Boolean(detail.watchlist_added ?? (detail as any).is_watched)
      setIsWatched(isExempt)
      isWatchedRef.current = isExempt

      const seriesAuthor =
        detail.user ??
        result.novel_series_first_novel?.user ??
        result.novels?.[0]?.user ??
        null
      setAuthor(seriesAuthor)
      authorRef.current = seriesAuthor

      const rawCover = extractRawCoverCandidate(
        detail,
        result.novel_series_first_novel,
        result.novels?.[0]
      )
      const cover = upgradeHighQualityCoverUrl(rawCover)
      setCoverPreviewUrl(rawCover)
      setCoverUrl(cover)

      const allRawNovels: PixivNovel[] = Array.isArray(result.novels) ? [...result.novels] : []
      let currentNextURL = result.next_url ?? null

      while (currentNextURL && allRawNovels.length < 500) {
        try {
          const nextResult = await nextNovelSeries(currentNextURL!, token)
          if (Array.isArray(nextResult.novels) && nextResult.novels.length > 0) {
            allRawNovels.push(...nextResult.novels)
            currentNextURL = nextResult.next_url ?? null
          } else {
            break
          }
        } catch {
          break
        }
      }

      const mappedNovels = allRawNovels.map((novel, idx) => ({
        ...novel,
        episode_number: idx + 1,
      }))
      rawMappedNovelsRef.current = mappedNovels
      setWorkCount(detail.content_count ?? allRawNovels.length)

      const sorted = isAscendingRef.current ? mappedNovels : [...mappedNovels].reverse()
      return { items: sorted, nextURL: null }
    },
    filter: (items) => filterSeriesNovels(items, isWatchedRef.current, authorRef.current),
    deps: [props.seriesID, isAscending],
    enabled: props.kind === "novel",
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const illustPagedRef = useLatest(illustPaged)
  const novelPagedRef = useLatest(novelPaged)

  async function toggleWatchlist() {
    if (watchLoading) return
    void Haptics.transient()
    setWatchLoading(true)
    const nextState = !isWatched
    try {
      if (nextState) {
        await session.call((token) => addWatchlistSeries(props.seriesID, props.kind, token))
        setIsWatched(true)
        isWatchedRef.current = true
        if (props.kind === "manga") illustPagedRef.current.reapplyFilter()
        else novelPagedRef.current.reapplyFilter()
      } else {
        await session.call((token) => deleteWatchlistSeries(props.seriesID, props.kind, token))
        setIsWatched(false)
        isWatchedRef.current = false
        if (props.kind === "manga") illustPagedRef.current.reapplyFilter()
        else novelPagedRef.current.reapplyFilter()
      }
    } catch {
      // 保持当前状态
    } finally {
      setWatchLoading(false)
    }
  }

  useEffect(() => {
    return onWatchlistChanged((changedID, watched) => {
      if (changedID === props.seriesID) {
        setIsWatched(watched)
        isWatchedRef.current = watched
        if (props.kind === "manga") illustPagedRef.current.reapplyFilter()
        else novelPagedRef.current.reapplyFilter()
      }
    })
  }, [props.seriesID, props.kind])

  useEffect(() => {
    return onUserFollowChanged((changedUserID) => {
      if (authorRef.current?.id === changedUserID) {
        if (props.kind === "manga") illustPagedRef.current.reapplyFilter()
        else novelPagedRef.current.reapplyFilter()
      }
    })
  }, [props.kind])

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      const targetAsc = nextSettings.watchlistSortOrder === "asc"
      setIsAscending(targetAsc)
      if (props.kind === "manga") illustPagedRef.current.reapplyFilter()
      else novelPagedRef.current.reapplyFilter()
    })
  }, [props.kind])

  const paged = props.kind === "manga" ? illustPaged : novelPaged

  const handleRefresh = async () => {
    rawMappedIllustsRef.current = []
    rawMappedNovelsRef.current = []
    await paged.refresh()
  }

  if (paged.initialLoading) {
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

  if (paged.error) {
    return (
      <ScrollView
        navigationTitle="系列详情"
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      >
        <ErrorView message={paged.error} onRetry={handleRefresh} />
      </ScrollView>
    )
  }

  return (
    <ScrollView
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      ignoresSafeArea={{ edges: ["top", "bottom"] }}
      background={ambientBackground}
      refreshable={handleRefresh}
      toolbar={{
        topBarTrailing: [
          <Button
            disabled={watchLoading}
            action={toggleWatchlist}
          >
            <Image
              systemName={isWatched ? "bookmark.fill" : "bookmark"}
              foregroundStyle={isWatched ? "#0096FA" : undefined}
            />
          </Button>,
          <Button
            action={() => {
              void Haptics.transient()
              const nextAsc = !isAscending
              setIsAscending(nextAsc)
              updateSettings({ watchlistSortOrder: nextAsc ? "asc" : "desc" })
            }}
          >
            <Image systemName={isAscending ? "arrow.up" : "arrow.down"} />
          </Button>,
          <Button
            action={() => {
              void Haptics.transient()
              const shareUrl = props.kind === "novel"
                ? `https://www.pixiv.net/novel/series/${props.seriesID}`
                : (author?.id
                    ? `https://www.pixiv.net/user/${author.id}/series/${props.seriesID}`
                    : `https://www.pixiv.net/series/${props.seriesID}`)
              void ShareSheet.present([shareUrl])
            }}
          >
            <Image systemName="square.and.arrow.up" />
          </Button>,
          ...(author ? [
            <NavigationLink
              key="series-author"
              value={`user:${author.id}`}
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
        <ImmersiveHeaderBanner url={coverUrl} previewUrl={coverPreviewUrl}>
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
        </ImmersiveHeaderBanner>

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
              <ExpandableIntroduction
                caption={caption}
                routeDestination={renderDestination}
              />
            </VStack>
          ) : null}
        </VStack>

        {/* 章节列表 */}
        {props.kind === "novel" ? (
          <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10, top: 4 }}>
            {novelPaged.items.length === 0 && !novelPaged.initialLoading ? (
              <EmptyView
                text="暂无可显示的小说章节"
                systemImage="book"
              />
            ) : (
              <>
                {novelPaged.items.map((novel, index) => (
                  <NovelCard key={novel.id} novel={novel} priority={index} />
                ))}
                {novelPaged.items.length > 0 ? (
                  <LoadMoreTrigger
                    anchor={novelPaged.items[novelPaged.items.length - 1].id}
                    onLoadMore={novelPaged.loadMore}
                    hasMore={novelPaged.hasMore}
                    isLoading={novelPaged.loadingMore}
                  />
                ) : null}
              </>
            )}
          </LazyVStack>
        ) : (
          <VStack alignment="leading" spacing={8} padding={{ top: 4 }} frame={{ maxWidth: "infinity" }}>
            {illustPaged.items.length === 0 && !illustPaged.initialLoading ? (
              <EmptyView
                text="暂无可显示的漫画章节"
                systemImage="photo.on.rectangle"
              />
            ) : (
              <IllustFlowFeed
                items={illustPaged.items}
                onLoadMore={illustPaged.loadMore}
                hasMore={illustPaged.hasMore}
                isLoading={illustPaged.loadingMore}
                cornerBadgeOf={(illust, index) => (
                  <ImageNumberBadge
                    number={
                      illust.episode_number ??
                      (isAscending
                        ? index + 1
                        : (workCount ?? rawMappedIllustsRef.current.length) - index)
                    }
                  />
                )}
              />
            )}
          </VStack>
        )}
      </VStack>
    </ScrollView>
  )
}
