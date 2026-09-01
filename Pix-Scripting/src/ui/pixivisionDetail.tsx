import {
  Button,
  Device,
  FlowLayout,
  HStack,
  Image,
  LazyVStack,
  NavigationLink,
  ScrollView,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import { illustrationDetail, pixivisionDetail } from "../api/pixiv"
import { session } from "../api/session"
import { cacheIllust, getCachedIllust } from "../store/illustCache"
import { renderDestination } from "./routes"
import { useAsyncGuard } from "./hooks"
import type { PixivIllustration, PixivisionArtwork, PixivisionDetail } from "../types"
import {
  ErrorView,
  ExpandableIntroduction,
  formatDate,
  IllustCard,
  LoadingView,
  PixivisionCard,
  TagChip,
} from "./components"

const FLOW_HORIZONTAL_PADDING = 12

export function PixivisionDetailView(props: { articleID: number }) {
  const { articleID } = props
  const [detail, setDetail] = useState<PixivisionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hydratedMap, setHydratedMap] = useState<Record<number, PixivIllustration>>({})
  const guard = useAsyncGuard()
  const hydratingSetRef = useRef<Set<number>>(new Set())

  const handleShare = useCallback(async () => {
    await ShareSheet.present([`https://www.pixivision.net/zh/a/${articleID}`])
  }, [articleID])

  const hydrateArtwork = useCallback(async (id: number) => {
    if (hydratingSetRef.current.has(id)) return
    const cached = getCachedIllust(id)
    if (cached) {
      setHydratedMap((prev) => (prev[id] ? prev : { ...prev, [id]: cached }))
      return
    }
    hydratingSetRef.current.add(id)
    try {
      const full = await session.call((token) => illustrationDetail(id, token))
      if (full) {
        cacheIllust(full)
        setHydratedMap((prev) => ({ ...prev, [id]: full }))
      }
    } catch {
      // 容错：接口失败时保持骨架卡片展示
    } finally {
      hydratingSetRef.current.delete(id)
    }
  }, [])

  const hydrateAllArtworks = useCallback(async (artworks: PixivisionArtwork[]) => {
    const idsToFetch = artworks
      .map((a) => a.id)
      .filter((id) => !getCachedIllust(id))

    if (idsToFetch.length === 0) return

    await Promise.allSettled(
      idsToFetch.map(async (id) => {
        if (hydratingSetRef.current.has(id)) return
        hydratingSetRef.current.add(id)
        try {
          const full = await session.call((token) => illustrationDetail(id, token))
          if (full) {
            cacheIllust(full)
            setHydratedMap((prev) => ({ ...prev, [id]: full }))
          }
        } catch {
        } finally {
          hydratingSetRef.current.delete(id)
        }
      })
    )
  }, [])

  async function load() {
    const g = guard()
    setLoading(true)
    setError(null)
    try {
      const value = await pixivisionDetail(articleID)
      if (!g.isCurrent()) return
      setDetail(value)

      // 1. 预先填充已有本地缓存的作品（使用真实原始分辨率）
      const initialMap: Record<number, PixivIllustration> = {}
      for (const item of value.artworks) {
        const cached = getCachedIllust(item.id)
        if (cached) initialMap[item.id] = cached
      }
      if (Object.keys(initialMap).length > 0) {
        setHydratedMap(initialMap)
      }

      // 2. 异步并发拉取所有作品的原始官方详情（获取真实原始分辨率）
      void hydrateAllArtworks(value.artworks)
    } catch (err: any) {
      if (g.isCurrent()) setError(err?.message ?? "加载失败")
    } finally {
      if (g.isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleID])

  if (loading) {
    return (
      <ScrollView navigationTitle="特辑详情" navigationBarTitleDisplayMode="inline">
        <LoadingView />
      </ScrollView>
    )
  }

  if (error || !detail) {
    return (
      <ScrollView navigationTitle="特辑详情" navigationBarTitleDisplayMode="inline">
        <ErrorView message={error ?? "特辑不存在或已下架"} onRetry={load} />
      </ScrollView>
    )
  }

  return (
    <ScrollView
      navigationTitle={detail.title}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarTrailing: (
          <Button key="share" action={handleShare}>
            <Image systemName="square.and.arrow.up" />
          </Button>
        ),
      }}
    >
      <VStack
        alignment="leading"
        spacing={14}
        padding={{ horizontal: FLOW_HORIZONTAL_PADDING, top: 12, bottom: 32 }}
      >
        {/* 1. 头部信息 */}
        <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Text
              font="subheadline"
              fontWeight="semibold"
              foregroundStyle="#0096FA"
            >
              {detail.category || "特辑"}
            </Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">
              {formatPixivisionDate(detail.date)}
            </Text>
          </HStack>

          <Text
            font="title2"
            fontWeight="bold"
            multilineTextAlignment="leading"
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {detail.title}
          </Text>
        </VStack>

        {/* 2. 简介（复用图片详情页 ExpandableIntroduction） */}
        {detail.lead ? (
          <ExpandableIntroduction
            title="编辑导语"
            caption={detail.lead}
            routeDestination={renderDestination}
          />
        ) : null}

        {detail.description && detail.description !== detail.lead ? (
          <ExpandableIntroduction
            title="简介"
            caption={detail.description}
            routeDestination={renderDestination}
          />
        ) : null}

        {/* 3. 标签（复用图片详情页 FlowLayout 流式排版） */}
        {Array.isArray(detail.tags) && detail.tags.length > 0 ? (
          <VStack alignment="leading" spacing={6}>
            <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
              标签
            </Text>
            <FlowLayout spacing={6}>
              {detail.tags.map((tag) => (
                <TagChip
                  key={tag.name}
                  name={tag.name}
                  tagName={tag.name}
                  value={`pixivision-tag:${encodeURIComponent(tag.name)}`}
                  compact
                />
              ))}
            </FlowLayout>
          </VStack>
        ) : null}

        {/* 4. 正文插画列表 */}
        {detail.artworks.length > 0 ? (
          <VStack alignment="leading" spacing={8} padding={{ top: 4 }}>
            {detail.artworks.map((artwork, index) => {
              const hydrated = hydratedMap[artwork.id]
              const illust = hydrated ?? buildArtworkSkeletonIllust(artwork)
              return (
                <VStack
                  key={artwork.id}
                  alignment="leading"
                  spacing={6}
                  frame={{ maxWidth: "infinity" }}
                >
                  <IllustCard
                    hero={true}
                    illust={illust}
                    priority={index}
                    onAppear={() => {
                      if (!hydrated) {
                        void hydrateArtwork(artwork.id)
                      }
                    }}
                  />
                  {artwork.comment ? (
                    <Text
                      font="caption"
                      foregroundStyle="secondaryLabel"
                      padding={{ horizontal: 6 }}
                      lineLimit={3}
                      multilineTextAlignment="leading"
                    >
                      {artwork.comment}
                    </Text>
                  ) : null}
                </VStack>
              )
            })}
          </VStack>
        ) : null}

        {/* 5. 相关特辑推荐 */}
        {detail.embeddedArticles && detail.embeddedArticles.length > 0 ? (
          <VStack alignment="leading" spacing={12} padding={{ top: 16 }}>
            <HStack spacing={6} alignment="center">
              <Image
                systemName="sparkles.rectangle.stack"
                font="headline"
                foregroundStyle="#0096FA"
              />
              <Text font="headline" fontWeight="bold">
                相关特辑
              </Text>
            </HStack>
            <LazyVStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
              {detail.embeddedArticles.map((article) => (
                <PixivisionCard key={article.id} article={article} />
              ))}
            </LazyVStack>
          </VStack>
        ) : null}
      </VStack>
    </ScrollView>
  )
}

function buildArtworkSkeletonIllust(artwork: PixivisionArtwork): PixivIllustration {
  return {
    id: artwork.id,
    title: artwork.title,
    type: "illust",
    image_urls: {
      square_medium: artwork.imageURL,
      medium: artwork.imageURL,
      large: artwork.imageURL,
    },
    caption: artwork.comment ?? "",
    user: {
      id: artwork.authorID ?? 0,
      name: artwork.authorName ?? "",
      account: "",
      profile_image_urls: {
        medium: "",
      },
      is_followed: false,
    },
    tags: [],
    create_date: "",
    page_count: 1,
    width: 0,
    height: 0,
    x_restrict: 0,
    series: null,
    meta_single_page: {},
    meta_pages: [],
    total_view: 0,
    total_bookmarks: 0,
    is_bookmarked: false,
    is_muted: false,
    total_comments: 0,
    illust_ai_type: 0,
    comment_access_control: 0,
  }
}

function formatPixivisionDate(value: string): string {
  const parts = value.split("-")
  if (parts.length !== 3) return formatDate(value)
  return `${parts[0]}.${parts[1]}.${parts[2]}`
}
