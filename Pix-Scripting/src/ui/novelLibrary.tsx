import {
  Button,
  Image,
  LazyVStack,
  Text,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import { nextNovelMarkers, novelMarkers } from "../api/pixiv"
import { novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { isNovelContentVisible } from "../store/contentFilter"
import { onNovelMarkerChanged } from "../store/bookmarkSync"
import { useLatest, usePagedList, currentBatchSize, useExperimentalAmbientPalette } from "./hooks"
import { destinationElement } from "./routes"
import {
  DockActionBar,
  useRegisterBottomAccessory,
  type DockActionItem,
} from "./bottomAccessory"
import type { PixivNovelMarker } from "../types"

declare const Haptics: any
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
  const [isAscending, setIsAscending] = useState(false)
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"

  useEffect(() => {
    return onSettingsChanged(() => {
      setPageLayout(loadSettings().pageLayout)
    })
  }, [])

  const sortedItems = useMemo(() => {
    if (!isAscending) return paged.items
    return [...paged.items].reverse()
  }, [paged.items, isAscending])

  const novelBookmarkAccessory = useMemo(() => {
    const items: DockActionItem[] = [
      {
        key: "title",
        label: "小说书签",
        icon: "book.pages.fill",
        color: "#EE2F49",
        action: () => {
          try {
            void Haptics.transient()
          } catch {}
        },
      },
      {
        key: "sort",
        label: isAscending ? "正序" : "倒序",
        icon: isAscending ? "arrow.up" : "arrow.down",
        color: "#3172EB",
        action: () => {
          try {
            void Haptics.transient()
          } catch {}
          setIsAscending((v) => !v)
        },
      },
    ]
    return <DockActionBar items={items} />
  }, [isAscending])

  useRegisterBottomAccessory(
    "novelBookmarks",
    novelBookmarkAccessory,
    isAppleMusic
  )

  const firstNovelUrl = sortedItems[0] ? novelThumbUrlOf(sortedItems[0].novel) : null
  const { ambientBackground } = useExperimentalAmbientPalette(firstNovelUrl)
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
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        principal: (
          <Text font="title2" fontWeight="bold">
            小说书签
          </Text>
        ),
        topBarTrailing: !isAppleMusic
          ? [
              <Button
                key="sort-btn"
                action={() => {
                  try {
                    void Haptics.transient()
                  } catch {}
                  setIsAscending((v) => !v)
                }}
              >
                <Image systemName={isAscending ? "arrow.up" : "arrow.down"} />
              </Button>,
            ]
          : undefined,
      }}
      background={ambientBackground}
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
          {sortedItems.map((item, index) => (
            <NovelCard
              key={item.novel.id}
              novel={item.novel}
              priority={index}
              markerPage={item.novel_marker.page}
              showEpisodeNumber={false}
            />
          ))}
          <LoadMoreTrigger
            anchor={sortedItems[sortedItems.length - 1]?.novel.id ?? 0}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        </LazyVStack>
      )}
    </RefreshableScrollView>
  )
}
