import {
  LazyVStack,
  useEffect,
} from "scripting"
import { nextNovelMarkers, novelMarkers } from "../api/pixiv"
import { novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { isNovelContentVisible } from "../store/contentFilter"
import { onNovelMarkerChanged } from "../store/bookmarkSync"
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

// Pixiv 小说书签（Marker）列表。它与小说收藏是不同资源：
// 服务端仅返回已保存小说 Marker 的条目，不支持公开/私密与标签筛选。
export function NovelLibraryView() {
  const paged = usePagedList<PixivNovelMarker>({
    first: (token) => novelMarkers(token),
    more: (nextURL, token) => nextNovelMarkers(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      return items.filter((item) =>
        isNovelContentVisible(item.novel, settings, undefined, {
          exemptRestrictions: settings.exemptFilterForPersonal,
        })
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

  useEffect(() => {
    return onNovelMarkerChanged(() => {
      pagedRef.current.refresh()
    })
  }, [])

  return (
    <RefreshableScrollView
      navigationTitle="小说书签"
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
      navigationDestination={destinationElement}
    >
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无小说书签" systemImage="book.pages" />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {paged.items.map((item, index) => (
            <NovelCard
              key={item.novel.id}
              novel={item.novel}
              priority={index}
              markerPage={item.novel_marker.page}
              showEpisodeNumber={false}
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
