import {
  Button,
  Device,
  Divider,
  HStack,
  Image,
  LazyVStack,
  List,
  NavigationLink,
  NavigationStack,
  ScrollView,
  Section,
  SecureField,
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
  getSauceNaoApiKeys,
  getSauceNaoApiKey,
  addSauceNaoApiKey,
  removeSauceNaoApiKey,
  clearSauceNaoApiKey,
  getSauceNaoQuotaStats,
  onSauceNaoKeyChanged,
} from "../store/sauceNaoStore"
import { cacheIllust } from "../store/illustCache"
import { CachedImage } from "./components/CachedImage"
import { EmptyView, ErrorView, LoadingView, presentExternalURL } from "./components"
import { destinationElement } from "./routes"

declare const Photos: any
declare const Haptics: any
declare const Dialog: any
declare const Pasteboard: any

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
  const [quota, setQuota] = useState(() => getSauceNaoQuotaStats())

  const performSearch = useCallback(async (targetImage: any) => {
    if (!targetImage) return
    const keys = getSauceNaoApiKeys()
    if (keys.length === 0) {
      setError("NEED_API_KEY")
      return
    }
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
        setError(err?.message ?? "SauceNAO 搜图失败")
      }
    } finally {
      setLoading(false)
      setQuota(getSauceNaoQuotaStats())
    }
  }, [])

  useEffect(() => {
    if (initialImage) {
      void performSearch(initialImage)
    }
  }, [initialImage, performSearch])

  // 监听外部或配置面板导致的 Key 更新，自动重试并刷新用量
  useEffect(() => {
    return onSauceNaoKeyChanged((nextKeys) => {
      setQuota(getSauceNaoQuotaStats())
      if (nextKeys.length > 0 && image && error === "NEED_API_KEY") {
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
          onBack={() => {
            setShowConfig(false)
            setQuota(getSauceNaoQuotaStats())
          }}
          onKeyUpdated={() => {
            setQuota(getSauceNaoQuotaStats())
            if (image) {
              void performSearch(image)
            }
          }}
        />
      ) : (
        <ScrollView
          navigationTitle={quota.keyCount > 0 ? `SauceNAO 搜图 (${quota.used}/${quota.total})` : "SauceNAO 搜图"}
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
            {image ? (
              <HStack
                alignment="center"
                spacing={12}
                padding={12}
                glassEffect={{ type: "rect", cornerRadius: 14 }}
                frame={{ maxWidth: "infinity" }}
              >
                <ZStack
                  frame={{ width: 56, height: 56 }}
                  clipShape={{ type: "rect", cornerRadius: 8 }}
                  alignment="center"
                >
                  {typeof image === "string" ? (
                    <CachedImage
                      url={image}
                      useIntrinsicAspectRatio={true}
                      contentMode="fit"
                      frame={{ width: 56, height: 56 }}
                    />
                  ) : (
                    <Image
                      image={image}
                      resizable={true}
                      aspectRatio={
                        image?.width && image?.height
                          ? { value: image.width / image.height, contentMode: "fit" }
                          : undefined
                      }
                      frame={{ width: 56, height: 56 }}
                    />
                  )}
                </ZStack>
                <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Text font="subheadline" fontWeight="bold" foregroundStyle="label">
                    检索目标图片
                  </Text>
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {loading
                      ? "正在向 SauceNAO 引擎寻源..."
                      : quota.keyCount > 0
                      ? `找到 ${results.length} 项候选 · 配额 ${quota.used}/${quota.total}`
                      : `找到 ${results.length} 项候选`}
                  </Text>
                </VStack>
                <Spacer />
                <Button
                  buttonStyle="plain"
                  action={handlePickFromPhotos}
                >
                  <HStack
                    alignment="center"
                    spacing={6}
                    padding={{ vertical: 6, horizontal: 10 }}
                    glassEffect={{ type: "rect", cornerRadius: 8 }}
                    border={{ style: "#007AFF40", width: 1 }}
                    clipShape={{ type: "rect", cornerRadius: 8 }}
                  >
                    <Image systemName="photo.badge.plus" font="subheadline" foregroundStyle="#007AFF" />
                    <Text font="subheadline" fontWeight="semibold" foregroundStyle="#007AFF">
                      重新选图
                    </Text>
                  </HStack>
                </Button>
              </HStack>
            ) : (
              <VStack
                alignment="center"
                spacing={12}
                padding={{ top: 12, bottom: 10 }}
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
            {quota.keyCount === 0 || error === "NEED_API_KEY" ? (
              <HStack
                alignment="center"
                spacing={12}
                padding={12}
                glassEffect={{ type: "rect", cornerRadius: 14 }}
                frame={{ maxWidth: "infinity", minHeight: 88 }}
              >
                {/* 1. 左侧图标 */}
                <ZStack
                  frame={{ width: 56, height: 56 }}
                  clipShape={{ type: "rect", cornerRadius: 10 }}
                  background="#FF95001A"
                  alignment="center"
                >
                  <Image systemName="key.fill" font="title2" foregroundStyle="#FF9500" />
                </ZStack>

                {/* 2. 中间信息（严格左对齐，无 Emoji） */}
                <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Text font="subheadline" fontWeight="bold" foregroundStyle="label">
                    需要配置搜图密钥
                  </Text>
                  <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                    官方要求携带个人 API Key，享有每日独立搜图配额。
                  </Text>
                </VStack>

                {/* 3. 右侧操作列（统一液态玻璃胶囊 84x28） */}
                <VStack alignment="trailing" spacing={6}>
                  <Button
                    buttonStyle="plain"
                    action={() => {
                      try {
                        void Haptics.transient()
                      } catch {}
                      setShowConfig(true)
                    }}
                  >
                    <HStack
                      alignment="center"
                      spacing={4}
                      padding={{ vertical: 5, horizontal: 8 }}
                      glassEffect={{ type: "rect", cornerRadius: 8 }}
                      border={{ style: "#007AFF40", width: 1 }}
                      clipShape={{ type: "rect", cornerRadius: 8 }}
                      frame={{ width: 84, height: 28, alignment: "center" }}
                    >
                      <Image
                        systemName="gearshape"
                        font="caption"
                        foregroundStyle="#007AFF"
                      />
                      <Text
                        font="caption"
                        fontWeight="medium"
                        foregroundStyle="#007AFF"
                      >
                        配置密钥
                      </Text>
                    </HStack>
                  </Button>

                  <Button
                    buttonStyle="plain"
                    action={() => void presentExternalURL("https://saucenao.com/user.php?page=search-api")}
                  >
                    <HStack
                      alignment="center"
                      spacing={4}
                      padding={{ vertical: 5, horizontal: 8 }}
                      glassEffect={{ type: "rect", cornerRadius: 8 }}
                      border={{ style: "#007AFF40", width: 1 }}
                      clipShape={{ type: "rect", cornerRadius: 8 }}
                      frame={{ width: 84, height: 28, alignment: "center" }}
                    >
                      <Image
                        systemName="safari"
                        font="caption"
                        foregroundStyle="#007AFF"
                      />
                      <Text
                        font="caption"
                        fontWeight="medium"
                        foregroundStyle="#007AFF"
                      >
                        获取密钥
                      </Text>
                    </HStack>
                  </Button>
                </VStack>
              </HStack>
            ) : loading ? (
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
              <LazyVStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
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
  const [keys, setKeys] = useState(() => getSauceNaoApiKeys())
  const [newKeyInput, setNewKeyInput] = useState("")
  const [showNewKeyText, setShowNewKeyText] = useState(false)
  const [showSavedKeysText, setShowSavedKeysText] = useState(false)
  const quota = getSauceNaoQuotaStats()

  const handlePasteNewKey = useCallback(async () => {
    try {
      if (typeof Pasteboard !== "undefined" && typeof Pasteboard.getString === "function") {
        const text = await Pasteboard.getString()
        if (text && typeof text === "string") {
          const trimmed = text.trim()
          if (trimmed) {
            setNewKeyInput(trimmed)
            try {
              void Haptics.transient(0.3, 0.3)
            } catch {}
          }
        }
      }
    } catch {}
  }, [])

  const handleAddKey = useCallback(async () => {
    const trimmed = newKeyInput.trim()
    if (!trimmed) {
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        await Dialog.alert({
          title: "请输入有效密钥",
          message: "SauceNAO API Key 通常为 40 位十六进制字符串。",
        })
      }
      return
    }
    const success = addSauceNaoApiKey(trimmed)
    if (!success) {
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        await Dialog.alert({
          title: "密钥已存在",
          message: "该 SauceNAO API Key 已经在列表中，无需重复添加。",
        })
      }
      return
    }
    setNewKeyInput("")
    setKeys(getSauceNaoApiKeys())
    try {
      void Haptics.notification("success")
    } catch {}
    if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
      await Dialog.alert({
        title: "添加成功",
        message: "已将新密钥安全保存至本地与 iCloud 钥匙串。",
      })
    }
    onKeyUpdated()
  }, [newKeyInput, onKeyUpdated])

  const handleDone = useCallback(async () => {
    const trimmed = newKeyInput.trim()
    if (trimmed) {
      const success = addSauceNaoApiKey(trimmed)
      if (success) {
        setKeys(getSauceNaoApiKeys())
        setNewKeyInput("")
      }
    }
    try {
      void Haptics.notification("success")
    } catch {}
    onKeyUpdated()
    onBack()
  }, [newKeyInput, onBack, onKeyUpdated])

  const handleRemoveKey = useCallback(async (targetKey: string) => {
    try {
      void Haptics.impact("medium")
    } catch {}
    let confirmed = true
    if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
      const masked = targetKey.length > 8 ? `${targetKey.slice(0, 4)}••••${targetKey.slice(-4)}` : targetKey
      confirmed = await Dialog.confirm({
        title: "删除密钥确认",
        message: `确定要删除该密钥 (${masked}) 吗？`,
        confirmLabel: "删除",
        cancelLabel: "取消",
      })
    }
    if (!confirmed) return

    removeSauceNaoApiKey(targetKey)
    setKeys(getSauceNaoApiKeys())
    try {
      void Haptics.notification("success")
    } catch {}
    onKeyUpdated()
  }, [onKeyUpdated])

  const handleClearAll = useCallback(async () => {
    try {
      void Haptics.impact("medium")
    } catch {}
    let confirmed = true
    if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
      confirmed = await Dialog.confirm({
        title: "清空全部密钥确认",
        message: "确定要从本地和 iCloud 钥匙串彻底清除所有 SauceNAO 密钥吗？",
        confirmLabel: "清空全部",
        cancelLabel: "取消",
      })
    }
    if (!confirmed) return

    clearSauceNaoApiKey()
    setKeys([])
    setNewKeyInput("")
    try {
      void Haptics.notification("success")
    } catch {}
    onKeyUpdated()
  }, [onKeyUpdated])

  return (
    <List
      navigationTitle={keys.length > 0 ? `密钥配置 (${quota.used}/${quota.total})` : "SauceNAO 密钥配置"}
      navigationBarTitleDisplayMode="inline"
      listSectionSpacing="compact"
      toolbar={{
        topBarLeading: (
          <Button title="返回" systemImage="chevron.backward" action={onBack} />
        ),
        topBarTrailing: [
          <Button
            key="done"
            title="完成"
            systemImage="checkmark"
            fontWeight="bold"
            action={handleDone}
          />,
        ],
      }}
    >
      {/* 1. 已配置密钥列表 */}
      {keys.length > 0 ? (
        <Section
          header={
            <HStack alignment="center" spacing={6}>
              <Text>
                {`已配置密钥 (${keys.length} 个 · 今日已用 ${quota.used}/${quota.total})`}
              </Text>
              <Spacer />
              <Button
                buttonStyle="plain"
                action={() => setShowSavedKeysText(!showSavedKeysText)}
              >
                <HStack alignment="center" spacing={2}>
                  <Image
                    systemName={showSavedKeysText ? "eye.slash" : "eye"}
                    font="caption"
                    foregroundStyle="secondaryLabel"
                  />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {showSavedKeysText ? "隐藏明文" : "显示明文"}
                  </Text>
                </HStack>
              </Button>
            </HStack>
          }
        >
          {keys.map((k, index) => {
            const displayStr = showSavedKeysText
              ? k
              : k.length > 8
              ? `${k.slice(0, 4)}••••••••••••••••${k.slice(-4)}`
              : k
            return (
              <HStack key={`${k}-${index}`} alignment="center" spacing={10}>
                <Image systemName="key.fill" font="subheadline" foregroundStyle="#007AFF" />
                <Text font="subheadline" foregroundStyle="label">
                  {displayStr}
                </Text>
                <Spacer />
                <Button
                  buttonStyle="plain"
                  action={() => void handleRemoveKey(k)}
                >
                  <Image systemName="trash" font="subheadline" foregroundStyle="systemRed" />
                </Button>
              </HStack>
            )
          })}
        </Section>
      ) : null}

      {/* 2. 添加新密钥 */}
      <Section
        header={<Text>添加新密钥</Text>}
        footer={
          <HStack spacing={4} alignment="center">
            <Spacer />
            <Button
              buttonStyle="plain"
              action={() => void presentExternalURL("https://saucenao.com/user.php?page=search-api")}
            >
              <Text font="caption" foregroundStyle="systemBlue">
                去官方获取密钥 ↗
              </Text>
            </Button>
          </HStack>
        }
      >
        <HStack spacing={10} alignment="center">
          {showNewKeyText ? (
            <TextField
              title="API Key"
              prompt="在此粘贴 40 位 API Key"
              value={newKeyInput}
              onChanged={setNewKeyInput}
              autocorrectionDisabled={true}
              textInputAutocapitalization="never"
            />
          ) : (
            <SecureField
              title="API Key"
              prompt="在此粘贴 40 位 API Key"
              value={newKeyInput}
              onChanged={setNewKeyInput}
            />
          )}
          <Button buttonStyle="plain" action={handlePasteNewKey}>
            <Image systemName="doc.on.clipboard" foregroundStyle="#007AFF" />
          </Button>
          <Button buttonStyle="plain" action={() => setShowNewKeyText(!showNewKeyText)}>
            <Image
              systemName={showNewKeyText ? "eye.slash" : "eye"}
              foregroundStyle="secondaryLabel"
            />
          </Button>
        </HStack>

        {/* 单独一行的添加按钮 */}
        <Button
          title="添加新密钥"
          action={handleAddKey}
        />
      </Section>

      {/* 3. 清空所有密钥 */}
      {keys.length > 0 ? (
        <Section>
          <Button
            title="清空所有 SauceNAO 密钥"
            role="destructive"
            action={handleClearAll}
          />
        </Section>
      ) : null}
    </List>
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

  const hasWorkAction = Boolean(match.pixivId || match.extUrls.length > 0)
  const hasAuthorAction = Boolean(match.authorId || match.authorUrl)

  const handleCopyInfo = useCallback(async () => {
    try {
      const lines: string[] = []
      if (match.title) lines.push(`作品: ${match.title}`)
      if (match.similarity) lines.push(`相似度: ${match.similarity.toFixed(1)}%`)
      if (match.authorName) lines.push(`创作者: ${match.authorName}`)
      if (match.extraInfo) lines.push(`信息: ${match.extraInfo}`)
      if (match.indexName) lines.push(`图库: ${match.indexName}`)
      if (match.extUrls.length > 0) lines.push(`链接: ${match.extUrls.join(", ")}`)
      if (match.authorUrl) lines.push(`作者主页: ${match.authorUrl}`)

      const fullText = lines.join("\n")
      if (typeof Pasteboard !== "undefined" && typeof Pasteboard.setString === "function") {
        await Pasteboard.setString(fullText)
      }
      try {
        void Haptics.notification("success")
      } catch {}
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        await Dialog.alert({
          title: "已复制搜图信息",
          message: fullText,
        })
      }
    } catch {}
  }, [match])

  return (
    <HStack
      alignment="center"
      spacing={12}
      padding={12}
      glassEffect={{ type: "rect", cornerRadius: 14 }}
      frame={{ maxWidth: "infinity", minHeight: 96 }}
    >
      {/* 1. 缩略图（真实物理长宽比自适应居中） */}
      <ZStack
        frame={{ width: 72, height: 72 }}
        clipShape={{ type: "rect", cornerRadius: 8 }}
        alignment="center"
      >
        <CachedImage
          url={match.thumbnailUrl}
          useIntrinsicAspectRatio={true}
          contentMode="fit"
          cornerRadius={8}
          frame={{ width: 72, height: 72 }}
        />
      </ZStack>

      {/* 2. 信息详情（严格左对齐） */}
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <HStack alignment="center" spacing={6}>
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
        </HStack>

        <Text
          font="subheadline"
          fontWeight="bold"
          foregroundStyle="label"
          lineLimit={2}
          multilineTextAlignment="leading"
        >
          {match.title}
        </Text>

        {match.authorName || match.extraInfo ? (
          <HStack alignment="center" spacing={4}>
            {match.authorName ? (
              <>
                <Image systemName="person.fill" font="caption2" foregroundStyle="secondaryLabel" />
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {match.authorName}
                </Text>
              </>
            ) : null}
            {match.authorName && match.extraInfo ? (
              <Text font="caption2" foregroundStyle="secondaryLabel">
                ·
              </Text>
            ) : null}
            {match.extraInfo ? (
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                {match.extraInfo}
              </Text>
            ) : null}
          </HStack>
        ) : null}
      </VStack>

      {/* 3. 右侧操作按钮列（若无可跳转链接，则展示复制信息按钮） */}
      <VStack alignment="trailing" spacing={6}>
        {match.pixivId ? (
          <NavigationLink
            value={`illust:${match.pixivId}`}
            buttonStyle="plain"
          >
            <HStack
              alignment="center"
              spacing={4}
              padding={{ vertical: 5, horizontal: 8 }}
              glassEffect={{ type: "rect", cornerRadius: 8 }}
              border={{ style: "#007AFF40", width: 1 }}
              clipShape={{ type: "rect", cornerRadius: 8 }}
              frame={{ width: 84, height: 28, alignment: "center" }}
            >
              <Image
                systemName="photo.stack"
                font="caption"
                foregroundStyle="#007AFF"
              />
              <Text
                font="caption"
                fontWeight="medium"
                foregroundStyle="#007AFF"
              >
                作品详情
              </Text>
            </HStack>
          </NavigationLink>
        ) : match.extUrls.length > 0 ? (
          <Button
            buttonStyle="plain"
            action={() => void presentExternalURL(match.extUrls[0])}
          >
            <HStack
              alignment="center"
              spacing={4}
              padding={{ vertical: 5, horizontal: 8 }}
              glassEffect={{ type: "rect", cornerRadius: 8 }}
              border={{ style: "#007AFF40", width: 1 }}
              clipShape={{ type: "rect", cornerRadius: 8 }}
              frame={{ width: 84, height: 28, alignment: "center" }}
            >
              <Image
                systemName="arrow.up.right.square"
                font="caption"
                foregroundStyle="#007AFF"
              />
              <Text
                font="caption"
                fontWeight="medium"
                foregroundStyle="#007AFF"
              >
                来源网页
              </Text>
            </HStack>
          </Button>
        ) : null}

        {match.authorId ? (
          <NavigationLink
            value={`user:${match.authorId}`}
            buttonStyle="plain"
          >
            <HStack
              alignment="center"
              spacing={4}
              padding={{ vertical: 5, horizontal: 8 }}
              glassEffect={{ type: "rect", cornerRadius: 8 }}
              border={{ style: "#007AFF40", width: 1 }}
              clipShape={{ type: "rect", cornerRadius: 8 }}
              frame={{ width: 84, height: 28, alignment: "center" }}
            >
              <Image
                systemName="person.crop.circle"
                font="caption"
                foregroundStyle="#007AFF"
              />
              <Text
                font="caption"
                fontWeight="medium"
                foregroundStyle="#007AFF"
              >
                作者主页
              </Text>
            </HStack>
          </NavigationLink>
        ) : match.authorUrl ? (
          <Button
            buttonStyle="plain"
            action={() => void presentExternalURL(match.authorUrl!)}
          >
            <HStack
              alignment="center"
              spacing={4}
              padding={{ vertical: 5, horizontal: 8 }}
              glassEffect={{ type: "rect", cornerRadius: 8 }}
              border={{ style: "#007AFF40", width: 1 }}
              clipShape={{ type: "rect", cornerRadius: 8 }}
              frame={{ width: 84, height: 28, alignment: "center" }}
            >
              <Image
                systemName="person.crop.circle"
                font="caption"
                foregroundStyle="#007AFF"
              />
              <Text
                font="caption"
                fontWeight="medium"
                foregroundStyle="#007AFF"
              >
                作者主页
              </Text>
            </HStack>
          </Button>
        ) : null}

        {!hasWorkAction && !hasAuthorAction ? (
          <Button
            buttonStyle="plain"
            action={handleCopyInfo}
          >
            <HStack
              alignment="center"
              spacing={4}
              padding={{ vertical: 5, horizontal: 8 }}
              glassEffect={{ type: "rect", cornerRadius: 8 }}
              border={{ style: "#007AFF40", width: 1 }}
              clipShape={{ type: "rect", cornerRadius: 8 }}
              frame={{ width: 84, height: 28, alignment: "center" }}
            >
              <Image
                systemName="doc.on.clipboard"
                font="caption"
                foregroundStyle="#007AFF"
              />
              <Text
                font="caption"
                fontWeight="medium"
                foregroundStyle="#007AFF"
              >
                复制信息
              </Text>
            </HStack>
          </Button>
        ) : null}
      </VStack>
    </HStack>
  )
}
