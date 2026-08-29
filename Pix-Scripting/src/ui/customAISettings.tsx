import {
  Button,
  HStack,
  Image,
  List,
  Picker,
  Section,
  SecureField,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import {
  AI_PRESETS,
  deleteCustomAIProfile,
  getEffectiveGeneralEndpoint,
  getEffectiveImageGenEndpoint,
  getEffectiveImageGenKey,
  loadCustomAIProfile,
  onCustomAIConfigChanged,
  updateCustomAIProfile,
  isScriptingPro,
  type CustomAIProfile,
  type GeneralAIProtocol,
  type ImageGenAIProtocol,
} from "../store/customAI"
import {
  fetchRemoteModelList,
  testCustomImageGenConnection,
  type RemoteModelItem,
  type TestResult,
} from "../api/aiAdapters"

declare const Pasteboard: any
declare const Safari: any
declare const Haptics: any
declare const Dialog: any

export function CustomAISettingsView() {
  const [profile, setProfile] = useState<CustomAIProfile>(() => loadCustomAIProfile())
  const [showKeyText, setShowKeyText] = useState(false)
  const [showImageKeyText, setShowImageKeyText] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // 远程模型拉取与一体化连通状态
  const [fetchingModels, setFetchingModels] = useState(false)
  const [remoteModels, setRemoteModels] = useState<RemoteModelItem[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetchLatency, setFetchLatency] = useState<number | null>(null)

  // 生图模型测试状态
  const [testingImage, setTestingImage] = useState(false)
  const [imageTestResult, setImageTestResult] = useState<TestResult | null>(null)

  useEffect(() => {
    const unsub = onCustomAIConfigChanged((updated) => {
      setProfile({ ...updated })
    })
    return () => {
      unsub()
    }
  }, [])

  function updateGeneral(patch: Partial<CustomAIProfile["general"]>) {
    const next = updateCustomAIProfile({
      general: {
        ...profile.general,
        ...patch,
      },
    })
    setProfile(next)
  }

  function updateImageGen(patch: Partial<CustomAIProfile["imageGen"]>) {
    const next = updateCustomAIProfile({
      imageGen: {
        ...profile.imageGen,
        ...patch,
      },
    })
    setProfile(next)
    setImageTestResult(null)
  }

  function applyPreset(presetId: string) {
    const preset = AI_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    void Haptics.transient(0.3, 0.3)
    updateGeneral({
      preset: preset.id,
      protocol: preset.protocol,
      endpoint: "",
      model: "",
      supportsVision: preset.supportsVision,
      apiKey: "",
    })
    setRemoteModels([])
    setFetchError(null)
    setFetchLatency(null)
  }

  const currentPreset = useMemo(() => {
    if (profile.general.preset) {
      const p = AI_PRESETS.find((item) => item.id === profile.general.preset)
      if (p) return p
    }
    return null
  }, [profile.general.preset])

  const selectedPresetId = currentPreset?.id || ""

  const defaultGeneralEndpointPlaceholder = useMemo(() => {
    if (currentPreset?.defaultEndpoint) return currentPreset.defaultEndpoint
    if (profile.general.protocol === "gemini") return "https://generativelanguage.googleapis.com"
    if (profile.general.protocol === "anthropic") return "https://api.anthropic.com"
    return "https://api.openai.com"
  }, [currentPreset, profile.general.protocol])

  const defaultImageGenEndpointPlaceholder = useMemo(() => {
    if (profile.imageGen.protocol === "gemini-imagen") {
      return "https://generativelanguage.googleapis.com"
    }
    return "https://api.openai.com"
  }, [profile.imageGen.protocol])

  /**
   * 一键从剪贴板粘贴 API Key
   */
  async function handlePasteApiKey() {
    try {
      const text = await Pasteboard.getString()
      if (text && typeof text === "string" && text.trim()) {
        const trimmed = text.trim()
        updateGeneral({ apiKey: trimmed })
        void Haptics.transient(0.3, 0.4)
      } else {
        void Dialog.alert({
          title: "剪贴板未包含有效文本",
          message: "请先复制 API 密钥后再点击粘贴。",
        })
      }
    } catch (e) {
      console.log("Paste error:", e)
    }
  }

  /**
   * 打开对应提供商的官方获取 API Key 控制台
   */
  async function handleOpenApiKeyConsole() {
    if (currentPreset?.apiKeyUrl) {
      void Haptics.transient(0.2, 0.2)
      try {
        await Safari.present(currentPreset.apiKeyUrl)
      } catch {
        void Safari.openURL(currentPreset.apiKeyUrl)
      }
    }
  }

  /**
   * 校验 API Key 并拉取远程可用模型列表（一体化连通性测试）
   */
  async function handleFetchRemoteModels() {
    if (!profile.general.apiKey) {
      void Dialog.alert({
        title: "请输入 API 密钥",
        message: "请先填入或粘贴有效的 API Key 后再进行连接验证。",
      })
      return
    }

    setFetchingModels(true)
    setFetchError(null)
    setFetchLatency(null)

    const startTime = Date.now()
    try {
      const effectiveEndpoint = getEffectiveGeneralEndpoint(profile.general)
      const res = await fetchRemoteModelList(
        profile.general.protocol,
        effectiveEndpoint,
        profile.general.apiKey,
        profile.general.preset
      )

      const latency = Date.now() - startTime
      setFetchLatency(latency)

      if (res.success && res.models.length > 0) {
        setRemoteModels(res.models)
        void Haptics.transient(0.4, 0.6)

        // 若当前模型未设置或不在列表中，自动选中第一个推荐模型
        const currentModelInList = res.models.some((m) => m.id === profile.general.model)
        if (!currentModelInList || !profile.general.model) {
          const recommended = res.models.find((m) => m.isVisionRecommended) || res.models[0]
          updateGeneral({
            model: recommended.id,
            supportsVision: Boolean(recommended.isVisionRecommended),
          })
        }
      } else {
        setFetchError(res.error || "未在远端获取到可用模型")
        void Haptics.transient(0.5, 0.2)
      }
    } catch (err: any) {
      setFetchError(err?.message || "连接失败，请检查网络或密钥有效性")
    } finally {
      setFetchingModels(false)
    }
  }

  function handleSelectRemoteModel(modelId: string) {
    if (!modelId) return
    const targetModel = remoteModels.find((m) => m.id === modelId)
    const isVision = targetModel ? Boolean(targetModel.isVisionRecommended) : profile.general.supportsVision
    updateGeneral({
      model: modelId,
      supportsVision: isVision,
    })
  }

  async function handleTestImageConnection() {
    const effectiveKey = getEffectiveImageGenKey(profile)
    const effectiveEndpoint = getEffectiveImageGenEndpoint(profile.imageGen)
    if (!effectiveEndpoint || !profile.imageGen.model || !effectiveKey) {
      void Dialog.alert({
        title: "生图配置不完整",
        message: "请先填写完整的生图模型名称与有效 API 密钥。",
      })
      return
    }

    setTestingImage(true)
    setImageTestResult(null)
    try {
      const res = await testCustomImageGenConnection(profile.imageGen, effectiveKey)
      setImageTestResult(res)
    } finally {
      setTestingImage(false)
    }
  }

  async function handleDeleteAll() {
    const confirmed = await Dialog.confirm({
      title: "清空所有自定义 AI 配置",
      message:
        "此操作将永久清空本地 Keychain 与 iCloud 钥匙串中保存的端点、模型与 API 密钥。确定继续吗？",
      confirmLabel: "彻底删除",
      cancelLabel: "取消",
    })

    if (confirmed) {
      deleteCustomAIProfile()
      setProfile(loadCustomAIProfile())
      setRemoteModels([])
      setFetchLatency(null)
      setFetchError(null)
      setImageTestResult(null)
      void Dialog.alert({
        title: "已清空",
        message: "自定义 AI 配置已彻底删除。",
      })
    }
  }

  const imageGenCandidates = remoteModels.filter((m) => m.isImageGenRecommended)

  return (
    <List
      navigationTitle="AI 助手设置"
      navigationBarTitleDisplayMode="inline"
    >
      {/* 顶部 PRO 会员状态与免 PRO 解锁提示横幅 */}
      <Section header={<Text>运行环境</Text>}>
        {isScriptingPro() ? (
          <HStack spacing={10} alignment="top">
            <Image systemName="crown.fill" font="title3" foregroundStyle="systemYellow" />
            <VStack alignment="leading" spacing={4}>
              <Text font="headline" foregroundStyle="label">
                已激活 Scripting PRO
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                Scripting 原生 Assistant 已就绪。配置自定义模型后将优先调用您的专属大模型。
              </Text>
            </VStack>
          </HStack>
        ) : (
          <HStack spacing={10} alignment="top">
            <Image systemName="sparkles" font="title3" foregroundStyle="systemBlue" />
            <VStack alignment="leading" spacing={4}>
              <Text font="headline" foregroundStyle="label">
                自定义 AI 免费解锁
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                未开通 PRO 会员？填入您的 API 密钥（支持 DeepSeek、OpenAI、OpenCode、Gemini 等），即可免费使用完整 AI 助手功能。
              </Text>
            </VStack>
          </HStack>
        )}
      </Section>

      {/* 核心配置（小白极简三步上手） */}
      <Section
        header={<Text>AI 助手配置</Text>}
        footer={
          <Text>
            {currentPreset?.description
              ? `当前提供商：${currentPreset.description}。配置完成后，简介翻译、轻小说 AI 总结/续写与漫画 OCR 将自动生效。`
              : "配置完成后，简介翻译、轻小说 AI 总结/续写与漫画 OCR 将自动生效。"}
          </Text>
        }
      >
        {/* 1. 提供商选择 */}
        <Picker
          title="服务提供商"
          value={selectedPresetId}
          onChanged={(value: string) => {
            if (value) applyPreset(value)
          }}
        >
          {AI_PRESETS.map((preset) => (
            <Text key={preset.id} tag={preset.id}>
              {preset.name}
            </Text>
          ))}
        </Picker>

        {/* 2. API 密钥输入（带粘贴与明密文查看） */}
        <HStack spacing={8} alignment="center">
          <Text font="body" frame={{ width: 80, alignment: "leading" }}>API 密钥</Text>
          {showKeyText ? (
            <TextField
              title="API 密钥"
              prompt="在此粘贴 sk-..."
              value={profile.general.apiKey}
              onChanged={(val) => updateGeneral({ apiKey: val })}
              textContentType="password"
              autocorrectionDisabled={true}
              textInputAutocapitalization="never"
              keyboardType="asciiCapable"
            />
          ) : (
            <SecureField
              title="API 密钥"
              prompt="在此粘贴 sk-..."
              value={profile.general.apiKey}
              onChanged={(val) => updateGeneral({ apiKey: val })}
              textContentType="password"
              autocorrectionDisabled={true}
              textInputAutocapitalization="never"
              keyboardType="asciiCapable"
            />
          )}
          <Button
            buttonStyle="plain"
            action={handlePasteApiKey}
          >
            <HStack spacing={2} alignment="center">
              <Image systemName="doc.on.clipboard" foregroundStyle="systemBlue" />
              <Text font="caption" foregroundStyle="systemBlue">粘贴</Text>
            </HStack>
          </Button>
          <Button
            buttonStyle="plain"
            action={() => setShowKeyText(!showKeyText)}
          >
            <Image
              systemName={showKeyText ? "eye.slash" : "eye"}
              foregroundStyle="secondaryLabel"
            />
          </Button>
        </HStack>

        {/* 官方 Key 获取直达入口 */}
        {currentPreset?.apiKeyUrl ? (
          <HStack spacing={6} alignment="center">
            <Image systemName="arrow.up.forward.app" font="caption" foregroundStyle="systemBlue" />
            <Button buttonStyle="plain" action={handleOpenApiKeyConsole}>
              <Text font="caption" foregroundStyle="systemBlue">
                {`去 ${currentPreset.name} 官方控制台获取 API Key ↗`}
              </Text>
            </Button>
          </HStack>
        ) : null}

        {/* 3. 一键验证与模型选择 */}
        {remoteModels.length > 0 ? (
          <>
            {/* 成功连接状态横幅 */}
            <HStack spacing={6} alignment="center">
              <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" />
              <Text font="caption" foregroundStyle="systemGreen">
                {`已连接 · 延迟 ${fetchLatency != null ? `${fetchLatency}ms` : "正常"} · 可用模型 ${remoteModels.length} 个`}
              </Text>
              <Spacer />
              <Button
                buttonStyle="plain"
                disabled={fetchingModels}
                action={handleFetchRemoteModels}
              >
                <HStack spacing={2} alignment="center">
                  <Image
                    systemName={fetchingModels ? "arrow.triangle.2.circlepath" : "arrow.clockwise"}
                    font="caption"
                    foregroundStyle="secondaryLabel"
                  />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {fetchingModels ? "刷新中…" : "重新拉取"}
                  </Text>
                </HStack>
              </Button>
            </HStack>

            {/* 模型下拉选择器 */}
            <Picker
              title="选择模型"
              value={profile.general.model}
              onChanged={(val: string) => handleSelectRemoteModel(val)}
            >
              {remoteModels.map((m) => (
                <Text key={m.id} tag={m.id}>
                  {m.isVisionRecommended ? `[👁 视觉] ${m.name || m.id}` : m.name || m.id}
                </Text>
              ))}
            </Picker>
          </>
        ) : (
          <>
            {/* 未拉取时的一键验证与加载按钮 */}
            <HStack spacing={8} alignment="center">
              <Button
                buttonStyle="borderedProminent"
                disabled={fetchingModels || !profile.general.apiKey}
                action={handleFetchRemoteModels}
              >
                <HStack spacing={6} alignment="center">
                  <Image
                    systemName={fetchingModels ? "arrow.triangle.2.circlepath" : "bolt.badge.checkmark.fill"}
                  />
                  <Text font="body">
                    {fetchingModels ? "正在验证并加载可用模型…" : "验证密钥并加载模型"}
                  </Text>
                </HStack>
              </Button>
            </HStack>

            {/* 失败错误提示 */}
            {fetchError ? (
              <HStack spacing={4} alignment="center">
                <Image systemName="exclamationmark.circle.fill" foregroundStyle="systemRed" />
                <Text font="caption" foregroundStyle="systemRed" lineLimit={2}>
                  {fetchError}
                </Text>
              </HStack>
            ) : null}

            {/* 未拉取时提供手动模型输入框作为兜底 */}
            <HStack spacing={8} alignment="center">
              <Text font="body" frame={{ width: 80, alignment: "leading" }}>模型名称</Text>
              <TextField
                title="模型名称"
                prompt="点击上方按钮拉取，或手动输入"
                value={profile.general.model}
                onChanged={(val) => updateGeneral({ model: val })}
              />
            </HStack>
          </>
        )}
      </Section>

      {/* 高级设置（折叠收纳进阶参数） */}
      <Section
        header={<Text>高级与自定义参数</Text>}
        footer={
          showAdvanced ? (
            <Text>
              若使用第三方中转站或自建反向代理，请在上方填写自定义端点地址。修改协议类型可匹配自建服务格式。
            </Text>
          ) : undefined
        }
      >
        <Toggle
          title="展开高级参数设置"
          value={showAdvanced}
          onChanged={(val) => setShowAdvanced(val)}
        />

        {showAdvanced ? (
          <>
            <Picker
              title="协议类型"
              value={profile.general.protocol}
              onChanged={(val: string) => {
                const newProtocol = val as GeneralAIProtocol
                updateGeneral({
                  protocol: newProtocol,
                })
                setRemoteModels([])
                setFetchLatency(null)
              }}
            >
              <Text tag="openai-responses">OpenAI Responses</Text>
              <Text tag="openai-chat">OpenAI Chat</Text>
              <Text tag="gemini">Google Gemini</Text>
              <Text tag="anthropic">Anthropic Claude</Text>
            </Picker>

            <HStack spacing={8} alignment="center">
              <Text font="body" frame={{ width: 80, alignment: "leading" }}>端点地址</Text>
              <TextField
                title="端点地址"
                prompt={defaultGeneralEndpointPlaceholder}
                value={profile.general.endpoint}
                onChanged={(val) => updateGeneral({ endpoint: val })}
              />
            </HStack>

            <Toggle
              title="模型支持视觉识别 (Vision / OCR)"
              value={profile.general.supportsVision}
              onChanged={(val) => updateGeneral({ supportsVision: val })}
            />

            {/* 独立生图模型配置 */}
            <Toggle
              title="启用独立生图模型 (漫画重绘/汉化)"
              value={profile.imageGen.enabled}
              onChanged={(val) => updateImageGen({ enabled: val })}
            />

            {profile.imageGen.enabled ? (
              <>
                <Picker
                  title="生图协议"
                  value={profile.imageGen.protocol}
                  onChanged={(val: string) => updateImageGen({ protocol: val as ImageGenAIProtocol })}
                >
                  <Text tag="openai-images">OpenAI Images</Text>
                  <Text tag="openai-responses">OpenAI Responses</Text>
                  <Text tag="gemini-imagen">Google Imagen</Text>
                </Picker>

                <HStack spacing={8} alignment="center">
                  <Text font="body" frame={{ width: 80, alignment: "leading" }}>端点地址</Text>
                  <TextField
                    title="端点地址"
                    prompt={defaultImageGenEndpointPlaceholder}
                    value={profile.imageGen.endpoint}
                    onChanged={(val) => updateImageGen({ endpoint: val })}
                  />
                </HStack>

                {imageGenCandidates.length > 0 ? (
                  <Picker
                    title="生图模型"
                    value={profile.imageGen.model}
                    onChanged={(val: string) => updateImageGen({ model: val })}
                  >
                    {imageGenCandidates.map((m) => (
                      <Text key={m.id} tag={m.id}>
                        {`[🎨 生图] ${m.name || m.id}`}
                      </Text>
                    ))}
                  </Picker>
                ) : (
                  <HStack spacing={8} alignment="center">
                    <Text font="body" frame={{ width: 80, alignment: "leading" }}>模型名称</Text>
                    <TextField
                      title="模型名称"
                      prompt="例如 dall-e-3 / flux-1.1-pro"
                      value={profile.imageGen.model}
                      onChanged={(val) => updateImageGen({ model: val })}
                    />
                  </HStack>
                )}

                <Toggle
                  title="复用通用模型 API 密钥"
                  value={profile.imageGen.reuseGeneralKey}
                  onChanged={(val) => updateImageGen({ reuseGeneralKey: val })}
                />

                {!profile.imageGen.reuseGeneralKey ? (
                  <HStack spacing={8} alignment="center">
                    <Text font="body" frame={{ width: 80, alignment: "leading" }}>生图密钥</Text>
                    {showImageKeyText ? (
                      <TextField
                        title="生图密钥"
                        prompt="sk-..."
                        value={profile.imageGen.apiKey}
                        onChanged={(val) => updateImageGen({ apiKey: val })}
                        textContentType="password"
                        autocorrectionDisabled={true}
                        textInputAutocapitalization="never"
                        keyboardType="asciiCapable"
                      />
                    ) : (
                      <SecureField
                        title="生图密钥"
                        prompt="sk-..."
                        value={profile.imageGen.apiKey}
                        onChanged={(val) => updateImageGen({ apiKey: val })}
                        textContentType="password"
                        autocorrectionDisabled={true}
                        textInputAutocapitalization="never"
                        keyboardType="asciiCapable"
                      />
                    )}
                    <Button
                      buttonStyle="plain"
                      action={() => setShowImageKeyText(!showImageKeyText)}
                    >
                      <Image
                        systemName={showImageKeyText ? "eye.slash" : "eye"}
                        foregroundStyle="secondaryLabel"
                      />
                    </Button>
                  </HStack>
                ) : null}

                <HStack spacing={8} alignment="center">
                  <Button
                    buttonStyle="glass"
                    disabled={testingImage}
                    action={handleTestImageConnection}
                  >
                    <HStack spacing={6} alignment="center">
                      <Image systemName="photo.badge.checkmark" foregroundStyle="systemPurple" />
                      <Text font="body">{testingImage ? "正在测试生图…" : "测试生图模型连接"}</Text>
                    </HStack>
                  </Button>
                  <Spacer />
                  {imageTestResult ? (
                    <HStack spacing={4} alignment="center">
                      <Image
                        systemName={imageTestResult.success ? "checkmark.circle.fill" : "xmark.circle.fill"}
                        foregroundStyle={imageTestResult.success ? "systemGreen" : "systemRed"}
                      />
                      <Text
                        font="caption"
                        foregroundStyle={imageTestResult.success ? "systemGreen" : "systemRed"}
                      >
                        {imageTestResult.success
                          ? `成功 (${imageTestResult.latencyMs}ms)`
                          : imageTestResult.error || "连接失败"}
                      </Text>
                    </HStack>
                  ) : null}
                </HStack>
              </>
            ) : null}
          </>
        ) : null}
      </Section>

      {/* 危险操作区 */}
      <Section>
        <Button
          role="destructive"
          action={handleDeleteAll}
        >
          <HStack spacing={6} alignment="center">
            <Image systemName="trash.fill" foregroundStyle="systemRed" />
            <Text foregroundStyle="systemRed">清空并删除所有自定义 AI 配置</Text>
          </HStack>
        </Button>
      </Section>
    </List>
  )
}
