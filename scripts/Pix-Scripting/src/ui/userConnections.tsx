import {
  GeometryReader,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  useEffect,
  useState,
} from "scripting"
import {
  myPixivUsers,
  nextUsers,
  userConnections,
  type Visibility,
} from "../api/pixiv"
import { session } from "../api/session"
import { loadSettings, onSettingsChanged } from "../store/settings"
import type { PixivUserPreview } from "../types"
import {
  ConnectionRow,
  connectionPreviewImageURLs,
  CONNECTION_CARD_HORIZONTAL_PADDING,
  CONNECTION_LIST_HORIZONTAL_PADDING,
  CONNECTION_PREVIEW_GAP,
  EmptyView,
  ErrorView,
  LoadMoreTrigger,
  LoadingView,
  RefreshableScrollView,
} from "./components"
import { prefetch } from "../image/imageLoader"
import { currentBatchSize, usePagedList } from "./hooks"

export type ConnectionRouteKind = "following" | "follower" | "mypixiv"
type ConnectionVisibility = Extract<Visibility, "public" | "private">

export type ConnectionPreview = PixivUserPreview & { id: number }

const TITLES: Record<ConnectionRouteKind, string> = {
  following: "我的关注",
  follower: "我的粉丝",
  mypixiv: "我的好友",
}

export function UserConnectionsView(props: {
  kind: ConnectionRouteKind
  userID?: number
  title?: string
  showVisibilityPicker?: boolean
}) {
  const userID = props.userID ?? session.userID
  const title =
    props.title ??
    (props.userID == null
      ? TITLES[props.kind]
      : props.kind === "following"
        ? "关注"
        : props.kind === "follower"
          ? "粉丝"
          : "好友")
  const [restrict, setRestrict] = useState<ConnectionVisibility>("public")
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const showVisibilityPicker =
    props.showVisibilityPicker ?? (props.kind === "following" && props.userID == null)

  useEffect(() => {
    return onSettingsChanged(() => {
      setHideNovels(loadSettings().hideNovels)
    })
  }, [])

  const paged = usePagedList<ConnectionPreview>({
    first: async (token) =>
      normalizePage(await loadConnections(userID, props.kind, restrict, token)),
    more: async (nextURL, token) => normalizePage(await nextUsers(nextURL, token)),
    deps: [userID, props.kind, restrict],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).flatMap(connectionPreviewImageURLs)).cancel,
  })

  return (
    <GeometryReader>
      {(proxy) => {
        const previewSide = Math.max(
          0,
          (proxy.size.width -
            (CONNECTION_LIST_HORIZONTAL_PADDING + CONNECTION_CARD_HORIZONTAL_PADDING) * 2 -
            CONNECTION_PREVIEW_GAP * 2) / 3
        )
        return (
          <RefreshableScrollView
            navigationTitle={title}
            navigationBarTitleDisplayMode="inline"
            toolbar={
              showVisibilityPicker
                ? connectionToolbar({ restrict, onRestrictChange: setRestrict })
                : undefined
            }
            refreshable={paged.refresh}
          >
            {paged.initialLoading ? (
              <LoadingView />
            ) : paged.error && paged.items.length === 0 ? (
              <ErrorView message={paged.error} onRetry={paged.refresh} />
            ) : paged.items.length === 0 ? (
              <EmptyView
                text={
                  props.kind === "following"
                    ? "暂未关注用户"
                    : props.kind === "follower"
                      ? "暂时没有粉丝"
                      : "暂时没有好友"
                }
                systemImage="person.2"
              />
            ) : (
              <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
                {paged.items.map((preview) => (
                  <ConnectionRow
                    key={preview.user.id}
                    preview={preview}
                    showFollowControl={preview.user.id !== session.userID}
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
            )}
          </RefreshableScrollView>
        )
      }}
    </GeometryReader>
  )
}

async function loadConnections(
  userID: number | null,
  kind: ConnectionRouteKind,
  restrict: ConnectionVisibility,
  accessToken: string
) {
  if (userID == null) return { items: [], nextURL: null }
  if (kind === "mypixiv") return myPixivUsers(userID, accessToken)
  return userConnections(userID, kind, restrict, accessToken)
}

function connectionToolbar(props: {
  restrict: ConnectionVisibility
  onRestrictChange: (restrict: ConnectionVisibility) => void
}) {
  return {
    topBarTrailing: [
      <Menu label={<Image systemName="ellipsis.circle" />}>
        <Picker
          title="关注范围"
          value={props.restrict}
          onChanged={(value: string) =>
            props.onRestrictChange(value as ConnectionVisibility)
          }
        >
          <Label tag="public" title="公开" systemImage="globe" />
          <Label tag="private" title="私密" systemImage="lock" />
        </Picker>
      </Menu>,
    ],
  }
}

export function normalizePage(page: {
  items: PixivUserPreview[]
  nextURL: string | null
}): { items: ConnectionPreview[]; nextURL: string | null } {
  return {
    items: page.items.map((preview) => ({ ...preview, id: preview.user.id })),
    nextURL: page.nextURL,
  }
}
