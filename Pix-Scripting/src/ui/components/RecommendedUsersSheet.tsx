import {
  Button,
  GeometryReader,
  Image,
  LazyVStack,
  NavigationStack,
  ScrollView,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { nextUsers, recommendedUsers } from "../../api/pixiv"
import { session } from "../../api/session"
import { loadSettings, onSettingsChanged } from "../../store/settings"
import { destinationElement } from "../routes"
import {
  CONNECTION_CARD_HORIZONTAL_PADDING,
  CONNECTION_LIST_HORIZONTAL_PADDING,
  CONNECTION_PREVIEW_GAP,
  ConnectionRow,
  connectionPreviewImageURLs,
} from "./ConnectionRow"
import { EmptyView, ErrorView, LoadingView } from "./StatusViews"
import { LoadMoreTrigger } from "./RefreshableScrollView"
import { prefetch } from "../../image/imageLoader"
import { currentBatchSize, usePagedList } from "../hooks"
import type { PixivPage, PixivUserPreview } from "../../types"

type ConnectionPreview = PixivUserPreview & { id: number }

function normalizePage(page: PixivPage<PixivUserPreview>): PixivPage<ConnectionPreview> {
  const myID = session.userID
  const items = (page.items ?? [])
    .filter((item) => item.user.id !== myID)
    .map((item) => ({
      ...item,
      id: item.user.id,
    }))
  return { items, nextURL: page.nextURL }
}

export function RecommendedUsersSheet(props: {
  onClose: () => void
}) {
  const { onClose } = props
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)

  useEffect(() => {
    return onSettingsChanged(() => {
      setHideNovels(loadSettings().hideNovels)
    })
  }, [])

  const paged = usePagedList<ConnectionPreview>({
    first: async (token) => normalizePage(await recommendedUsers(token)),
    more: async (nextURL, token) => normalizePage(await nextUsers(nextURL, token)),
    deps: [],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).flatMap(connectionPreviewImageURLs)).cancel,
  })

  return (
    <NavigationStack navigationDestination={destinationElement}>
      <VStack
        navigationTitle=""
        navigationBarTitleDisplayMode="inline"
        presentationDetents={["medium", "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: (
            <Button action={onClose}>
              <Image systemName="xmark" />
            </Button>
          ),
          topBarTrailing: (
            <Button action={onClose}>
              <Image systemName="checkmark" />
            </Button>
          ),
        }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        {paged.initialLoading && paged.items.length === 0 ? (
          <LoadingView />
        ) : paged.error && paged.items.length === 0 ? (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        ) : paged.items.length === 0 ? (
          <EmptyView text="暂无推荐创作者" />
        ) : (
          <GeometryReader>
            {(proxy) => {
              const previewSide = Math.max(
                0,
                (proxy.size.width -
                  (CONNECTION_LIST_HORIZONTAL_PADDING + CONNECTION_CARD_HORIZONTAL_PADDING) * 2 -
                  CONNECTION_PREVIEW_GAP * 2) /
                  3
              )
              return (
                <ScrollView
                  frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                  presentationContentInteraction="scrolls"
                >
                  <LazyVStack
                    spacing={10}
                    padding={{ horizontal: CONNECTION_LIST_HORIZONTAL_PADDING, top: 12, bottom: 24 }}
                    frame={{ maxWidth: "infinity" }}
                  >
                    {paged.items.map((item) => (
                      <ConnectionRow
                        key={`recommended-${item.user.id}`}
                        preview={item}
                        showFollowControl={item.user.id !== session.userID}
                        previewSide={previewSide}
                        hideNovels={hideNovels}
                      />
                    ))}
                    <LoadMoreTrigger
                      anchor={paged.items[paged.items.length - 1].user.id}
                      onLoadMore={paged.loadMore}
                      hasMore={paged.hasMore}
                      isLoading={paged.loadingMore}
                    />
                  </LazyVStack>
                </ScrollView>
              )
            }}
          </GeometryReader>
        )}
      </VStack>
    </NavigationStack>
  )
}
