import {
  Device,
  LazyVStack,
  NavigationLink,
  ScrollView,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { pixivisionDetail } from "../api/pixiv"
import { useAsyncGuard } from "./hooks"
import type { PixivisionDetail } from "../types"
import {
  CachedImage,
  ErrorView,
  formatDate,
  LoadingView,
  PixivisionCard,
} from "./components"

const PIXIVISION_ARTWORK_RATIO = 768 / 1200
const PIXIVISION_DETAIL_WIDTH = Device.screen.width - 28

export function PixivisionDetailView(props: { articleID: number }) {
  const { articleID } = props
  const [detail, setDetail] = useState<PixivisionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const guard = useAsyncGuard()

  async function load() {
    const g = guard()
    setLoading(true)
    setError(null)
    try {
      // Pixivision 详情页为完全公开页面，直接请求无需等待 OAuth Token
      const value = await pixivisionDetail(articleID)
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
      <ScrollView navigationTitle="Pixivision" navigationBarTitleDisplayMode="inline">
        <LoadingView />
      </ScrollView>
    )
  }

  if (error || !detail) {
    return (
      <ScrollView navigationTitle="Pixivision" navigationBarTitleDisplayMode="inline">
        <ErrorView message={error ?? "Pixivision 文章不存在"} onRetry={load} />
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
              相关 Pixivision 文章
            </Text>
            <LazyVStack alignment="leading" spacing={12}>
              {detail.embeddedArticles.map((article) => (
                <PixivisionCard key={article.id} article={article} />
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
                  aspectRatioValue={PIXIVISION_ARTWORK_RATIO}
                  cornerRadius={10}
                  contentMode="fit"
                  frame={{
                    width: PIXIVISION_DETAIL_WIDTH,
                    height: PIXIVISION_DETAIL_WIDTH / PIXIVISION_ARTWORK_RATIO,
                  }}
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
