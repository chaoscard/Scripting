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
import { fetchPublicWebIllustDetail, illustrationDetail, pixivisionDetail } from "../api/pixiv"
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
    if (cached && cached.width > 0 && cached.height > 0) {
      setHydratedMap((prev) => (prev[id] ? prev : { ...prev, [id]: cached }))
      return
    }
    hydratingSetRef.current.add(id)
    try {
      let full: PixivIllustration | null = null
      if (session.userID) {
        try {
          full = await session.call((token) => illustrationDetail(id, token))
        } catch {
          // 回退到公开 Web 接口
        }
      }
      if (!full) {
        full = await fetchPublicWebIllustDetail(id)
      }
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

  async function load() {
    const g = guard()
    setLoading(true)
    setError(null)
    try {
      const value = await pixivisionDetail(articleID)
      if (!g.isCurrent()) return

      // 1. 预先填充已有本地缓存的作品（使用真实原始分辨率，与 Hero 卡片保持一致）
      const initialMap: Record<number, PixivIllustration> = {}
      for (const item of value.artworks) {
        const cached = getCachedIllust(item.id)
        if (cached && cached.width > 0 && cached.height > 0) {
          initialMap[item.id] = cached
        }
      }

      // 2. 并发预取所有未缓存作品的真实物理宽高与大图元数据（确保首帧画出正确比例的框）
      const idsToFetch = value.artworks
        .map((a) => a.id)
        .filter((id) => !initialMap[id])

      if (idsToFetch.length > 0) {
        const results = await Promise.allSettled(
          idsToFetch.map(async (id) => {
            if (session.userID) {
              try {
                const full = await session.call((token) => illustrationDetail(id, token))
                if (full) return full
              } catch {
                // 回退到公开 Web 接口
              }
            }
            return fetchPublicWebIllustDetail(id)
          })
        )
        if (!g.isCurrent()) return

        for (let i = 0; i < idsToFetch.length; i++) {
          const res = results[i]
          if (res.status === "fulfilled" && res.value) {
            cacheIllust(res.value)
            initialMap[idsToFetch[i]] = res.value
          }
        }
      }

      setHydratedMap(initialMap)
      setDetail(value)
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
        padding={{ top: 12, bottom: 32 }}
      >
        {/* 1. 头部信息 */}
        <VStack
          alignment="leading"
          spacing={8}
          padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
          frame={{ maxWidth: "infinity" }}
        >
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
          <VStack padding={{ horizontal: FLOW_HORIZONTAL_PADDING }} frame={{ maxWidth: "infinity" }}>
            <ExpandableIntroduction
              title="编辑导语"
              caption={detail.lead}
              routeDestination={renderDestination}
            />
          </VStack>
        ) : null}

        {detail.description && detail.description !== detail.lead ? (
          <VStack padding={{ horizontal: FLOW_HORIZONTAL_PADDING }} frame={{ maxWidth: "infinity" }}>
            <ExpandableIntroduction
              title="简介"
              caption={detail.description}
              routeDestination={renderDestination}
            />
          </VStack>
        ) : null}

        {/* 3. 标签（只展示纯净的文章真实标签） */}
        {Array.isArray(detail.tags) && detail.tags.length > 0 ? (
          <VStack
            alignment="leading"
            spacing={6}
            padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
          >
            <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
              标签
            </Text>
            <FlowLayout spacing={6}>
              {detail.tags.map((tag) => {
                const route = tag.id
                  ? `pixivision-tag:${tag.id}?name=${encodeURIComponent(tag.name)}`
                  : `pixivision-tag:${encodeURIComponent(tag.name)}`
                return (
                  <TagChip
                    key={`${tag.id ?? tag.name}`}
                    name={tag.name}
                    tagName={tag.name}
                    value={route}
                    compact
                  />
                )
              })}
            </FlowLayout>
          </VStack>
        ) : null}

        {/* 4. 正文插画列表（完全遵循 WaterfallView 中 hero 卡片的容器与外框规范） */}
        {detail.artworks.length > 0 ? (
          <VStack alignment="leading" spacing={12} padding={{ top: 4 }}>
            {detail.artworks.map((artwork, index) => {
              const hydrated = hydratedMap[artwork.id]
              const illust = hydrated ?? buildArtworkSkeletonIllust(artwork)
              return (
                <VStack
                  key={artwork.id}
                  alignment="leading"
                  spacing={6}
                  padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
                  frame={{ width: Device.screen.width }}
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

        {/* 5. 正文内嵌特辑 */}
        {detail.embeddedArticles && detail.embeddedArticles.length > 0 ? (
          <VStack alignment="leading" spacing={12} padding={{ horizontal: FLOW_HORIZONTAL_PADDING, top: 16 }}>
            <HStack spacing={6} alignment="center">
              <Image
                systemName="doc.text.image"
                font="headline"
                foregroundStyle="#0096FA"
              />
              <Text font="headline" fontWeight="bold">
                推荐阅读
              </Text>
            </HStack>
            <LazyVStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
              {detail.embeddedArticles.map((article) => (
                <PixivisionCard key={article.id} article={article} />
              ))}
            </LazyVStack>
          </VStack>
        ) : null}

        {/* 6. 底部相关推荐分组 (Related Articles) */}
        {detail.relatedSections && detail.relatedSections.length > 0 ? (
          <VStack alignment="leading" spacing={20} padding={{ horizontal: FLOW_HORIZONTAL_PADDING, top: 16 }}>
            {detail.relatedSections.map((section, sIdx) => {
              const isLike = section.title.includes("喜欢")
              const iconName = isLike ? "heart.fill" : "sparkles.rectangle.stack.fill"
              const iconColor = isLike ? "#FF453A" : "#0096FA"
              return (
                <VStack
                  key={`${section.title}-${sIdx}`}
                  alignment="leading"
                  spacing={10}
                  frame={{ maxWidth: "infinity" }}
                >
                  <HStack spacing={6} alignment="center">
                    <Image
                      systemName={iconName}
                      font="headline"
                      foregroundStyle={iconColor}
                    />
                    <Text font="headline" fontWeight="bold">
                      {section.title}
                    </Text>
                  </HStack>
                  <LazyVStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
                    {section.articles.map((article) => (
                      <PixivisionCard key={`${section.title}-${article.id}`} article={article} />
                    ))}
                  </LazyVStack>
                </VStack>
              )
            })}
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
    width: artwork.width ?? 0,
    height: artwork.height ?? 0,
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
