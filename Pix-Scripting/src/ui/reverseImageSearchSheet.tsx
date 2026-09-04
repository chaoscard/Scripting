import {
  Button,
  Device,
  Divider,
  HStack,
  Image,
  LazyVStack,
  NavigationStack,
  ScrollView,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { searchImageBySauceNAO, type SauceNAOMatch } from "../api/sauceNao"
import { CachedImage } from "./components/CachedImage"
import { EmptyView, ErrorView, LoadingView, presentExternalURL } from "./components"
import { requestPixivRoute } from "./routeNavigation"

declare const Photos: any
declare const Haptics: any

export function ReverseImageSearchSheet(props: {
  initialImage?: any
  onClose: () => void
}) {
  const { initialImage, onClose } = props
  const [image, setImage] = useState<any>(initialImage ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SauceNAOMatch[]>([])
  const [queryThumb, setQueryThumb] = useState<string | null>(null)

  const performSearch = useCallback(async (targetImage: any) => {
    if (!targetImage) return
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const base64 = targetImage.toJPEGBase64String ? targetImage.toJPEGBase64String(0.5) : null
      if (base64) {
        setQueryThumb(`data:image/jpeg;base64,${base64}`)
      }
      const resp = await searchImageBySauceNAO(targetImage)
      setResults(resp.results)
      try {
        void Haptics.transient()
      } catch {}
    } catch (err: any) {
      setError(err?.message ?? "以图搜图失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialImage) {
      void performSearch(initialImage)
    }
  }, [initialImage, performSearch])

  const handlePickFromPhotos = useCallback(async () => {
    try {
      void Haptics.transient()
    } catch {}
    try {
      const picked = await Photos.pickPhotos(1)
      if (picked && picked.length > 0 && picked[0]) {
        setImage(picked[0])
        void performSearch(picked[0])
      }
    } catch (err: any) {
      setError(err?.message ?? "选取相册图片失败")
    }
  }, [performSearch])

  return (
    <NavigationStack
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
    >
      <ScrollView
        navigationTitle="以图搜图"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button title="关闭" action={onClose} />
          ),
          topBarTrailing: (
            <Button
              title="搜索"
              systemImage="photo.badge.magnifyingglass"
              action={handlePickFromPhotos}
            />
          ),
        }}
      >
        <VStack alignment="leading" spacing={14} padding={{ horizontal: 16, top: 12, bottom: 32 }}>
          {/* 顶部检索源图信息 */}
          {queryThumb ? (
            <HStack
              alignment="center"
              spacing={12}
              padding={12}
              glassEffect={{ type: "rect", cornerRadius: 12 }}
              frame={{ maxWidth: "infinity" }}
            >
              <ZStack
                frame={{ width: 56, height: 56 }}
                clipShape={{ type: "rect", cornerRadius: 8 }}
              >
                <CachedImage
                  url={queryThumb}
                  aspectRatioValue={1}
                  contentMode="fill"
                  frame={{ width: 56, height: 56 }}
                />
              </ZStack>
              <VStack alignment="leading" spacing={3}>
                <Text font="subheadline" fontWeight="bold" foregroundStyle="label">
                  检索目标图片
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {loading ? "正在向 SauceNAO 引擎寻源..." : `找到 ${results.length} 项候选`}
                </Text>
              </VStack>
              <Spacer />
              <Button
                buttonStyle="bordered"
                action={handlePickFromPhotos}
              >
                <Text font="caption" fontWeight="medium">
                  重新选图
                </Text>
              </Button>
            </HStack>
          ) : (
            <VStack
              alignment="center"
              spacing={12}
              padding={{ vertical: 36 }}
              frame={{ maxWidth: "infinity" }}
            >
              <Image
                systemName="photo.badge.magnifyingglass"
                font="largeTitle"
                foregroundStyle="#007AFF"
              />
              <Text font="subheadline" foregroundStyle="secondaryLabel">
                从相册选取图片，在 Pixiv 与全网寻找高清原图与画师
              </Text>
              <Button
                buttonStyle="borderedProminent"
                action={handlePickFromPhotos}
              >
                <HStack alignment="center" spacing={6}>
                  <Image systemName="photo.on.rectangle" font="subheadline" />
                  <Text font="subheadline" fontWeight="semibold">
                    从相册选取图片
                  </Text>
                </HStack>
              </Button>
            </VStack>
          )}

          {/* 搜索状态展示 */}
          {loading ? (
            <VStack alignment="center" spacing={12} padding={{ vertical: 36 }} frame={{ maxWidth: "infinity" }}>
              <LoadingView />
              <Text font="subheadline" foregroundStyle="secondaryLabel">
                正在通过 SauceNAO 深度检索图像指纹...
              </Text>
            </VStack>
          ) : error ? (
            <ErrorView message={error} onRetry={() => image && performSearch(image)} />
          ) : results.length === 0 && image ? (
            <EmptyView text="未匹配到高相似度作品" systemImage="questionmark.circle" />
          ) : results.length > 0 ? (
            <LazyVStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
              <HStack alignment="center" spacing={6}>
                <Image systemName="sparkles" font="caption" foregroundStyle="#007AFF" />
                <Text font="caption" fontWeight="semibold" foregroundStyle="secondaryLabel">
                  匹配结果（按相似度排序）
                </Text>
              </HStack>
              {results.map((match, idx) => (
                <SauceNAOMatchCard
                  key={`${match.pixivId || match.title}-${idx}`}
                  match={match}
                  onSelectPixiv={(pixivId) => {
                    onClose()
                    requestPixivRoute(`illust:${pixivId}`)
                  }}
                  onSelectAuthor={(authorId) => {
                    onClose()
                    requestPixivRoute(`user:${authorId}`)
                  }}
                />
              ))}
            </LazyVStack>
          ) : null}
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

function SauceNAOMatchCard(props: {
  match: SauceNAOMatch
  onSelectPixiv: (id: number) => void
  onSelectAuthor: (id: number) => void
}) {
  const { match, onSelectPixiv, onSelectAuthor } = props
  const similarityScore = match.similarity
  const isHighSim = similarityScore >= 80
  const isMedSim = similarityScore >= 60
  const badgeColor = isHighSim ? "#34C759" : isMedSim ? "#FF9500" : "#8E8E93"

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={12}
      glassEffect={{ type: "rect", cornerRadius: 14 }}
      frame={{ maxWidth: "infinity" }}
    >
      <HStack alignment="top" spacing={12} frame={{ maxWidth: "infinity" }}>
        {/* 缩略图 */}
        <ZStack
          frame={{ width: 80, height: 80 }}
          clipShape={{ type: "rect", cornerRadius: 8 }}
          alignment="center"
        >
          <CachedImage
            url={match.thumbnailUrl}
            aspectRatioValue={1}
            contentMode="fill"
            cornerRadius={8}
            frame={{ width: 80, height: 80 }}
          />
        </ZStack>

        {/* 信息详情 */}
        <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
          <HStack alignment="center" spacing={6} frame={{ maxWidth: "infinity" }}>
            <HStack
              alignment="center"
              spacing={4}
              padding={{ horizontal: 6, vertical: 2 }}
              glassEffect="capsule"
              contentShape="capsule"
            >
              <Text font="caption2" fontWeight="bold" foregroundStyle={badgeColor as any}>
                {`${similarityScore.toFixed(1)}% 相似度`}
              </Text>
            </HStack>
            {match.isPixiv ? (
              <HStack
                alignment="center"
                spacing={3}
                padding={{ horizontal: 6, vertical: 2 }}
                background="#0096FA1F"
                clipShape="capsule"
              >
                <Text font="caption2" fontWeight="semibold" foregroundStyle="#0096FA">
                  Pixiv
                </Text>
              </HStack>
            ) : null}
            <Spacer />
          </HStack>

          <Text font="subheadline" fontWeight="bold" foregroundStyle="label" lineLimit={2}>
            {match.title}
          </Text>

          {match.authorName ? (
            <HStack alignment="center" spacing={4}>
              <Image systemName="person.fill" font="caption2" foregroundStyle="secondaryLabel" />
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                {match.authorName}
              </Text>
            </HStack>
          ) : null}
        </VStack>
      </HStack>

      {/* 操作按钮栏 */}
      <Divider />
      <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
        {match.pixivId ? (
          <Button
            buttonStyle="borderedProminent"
            action={() => onSelectPixiv(match.pixivId!)}
            frame={{ maxWidth: "infinity" }}
          >
            <HStack alignment="center" spacing={6}>
              <Image systemName="photo.stack" font="subheadline" />
              <Text font="subheadline" fontWeight="semibold">
                打开作品详情
              </Text>
            </HStack>
          </Button>
        ) : match.extUrls.length > 0 ? (
          <Button
            buttonStyle="bordered"
            action={() => void presentExternalURL(match.extUrls[0])}
            frame={{ maxWidth: "infinity" }}
          >
            <HStack alignment="center" spacing={6}>
              <Image systemName="safari" font="subheadline" />
              <Text font="subheadline" fontWeight="medium">
                查看来源网页
              </Text>
            </HStack>
          </Button>
        ) : null}

        {match.authorId ? (
          <Button
            buttonStyle="bordered"
            action={() => onSelectAuthor(match.authorId!)}
          >
            <HStack alignment="center" spacing={4}>
              <Image systemName="person.crop.circle" font="subheadline" />
              <Text font="subheadline">
                画师
              </Text>
            </HStack>
          </Button>
        ) : null}
      </HStack>
    </VStack>
  )
}
