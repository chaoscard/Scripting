import {
  Button,
  Device,
  Group,
  HStack,
  Image,
  LazyVStack,
  NavigationLink,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useMemo,
  useState,
  VStack,
  ZStack,
} from "scripting"
import {
  isPixivisionBookmarked,
  loadPixivisionBookmarks,
  onPixivisionBookmarksChanged,
  preparePixivisionBookmarksStorage,
  removePixivisionBookmark,
  type PixivisionBookmarkItem,
} from "../store/pixivisionBookmarks"
import { CachedImage } from "./components/CachedImage"
import { EmptyView, RefreshableScrollView } from "./components"
import { useExperimentalAmbientPalette, useLayoutMetrics } from "./hooks"
import { recordPixivisionCoverUrl } from "../image/imageLoader"
import { loadSettings, onSettingsChanged } from "../store/settings"
import { LibraryView } from "./library"

declare const Haptics: any

const FLOW_HORIZONTAL_PADDING = 12
const DEFAULT_ARTICLE_RATIO = 1200 / 630

export function PixivisionBookmarksView() {
  return <LibraryView initialKind="pixivision" />
}

export function PixivisionBookmarksContent(props: {
  isAscending?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const [items, setItems] = useState<PixivisionBookmarkItem[]>(() => loadPixivisionBookmarks())
  const isAscending = props.isAscending ?? false

  useEffect(() => {
    void preparePixivisionBookmarksStorage().then(() => {
      setItems(loadPixivisionBookmarks())
    })
    return onPixivisionBookmarksChanged(() => {
      setItems(loadPixivisionBookmarks())
    })
  }, [])

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const timeA = a.bookmarkedAt ?? 0
      const timeB = b.bookmarkedAt ?? 0
      return isAscending ? timeA - timeB : timeB - timeA
    })
  }, [items, isAscending])

  const firstImageUrl = useMemo(() => {
    return sortedItems[0]?.thumbnailURL ?? null
  }, [sortedItems])

  useEffect(() => {
    props.onFirstImageUrlChange?.(firstImageUrl)
  }, [firstImageUrl, props.onFirstImageUrlChange])

  const handleRefresh = useCallback(async () => {
    await preparePixivisionBookmarksStorage()
    setItems(loadPixivisionBookmarks())
  }, [])

  return (
    <RefreshableScrollView refreshable={handleRefresh}>
      <VStack alignment="leading" spacing={12} padding={{ horizontal: FLOW_HORIZONTAL_PADDING, top: 8, bottom: 24 }}>
        {sortedItems.length === 0 ? (
          <EmptyView
            text="暂无收藏的特辑"
            systemImage="rectangle.stack"
          />
        ) : (
          <LazyVStack alignment="leading" spacing={14} frame={{ maxWidth: "infinity" }}>
            {sortedItems.map((item, index) => (
              <PixivisionBookmarkCard
                key={item.id}
                item={item}
                priority={index}
                onRemove={() => {
                  try {
                    void Haptics.transient()
                  } catch {}
                  removePixivisionBookmark(item.id)
                }}
              />
            ))}
          </LazyVStack>
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function PixivisionBookmarkCard(props: {
  item: PixivisionBookmarkItem
  priority?: number
  onRemove: () => void
}) {
  const { item, priority, onRemove } = props
  const { width: screenWidth } = useLayoutMetrics()
  const heroCardWidth = Math.floor(screenWidth - FLOW_HORIZONTAL_PADDING * 2)

  if (item.id && item.thumbnailURL) {
    recordPixivisionCoverUrl(item.id, item.thumbnailURL)
  }

  const imageRatio = DEFAULT_ARTICLE_RATIO
  const cardFrame = { width: heroCardWidth }
  const imageFrame = {
    width: heroCardWidth,
    height: Math.round(heroCardWidth / imageRatio),
  }

  return (
    <ZStack alignment="topTrailing" frame={cardFrame}>
      <VStack
        alignment="leading"
        spacing={6}
        frame={cardFrame}
        padding={6}
        glassEffect={{ type: "rect", cornerRadius: 16 }}
        shadow={{ color: "#0000000F", radius: 20, y: 10 }}
        contextMenu={{
          menuItems: (
            <Group>
              <Button
                title="取消收藏"
                systemImage="heart.slash"
                role="destructive"
                action={onRemove}
              />
            </Group>
          ),
        }}
      >
        {/* 封面图片 */}
        <NavigationLink value={`pixivision:${item.id}`} frame={cardFrame}>
          <ZStack
            alignment="topLeading"
            frame={imageFrame}
            clipShape={{ type: "rect", cornerRadius: 12 }}
            clipped={true}
          >
            <CachedImage
              url={item.thumbnailURL ?? null}
              aspectRatioValue={imageRatio}
              centerCropAspect={imageRatio}
              cropAnchor="top"
              contentMode="fill"
              cornerRadius={12}
              frame={imageFrame}
              priority={priority}
            />
          </ZStack>
        </NavigationLink>

        {/* 标题与类别信息 */}
        <VStack
          alignment="leading"
          spacing={6}
          padding={{ horizontal: 8, top: 4, bottom: 6 }}
          frame={{ width: heroCardWidth - 12 }}
        >
          <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
            {item.categoryLabel || item.category ? (
              <HStack
                spacing={4}
                padding={{ horizontal: 8, vertical: 3 }}
                glassEffect="capsule"
                contentShape="capsule"
              >
                <Text font="caption2" fontWeight="semibold" foregroundStyle="#0096FA">
                  {item.categoryLabel || item.category || ""}
                </Text>
              </HStack>
            ) : null}
            {item.publishedAt ? (
              <Text font="caption" foregroundStyle="secondaryLabel">
                {item.publishedAt}
              </Text>
            ) : null}
            <Spacer />
            <Button buttonStyle="plain" action={onRemove}>
              <Image
                systemName="heart.fill"
                font="subheadline"
                foregroundStyle="#FF2D55"
              />
            </Button>
          </HStack>

          <NavigationLink value={`pixivision:${item.id}`} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text
              font="headline"
              fontWeight="bold"
              foregroundStyle="label"
              lineLimit={2}
            >
              {item.title}
            </Text>
          </NavigationLink>
        </VStack>
      </VStack>
    </ZStack>
  )
}
