import {
  Button,
  HStack,
  Image,
  Label,
  List,
  Picker,
  Section,
  SecureField,
  Spacer,
  Text,
  TextField,
  Toggle,
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

  // 远程模型拉取与一体化连通状态
  const [fetchingModels, setFetchingModels] = useState(false)
  const [remoteModels, setRemoteModels] = useState<RemoteModelItem[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetchLatency, setFetchLatency] = useState<number | null>(null)

  // 生图模型拉取与测试状态
  const [fetchingImageModels, setFetchingImageModels] = useState(false)
  const [imageRemoteModels, setImageRemoteModels] = useState<RemoteModelItem[]>([])
  const [imageFetchError, setImageFetchError] = useState<string | null>(null)
  const [imageFetchLatency, setImageFetchLatency] = useState<number | null>(null)
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
    if (profile.general.preset === "custom") return "https://api.example.com"
    if (currentPreset?.defaultEndpoint) return currentPreset.defaultEndpoint
    if (!profile.general.preset) return "https://api.example.com"
    if (profile.general.protocol === "gemini") return "https://generativelanguage.googleapis.com"
    if (profile.general.protocol === "anthropic") return "https://api.anthropic.com"
    return "https://api.openai.com"
  }, [currentPreset, profile.general.preset, profile.general.protocol])

  const defaultImageGenEndpointPlaceholder = useMemo(() => {
    if (profile.imageGen.protocol === "gemini-imagen") {
      return "https://generativelanguage.googleapis.com"
    }
    return "https://api.openai.com"
  }, [profile.imageGen.protocol])

  /**
   * 一键从剪贴板粘贴 API Key
   */
  async function handlePasteApiKey(isImageKey = false) {
    try {
      const text = await Pasteboard.getString()
      if (text && typeof text === "string" && text.trim()) {
        const trimmed = text.trim()
        if (isImageKey) {
          updateImageGen({ apiKey: trimmed })
        } else {
          updateGeneral({ apiKey: trimmed })
        }
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
   * 校验 API Key 并拉取远程可用模型列表
   */
  async function handleFetchRemoteModels() {
    if (!profile.general.noKeyRequired && !profile.general.apiKey) {
      void Dialog.alert({
        title: "请输入 API 密钥",
        message: "请先填入或粘贴有效的 API Key 后再进行连接验证。",
      })
      return
    }

    const effectiveEndpoint = getEffectiveGeneralEndpoint(profile.general)
    if (!effectiveEndpoint) {
      void Dialog.alert({
        title: "请输入 API 地址",
        message: "自定义模式需先填入有效的 API 地址后再进行连接验证。",
      })
      return
    }

    setFetchingModels(true)
    setFetchError(null)
    setFetchLatency(null)

    const startTime = Date.now()
    try {
      const res = await fetchRemoteModelList(
        profile.general.protocol,
        effectiveEndpoint,
        profile.general.apiKey,
        profile.general.preset,
        profile.general.noKeyRequired
      )

      const latency = Date.now() - startTime
      setFetchLatency(latency)

      if (res.success && res.models.length > 0) {
        setRemoteModels(res.models)
        void Haptics.transient(0.4, 0.6)

        // 若当前模型未设置或不在列表中，自动选中第一个可用模型
        const currentModelInList = res.models.some((m) => m.id === profile.general.model)
        if (!currentModelInList || !profile.general.model) {
          updateGeneral({
            model: res.models[0].id,
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
    updateGeneral({
      model: modelId,
    })
  }

  async function handleFetchImageModels() {
    const effectiveKey = getEffectiveImageGenKey(profile)
    if (!profile.general.noKeyRequired && !effectiveKey) {
      void Dialog.alert({
        title: "请输入生图密钥",
        message: "请先填入生图 API 密钥或开启复用通用密钥。",
      })
      return
    }

    const effectiveEndpoint = getEffectiveImageGenEndpoint(profile.imageGen)
    if (!effectiveEndpoint) {
      void Dialog.alert({
        title: "请输入生图端点地址",
        message: "需先填入有效的生图 API 端点地址后再进行拉取。",
      })
      return
    }

    setFetchingImageModels(true)
    setImageFetchError(null)
    setImageFetchLatency(null)

    const startTime = Date.now()
    try {
      const generalProtocol: GeneralAIProtocol =
        profile.imageGen.protocol === "gemini-imagen" ? "gemini" : "openai-responses"
      const res = await fetchRemoteModelList(
        generalProtocol,
        effectiveEndpoint,
        effectiveKey,
        undefined,
        profile.general.noKeyRequired
      )

      const latency = Date.now() - startTime
      setImageFetchLatency(latency)

      if (res.success && res.models.length > 0) {
        setImageRemoteModels(res.models)
        void Haptics.transient(0.4, 0.6)

        const currentInList = res.models.some((m) => m.id === profile.imageGen.model)
        if (!currentInList || !profile.imageGen.model) {
          updateImageGen({
            model: res.models[0].id,
          })
        }
      } else {
        setImageFetchError(res.error || "未在远端获取到可用生图模型")
        void Haptics.transient(0.5, 0.2)
      }
    } catch (err: any) {
      setImageFetchError(err?.message || "连接失败，请检查生图端点与网络")
    } finally {
      setFetchingImageModels(false)
    }
  }

  async function handleDeleteAll() {
    const confirmed = await Dialog.confirm({
      title: "清空所有自定义 AI 配置",
      message:
        "此操作将永久清空本地钥匙串与 iCloud 钥匙串中保存的端点、模型与 API 密钥。确定继续吗？",
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

  function handleImageProtocolChange(protocol: ImageGenAIProtocol) {
    updateImageGen({
      protocol,
    })
    setImageRemoteModels([])
    setImageFetchLatency(null)
    setImageFetchError(null)
  }

  return (
    <List
      navigationTitle="AI 模型配置"
      navigationBarTitleDisplayMode="inline"
      listSectionSpacing="compact"
    >
      {/* 1. 通用模型 */}
      <Section
        header={<Text>通用模型</Text>}
        footer={
          fetchError ? (
            <Text foregroundStyle="systemRed">{fetchError}</Text>
          ) : fetchLatency != null && remoteModels.length > 0 ? (
            <Text foregroundStyle="secondaryLabel">
              {`已连接 · 延迟 ${fetchLatency}ms · 可用模型 ${remoteModels.length} 个`}
            </Text>
          ) : currentPreset?.apiKeyUrl && !profile.general.noKeyRequired ? (
            <HStack spacing={4} alignment="center">
              <Spacer />
              <Button buttonStyle="plain" action={handleOpenApiKeyConsole}>
                <Text font="caption" foregroundStyle="systemBlue">
                  去官方获取密钥 ↗
                </Text>
              </Button>
            </HStack>
          ) : undefined
        }
      >
        <Picker
          title="提供商"
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

        {!profile.general.noKeyRequired ? (
          <HStack spacing={10} alignment="center">
            {showKeyText ? (
              <TextField
                title="API 密钥"
                prompt="在此粘贴 sk-..."
                value={profile.general.apiKey}
                onChanged={(val) => updateGeneral({ apiKey: val })}
                autocorrectionDisabled={true}
                textInputAutocapitalization="never"
              />
            ) : (
              <SecureField
                title="API 密钥"
                prompt="在此粘贴 sk-..."
                value={profile.general.apiKey}
                onChanged={(val) => updateGeneral({ apiKey: val })}
              />
            )}
            <Button buttonStyle="plain" action={() => handlePasteApiKey(false)}>
              <Image systemName="doc.on.clipboard" foregroundStyle="systemBlue" />
            </Button>
            <Button buttonStyle="plain" action={() => setShowKeyText(!showKeyText)}>
              <Image
                systemName={showKeyText ? "eye.slash" : "eye"}
                foregroundStyle="secondaryLabel"
              />
            </Button>
          </HStack>
        ) : null}

        <Toggle
          title="无需密钥"
          value={Boolean(profile.general.noKeyRequired)}
          onChanged={(val) => updateGeneral({ noKeyRequired: val })}
        />

        <Picker
          title="API 协议"
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
          <Text tag="openai-responses">Responses API</Text>
          <Text tag="openai-chat">Chat Completions</Text>
          <Text tag="gemini">Google Gemini</Text>
          <Text tag="anthropic">Anthropic Claude</Text>
        </Picker>

        <TextField
          title="API 端点"
          prompt={defaultGeneralEndpointPlaceholder}
          value={profile.general.endpoint}
          onChanged={(val) => updateGeneral({ endpoint: val })}
        />

        {remoteModels.length > 0 ? (
          <HStack spacing={10} alignment="center">
            <Picker
              title="选择模型"
              value={profile.general.model}
              onChanged={(val: string) => handleSelectRemoteModel(val)}
            >
              {remoteModels.map((m) => (
                <Text key={m.id} tag={m.id}>
                  {m.name || m.id}
                </Text>
              ))}
            </Picker>
            <Button
              buttonStyle="plain"
              disabled={fetchingModels}
              action={handleFetchRemoteModels}
            >
              <Image
                systemName={fetchingModels ? "arrow.triangle.2.circlepath" : "arrow.clockwise"}
                foregroundStyle="systemBlue"
              />
            </Button>
          </HStack>
        ) : (
          <HStack spacing={10} alignment="center">
            <TextField
              title="通用模型"
              prompt=""
              value={profile.general.model}
              onChanged={(val) => updateGeneral({ model: val })}
            />
            <Button
              buttonStyle="plain"
              disabled={fetchingModels || (!profile.general.apiKey && !profile.general.noKeyRequired)}
              action={handleFetchRemoteModels}
            >
              <Image
                systemName={fetchingModels ? "arrow.triangle.2.circlepath" : "icloud.and.arrow.down"}
                foregroundStyle={profile.general.apiKey || profile.general.noKeyRequired ? "systemBlue" : "secondaryLabel"}
              />
            </Button>
          </HStack>
        )}

        <Toggle
          title="支持视觉识别"
          value={profile.general.supportsVision}
          onChanged={(val) => updateGeneral({ supportsVision: val })}
        />
      </Section>

      {/* 2. 生图模型 */}
      <Section
        header={<Text>生图模型</Text>}
      >
        <Toggle
          title="独立生图模型"
          value={profile.imageGen.enabled}
          onChanged={(val) => updateImageGen({ enabled: val })}
        />

        {profile.imageGen.enabled ? (
          <>
            <Toggle
              title="复用通用模型 API 密钥"
              value={profile.imageGen.reuseGeneralKey}
              onChanged={(val) => updateImageGen({ reuseGeneralKey: val })}
            />

            {!profile.imageGen.reuseGeneralKey ? (
              <HStack spacing={10} alignment="center">
                {showImageKeyText ? (
                  <TextField
                    title="生图密钥"
                    prompt="在此粘贴 sk-..."
                    value={profile.imageGen.apiKey}
                    onChanged={(val) => updateImageGen({ apiKey: val })}
                    autocorrectionDisabled={true}
                    textInputAutocapitalization="never"
                  />
                ) : (
                  <SecureField
                    title="生图密钥"
                    prompt="在此粘贴 sk-..."
                    value={profile.imageGen.apiKey}
                    onChanged={(val) => updateImageGen({ apiKey: val })}
                  />
                )}
                <Button buttonStyle="plain" action={() => handlePasteApiKey(true)}>
                  <Image systemName="doc.on.clipboard" foregroundStyle="systemBlue" />
                </Button>
                <Button buttonStyle="plain" action={() => setShowImageKeyText(!showImageKeyText)}>
                  <Image
                    systemName={showImageKeyText ? "eye.slash" : "eye"}
                    foregroundStyle="secondaryLabel"
                  />
                </Button>
              </HStack>
            ) : null}

            <Picker
              title="生图协议"
              value={profile.imageGen.protocol}
              onChanged={(val: string) => handleImageProtocolChange(val as ImageGenAIProtocol)}
            >
              <Text tag="openai-images">OpenAI Images</Text>
              <Text tag="openai-responses">OpenAI Responses</Text>
              <Text tag="gemini-imagen">Google Imagen</Text>
            </Picker>

            <TextField
              title="生图端点"
              prompt={defaultImageGenEndpointPlaceholder}
              value={profile.imageGen.endpoint}
              onChanged={(val) => updateImageGen({ endpoint: val })}
            />

            {imageRemoteModels.length > 0 ? (
              <HStack spacing={10} alignment="center">
                <Picker
                  title="生图模型"
                  value={profile.imageGen.model}
                  onChanged={(val: string) => updateImageGen({ model: val })}
                >
                  {imageRemoteModels.map((m) => (
                    <Label
                      key={m.id}
                      tag={m.id}
                      title={m.name || m.id}
                      systemImage="paintbrush"
                    />
                  ))}
                </Picker>
                <Button
                  buttonStyle="plain"
                  disabled={fetchingImageModels}
                  action={handleFetchImageModels}
                >
                  <Image
                    systemName={fetchingImageModels ? "arrow.triangle.2.circlepath" : "arrow.clockwise"}
                    foregroundStyle="systemBlue"
                  />
                </Button>
              </HStack>
            ) : (
              <HStack spacing={10} alignment="center">
                <TextField
                  title="生图模型"
                  prompt=""
                  value={profile.imageGen.model}
                  onChanged={(val) => updateImageGen({ model: val })}
                />
                <Button
                  buttonStyle="plain"
                  disabled={fetchingImageModels}
                  action={handleFetchImageModels}
                >
                  <Image
                    systemName={fetchingImageModels ? "arrow.triangle.2.circlepath" : "icloud.and.arrow.down"}
                    foregroundStyle={
                      profile.general.apiKey || profile.imageGen.apiKey || profile.general.noKeyRequired
                        ? "systemBlue"
                        : "secondaryLabel"
                    }
                  />
                </Button>
              </HStack>
            )}

            {imageFetchError ? (
              <HStack spacing={4} alignment="center">
                <Image systemName="exclamationmark.circle.fill" foregroundStyle="systemRed" />
                <Text font="caption" foregroundStyle="systemRed" lineLimit={2}>
                  {imageFetchError}
                </Text>
              </HStack>
            ) : imageFetchLatency != null && imageRemoteModels.length > 0 ? (
              <HStack spacing={4} alignment="center">
                <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" />
                <Text font="caption" foregroundStyle="systemGreen">
                  {`已连接 · 延迟 ${imageFetchLatency}ms · 可用生图模型 ${imageRemoteModels.length} 个`}
                </Text>
              </HStack>
            ) : null}

            {imageTestResult ? (
              <HStack spacing={4} alignment="center">
                <Image
                  systemName={imageTestResult.success ? "checkmark.circle.fill" : "xmark.circle.fill"}
                  foregroundStyle={imageTestResult.success ? "systemGreen" : "systemRed"}
                />
                <Text
                  font="caption"
                  foregroundStyle={imageTestResult.success ? "systemGreen" : "systemRed"}
                  lineLimit={2}
                >
                  {imageTestResult.success
                    ? `生图接口连通正常 · 延迟 ${imageTestResult.latencyMs}ms`
                    : imageTestResult.error || "连接失败"}
                </Text>
              </HStack>
            ) : null}
          </>
        ) : null}
      </Section>

      {/* 3. 清空配置 */}
      <Section>
        <Button
          title="清空所有自定义 AI 配置"
          role="destructive"
          action={handleDeleteAll}
        />
      </Section>
    </List>
  )
}
