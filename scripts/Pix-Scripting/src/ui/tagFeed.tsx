import {
  useEffect,
  VStack,
} from "scripting"
import {
  nextIllustrations,
  searchIllustrations,
} from "../api/pixiv"
import { cardThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { isIllustContentVisible } from "../store/contentFilter"
import { useLatest, usePagedList, currentBatchSize } from "./hooks"
import type { PixivIllustration } from "../types"
import {
  EmptyView,
  ErrorView,
  LoadingView,
  IllustFlowFeed,
  RefreshableScrollView,
} from "./components"

export function TagFeedView(props: { tag: string }) {
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
    filter: filterTagItems,
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
                : "该标签下暂无作品"
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

// 标签流过滤：屏蔽标签与用户黑名单在翻页时生效。
function filterTagItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}
