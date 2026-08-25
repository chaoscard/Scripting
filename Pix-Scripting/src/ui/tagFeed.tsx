import {
  LazyVStack,
  useEffect,
  VStack,
} from "scripting"
import {
  nextIllustrations,
  nextNovels,
  searchIllustrations,
  searchNovels,
} from "../api/pixiv"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { isIllustContentVisible, isNovelContentVisible } from "../store/contentFilter"
import { useLatest, usePagedList, currentBatchSize } from "./hooks"
import type { PixivIllustration, PixivNovel } from "../types"
import {
  EmptyView,
  ErrorView,
  LoadingView,
  IllustFlowFeed,
  LoadMoreTrigger,
  NovelCard,
  RefreshableScrollView,
} from "./components"

export function TagFeedView(props: { tag: string; kind?: "illust" | "novel" }) {
  const { tag, kind = "illust" } = props

  if (kind === "novel") {
    return <TagNovelFeed tag={tag} />
  }

  return <TagIllustFeed tag={tag} />
}

function TagIllustFeed(props: { tag: string }) {
  const { tag } = props

  const paged = usePagedList<PixivIllustration>({
    first: (token) =>
      searchIllustrations(
        {
          word: tag,
          target: "exact_match_for_tags",
          sort: "date_desc",
        },
        token
      ),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterTagIllustItems,
    deps: [tag],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel
  })

  // 设置变更（屏蔽标签/用户）后立即重新加载过滤
  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  return (
    <RefreshableScrollView
      navigationTitle={`#${tag}`}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
      <VStack alignment="leading" spacing={10} padding={{ top: 4 }}>
        {paged.initialLoading ? (
          <LoadingView />
        ) : paged.error && paged.items.length === 0 ? (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        ) : paged.items.length === 0 ? (
          <EmptyView
            text={
              paged.hasFilteredContent
                ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                : "该标签下暂无插画作品"
            }
            systemImage={paged.hasFilteredContent ? "eye.slash" : undefined}
          />
        ) : (
          <IllustFlowFeed
            items={paged.items}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function TagNovelFeed(props: { tag: string }) {
  const { tag } = props

  const paged = usePagedList<PixivNovel>({
    first: (token) =>
      searchNovels(
        {
          word: tag,
          target: "exact_match_for_tags",
          sort: "date_desc",
        },
        token
      ),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: filterTagNovelItems,
    deps: [tag],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel
  })

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  return (
    <RefreshableScrollView
      navigationTitle={`#${tag}`}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
      <VStack alignment="leading" spacing={10} padding={{ top: 4 }}>
        {paged.initialLoading ? (
          <LoadingView />
        ) : paged.error && paged.items.length === 0 ? (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        ) : paged.items.length === 0 ? (
          <EmptyView
            text={
              paged.hasFilteredContent
                ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                : "该标签下暂无小说作品"
            }
            systemImage={paged.hasFilteredContent ? "eye.slash" : undefined}
          />
        ) : (
          <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
            {paged.items.map((novel, index) => (
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
          </LazyVStack>
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function filterTagIllustItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterTagNovelItems(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) => isNovelContentVisible(item, settings))
}
