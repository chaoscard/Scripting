import {
  Button,
  HStack,
  Image,
  List,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useState,
} from "scripting"
import {
  AI_PRESETS,
  deleteCustomAIProfile,
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
  testCustomAIConnection,
  testCustomImageGenConnection,
  type RemoteModelItem,
  type TestResult,
} from "../api/aiAdapters"

export function CustomAISettingsView() {
  const [profile, setProfile] = useState<CustomAIProfile>(() => loadCustomAIProfile())
  const [showKeyText, setShowKeyText] = useState(false)
  const [showImageKeyText, setShowImageKeyText] = useState(false)

  // 远程模型列表拉取状态
  const [fetchingModels, setFetchingModels] = useState(false)
  const [remoteModels, setRemoteModels] = useState<RemoteModelItem[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetchSuccessCount, setFetchSuccessCount] = useState<number | null>(null)
  const [manualModelInput, setManualModelInput] = useState(false)

  // 通用模型测试状态
  const [testingGeneral, setTestingGeneral] = useState(false)
  const [generalTestResult, setGeneralTestResult] = useState<TestResult | null>(null)

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
    setGeneralTestResult(null)
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
    updateGeneral({
      protocol: preset.protocol,
      endpoint: preset.defaultEndpoint,
      model: preset.defaultModel,
      supportsVision: preset.supportsVision,
    })
    setRemoteModels([])
    setFetchError(null)
    setFetchSuccessCount(null)
  }

  /**
   * 校验 API Key 并拉取远程可用模型列表
   */
  async function handleFetchRemoteModels() {
    if (!profile.general.apiKey) {
      void Dialog.alert({
        title: "请输入 API 密钥",
        message: "校验与拉取模型列表需要提供有效的 API Key。",
      })
      return
    }

    setFetchingModels(true)
    setFetchError(null)
    setFetchSuccessCount(null)

    try {
      const res = await fetchRemoteModelList(
        profile.general.protocol,
        profile.general.endpoint,
        profile.general.apiKey
      )

      if (res.success && res.models.length > 0) {
        setRemoteModels(res.models)
        setFetchSuccessCount(res.models.length)

        // 若当前模型不在列表中且列表不为空，自动选中第一个
        const currentModelInList = res.models.some((m) => m.id === profile.general.model)
        if (!currentModelInList && res.models.length > 0) {
          const firstModel = res.models[0]
          updateGeneral({
            model: firstModel.id,
            supportsVision: Boolean(firstModel.isVisionRecommended),
          })
        }
      } else {
        setFetchError(res.error || "未在远端获取到可用模型")
      }
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

  async function handleTestGeneralConnection() {
    if (!profile.general.endpoint || !profile.general.model || !profile.general.apiKey) {
      void Dialog.alert({
        title: "配置不完整",
        message: "请先填写完整的端点地址、模型名称与 API 密钥后再进行连接测试。",
      })
      return
    }

    setTestingGeneral(true)
    setGeneralTestResult(null)
    try {
      const res = await testCustomAIConnection(profile.general)
      setGeneralTestResult(res)
    } finally {
      setTestingGeneral(false)
    }
  }

  async function handleTestImageConnection() {
    const effectiveKey = getEffectiveImageGenKey(profile)
    if (!profile.imageGen.endpoint || !profile.imageGen.model || !effectiveKey) {
      void Dialog.alert({
        title: "生图配置不完整",
        message: "请先填写完整的生图端点、模型名称与有效 API 密钥。",
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
      title: "删除所有自定义 AI 配置",
      message:
        "此操作将永久清空本地 Keychain 与 iCloud 钥匙串中保存的端点、模型与 API 密钥。确定继续吗？",
      confirmLabel: "彻底删除",
      cancelLabel: "取消",
    })

    if (confirmed) {
      deleteCustomAIProfile()
      setProfile(loadCustomAIProfile())
      setRemoteModels([])
      setFetchSuccessCount(null)
      setFetchError(null)
      setGeneralTestResult(null)
      setImageTestResult(null)
      void Dialog.alert({
        title: "已清空",
        message: "自定义 AI 配置及 iCloud 钥匙串凭证已彻底删除。",
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
      <Section
        header={<Text>会员与运行环境</Text>}
      >
        {isScriptingPro() ? (
          <HStack spacing={10} alignment="top">
            <Image systemName="crown.fill" font="title3" foregroundStyle="systemYellow" />
            <VStack alignment="leading" spacing={4}>
              <Text font="headline" foregroundStyle="label">
                已激活 Scripting PRO
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                Scripting 原生 Assistant 已就绪。配置自定义模型后将优先走您的专属大模型，享受 OpenAI Responses、DeepSeek-R1 深度推理等高级定制体验。
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
                无需 Scripting PRO 会员。只需在下方填入您自备的 API Key（如 DeepSeek、OpenAI、Gemini、Claude 等），即可免费使用完整 AI 翻译、小说总结续写与漫画 OCR 气泡汉化。
              </Text>
            </VStack>
          </HStack>
        )}
      </Section>

      {/* 预设与快速填充 */}
      <Section
        header={<Text>快速预设配置</Text>}
        footer={<Text>选择预设可快速填入对应提供商的默认端点与推荐模型，您只需填入个人 API Key 即可一键拉取与使用。</Text>}
      >
        <Picker
          title="选择提供商预设"
          value=""
          onChanged={(value: string) => {
            if (value) applyPreset(value)
          }}
        >
          <Text tag="">点击选择预设并一键填入…</Text>
          {AI_PRESETS.map((preset) => (
            <Text key={preset.id} tag={preset.id}>
              {preset.name}
            </Text>
          ))}
        </Picker>
      </Section>

      {/* 通用模型配置 */}
      <Section
        header={<Text>通用模型配置（翻译 / OCR / 总结续写）</Text>}
        footer={
          <Text>
            填入 API Key 后点击“校验密钥并拉取模型”，即可从服务商获取完整可用模型列表并智能识别视觉（Vision）能力。
          </Text>
        }
      >
        <Picker
          title="协议类型"
          value={profile.general.protocol}
          onChanged={(val: string) => {
            updateGeneral({ protocol: val as GeneralAIProtocol })
            setRemoteModels([])
            setFetchSuccessCount(null)
          }}
        >
          <Text tag="openai-responses">OpenAI Responses (/v1/responses)</Text>
          <Text tag="openai-chat">OpenAI Chat (/v1/chat/completions)</Text>
          <Text tag="gemini">Google Gemini (GenerateContent)</Text>
          <Text tag="anthropic">Anthropic Claude (/v1/messages)</Text>
        </Picker>

        <HStack spacing={8} alignment="center">
          <Text font="body" frame={{ width: 80 }}>端点地址</Text>
          <TextField
            title="端点地址"
            prompt="例如 https://api.openai.com"
            value={profile.general.endpoint}
            onChanged={(val) => updateGeneral({ endpoint: val })}
          />
        </HStack>

        <HStack spacing={8} alignment="center">
          <Text font="body" frame={{ width: 80 }}>API 密钥</Text>
          <TextField
            title="API 密钥"
            prompt="sk-..."
            value={
              showKeyText
                ? profile.general.apiKey
                : profile.general.apiKey
                ? "••••••••••••••••••••••••"
                : ""
            }
            onChanged={(val) => {
              if (showKeyText || !profile.general.apiKey) {
                updateGeneral({ apiKey: val })
              }
            }}
          />
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

        {/* 现代化的校验与拉取模型按钮 */}
        <HStack spacing={8} alignment="center">
          <Button
            buttonStyle="glass"
            disabled={fetchingModels || !profile.general.apiKey}
            action={handleFetchRemoteModels}
          >
            <HStack spacing={6} alignment="center">
              <Image
                systemName="arrow.triangle.2.circlepath.circle.fill"
                foregroundStyle={profile.general.apiKey ? "systemBlue" : "secondaryLabel"}
              />
              <Text font="body">
                {fetchingModels ? "正在校验与拉取…" : "校验密钥并拉取模型列表"}
              </Text>
            </HStack>
          </Button>
          <Spacer />
          {fetchSuccessCount != null ? (
            <HStack spacing={4} alignment="center">
              <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" />
              <Text font="caption" foregroundStyle="systemGreen">
                已拉取 {fetchSuccessCount} 个模型
              </Text>
            </HStack>
          ) : null}
          {fetchError ? (
            <HStack spacing={4} alignment="center">
              <Image systemName="exclamationmark.circle.fill" foregroundStyle="systemRed" />
              <Text font="caption" foregroundStyle="systemRed" lineLimit={1}>
                {fetchError}
              </Text>
            </HStack>
          ) : null}
        </HStack>

        {/* 模型选择：远端列表 Picker 或 手动输入 TextField */}
        {remoteModels.length > 0 && !manualModelInput ? (
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
        ) : (
          <HStack spacing={8} alignment="center">
            <Text font="body" frame={{ width: 80 }}>模型名称</Text>
            <TextField
              title="模型名称"
              prompt="例如 gpt-4o / deepseek-chat"
              value={profile.general.model}
              onChanged={(val) => updateGeneral({ model: val })}
            />
          </HStack>
        )}

        {remoteModels.length > 0 ? (
          <HStack spacing={8} alignment="center">
            <Spacer />
            <Button
              buttonStyle="plain"
              action={() => setManualModelInput(!manualModelInput)}
            >
              <Text font="caption" foregroundStyle="systemBlue">
                {manualModelInput ? "切换为从已拉取列表中选择" : "手动输入自定义模型名称"}
              </Text>
            </Button>
          </HStack>
        ) : null}

        <Toggle
          title="模型支持视觉识别 (Vision / OCR)"
          value={profile.general.supportsVision}
          onChanged={(val) => updateGeneral({ supportsVision: val })}
        />

        {/* 通用模型连接测试 */}
        <HStack spacing={8} alignment="center">
          <Button
            buttonStyle="glass"
            disabled={testingGeneral}
            action={handleTestGeneralConnection}
          >
            <HStack spacing={6} alignment="center">
              <Image systemName="bolt.horizontal.fill" foregroundStyle="systemBlue" />
              <Text font="body">{testingGeneral ? "正在测试连通性…" : "测试通用模型连通性"}</Text>
            </HStack>
          </Button>
          <Spacer />
          {generalTestResult ? (
            <HStack spacing={4} alignment="center">
              <Image
                systemName={generalTestResult.success ? "checkmark.circle.fill" : "xmark.circle.fill"}
                foregroundStyle={generalTestResult.success ? "systemGreen" : "systemRed"}
              />
              <Text
                font="caption"
                foregroundStyle={generalTestResult.success ? "systemGreen" : "systemRed"}
              >
                {generalTestResult.success
                  ? `测试成功 (${generalTestResult.latencyMs}ms)`
                  : generalTestResult.error || "连接失败"}
              </Text>
            </HStack>
          ) : null}
        </HStack>
      </Section>

      {/* 独立生图模型配置 */}
      <Section
        header={<Text>生图模型配置（漫画生图汉化 / 重绘）</Text>}
        footer={
          <Text>
            若您需要使用独立模型（如 DALL-E 3、FLUX 或 Google Imagen）进行高质量汉化生图，可开启此项。
          </Text>
        }
      >
        <Toggle
          title="启用独立生图模型"
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
              <Text tag="openai-images">OpenAI Images (/v1/images/generations)</Text>
              <Text tag="openai-responses">OpenAI Responses (多模态输出)</Text>
              <Text tag="gemini-imagen">Google Imagen (predict)</Text>
            </Picker>

            <HStack spacing={8} alignment="center">
              <Text font="body" frame={{ width: 80 }}>端点地址</Text>
              <TextField
                title="端点地址"
                prompt="例如 https://api.openai.com"
                value={profile.imageGen.endpoint}
                onChanged={(val) => updateImageGen({ endpoint: val })}
              />
            </HStack>

            {/* 若远端拉取到了生图候选模型，展示快捷 Picker */}
            {imageGenCandidates.length > 0 ? (
              <Picker
                title="推荐生图模型"
                value={profile.imageGen.model}
                onChanged={(val: string) => updateImageGen({ model: val })}
              >
                {imageGenCandidates.map((m) => (
                  <Text key={m.id} tag={m.id}>
                    {`[🎨 生图] ${m.name || m.id}`}
                  </Text>
                ))}
              </Picker>
            ) : null}

            <HStack spacing={8} alignment="center">
              <Text font="body" frame={{ width: 80 }}>模型名称</Text>
              <TextField
                title="模型名称"
                prompt="例如 dall-e-3 / flux-1.1-pro"
                value={profile.imageGen.model}
                onChanged={(val) => updateImageGen({ model: val })}
              />
            </HStack>

            <Toggle
              title="复用通用模型 API 密钥"
              value={profile.imageGen.reuseGeneralKey}
              onChanged={(val) => updateImageGen({ reuseGeneralKey: val })}
            />

            {!profile.imageGen.reuseGeneralKey ? (
              <HStack spacing={8} alignment="center">
                <Text font="body" frame={{ width: 80 }}>生图密钥</Text>
                <TextField
                  title="生图密钥"
                  prompt="sk-..."
                  value={
                    showImageKeyText
                      ? profile.imageGen.apiKey
                      : profile.imageGen.apiKey
                      ? "••••••••••••••••••••••••"
                      : ""
                  }
                  onChanged={(val) => {
                    if (showImageKeyText || !profile.imageGen.apiKey) {
                      updateImageGen({ apiKey: val })
                    }
                  }}
                />
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

            {/* 生图模型连接测试 */}
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
                      : imageTestResult.error || "测试失败"}
                  </Text>
                </HStack>
              ) : null}
            </HStack>
          </>
        ) : null}
      </Section>

      {/* 数据同步与存储管理 */}
      <Section header={<Text>数据同步与安全管理</Text>}>
        <Toggle
          value={profile.syncToICloud}
          onChanged={(val) => {
            const updated = updateCustomAIProfile({ syncToICloud: val })
            setProfile(updated)
          }}
        >
          <VStack alignment="leading" spacing={2}>
            <Text font="body">iCloud 钥匙串同步</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              开启后通过 Apple 账号端到端加密同步至所有 Apple 设备
            </Text>
          </VStack>
        </Toggle>

        <Button
          role="destructive"
          action={handleDeleteAll}
        >
          <HStack spacing={8} alignment="center">
            <Image systemName="trash" foregroundStyle="systemRed" />
            <Text font="body" foregroundStyle="systemRed">
              删除所有自定义 AI 配置 (同步清除 iCloud Keychain)
            </Text>
          </HStack>
        </Button>
      </Section>

      {/* 底部安全与隐私保障提示 */}
      <Section
        footer={
          <VStack alignment="leading" spacing={6}>
            <HStack spacing={4} alignment="center">
              <Image systemName="lock.shield.fill" font="caption" foregroundStyle="systemGreen" />
              <Text font="caption" fontWeight="bold" foregroundStyle="secondaryLabel">
                端到端加密与安全隐私保障
              </Text>
            </HStack>
            <Text font="caption" foregroundStyle="tertiaryLabel">
              1. 您的 API 密钥与端点地址均安全存储于 iOS 系统 Keychain 中（启用 iCloud 同步时通过 Apple 钥匙串端到端高强度加密同步）。
            </Text>
            <Text font="caption" foregroundStyle="tertiaryLabel">
              2. 自定义 AI 请求直接由本设备安全发起至您填写的端点地址，绝不经过任何第三方服务器中转，亦绝不会明文记录在本地日志或普通文件中。
            </Text>
            <Text font="caption" foregroundStyle="tertiaryLabel">
              3. 自定义 AI 模型优先级高于 Scripting 内置 Assistant；若禁用或未配置，则自动回退至内置 Assistant。
            </Text>
          </VStack>
        }
      >
        <Text font="caption" foregroundStyle="secondaryLabel">
          配置已自动实时保存
        </Text>
      </Section>
    </List>
  )
}
