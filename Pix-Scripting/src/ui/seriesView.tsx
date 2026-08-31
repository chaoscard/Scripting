import {
  Button,
  HStack,
  Image,
  LazyVStack,
  NavigationLink,
  ScrollView,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  downloadEntireMangaSeries,
  downloadEntireNovelSeries,
} from "../downloader"
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
import { cacheIllusts } from "../store/illustCache"
import { cacheSeriesNav } from "../store/seriesCache"
import type {
  PixivIllustration,
  PixivIllustrationSeriesItem,
  PixivNovel,
  PixivUser,
} from "../types"
import {
  AvatarImage,
  EmptyView,
  ErrorView,
  ExpandableIntroduction,
  ImageNumberBadge,
  ImmersiveHeaderBanner,
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
  useSeriesWatchlist,
  useUserAmbientPalette,
} from "./hooks"

type SeriesKind = "manga" | "novel"
type SeriesWorkItem = PixivIllustration | PixivNovel

function seriesIllust(
  item: PixivIllustrationSeriesItem,
  seriesID?: number | null,
  seriesTitle?: string | null,
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
    series: seriesID ? { id: seriesID, title: seriesTitle ?? "漫画系列" } : undefined,
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

function filterSeriesIllusts(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isIllustContentVisible(item, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
      exemptBlockedUser: true,
    })
  )
}

function filterSeriesNovels(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isNovelContentVisible(item, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
      exemptBlockedUser: true,
    })
  )
}

function candidateUrlOf(item: any): string | null {
  if (!item) return null
  if (typeof item === "string") return item
  if (typeof item !== "object") return null

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

  if (item.meta_single_page?.original_image_url) {
    return item.meta_single_page.original_image_url
  }

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

  if (item.image_urls && typeof item.image_urls === "object") {
    const url =
      item.image_urls.original ??
      item.image_urls.large ??
      item.image_urls.medium ??
      item.image_urls.square_medium
    if (url && typeof url === "string") return url
  }

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
  const { kind, seriesID } = props
  const defaultTitle = kind === "manga" ? "漫画系列" : "小说系列"

  const [title, setTitle] = useState(defaultTitle)
  const [caption, setCaption] = useState("")
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [author, setAuthor] = useState<PixivUser | null>(null)
  const authorRef = useRef<PixivUser | null>(null)
  authorRef.current = author
  const [workCount, setWorkCount] = useState<number | null>(null)
  const [isWatched, setIsWatched] = useSeriesWatchlist(seriesID, kind, false)
  const [watchLoading, setWatchLoading] = useState(false)
  const [isAscending, setIsAscending] = useState(
    () => loadSettings().watchlistSortOrder === "asc"
  )
  const isAscendingRef = useRef(isAscending)
  isAscendingRef.current = isAscending

  const { ambientBackground } = useUserAmbientPalette(coverPreviewUrl || coverUrl)

  // 全量已获取未过滤的原始数据映射池（按自然正序 1..N 存储）
  const rawMappedItemsRef = useRef<SeriesWorkItem[]>([])

  // 统一的系列分页流状态机
  const paged = usePagedList<SeriesWorkItem>({
    first: async (token) => {
      // 若已有缓存原始数据且只是切换了排序，直接快速复用
      if (rawMappedItemsRef.current.length > 0) {
        const sorted = isAscendingRef.current
          ? rawMappedItemsRef.current
          : [...rawMappedItemsRef.current].reverse()
        return { items: sorted, nextURL: null }
      }

      let detail: any
      let seriesAuthor: PixivUser | null = null
      let rawCover: string | null = null
      let mappedItems: SeriesWorkItem[] = []
      let totalCount = 0

      if (kind === "manga") {
        const result = await illustrationSeries(seriesID, token)
        detail = result.illust_series_detail
        seriesAuthor =
          detail.user ??
          result.illust_series_first_illust?.user ??
          result.illusts?.[0]?.user ??
          null

        rawCover = extractRawCoverCandidate(
          detail,
          result.illust_series_first_illust,
          result.illusts?.[0]
        )

        const allRawIllusts: PixivIllustrationSeriesItem[] = Array.isArray(result.illusts) ? [...result.illusts] : []
        let currentNextURL = result.next_url ?? null

        while (currentNextURL && allRawIllusts.length < 500) {
          try {
            const nextResult = await nextIllustrationSeries(currentNextURL, token)
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
        const sTitle = detail.title || defaultTitle
        const illusts = rawAscending.map((it, idx) =>
          seriesIllust(it, seriesID, sTitle, seriesAuthor, idx + 1)
        )
        cacheIllusts(illusts)
        cacheSeriesNav(
          seriesID,
          "manga",
          sTitle,
          illusts.map((it) => ({
            id: it.id,
            title: it.title,
            episodeNumber: it.episode_number,
          }))
        )
        mappedItems = illusts
        totalCount = detail.series_work_count ?? allRawIllusts.length
      } else {
        const result = await novelSeries(seriesID, token)
        detail = result.novel_series_detail
        seriesAuthor =
          detail.user ??
          result.novel_series_first_novel?.user ??
          result.novels?.[0]?.user ??
          null

        rawCover = extractRawCoverCandidate(
          detail,
          result.novel_series_first_novel,
          result.novels?.[0]
        )

        const allRawNovels: PixivNovel[] = Array.isArray(result.novels) ? [...result.novels] : []
        let currentNextURL = result.next_url ?? null

        while (currentNextURL && allRawNovels.length < 500) {
          try {
            const nextResult = await nextNovelSeries(currentNextURL, token)
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

        const sTitle = detail.title || defaultTitle
        const novels: PixivNovel[] = allRawNovels.map((novel, idx) => ({
          ...novel,
          series: { id: seriesID, title: sTitle },
          episode_number: idx + 1,
        }))
        cacheSeriesNav(
          seriesID,
          "novel",
          sTitle,
          novels.map((it) => ({
            id: it.id,
            title: it.title,
            episodeNumber: it.episode_number,
          }))
        )
        mappedItems = novels
        totalCount = detail.content_count ?? allRawNovels.length
      }

      // 提取通用系列元信息
      const resolvedTitle = detail.title || defaultTitle
      setTitle(resolvedTitle)
      setCaption(detail.caption || "")
      const watched = Boolean(detail.watchlist_added ?? (detail as any).is_watched)
      setIsWatched(watched)

      setAuthor(seriesAuthor)
      authorRef.current = seriesAuthor

      const cover = upgradeHighQualityCoverUrl(rawCover)
      setCoverPreviewUrl(rawCover)
      setCoverUrl(cover)

      // 预热封面背景图，防止首次渲染时高度跳动
      const targetPreheatUrl = rawCover || cover
      const preheatDuration = loadSettings().backgroundPreheatDuration ?? 1000
      if (targetPreheatUrl && !cachedFileExists(targetPreheatUrl) && preheatDuration > 0) {
        await Promise.race([
          loadImage(targetPreheatUrl, 0),
          new Promise((resolve) => setTimeout(() => resolve(null), preheatDuration)),
        ])
      }

      rawMappedItemsRef.current = mappedItems
      setWorkCount(totalCount)

      const sorted = isAscendingRef.current ? mappedItems : [...mappedItems].reverse()
      return { items: sorted, nextURL: null }
    },
    filter: (items) =>
      kind === "manga"
        ? filterSeriesIllusts(items as PixivIllustration[])
        : filterSeriesNovels(items as PixivNovel[]),
    deps: [seriesID, isAscending, kind],
    onBatchPublished: (_, pendingItems) => {
      const batch = pendingItems.slice(0, currentBatchSize())
      const urls = kind === "manga"
        ? batch.map((it) => cardThumbUrlOf(it as PixivIllustration))
        : batch.map((it) => novelThumbUrlOf(it as PixivNovel))
      return prefetch(urls).cancel
    },
  })

  const pagedRef = useLatest(paged)
  const [seriesDownloading, setSeriesDownloading] = useState(false)

  async function handleExportSeries() {
    if (seriesDownloading) return
    void Haptics.transient()

    if (kind === "novel") {
      const confirmed = await Dialog.confirm({
        title: "下载整本小说",
        message: `确认下载《${title}》整本 EPUB 小说？`,
        confirmLabel: "开始下载",
        cancelLabel: "取消",
      })
      if (!confirmed) return

      setSeriesDownloading(true)
      try {
        const filePath = await downloadEntireNovelSeries(seriesID, title)
        if (filePath) {
          void Haptics.transient()
          await ShareSheet.present([filePath])
        }
      } finally {
        setSeriesDownloading(false)
      }
    } else {
      const choice = await Dialog.actionSheet({
        title: `下载整套漫画《${title}》`,
        actions: [
          { label: "CBZ 漫画包" },
          { label: "EPUB 电子书" },
        ],
      })
      if (choice !== 0 && choice !== 1) return

      const format: "cbz" | "epub" = choice === 0 ? "cbz" : "epub"
      setSeriesDownloading(true)
      try {
        const filePath = await downloadEntireMangaSeries(seriesID, title, format)
        if (filePath) {
          void Haptics.transient()
          await ShareSheet.present([filePath])
        }
      } finally {
        setSeriesDownloading(false)
      }
    }
  }

  async function toggleWatchlist() {
    if (watchLoading) return
    void Haptics.transient()
    setWatchLoading(true)
    const nextState = !isWatched
    try {
      if (nextState) {
        await session.call((token) => addWatchlistSeries(seriesID, kind, token))
        setIsWatched(true)
      } else {
        await session.call((token) => deleteWatchlistSeries(seriesID, kind, token))
        setIsWatched(false)
      }
    } catch {
      // 保持当前状态
    } finally {
      setWatchLoading(false)
    }
  }

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      const targetAsc = nextSettings.watchlistSortOrder === "asc"
      setIsAscending(targetAsc)
      pagedRef.current.reapplyFilter()
    })
  }, [kind])

  const handleRefresh = async () => {
    rawMappedItemsRef.current = []
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
              const shareUrl = kind === "novel"
                ? `https://www.pixiv.net/novel/series/${seriesID}`
                : (author?.id
                    ? `https://www.pixiv.net/user/${author.id}/series/${seriesID}`
                    : `https://www.pixiv.net/series/${seriesID}`)
              void ShareSheet.present([shareUrl])
            }}
          >
            <Image systemName="square.and.arrow.up" />
          </Button>,
          <Button
            disabled={seriesDownloading}
            action={handleExportSeries}
          >
            <Image
              systemName={seriesDownloading ? "arrow.down.circle.fill" : "square.and.arrow.down"}
              foregroundStyle={seriesDownloading ? "systemBlue" : undefined}
            />
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

        {/* 章节列表分流 */}
        {kind === "novel" ? (
          <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10, top: 4 }}>
            {paged.items.length === 0 && !paged.initialLoading ? (
              <EmptyView
                text={
                  paged.hasFilteredContent
                    ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
                    : "暂无可显示的小说章节"
                }
                systemImage={paged.hasFilteredContent ? "eye.slash" : "book"}
              />
            ) : (
              <>
                {(paged.items as PixivNovel[]).map((novel, index) => (
                  <NovelCard key={novel.id} novel={novel} priority={index} />
                ))}
                {paged.items.length > 0 ? (
                  <LoadMoreTrigger
                    anchor={paged.items[paged.items.length - 1].id}
                    onLoadMore={paged.loadMore}
                    hasMore={paged.hasMore}
                    isLoading={paged.loadingMore}
                  />
                ) : null}
              </>
            )}
          </LazyVStack>
        ) : (
          <VStack alignment="leading" spacing={8} padding={{ top: 4 }} frame={{ maxWidth: "infinity" }}>
            {paged.items.length === 0 && !paged.initialLoading ? (
              <EmptyView
                text={
                  paged.hasFilteredContent
                    ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                    : "暂无可显示的漫画章节"
                }
                systemImage={paged.hasFilteredContent ? "eye.slash" : "photo.on.rectangle"}
              />
            ) : (
              <IllustFlowFeed
                items={paged.items as PixivIllustration[]}
                onLoadMore={paged.loadMore}
                hasMore={paged.hasMore}
                isLoading={paged.loadingMore}
                cornerBadgeOf={(illust, index) => (
                  <ImageNumberBadge
                    number={
                      illust.episode_number ??
                      (isAscending
                        ? index + 1
                        : (workCount ?? rawMappedItemsRef.current.length) - index)
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
