import {
  Button,
  Device,
  Divider,
  HStack,
  Image,
  LazyVStack,
  NavigationLink,
  NavigationStack,
  ScrollView,
  Spacer,
  Text,
  TextField,
  useCallback,
  useEffect,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { searchImageBySauceNAO, type SauceNAOMatch } from "../api/sauceNao"
import {
  getSauceNaoApiKey,
  saveSauceNaoApiKey,
  clearSauceNaoApiKey,
  onSauceNaoKeyChanged,
} from "../store/sauceNaoStore"
import { cacheIllust } from "../store/illustCache"
import { CachedImage } from "./components/CachedImage"
import { EmptyView, ErrorView, LoadingView, presentExternalURL } from "./components"
import { destinationElement } from "./routes"

declare const Photos: any
declare const Haptics: any
declare const Dialog: any

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
  const [showConfig, setShowConfig] = useState(false)

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
      // 预置命中 Pixiv 结果的骨架缓存，确保跳转时 0ms 呈现
      for (const m of resp.results) {
        if (m.pixivId) {
          cacheIllust({
            id: m.pixivId,
            title: m.title,
            type: "illust",
            image_urls: {
              square_medium: m.thumbnailUrl,
              medium: m.thumbnailUrl,
              large: m.thumbnailUrl,
            },
            caption: "",
            user: {
              id: m.authorId || 0,
              name: m.authorName || "创作者",
              account: "",
              profile_image_urls: { medium: "" },
              is_followed: false,
            },
            tags: [],
            create_date: "",
            page_count: 1,
            width: 0,
            height: 0,
            x_restrict: 0,
            total_view: 0,
            total_bookmarks: 0,
            is_bookmarked: false,
            is_muted: false,
            illust_ai_type: 0,
            total_comments: 0,
            comment_access_control: 0,
            meta_pages: [],
          })
        }
      }
      setResults(resp.results)
      try {
        void Haptics.transient()
      } catch {}
    } catch (err: any) {
      if (err?.message === "NEED_API_KEY") {
        setError("NEED_API_KEY")
      } else {
        setError(err?.message ?? "以图搜图失败")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialImage) {
      void performSearch(initialImage)
    }
  }, [initialImage, performSearch])

  // 监听外部或配置面板导致的 Key 更新，自动重试
  useEffect(() => {
    return onSauceNaoKeyChanged((nextKey) => {
      if (nextKey && image && error === "NEED_API_KEY") {
        void performSearch(image)
      }
    })
  }, [image, error, performSearch])

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
      {showConfig ? (
        <SauceNAOConfigView
          onBack={() => setShowConfig(false)}
          onKeyUpdated={() => {
            if (image) {
              void performSearch(image)
            }
          }}
        />
      ) : (
        <ScrollView
          navigationTitle="以图搜图"
          navigationBarTitleDisplayMode="inline"
          navigationDestination={destinationElement}
          toolbar={{
            topBarLeading: (
              <Button title="关闭" systemImage="xmark" action={onClose} />
            ),
            topBarTrailing: [
              <Button
                key="config-gear"
                title="设置"
                systemImage="gearshape"
                action={() => {
                  try {
                    void Haptics.transient()
                  } catch {}
                  setShowConfig(true)
                }}
              />,
            ],
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
                padding={{ vertical: 56 }}
                frame={{ maxWidth: "infinity" }}
              >
                <Button
                  buttonStyle="borderedProminent"
                  controlSize="large"
                  action={handlePickFromPhotos}
                >
                  <HStack alignment="center" spacing={8} padding={{ horizontal: 8, vertical: 4 }}>
                    <Image systemName="photo.on.rectangle" font="headline" />
                    <Text font="headline" fontWeight="semibold">
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
            ) : error === "NEED_API_KEY" ? (
              <VStack
                alignment="center"
                spacing={14}
                padding={{ horizontal: 16, vertical: 24 }}
                glassEffect={{ type: "rect", cornerRadius: 14 }}
                frame={{ maxWidth: "infinity" }}
              >
                <Image systemName="key.fill" font="largeTitle" foregroundStyle="#FF9500" />
                <VStack alignment="center" spacing={4}>
                  <Text font="headline" fontWeight="bold">
                    需要配置 SauceNAO 搜图密钥
                  </Text>
                  <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
                    SauceNAO 官方已全面关闭匿名调用。个人 API Key 永久免费注册，配置后享有每日 100 次独立检索配额。
                  </Text>
                </VStack>
                <VStack alignment="center" spacing={10} frame={{ maxWidth: "infinity" }}>
                  <Button
                    buttonStyle="borderedProminent"
                    controlSize="regular"
                    action={() => setShowConfig(true)}
                    frame={{ maxWidth: "infinity" }}
                  >
                    <HStack alignment="center" spacing={6}>
                      <Image systemName="gearshape.fill" font="subheadline" />
                      <Text font="subheadline" fontWeight="semibold">
                        ⚙️ 立即配置 API Key
                      </Text>
                    </HStack>
                  </Button>
                  <Button
                    buttonStyle="bordered"
                    controlSize="regular"
                    action={() => void presentExternalURL("https://saucenao.com/user.php?page=search-api")}
                    frame={{ maxWidth: "infinity" }}
                  >
                    <HStack alignment="center" spacing={6}>
                      <Image systemName="safari" font="subheadline" />
                      <Text font="subheadline" fontWeight="medium">
                        🌐 免费获取 API Key
                      </Text>
                    </HStack>
                  </Button>
                </VStack>
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
                  />
                ))}
              </LazyVStack>
            ) : null}
          </VStack>
        </ScrollView>
      )}
    </NavigationStack>
  )
}

function SauceNAOConfigView(props: {
  onBack: () => void
  onKeyUpdated: () => void
}) {
  const { onBack, onKeyUpdated } = props
  const [keyInput, setKeyInput] = useState(() => getSauceNaoApiKey())

  const handleSave = useCallback(async () => {
    const trimmed = keyInput.trim()
    saveSauceNaoApiKey(trimmed)
    try {
      void Haptics.notification("success")
    } catch {}
    if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
      await Dialog.alert({
        title: "保存成功",
        message: trimmed
          ? "SauceNAO API Key 已安全保存至本地与 iCloud 钥匙串。"
          : "已清空 SauceNAO API Key。",
      })
    }
    onKeyUpdated()
    onBack()
  }, [keyInput, onBack, onKeyUpdated])

  const handleClear = useCallback(async () => {
    try {
      void Haptics.impact("medium")
    } catch {}
    let confirmed = true
    if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
      confirmed = await Dialog.confirm({
        title: "清除密钥确认",
        message: "确定要从当前设备与 iCloud 钥匙串中彻底清除 SauceNAO API Key 吗？",
        confirmLabel: "立即清除",
        cancelLabel: "取消",
      })
    }
    if (!confirmed) return

    clearSauceNaoApiKey()
    setKeyInput("")
    try {
      void Haptics.notification("success")
    } catch {}
    if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
      await Dialog.alert({
        title: "已清除",
        message: "已从本地和 iCloud 钥匙串彻底清除密钥数据。",
      })
    }
    onKeyUpdated()
  }, [onKeyUpdated])

  return (
    <ScrollView
      navigationTitle="SauceNAO 搜图配置"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarLeading: (
          <Button title="返回" systemImage="chevron.backward" action={onBack} />
        ),
        topBarTrailing: [
          <Button key="save" title="完成" fontWeight="bold" action={handleSave} />,
        ],
      }}
    >
      <VStack alignment="leading" spacing={16} padding={{ horizontal: 16, top: 16, bottom: 40 }}>
        {/* 1. 引擎说明卡片 */}
        <VStack
          alignment="leading"
          spacing={10}
          padding={14}
          glassEffect={{ type: "rect", cornerRadius: 14 }}
          frame={{ maxWidth: "infinity" }}
        >
          <HStack alignment="center" spacing={10}>
            <Image
              systemName="sparkles.rectangle.stack.fill"
              font="title2"
              foregroundStyle="#007AFF"
            />
            <VStack alignment="leading" spacing={2}>
              <Text font="headline" fontWeight="bold">
                SauceNAO 专属识图引擎
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                Pixiv / 插画高精度图像指纹匹配
              </Text>
            </VStack>
          </HStack>

          <Text font="footnote" foregroundStyle="secondaryLabel" lineSpacing={3}>
            SauceNAO 官方接口强制要求携带个人 API Key。个人账户永久免费注册，配置后享有每日 100 次独立搜图配额，不受公共网络代理或共享 IP 限流影响。
          </Text>

          <Button
            buttonStyle="bordered"
            action={() => void presentExternalURL("https://saucenao.com/user.php?page=search-api")}
            frame={{ maxWidth: "infinity" }}
          >
            <HStack alignment="center" spacing={6}>
              <Image systemName="safari" font="subheadline" />
              <Text font="subheadline" fontWeight="medium">
                免费注册并获取 API Key
              </Text>
            </HStack>
          </Button>
        </VStack>

        {/* 2. 密钥配置区域 */}
        <VStack
          alignment="leading"
          spacing={12}
          padding={14}
          glassEffect={{ type: "rect", cornerRadius: 14 }}
          frame={{ maxWidth: "infinity" }}
        >
          <Text font="subheadline" fontWeight="semibold">
            API Key
          </Text>

          <TextField
            title="API Key"
            value={keyInput}
            onChanged={setKeyInput}
            prompt="粘贴 40 位 SauceNAO API Key"
            textInputAutocapitalization="never"
            autocorrectionDisabled={true}
          />

          <HStack alignment="center" spacing={6}>
            <Image systemName="icloud.fill" font="caption2" foregroundStyle="#007AFF" />
            <Text font="caption2" foregroundStyle="secondaryLabel">
              本地与 iCloud 钥匙串双向同步，多设备无缝漫游
            </Text>
          </HStack>

          <Button
            buttonStyle="borderedProminent"
            action={handleSave}
            frame={{ maxWidth: "infinity" }}
          >
            <HStack alignment="center" spacing={6}>
              <Image systemName="checkmark" font="subheadline" />
              <Text font="subheadline" fontWeight="semibold">
                保存密钥
              </Text>
            </HStack>
          </Button>
        </VStack>

        {/* 3. 清除密钥操作卡片 */}
        {getSauceNaoApiKey() ? (
          <VStack
            alignment="leading"
            spacing={10}
            padding={14}
            glassEffect={{ type: "rect", cornerRadius: 14 }}
            frame={{ maxWidth: "infinity" }}
          >
            <Text font="subheadline" fontWeight="semibold" foregroundStyle="red">
              危险操作
            </Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              一键从本地设备与 iCloud 钥匙串中彻底注销并清除当前 SauceNAO 密钥。
            </Text>
            <Button
              buttonStyle="bordered"
              role="destructive"
              action={handleClear}
              frame={{ maxWidth: "infinity" }}
            >
              <HStack alignment="center" spacing={6}>
                <Image systemName="trash" font="subheadline" foregroundStyle="red" />
                <Text font="subheadline" fontWeight="semibold" foregroundStyle="red">
                  一键清除本地与 iCloud 密钥
                </Text>
              </HStack>
            </Button>
          </VStack>
        ) : null}
      </VStack>
    </ScrollView>
  )
}

function SauceNAOMatchCard(props: {
  match: SauceNAOMatch
}) {
  const { match } = props
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
          <NavigationLink
            value={`illust:${match.pixivId}`}
            buttonStyle="plain"
            frame={{ maxWidth: "infinity" }}
          >
            <HStack
              alignment="center"
              spacing={6}
              padding={{ vertical: 9, horizontal: 12 }}
              background="#007AFF"
              clipShape={{ type: "rect", cornerRadius: 8 }}
              frame={{ maxWidth: "infinity", alignment: "center" }}
            >
              <Image systemName="photo.stack" font="subheadline" foregroundStyle="white" />
              <Text font="subheadline" fontWeight="semibold" foregroundStyle="white">
                打开作品详情
              </Text>
            </HStack>
          </NavigationLink>
        ) : match.extUrls.length > 0 ? (
          <Button
            buttonStyle="bordered"
            action={() => void presentExternalURL(match.extUrls[0])}
            frame={{ maxWidth: "infinity" }}
          >
            <HStack alignment="center" spacing={6}>
              <Image systemName="arrow.up.right.square" font="subheadline" />
              <Text font="subheadline" fontWeight="medium">
                查看来源网页
              </Text>
            </HStack>
          </Button>
        ) : null}

        {match.authorId ? (
          <NavigationLink
            value={`user:${match.authorId}`}
            buttonStyle="plain"
            frame={{ maxWidth: "infinity" }}
          >
            <HStack
              alignment="center"
              spacing={6}
              padding={{ vertical: 8, horizontal: 12 }}
              glassEffect={{ type: "rect", cornerRadius: 8 }}
              border={{ style: "#007AFF40", width: 1 }}
              clipShape={{ type: "rect", cornerRadius: 8 }}
              frame={{ maxWidth: "infinity", alignment: "center" }}
            >
              <Image
                systemName="person.crop.circle.fill"
                font="subheadline"
                foregroundStyle="#007AFF"
              />
              <Text
                font="subheadline"
                fontWeight="medium"
                foregroundStyle="#007AFF"
              >
                创作者主页
              </Text>
            </HStack>
          </NavigationLink>
        ) : match.authorUrl ? (
          <Button
            buttonStyle="bordered"
            action={() => void presentExternalURL(match.authorUrl!)}
            frame={{ maxWidth: "infinity" }}
          >
            <HStack alignment="center" spacing={6}>
              <Image systemName="person.crop.circle" font="subheadline" />
              <Text font="subheadline" fontWeight="medium">
                创作者主页
              </Text>
            </HStack>
          </Button>
        ) : null}
      </HStack>
    </VStack>
  )
}
