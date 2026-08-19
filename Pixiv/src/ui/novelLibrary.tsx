import {
  LazyVStack,
  Text,
  useEffect,
  VStack,
} from "scripting"
import { nextNovelMarkers, novelMarkers } from "../api/pixiv"
import { novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  isNovelContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { useLatest, usePagedList, currentBatchSize } from "./hooks"
import { destinationElement } from "./routes"
import type { PixivNovelMarker } from "../types"
import {
  EmptyView,
  ErrorView,
  LoadingView,
  LoadMoreTrigger,
  NovelCard,
  RefreshableScrollView,
} from "./components"

// Pixiv 阅读书签（Marker）列表。它与小说收藏是不同资源：
// 服务端仅返回已保存阅读 Marker 的小说，不支持公开/私密与标签筛选。
export function NovelLibraryView() {
  const paged = usePagedList<PixivNovelMarker>({
    first: (token) => novelMarkers(token),
    more: (nextURL, token) => nextNovelMarkers(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      return items.filter((item) =>
        isNovelContentVisible(
          item.novel,
          settings,
          settings.libraryFilterExempt
        )
      )
    },
    deps: [],
    onBatchPublished: (_, pendingItems) =>
      prefetch(
        pendingItems.slice(0, currentBatchSize()).map((item) => novelThumbUrlOf(item.novel))
      ).cancel,
  })

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  return (
    <RefreshableScrollView
      navigationTitle="阅读书签"
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
      navigationDestination={destinationElement}
    >
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无阅读书签" systemImage="bookmark" />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {paged.items.map((item, index) => (
            <NovelCard
              key={item.novel.id}
              novel={item.novel}
              priority={index}
              markerPage={item.novel_marker.page}
            />
          ))}
          <LoadMoreTrigger
            anchor={paged.items[paged.items.length - 1].novel.id}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        </LazyVStack>
      )}
    </RefreshableScrollView>
  )
}
