import {
  HStack,
  LazyVStack,
  NavigationLink,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { illustrationSeries, nextIllustrationSeries, nextNovelSeries, novelSeries } from "../api/pixiv"
import { session } from "../api/session"
import {
  isIllustContentVisible,
  isR18ContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import type { PixivIllustration, PixivIllustrationSeriesItem, PixivNovel } from "../types"
import {
  EmptyView,
  ErrorView,
  ImageNumberBadge,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

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

export function SeriesView(props: { kind: SeriesKind; seriesID: number }) {
  const [title, setTitle] = useState("系列")
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
        setTitle(result.illust_series_detail.title)
        setNovels([])
        setNextURL(result.next_url ?? null)
        setItems(filterSeriesIllusts(result.illusts.map(seriesIllust)))
      } else {
        const result = await session.call((token) => novelSeries(props.seriesID, token))
        setTitle(result.novel_series_detail.title)
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
            return [
              ...current,
              ...filtered.filter((item) => !seen.has(item.id)),
            ]
          })
        setNextURL(result.next_url ?? null)
      }
    } catch {
      // 保留已加载章节，下一次滚动仍可重试
    } finally {
      setLoadingMore(false)
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


  return (
    <RefreshableScrollView
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      refreshable={load}
    >
      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorView message={error} onRetry={load} />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10, top: 8 }}>
          {props.kind === "novel" ? (
            <>
              {novels.length === 0 ? (
                <EmptyView
                  text="暂无可显示的小说章节"
                  systemImage="book"
                />
              ) : (
                <>
                  {novels.map((novel, index) => (
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
              items={items}
              onLoadMore={loadMore}
              hasMore={nextURL != null}
              isLoading={loadingMore}
              cornerBadgeOf={(_, index) => <ImageNumberBadge number={index + 1} />}
            />
          )}
        </LazyVStack>
      )}
    </RefreshableScrollView>
  )
}
