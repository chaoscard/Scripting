import {
  Button,
  Circle,
  GeometryReader,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  NavigationLink,
  Picker,
  Spacer,
  Text,
  useEffect,
  useState,
  VStack,
  ZStack,
} from "scripting"
import {
  followUser,
  myPixivUsers,
  nextUsers,
  unfollowUser,
  userConnections,
  type Visibility,
} from "../api/pixiv"
import { session } from "../api/session"
import type { PixivIllustration, PixivNovel, PixivUserPreview } from "../types"
import {
  AvatarImage,
  CachedImage,
  EmptyView,
  ErrorView,
  LoadMoreTrigger,
  LoadingView,
  RefreshableScrollView,
} from "./components"
import { novelThumbUrlOf, prefetch, thumbUrlOf } from "../image/imageLoader"
import { usePagedList, currentBatchSize, useUserFollow } from "./hooks"

export type ConnectionRouteKind = "following" | "follower" | "mypixiv"
type ConnectionVisibility = Extract<Visibility, "public" | "private">

type ConnectionPreview = PixivUserPreview & { id: number }

const CONNECTION_PREVIEW_GAP = 6
const NOVEL_PREVIEW_COVER_RATIO = 0.71
const CONNECTION_LIST_HORIZONTAL_PADDING = 10
const CONNECTION_CARD_HORIZONTAL_PADDING = 10

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
  const showVisibilityPicker =
    props.showVisibilityPicker ?? (props.kind === "following" && props.userID == null)
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

function normalizePage(page: {
  items: PixivUserPreview[]
  nextURL: string | null
}): { items: ConnectionPreview[]; nextURL: string | null } {
  return {
    items: page.items.map((preview) => ({ ...preview, id: preview.user.id })),
    nextURL: page.nextURL,
  }
}

function connectionPreviewImageURLs(preview: ConnectionPreview): (string | null)[] {
  return [
    ...preview.illusts.slice(0, 3).map(thumbUrlOf),
    ...(preview.novels ?? []).slice(0, 3).map(novelThumbUrlOf),
  ]
}

function ConnectionRow(props: {
  preview: PixivUserPreview
  showFollowControl: boolean
  previewSide: number
}) {
  const { preview } = props
  const [followed, setFollowed] = useUserFollow(preview.user.id, preview.user.is_followed ?? true)
  const [followBusy, setFollowBusy] = useState(false)
  const previewItems = [
    ...preview.illusts.map((illustration) => ({ kind: "illust" as const, item: illustration })),
    ...(preview.novels ?? []).map((novel) => ({ kind: "novel" as const, item: novel })),
  ].slice(0, 3)

  async function toggleFollow() {
    if (followBusy) return
    setFollowBusy(true)
    const nextFollowed = !followed
    setFollowed(nextFollowed)
    try {
      if (nextFollowed) {
        await session.call((token) => followUser(preview.user.id, "public", token))
      } else {
        await session.call((token) => unfollowUser(preview.user.id, token))
      }
    } catch {
      setFollowed(!nextFollowed)
    } finally {
      setFollowBusy(false)
    }
  }

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={10}
      glassEffect={{ type: "rect", cornerRadius: 8 }}
      glassEffectTransition="materialize"
      frame={{ maxWidth: "infinity" }}
    >
      <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
        <NavigationLink value={`user:${preview.user.id}`}>
          <HStack spacing={8}>
            <ZStack frame={{ width: 38, height: 38 }}>
              <Circle
                fill="rgba(255, 255, 255, 0.16)"
                glassEffect={true}
                frame={{ width: 38, height: 38 }}
              />
              <AvatarImage url={preview.user.profile_image_urls?.medium ?? null} size={32} />
            </ZStack>
            <VStack alignment="leading" spacing={2}>
              <Text font="body" fontWeight="semibold" lineLimit={1}>{preview.user.name}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                @{preview.user.account}
              </Text>
            </VStack>
          </HStack>
        </NavigationLink>
        <Spacer />
        {props.showFollowControl ? (
          <Button
            buttonStyle="glass"
            disabled={followBusy}
            frame={{ width: 38, height: 38 }}
            clipShape={{ type: "rect", cornerRadius: 19 }}
            contentShape="rect"
            action={toggleFollow}
          >
            <Image
              systemName={followed ? "person.fill.checkmark" : "person.badge.plus"}
              font="body"
              foregroundStyle={followed ? "secondaryLabel" : "#007AFF"}
              frame={{ width: 38, height: 38 }}
            />
          </Button>
        ) : null}
      </HStack>
      {previewItems.length > 0 ? (
        <HStack spacing={CONNECTION_PREVIEW_GAP}>
          {previewItems.map((item) => (
            item.kind === "illust" ? (
              <ConnectionIllustThumbnail
                key={`illust:${item.item.id}`}
                illustration={item.item}
                side={props.previewSide}
              />
            ) : (
              <ConnectionNovelThumbnail
                key={`novel:${item.item.id}`}
                novel={item.item}
                side={props.previewSide}
              />
            )
          ))}
        </HStack>
      ) : null}
    </VStack>
  )
}

function ConnectionIllustThumbnail(props: {
  illustration: PixivIllustration
  side: number
}) {
  return (
    <NavigationLink
      value={`illust:${props.illustration.id}`}
      frame={{ width: props.side, height: props.side }}
    >
      <CachedImage
        url={thumbUrlOf(props.illustration)}
        aspectRatioValue={1}
        useIntrinsicAspectRatio={false}
        cornerRadius={6}
        frame={{ width: props.side, height: props.side }}
      />
    </NavigationLink>
  )
}

function ConnectionNovelThumbnail(props: {
  novel: PixivNovel
  side: number
}) {
  const coverWidth = props.side * NOVEL_PREVIEW_COVER_RATIO

  return (
    <NavigationLink
      value={`novel:${props.novel.id}`}
      frame={{ width: props.side, height: props.side }}
    >
      <ZStack
        background="systemGray6"
        clipShape={{ type: "rect", cornerRadius: 6 }}
        frame={{ width: props.side, height: props.side }}
      >
        <ZStack
          alignment="bottom"
          clipShape={{ type: "rect", cornerRadius: 6 }}
          frame={{ width: coverWidth, height: props.side }}
        >
          <CachedImage
            url={novelThumbUrlOf(props.novel)}
            aspectRatioValue={NOVEL_PREVIEW_COVER_RATIO}
            useIntrinsicAspectRatio={false}
            contentMode="fill"
            cornerRadius={0}
            frame={{ width: coverWidth, height: props.side }}
          />
          <Text
            font="caption2"
            fontWeight="semibold"
            foregroundStyle="white"
            lineLimit={5}
            multilineTextAlignment="center"
            fixedSize={{ horizontal: false, vertical: false }}
            padding={{ horizontal: 5, vertical: 4 }}
            frame={{ width: coverWidth, alignment: "center" }}
            background="rgba(0, 0, 0, 0.58)"
          >
            {props.novel.title}
          </Text>
        </ZStack>
      </ZStack>
    </NavigationLink>
  )
}
