import {
  Button,
  Divider,
  Group,
  HStack,
  Image,
  Menu,
  NavigationStack,
  ScrollView,
  Slider,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useState,
  VStack,
} from "scripting"
import {
  DEFAULT_NOVEL_READER_SETTINGS,
  loadNovelReaderSettings,
  NOVEL_THEME_PALETTES,
  onNovelReaderSettingsChanged,
  removeCustomBackground,
  saveCustomBackground,
  saveNovelReaderSettings,
  type BuiltinFontId,
  type NovelReaderSettings,
  type NovelThemeId,
} from "../store/novelReaderSettings"

const PRESET_FONTS: { id: BuiltinFontId; name: string; desc: string }[] = [
  { id: "system", name: "系统默认", desc: "苹方 PingFang" },
  { id: "songti", name: "经典宋体", desc: "宋体 / 纸书感" },
  { id: "kaiti", name: "优美楷体", desc: "楷体 / 古雅" },
  { id: "yuanti", name: "柔和圆体", desc: "圆体 / 亲和" },
]

const THEME_ORDER: NovelThemeId[] = ["default", "parchment", "green", "tea", "dark", "oled"]

export function NovelTypographySheet(props: { onClose?: () => void }) {
  const { onClose } = props
  const [settings, setSettings] = useState<NovelReaderSettings>(() => loadNovelReaderSettings())
  const [isPickingFont, setIsPickingFont] = useState(false)
  const [isPickingPhoto, setIsPickingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  useEffect(() => {
    return onNovelReaderSettingsChanged((updated) => {
      setSettings(updated)
    })
  }, [])

  const updateSetting = useCallback((partial: Partial<NovelReaderSettings>) => {
    const updated = saveNovelReaderSettings(partial)
    setSettings(updated)
  }, [])

  const handlePickFont = useCallback(async () => {
    if (isPickingFont) return
    setIsPickingFont(true)
    try {
      if (typeof FontPicker !== "undefined" && typeof FontPicker.pickFont === "function") {
        const picked = await FontPicker.pickFont()
        if (picked && picked.trim().length > 0) {
          updateSetting({
            fontId: "custom",
            customFontPostscriptName: picked.trim(),
          })
        }
      }
    } catch {
      // 忽略选择器异常
    } finally {
      setIsPickingFont(false)
    }
  }, [isPickingFont, updateSetting])

  const handlePickPhoto = useCallback(async () => {
    if (isPickingPhoto) return
    setIsPickingPhoto(true)
    setPhotoError(null)
    try {
      if (typeof Photos !== "undefined" && typeof Photos.pickPhotos === "function") {
        const images = await Photos.pickPhotos(1)
        if (images && images.length > 0) {
          const success = await saveCustomBackground(images[0])
          if (success) {
            updateSetting({ themeId: "custom", customBgExists: true })
          } else {
            setPhotoError("保存背景图片失败，请重试")
          }
        }
      }
    } catch {
      setPhotoError("选取图片失败，请检查相册访问权限")
    } finally {
      setIsPickingPhoto(false)
    }
  }, [isPickingPhoto, updateSetting])

  const handleReset = useCallback(() => {
    try {
      if (typeof HapticFeedback !== "undefined") {
        HapticFeedback.notificationWarning()
      }
    } catch {
      // 忽略震动异常
    }
    const updated = saveNovelReaderSettings({
      ...DEFAULT_NOVEL_READER_SETTINGS,
      customBgExists: settings.customBgExists,
    })
    setSettings(updated)
  }, [settings.customBgExists])

  return (
    <NavigationStack>
      <ScrollView
        navigationTitle="版式"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: onClose
            ? [
                <Button
                  title="关闭"
                  systemImage="xmark"
                  action={onClose}
                />,
              ]
            : undefined,
          topBarTrailing: [
            <Menu
              title="重置"
              systemImage="arrow.counterclockwise"
              primaryAction={() => {
                try {
                  if (typeof HapticFeedback !== "undefined") {
                    HapticFeedback.mediumImpact()
                  }
                } catch {
                  // 忽略震动异常
                }
              }}
            >
              <Button
                title="重置为默认版式"
                role="destructive"
                systemImage="arrow.counterclockwise"
                action={handleReset}
              />
            </Menu>,
            onClose ? (
              <Button
                title="完成"
                systemImage="checkmark"
                fontWeight="bold"
                action={onClose}
              />
            ) : undefined,
          ].filter(Boolean) as any,
        }}
      >
        <VStack spacing={20} padding={{ horizontal: 16, top: 12, bottom: 32 }} frame={{ maxWidth: "infinity" }}>
          {/* 1. 主题 */}
          <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
            <HStack spacing={6} alignment="center">
              <Image systemName="paintpalette.fill" font="headline" foregroundStyle="#007AFF" />
              <Text font="headline" fontWeight="bold">
                主题
              </Text>
            </HStack>

            <VStack
              spacing={0}
              glassEffect={{ type: "rect", cornerRadius: 14 }}
              contentShape={{ type: "rect", cornerRadius: 14 }}
              frame={{ maxWidth: "infinity" }}
            >
              {/* 第一行：预设主题 */}
              <HStack alignment="center" padding={{ horizontal: 16, vertical: 13 }} frame={{ maxWidth: "infinity" }}>
                <Text font="body">预设主题</Text>
                <Spacer />
                <Menu
                  label={
                    <HStack spacing={4} alignment="center">
                      <Text font="body" foregroundStyle="secondaryLabel">
                        {settings.themeId !== "custom"
                          ? NOVEL_THEME_PALETTES[settings.themeId]?.name ?? "系统主题"
                          : "选择主题"}
                      </Text>
                      <Image systemName="chevron.up.chevron.down" font="caption2" foregroundStyle="tertiaryLabel" />
                    </HStack>
                  }
                >
                  {THEME_ORDER.map((themeId) => {
                    const theme = NOVEL_THEME_PALETTES[themeId]
                    const isSelected = settings.themeId === themeId
                    return (
                      <Button
                        key={themeId}
                        title={theme.name}
                        systemImage={isSelected ? "checkmark" : undefined}
                        action={() => updateSetting({ themeId })}
                      />
                    )
                  })}
                </Menu>
              </HStack>

              <Divider padding={{ leading: 16 }} />

              {/* 第二行：自定义主题 */}
              <HStack alignment="center" padding={{ horizontal: 16, vertical: 13 }} frame={{ maxWidth: "infinity" }}>
                <Text font="body">自定义主题</Text>
                <Spacer />
                <Button
                  buttonStyle="plain"
                  action={() => void handlePickPhoto()}
                >
                  <HStack spacing={6} alignment="center">
                    <Text font="body" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {settings.customBgExists && settings.themeId === "custom"
                        ? "已启用相册壁纸"
                        : "从相册选取"}
                    </Text>
                    <Image
                      systemName="photo.on.rectangle.angled"
                      font="body"
                      foregroundStyle="secondaryLabel"
                    />
                  </HStack>
                </Button>
              </HStack>

              {/* 当自定义壁纸存在且已选用自定义主题时，提供高级遮罩调节 */}
              {settings.themeId === "custom" && settings.customBgExists ? (
                <VStack spacing={10} padding={{ horizontal: 16, top: 8, bottom: 12 }} frame={{ maxWidth: "infinity" }}>
                  <Divider />
                  <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                      背景暗度遮罩 ({Math.round(settings.customBgMaskOpacity * 100)}%)
                    </Text>
                    <Spacer />
                    <HStack spacing={6}>
                      <Button
                        title="暗色遮罩"
                        buttonStyle={settings.customBgMaskColor === "black" ? "borderedProminent" : "bordered"}
                        controlSize="mini"
                        action={() => updateSetting({ customBgMaskColor: "black" })}
                      />
                      <Button
                        title="浅色遮罩"
                        buttonStyle={settings.customBgMaskColor === "white" ? "borderedProminent" : "bordered"}
                        controlSize="mini"
                        action={() => updateSetting({ customBgMaskColor: "white" })}
                      />
                    </HStack>
                  </HStack>

                  <Slider
                    min={0.0}
                    max={0.8}
                    step={0.05}
                    value={settings.customBgMaskOpacity}
                    onChanged={(val) => updateSetting({ customBgMaskOpacity: val })}
                  />

                  <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
                    <Spacer />
                    <Button
                      buttonStyle="borderless"
                      controlSize="small"
                      action={() => removeCustomBackground()}
                    >
                      <Text font="footnote" foregroundStyle="#FF3B30">
                        清除相册壁纸
                      </Text>
                    </Button>
                  </HStack>
                </VStack>
              ) : null}

              {photoError ? (
                <Text font="caption2" foregroundStyle="#FF3B30" padding={{ horizontal: 16, bottom: 8 }}>
                  {photoError}
                </Text>
              ) : null}
            </VStack>
          </VStack>

          {/* 2. 排版 */}
          <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
            <HStack spacing={6} alignment="center">
              <Image systemName="rectangle.and.text.magnifyingglass" font="headline" foregroundStyle="#007AFF" />
              <Text font="headline" fontWeight="bold">
                排版
              </Text>
            </HStack>

            <VStack
              spacing={0}
              glassEffect={{ type: "rect", cornerRadius: 14 }}
              contentShape={{ type: "rect", cornerRadius: 14 }}
              frame={{ maxWidth: "infinity" }}
            >
              {/* 方向 */}
              <HStack alignment="center" padding={{ horizontal: 16, vertical: 13 }} frame={{ maxWidth: "infinity" }}>
                <Text font="body">方向</Text>
                <Spacer />
                <Menu
                  label={
                    <HStack spacing={4} alignment="center">
                      <Text font="body" foregroundStyle="secondaryLabel">
                        {settings.layoutDirection === "horizontal" ? "横排" : "竖排"}
                      </Text>
                      <Image systemName="chevron.up.chevron.down" font="caption2" foregroundStyle="tertiaryLabel" />
                    </HStack>
                  }
                >
                  <Button
                    title="横排"
                    systemImage={settings.layoutDirection === "horizontal" ? "checkmark" : undefined}
                    action={() => updateSetting({ layoutDirection: "horizontal" })}
                  />
                  <Button
                    title="竖排"
                    systemImage={settings.layoutDirection === "vertical" ? "checkmark" : undefined}
                    action={() => updateSetting({ layoutDirection: "vertical" })}
                  />
                </Menu>
              </HStack>

              <Divider padding={{ leading: 16 }} />

              {/* 行距 */}
              <HStack alignment="center" padding={{ horizontal: 16, vertical: 13 }} frame={{ maxWidth: "infinity" }}>
                <Text font="body">行距</Text>
                <Spacer />
                <Menu
                  label={
                    <HStack spacing={4} alignment="center">
                      <Text font="body" foregroundStyle="secondaryLabel">
                        {settings.lineSpacingLevel === "compact"
                          ? "紧凑"
                          : settings.lineSpacingLevel === "loose"
                          ? "宽松"
                          : "标准"}
                      </Text>
                      <Image systemName="chevron.up.chevron.down" font="caption2" foregroundStyle="tertiaryLabel" />
                    </HStack>
                  }
                >
                  <Button
                    title="紧凑"
                    systemImage={settings.lineSpacingLevel === "compact" ? "checkmark" : undefined}
                    action={() => updateSetting({ lineSpacingLevel: "compact" })}
                  />
                  <Button
                    title="标准"
                    systemImage={settings.lineSpacingLevel === "normal" ? "checkmark" : undefined}
                    action={() => updateSetting({ lineSpacingLevel: "normal" })}
                  />
                  <Button
                    title="宽松"
                    systemImage={settings.lineSpacingLevel === "loose" ? "checkmark" : undefined}
                    action={() => updateSetting({ lineSpacingLevel: "loose" })}
                  />
                </Menu>
              </HStack>
            </VStack>
          </VStack>

          {/* 3. 字体 */}
          <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
            <HStack spacing={6} alignment="center">
              <Text font="headline" fontWeight="bold" foregroundStyle="#007AFF">
                Aa
              </Text>
              <Text font="headline" fontWeight="bold">
                字体
              </Text>
            </HStack>

            <VStack
              spacing={0}
              glassEffect={{ type: "rect", cornerRadius: 14 }}
              contentShape={{ type: "rect", cornerRadius: 14 }}
              frame={{ maxWidth: "infinity" }}
            >
              {/* 第一行：字体（预设字体菜单） */}
              <HStack alignment="center" padding={{ horizontal: 16, vertical: 13 }} frame={{ maxWidth: "infinity" }}>
                <Text font="body">字体</Text>
                <Spacer />
                <Menu
                  label={
                    <HStack spacing={4} alignment="center">
                      <Text font="body" foregroundStyle="secondaryLabel">
                        {settings.fontId !== "custom"
                          ? PRESET_FONTS.find((f) => f.id === settings.fontId)?.name ?? "系统默认"
                          : "自定义字体"}
                      </Text>
                      <Image systemName="chevron.up.chevron.down" font="caption2" foregroundStyle="tertiaryLabel" />
                    </HStack>
                  }
                >
                  {PRESET_FONTS.map((item) => {
                    const isSelected = settings.fontId === item.id
                    return (
                      <Button
                        key={item.id}
                        title={item.name}
                        systemImage={isSelected ? "checkmark" : undefined}
                        action={() => updateSetting({ fontId: item.id })}
                      />
                    )
                  })}
                </Menu>
              </HStack>

              <Divider padding={{ leading: 16 }} />

              {/* 第二行：自定义字体 */}
              <HStack alignment="center" padding={{ horizontal: 16, vertical: 13 }} frame={{ maxWidth: "infinity" }}>
                <Text font="body">自定义字体</Text>
                <Spacer />
                <Button
                  buttonStyle="plain"
                  action={() => void handlePickFont()}
                >
                  <HStack spacing={4} alignment="center">
                    <Text font="body" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {settings.fontId === "custom" && settings.customFontPostscriptName
                        ? settings.customFontPostscriptName
                        : "从系统字体库选取"}
                    </Text>
                    <Image
                      systemName="chevron.right"
                      font="footnote"
                      foregroundStyle="tertiaryLabel"
                    />
                  </HStack>
                </Button>
              </HStack>

              <Divider padding={{ leading: 16 }} />

              {/* 第三行：字重（纤细，标准，加粗） */}
              <HStack alignment="center" padding={{ horizontal: 16, vertical: 13 }} frame={{ maxWidth: "infinity" }}>
                <Text font="body">字重</Text>
                <Spacer />
                <Menu
                  label={
                    <HStack spacing={4} alignment="center">
                      <Text font="body" foregroundStyle="secondaryLabel">
                        {settings.fontWeight === "regular"
                          ? "纤细"
                          : settings.fontWeight === "bold"
                          ? "加粗"
                          : "标准"}
                      </Text>
                      <Image systemName="chevron.up.chevron.down" font="caption2" foregroundStyle="tertiaryLabel" />
                    </HStack>
                  }
                >
                  <Button
                    title="纤细"
                    systemImage={settings.fontWeight === "regular" ? "checkmark" : undefined}
                    action={() => updateSetting({ fontWeight: "regular" })}
                  />
                  <Button
                    title="标准"
                    systemImage={settings.fontWeight === "medium" ? "checkmark" : undefined}
                    action={() => updateSetting({ fontWeight: "medium" })}
                  />
                  <Button
                    title="加粗"
                    systemImage={settings.fontWeight === "bold" ? "checkmark" : undefined}
                    action={() => updateSetting({ fontWeight: "bold" })}
                  />
                </Menu>
              </HStack>

              <Divider padding={{ leading: 16 }} />

              {/* 第四行：字号（保留当前滑块） */}
              <VStack spacing={8} padding={{ horizontal: 16, vertical: 13 }} frame={{ maxWidth: "infinity" }}>
                <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Text font="body">字号</Text>
                  <Spacer />
                  <Text font="body" foregroundStyle="secondaryLabel">
                    {settings.fontSize} pt
                  </Text>
                </HStack>

                <HStack spacing={12} alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Button
                    buttonStyle="plain"
                    action={() => {
                      const nextSize = Math.max(14, settings.fontSize - 1)
                      updateSetting({ fontSize: nextSize })
                    }}
                  >
                    <Text font="subheadline" fontWeight="bold" foregroundStyle="#007AFF">
                      A -
                    </Text>
                  </Button>

                  <Slider
                    min={14}
                    max={32}
                    step={1}
                    value={settings.fontSize}
                    onChanged={(val) => updateSetting({ fontSize: Math.round(val) })}
                  />

                  <Button
                    buttonStyle="plain"
                    action={() => {
                      const nextSize = Math.min(32, settings.fontSize + 1)
                      updateSetting({ fontSize: nextSize })
                    }}
                  >
                    <Text font="subheadline" fontWeight="bold" foregroundStyle="#007AFF">
                      A +
                    </Text>
                  </Button>
                </HStack>
              </VStack>
            </VStack>
          </VStack>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

export default NovelTypographySheet
