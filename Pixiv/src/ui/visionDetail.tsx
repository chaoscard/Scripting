import {
  LazyVStack,
  NavigationLink,
  ScrollView,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { visionDetail } from "../api/pixiv"
import { session } from "../api/session"
import { useAsyncGuard } from "./hooks"
import type { PixivVisionDetail } from "../types"
import {
  CachedImage,
  ErrorView,
  formatDate,
  LoadingView,
  VisionCard,
} from "./components"

const VISION_ARTWORK_RATIO = 768 / 1200

export function VisionDetailView(props: { articleID: number }) {
  const { articleID } = props
  const [detail, setDetail] = useState<PixivVisionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const guard = useAsyncGuard()

  async function load() {
    const g = guard()
    setLoading(true)
    setError(null)
    try {
      const value = await session.call((token) => visionDetail(articleID, token))
      if (!g.isCurrent()) return
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
      <ScrollView navigationTitle="Vision" navigationBarTitleDisplayMode="inline">
        <LoadingView />
      </ScrollView>
    )
  }

  if (error || !detail) {
    return (
      <ScrollView navigationTitle="Vision" navigationBarTitleDisplayMode="inline">
        <ErrorView message={error ?? "Vision 文章不存在"} onRetry={load} />
      </ScrollView>
    )
  }

  return (
    <ScrollView
      navigationTitle={detail.title}
      navigationBarTitleDisplayMode="inline"
    >
      <VStack
        alignment="leading"
        spacing={14}
        padding={{ horizontal: 14, top: 12, bottom: 28 }}
      >
        <Text font="title2" fontWeight="bold" multilineTextAlignment="leading">
          {detail.title}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          {detail.category} · {formatDate(detail.date)}
        </Text>

        {detail.description ? (
          <Text
            font="body"
            multilineTextAlignment="leading"
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {detail.description}
          </Text>
        ) : null}

        {detail.embeddedArticles.length > 0 ? (
          <VStack alignment="leading" spacing={8} padding={{ top: 4 }}>
            <Text font="subheadline" fontWeight="semibold">
              相关 Vision 文章
            </Text>
            <LazyVStack alignment="leading" spacing={12}>
              {detail.embeddedArticles.map((article) => (
                <VisionCard key={article.id} article={article} />
              ))}
            </LazyVStack>
          </VStack>
        ) : null}

        <VStack alignment="leading" spacing={18} padding={{ top: 4 }}>
          {detail.artworks.map((artwork) => (
            <VStack key={artwork.id} alignment="leading" spacing={7}>
              <NavigationLink value={`illust:${artwork.id}`}>
                <CachedImage
                  url={artwork.imageURL}
                  aspectRatioValue={VISION_ARTWORK_RATIO}
                  cornerRadius={10}
                  contentMode="fit"
                />
              </NavigationLink>
              <Text
                font="subheadline"
                multilineTextAlignment="leading"
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                {artwork.title}
              </Text>
            </VStack>
          ))}
        </VStack>
      </VStack>
    </ScrollView>
  )
}
