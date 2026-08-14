import {
  HStack,
  NavigationLink,
  Text,
  VStack,
} from "scripting"
import {
  nextUsers,
  userConnections,
  type UserConnectionKind,
} from "../api/pixiv"
import { session } from "../api/session"
import type { PixivUserPreview } from "../types"
import {
  AuthorRow,
  CachedImage,
  EmptyView,
  ErrorView,
  LoadMoreTrigger,
  LoadingView,
  RefreshableScrollView,
} from "./components"
import { thumbUrlOf } from "../image/imageLoader"
import { usePagedList } from "./hooks"

export type ConnectionRouteKind = "following" | "follower"

type ConnectionPreview = PixivUserPreview & { id: number }

const TITLES: Record<ConnectionRouteKind, string> = {
  following: "我的关注",
  follower: "我的粉丝",
}

export function UserConnectionsView(props: {
  kind: ConnectionRouteKind
  userID?: number
  title?: string
}) {
  const userID = props.userID ?? session.userID
  const title =
    props.title ??
    (props.userID == null
      ? TITLES[props.kind]
      : props.kind === "following"
        ? "关注"
        : "粉丝")
  const paged = usePagedList<ConnectionPreview>({
    first: async (token) => normalizePage(await loadConnections(userID, props.kind, token)),
    more: async (nextURL, token) => normalizePage(await nextUsers(nextURL, token)),
    deps: [userID, props.kind],
  })

  return (
    <RefreshableScrollView
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView
          text={props.kind === "following" ? "暂未关注用户" : "暂时没有粉丝"}
          systemImage="person.2"
        />
      ) : (
        <VStack alignment="leading" spacing={8} padding={{ horizontal: 10, top: 6 }}>
          {paged.items.map((preview) => (
            <ConnectionRow key={preview.user.id} preview={preview} />
          ))}
          <LoadMoreTrigger
            anchor={paged.items[paged.items.length - 1].user.id}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        </VStack>
      )}
    </RefreshableScrollView>
  )
}

async function loadConnections(
  userID: number | null,
  kind: UserConnectionKind,
  accessToken: string
) {
  if (userID == null) return { items: [], nextURL: null }
  return userConnections(userID, kind, "public", accessToken)
}

function normalizePage(page: {
  items: PixivUserPreview[]
  nextURL: string | null
}): { items: ConnectionPreview[]; nextURL: string | null } {
  return {
    items: page.items.map((preview) => ({ ...preview, id: preview.user.id })),
    nextURL: page.nextURL,
  }
}

function ConnectionRow(props: { preview: PixivUserPreview }) {
  const { preview } = props
  return (
    <NavigationLink value={`user:${preview.user.id}`}>
      <VStack
        alignment="leading"
        spacing={8}
        padding={10}
        glassEffect={{ type: "rect", cornerRadius: 8 }}
        glassEffectTransition="materialize"
        frame={{ maxWidth: "infinity" }}
      >
        <AuthorRow user={preview.user} size={28} />
        {preview.illusts.length > 0 ? (
          <HStack spacing={6} padding={{ leading: 8 }}>
            {preview.illusts.slice(0, 3).map((illustration) => (
              <CachedImage
                key={illustration.id}
                url={thumbUrlOf(illustration)}
                aspectRatioValue={1}
                cornerRadius={6}
              />
            ))}
          </HStack>
        ) : null}
      </VStack>
    </NavigationLink>
  )
}
