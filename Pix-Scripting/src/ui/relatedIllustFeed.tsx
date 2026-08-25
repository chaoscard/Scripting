import { useEffect, VStack } from "scripting"
import { nextIllustrations, relatedIllustrations } from "../api/pixiv"
import { cardThumbUrlOf, prefetch } from "../image/imageLoader"
import { loadSettings, onSettingsChanged } from "../store/settings"
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
import { destinationElement } from "./routes"
import { getCachedIllust } from "../store/illustCache"

export function RelatedIllustFeedView(props: { illustID: number }) {
  const { illustID } = props
  const cached = getCachedIllust(illustID)
  const navTitle = cached?.title ? `相关作品 · ${cached.title}` : "相关作品"

  const paged = usePagedList<PixivIllustration>({
    first: (token) => relatedIllustrations(illustID, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => filterRelatedIllusts(items, illustID),
    deps: [illustID],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  return (
    <RefreshableScrollView
      navigationTitle={navTitle}
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
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
                : "暂无相关作品"
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

function filterRelatedIllusts(
  items: PixivIllustration[],
  targetID: number
): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter(
    (item) => item.id !== targetID && isIllustContentVisible(item, settings)
  )
}
