import {
  Button,
  HStack,
  Image,
  LazyVStack,
  NavigationLink,
  ScrollView,
  Text,
  useEffect,
  useMemo,
  useState,
  VStack,
  ZStack,
} from "scripting"
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

function seriesIllust(item: PixivIllustrationSeriesItem): PixivIllustration {
  return {
    id: item.id,
    title: item.title,
    type: item.illust_type === "ugoira" ? "ugoira" : item.illust_type === "manga" ? "manga" : "illust",
    image_urls: item.image_urls ?? {},
    caption: item.caption ?? "",
    user: item.user ?? { id: 0, name: "", account: "" },
    tags: item.tags ?? [],
    create_date: item.create_date,
    page_count: item.page_count,
    width: item.width,
    height: item.height,
    x_restrict: item.x_restrict ?? 0,
    meta_single_page: item.meta_single_page,
    meta_pages: item.meta_pages ?? [],
    total_view: item.total_view ?? 0,
    total_bookmarks: item.total_bookmarks ?? 0,
    is_bookmarked: item.is_bookmarked ?? false,
    is_muted: item.is_muted ?? false,
    illust_ai_type: item.illust_ai_type ?? 0,
    total_comments: item.total_comments ?? 0,
    comment_access_control: item.comment_access_control ?? 0,
  }
}

function filterSeriesIllusts(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterSeriesNovels(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isR18ContentVisible(item.x_restrict, settings.showR18, settings.showR18G) &&
    (settings.showAI || item.novel_ai_type !== 2)
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

  const collapsedText = useMemo(() => {
    if (!exceedsFiveLines) return plainText
    return lines.slice(0, 5).join("\n")
  }, [lines, exceedsFiveLines, plainText])

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
      {expanded || !exceedsFiveLines ? (
        <LinkedDescription
          html={props.caption}
          routeDestination={props.routeDestination}
          nativePlainText
        />
      ) : (
        <Text
          font="footnote"
          multilineTextAlignment="leading"
          lineLimit={5}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {collapsedText}
        </Text>
      )}

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
  const [title, setTitle] = useState("系列")
  const [caption, setCaption] = useState("")
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [author, setAuthor] = useState<PixivUser | null>(null)
  const [workCount, setWorkCount] = useState<number | null>(null)
  const [isWatched, setIsWatched] = useState(false)
  const [watchLoading, setWatchLoading] = useState(false)
  const [isAscending, setIsAscending] = useState(true)

  const [novels, setNovels] = useState<PixivNovel[]>([])
  const [items, setItems] = useState<PixivIllustration[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nextURL, setNextURL] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      if (props.kind === "manga") {
        const result = await session.call((token) => illustrationSeries(props.seriesID, token))
        const detail = result.illust_series_detail
        setTitle(detail.title || "漫画系列")
        setCaption(detail.caption || "")
        setWorkCount(detail.series_work_count ?? result.illusts.length)
        setIsWatched(Boolean(detail.watchlist_added ?? (detail as any).is_watched))

        const cover = extractCoverUrl(
          detail.cover_image_urls ?? detail.url,
          result.illust_series_first_illust?.image_urls,
          result.illusts[0]?.image_urls
        )
        setCoverUrl(cover)

        const seriesAuthor =
          detail.user ??
          result.illust_series_first_illust?.user ??
          result.illusts[0]?.user ??
          null
        setAuthor(seriesAuthor)

        setNovels([])
        setNextURL(result.next_url ?? null)
        setItems(filterSeriesIllusts(result.illusts.map(seriesIllust)))
      } else {
        const result = await session.call((token) => novelSeries(props.seriesID, token))
        const detail = result.novel_series_detail
        setTitle(detail.title || "小说系列")
        setCaption(detail.caption || "")
        setWorkCount(detail.content_count ?? result.novels.length)
        setIsWatched(Boolean(detail.watchlist_added ?? (detail as any).is_watched))

        const cover = extractCoverUrl(
          detail.cover_image_urls ?? detail.url,
          result.novel_series_first_novel?.image_urls,
          result.novels[0]?.image_urls
        )
        setCoverUrl(cover)

        const seriesAuthor =
          detail.user ??
          result.novel_series_first_novel?.user ??
          result.novels[0]?.user ??
          null
        setAuthor(seriesAuthor)

        setNovels(filterSeriesNovels(result.novels))
        setNextURL(result.next_url ?? null)
        setItems([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "系列加载失败")
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!nextURL || loadingMore) return
    setLoadingMore(true)
    try {
      if (props.kind === "novel") {
        const result = await session.call((token) => nextNovelSeries(nextURL, token))
        const filtered = filterSeriesNovels(result.novels)
        setNovels((current) => {
          const seen = new Set(current.map((novel) => novel.id))
          return [...current, ...filtered.filter((novel) => !seen.has(novel.id))]
        })
        setNextURL(result.next_url ?? null)
      } else {
        const result = await session.call((token) => nextIllustrationSeries(nextURL, token))
        const filtered = filterSeriesIllusts(result.illusts.map(seriesIllust))
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id))
          return [...current, ...filtered.filter((item) => !seen.has(item.id))]
        })
        setNextURL(result.next_url ?? null)
      }
    } catch {
      // 保留已加载章节，下一次滚动仍可重试
    } finally {
      setLoadingMore(false)
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
    return onSettingsChanged(() => {
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

  const displayNovels = isAscending ? novels : [...novels].reverse()
  const displayItems = isAscending ? items : [...items].reverse()

  return (
    <RefreshableScrollView
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      ignoresSafeArea={{ edges: "top" }}
      refreshable={load}
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
              setIsAscending((prev) => !prev)
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
        {/* 沉浸式顶部背景图（同用户主页实现） */}
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
        </ZStack>

        {/* 系列信息 */}
        <VStack
          alignment="center"
          spacing={6}
          padding={{ top: 14, horizontal: 16, bottom: 8 }}
          frame={{ maxWidth: "infinity" }}
        >
          {/* 标题居中显示 */}
          <Text
            font="title3"
            fontWeight="bold"
            multilineTextAlignment="center"
            frame={{ maxWidth: "infinity", alignment: "center" }}
          >
            {title}
          </Text>

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
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10, top: 4 }}>
          {props.kind === "novel" ? (
            <>
              {displayNovels.length === 0 ? (
                <EmptyView
                  text="暂无可显示的小说章节"
                  systemImage="book"
                />
              ) : (
                <>
                  {displayNovels.map((novel, index) => (
                    <NovelCard key={novel.id} novel={novel} priority={index} />
                  ))}
                  <LoadMoreTrigger
                    anchor={novels[novels.length - 1].id}
                    onLoadMore={loadMore}
                    hasMore={nextURL != null}
                    isLoading={loadingMore}
                  />
                </>
              )}
            </>
          ) : (
            <IllustFlowFeed
              items={displayItems}
              onLoadMore={loadMore}
              hasMore={nextURL != null}
              isLoading={loadingMore}
              cornerBadgeOf={(_, index) => (
                <ImageNumberBadge
                  number={isAscending ? index + 1 : items.length - index}
                />
              )}
            />
          )}
        </LazyVStack>
      </VStack>
    </RefreshableScrollView>
  )
}
