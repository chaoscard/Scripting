import {
  Button,
  Divider,
  HStack,
  Image,
  ScrollView,
  Slider,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useState,
  VStack,
  ZStack,
  type Color,
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
  type NovelFontWeight,
  type NovelLayoutDirection,
  type NovelLineSpacingLevel,
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
    saveNovelReaderSettings({
      ...DEFAULT_NOVEL_READER_SETTINGS,
      customBgExists: settings.customBgExists,
    })
  }, [settings.customBgExists])

  return (
    <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <VStack spacing={18} padding={{ horizontal: 16, top: 12, bottom: 32 }} frame={{ maxWidth: "infinity" }}>
        {/* 顶部标题栏 */}
        <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
          <Text font="headline" fontWeight="bold">
            阅读版式设置
          </Text>
          <Spacer />
          <Button
            buttonStyle="borderless"
            action={handleReset}
          >
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              重置
            </Text>
          </Button>
          {onClose ? (
            <Button
              title="完成"
              buttonStyle="borderedProminent"
              controlSize="small"
              action={onClose}
            />
          ) : null}
        </HStack>

        {/* 1. 阅读主题选择 */}
        <VStack
          alignment="leading"
          spacing={12}
          padding={14}
          glassEffect={{ type: "rect", cornerRadius: 14 }}
          frame={{ maxWidth: "infinity" }}
        >
          <HStack alignment="center">
            <Image systemName="paintpalette.fill" foregroundStyle="#007AFF" />
            <Text font="subheadline" fontWeight="bold">
              背景与主题
            </Text>
          </HStack>

          {/* 6 款预设色块 + 自定义壁纸入口 */}
          <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}>
            {THEME_ORDER.map((themeId) => {
              const theme = NOVEL_THEME_PALETTES[themeId]
              const isSelected = settings.themeId === themeId
              return (
                <VStack
                  key={themeId}
                  alignment="center"
                  spacing={4}
                  frame={{ maxWidth: "infinity" }}
                >
                  <ZStack
                    alignment="center"
                    frame={{ width: 40, height: 40 }}
                    glassEffect="circle"
                    contentShape="circle"
                    background={theme.previewColor}
                    border={isSelected ? { style: "#007AFF" as Color, width: 2.5 } : undefined}
                    onTapGesture={() => updateSetting({ themeId })}
                  >
                    {isSelected ? (
                      <Image
                        systemName="checkmark"
                        font="caption"
                        fontWeight="bold"
                        foregroundStyle={theme.isDark ? "#FFFFFF" : "#007AFF"}
                      />
                    ) : null}
                  </ZStack>
                  <Text font="caption2" foregroundStyle={isSelected ? "#007AFF" : "secondaryLabel"} lineLimit={1}>
                    {theme.name.slice(0, 4)}
                  </Text>
                </VStack>
              )
            })}

            {/* 相册自定义壁纸按钮 */}
            <VStack
              alignment="center"
              spacing={4}
              frame={{ maxWidth: "infinity" }}
            >
              <ZStack
                alignment="center"
                frame={{ width: 40, height: 40 }}
                glassEffect="circle"
                contentShape="circle"
                border={settings.themeId === "custom" ? { style: "#007AFF", width: 2.5 } : undefined}
                onTapGesture={() => {
                  if (settings.customBgExists) {
                    updateSetting({ themeId: "custom" })
                  } else {
                    void handlePickPhoto()
                  }
                }}
              >
                {settings.themeId === "custom" ? (
                  <Image
                    systemName="checkmark"
                    font="caption"
                    fontWeight="bold"
                    foregroundStyle="#007AFF"
                  />
                ) : (
                  <Image
                    systemName="photo.on.rectangle.angled"
                    font="callout"
                    foregroundStyle="secondaryLabel"
                  />
                )}
              </ZStack>
              <Text
                font="caption2"
                foregroundStyle={settings.themeId === "custom" ? "#007AFF" : "secondaryLabel"}
                lineLimit={1}
              >
                相册壁纸
              </Text>
            </VStack>
          </HStack>

          {/* 当选中相册壁纸时展开高级配置 */}
          {settings.themeId === "custom" ? (
            <VStack spacing={10} padding={{ top: 8 }} frame={{ maxWidth: "infinity" }}>
              <Divider />
              <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  壁纸操作
                </Text>
                <Spacer />
                <Button
                  title="更换壁纸"
                  buttonStyle="borderless"
                  font="footnote"
                  action={() => void handlePickPhoto()}
                />
                <Button
                  buttonStyle="borderless"
                  font="footnote"
                  action={() => removeCustomBackground()}
                >
                  <Text font="footnote" foregroundStyle="#FF3B30">
                    清除壁纸
                  </Text>
                </Button>
              </HStack>

              {/* 遮罩浓度调节 */}
              <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
                <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Text font="caption" foregroundStyle="secondaryLabel">
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
              </VStack>
            </VStack>
          ) : null}

          {photoError ? (
            <Text font="caption2" foregroundStyle="#FF3B30">
              {photoError}
            </Text>
          ) : null}
        </VStack>

        {/* 2. 排版方向切换 */}
        <VStack
          alignment="leading"
          spacing={10}
          padding={14}
          glassEffect={{ type: "rect", cornerRadius: 14 }}
          frame={{ maxWidth: "infinity" }}
        >
          <HStack alignment="center">
            <Image systemName="rectangle.and.text.magnifyingglass" foregroundStyle="#007AFF" />
            <Text font="subheadline" fontWeight="bold">
              排版方向
            </Text>
          </HStack>

          <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
            <Button
              buttonStyle="plain"
              frame={{ maxWidth: "infinity" }}
              action={() => updateSetting({ layoutDirection: "horizontal" })}
            >
              <HStack
                spacing={8}
                padding={12}
                alignment="center"
                glassEffect={{ type: "rect", cornerRadius: 10 }}
                background={settings.layoutDirection === "horizontal" ? "rgba(0, 122, 255, 0.12)" : undefined}
                border={
                  settings.layoutDirection === "horizontal"
                    ? { style: "#007AFF" as Color, width: 1.5 }
                    : undefined
                }
                frame={{ maxWidth: "infinity" }}
              >
                <Image
                  systemName="text.alignleft"
                  foregroundStyle={settings.layoutDirection === "horizontal" ? "#007AFF" : "secondaryLabel"}
                />
                <VStack alignment="leading" spacing={2}>
                  <Text
                    font="footnote"
                    fontWeight={settings.layoutDirection === "horizontal" ? "bold" : "regular"}
                    foregroundStyle={settings.layoutDirection === "horizontal" ? "#007AFF" : undefined}
                  >
                    横向排版
                  </Text>
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    极速原生平铺
                  </Text>
                </VStack>
                <Spacer />
                {settings.layoutDirection === "horizontal" ? (
                  <Image systemName="checkmark.circle.fill" font="caption" foregroundStyle="#007AFF" />
                ) : null}
              </HStack>
            </Button>

            <Button
              buttonStyle="plain"
              frame={{ maxWidth: "infinity" }}
              action={() => updateSetting({ layoutDirection: "vertical" })}
            >
              <HStack
                spacing={8}
                padding={12}
                alignment="center"
                glassEffect={{ type: "rect", cornerRadius: 10 }}
                background={settings.layoutDirection === "vertical" ? "rgba(0, 122, 255, 0.12)" : undefined}
                border={
                  settings.layoutDirection === "vertical"
                    ? { style: "#007AFF" as Color, width: 1.5 }
                    : undefined
                }
                frame={{ maxWidth: "infinity" }}
              >
                <Image
                  systemName="text.vertical"
                  foregroundStyle={settings.layoutDirection === "vertical" ? "#007AFF" : "secondaryLabel"}
                />
                <VStack alignment="leading" spacing={2}>
                  <Text
                    font="footnote"
                    fontWeight={settings.layoutDirection === "vertical" ? "bold" : "regular"}
                    foregroundStyle={settings.layoutDirection === "vertical" ? "#007AFF" : undefined}
                  >
                    竖向文库本
                  </Text>
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    标点旋转与假名
                  </Text>
                </VStack>
                <Spacer />
                {settings.layoutDirection === "vertical" ? (
                  <Image systemName="checkmark.circle.fill" font="caption" foregroundStyle="#007AFF" />
                ) : null}
              </HStack>
            </Button>
          </HStack>
        </VStack>

        {/* 3. 字体与字重 */}
        <VStack
          alignment="leading"
          spacing={12}
          padding={14}
          glassEffect={{ type: "rect", cornerRadius: 14 }}
          frame={{ maxWidth: "infinity" }}
        >
          <HStack alignment="center">
            <Image systemName="textformat" foregroundStyle="#007AFF" />
            <Text font="subheadline" fontWeight="bold">
              字体
            </Text>
          </HStack>

          {/* 4 款预设系统字体 */}
          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            {PRESET_FONTS.map((item) => {
              const isSelected = settings.fontId === item.id
              return (
                <Button
                  key={item.id}
                  buttonStyle="plain"
                  frame={{ maxWidth: "infinity" }}
                  action={() => updateSetting({ fontId: item.id })}
                >
                  <VStack
                    spacing={4}
                    padding={10}
                    alignment="center"
                    glassEffect={{ type: "rect", cornerRadius: 8 }}
                    background={isSelected ? "rgba(0, 122, 255, 0.12)" : undefined}
                    border={isSelected ? { style: "#007AFF" as Color, width: 1.5 } : undefined}
                    frame={{ maxWidth: "infinity" }}
                  >
                    <Text
                      font="footnote"
                      fontWeight={isSelected ? "bold" : "regular"}
                      foregroundStyle={isSelected ? "#007AFF" : undefined}
                      lineLimit={1}
                    >
                      {item.name}
                    </Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {item.desc}
                    </Text>
                  </VStack>
                </Button>
              )
            })}
          </HStack>

          {/* 自定义字体（通过 iOS 原生字体选择器） */}
          <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
            <Button
              buttonStyle="bordered"
              frame={{ maxWidth: "infinity" }}
              action={() => void handlePickFont()}
            >
              <HStack spacing={6} alignment="center">
                <Image systemName="plus.circle.fill" foregroundStyle="#007AFF" />
                <Text font="subheadline" foregroundStyle="#007AFF">
                  从系统字体库选取（支持描述文件字体）...
                </Text>
              </HStack>
            </Button>

            {settings.fontId === "custom" && settings.customFontPostscriptName ? (
              <HStack
                spacing={8}
                padding={{ horizontal: 12, vertical: 8 }}
                glassEffect={{ type: "rect", cornerRadius: 8 }}
                alignment="center"
                frame={{ maxWidth: "infinity" }}
              >
                <Image systemName="checkmark.circle.fill" foregroundStyle="#34C759" />
                <VStack alignment="leading" spacing={2}>
                  <Text font="caption" fontWeight="bold">
                    当前自定义字体：{settings.customFontPostscriptName}
                  </Text>
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    已从系统字体库成功载入
                  </Text>
                </VStack>
                <Spacer />
                <Button
                  title="恢复预设"
                  buttonStyle="borderless"
                  font="caption"
                  action={() => updateSetting({ fontId: "system" })}
                />
              </HStack>
            ) : null}
          </VStack>

          {/* 字重调节 */}
          <Divider />
          <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              字重 (Weight)
            </Text>
            <Spacer />
            <HStack spacing={6}>
              {(["regular", "medium", "bold"] as NovelFontWeight[]).map((weight) => {
                const labels: Record<NovelFontWeight, string> = {
                  regular: "常规",
                  medium: "适中",
                  bold: "粗体",
                }
                const isSelected = settings.fontWeight === weight
                return (
                  <Button
                    key={weight}
                    title={labels[weight]}
                    buttonStyle={isSelected ? "borderedProminent" : "bordered"}
                    controlSize="small"
                    action={() => updateSetting({ fontWeight: weight })}
                  />
                )
              })}
            </HStack>
          </HStack>
        </VStack>

        {/* 4. 字号与行间距 */}
        <VStack
          alignment="leading"
          spacing={14}
          padding={14}
          glassEffect={{ type: "rect", cornerRadius: 14 }}
          frame={{ maxWidth: "infinity" }}
        >
          <HStack alignment="center">
            <Image systemName="textformat.size" foregroundStyle="#007AFF" />
            <Text font="subheadline" fontWeight="bold">
              字号与间距
            </Text>
            <Spacer />
            <Text font="footnote" fontWeight="bold" foregroundStyle="#007AFF">
              {settings.fontSize} pt
            </Text>
          </HStack>

          {/* 字号调节 Slider 与 A- / A+ 按钮 */}
          <HStack spacing={12} alignment="center" frame={{ maxWidth: "infinity" }}>
            <Button
              buttonStyle="bordered"
              controlSize="small"
              action={() => {
                const nextSize = Math.max(14, settings.fontSize - 1)
                updateSetting({ fontSize: nextSize })
              }}
            >
              <HStack spacing={2} alignment="center">
                <Text font="caption" fontWeight="bold">A</Text>
                <Text font="caption2">-</Text>
              </HStack>
            </Button>

            <Slider
              min={14}
              max={32}
              step={1}
              value={settings.fontSize}
              onChanged={(val) => updateSetting({ fontSize: Math.round(val) })}
            />

            <Button
              buttonStyle="bordered"
              controlSize="small"
              action={() => {
                const nextSize = Math.min(32, settings.fontSize + 1)
                updateSetting({ fontSize: nextSize })
              }}
            >
              <HStack spacing={2} alignment="center">
                <Text font="footnote" fontWeight="bold">A</Text>
                <Text font="caption2">+</Text>
              </HStack>
            </Button>
          </HStack>

          {/* 行间距分段 */}
          <Divider />
          <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              行间距
            </Text>
            <Spacer />
            <HStack spacing={6}>
              {(["compact", "normal", "loose"] as NovelLineSpacingLevel[]).map((level) => {
                const labels: Record<NovelLineSpacingLevel, string> = {
                  compact: "紧凑",
                  normal: "标准",
                  loose: "宽松",
                }
                const isSelected = settings.lineSpacingLevel === level
                return (
                  <Button
                    key={level}
                    title={labels[level]}
                    buttonStyle={isSelected ? "borderedProminent" : "bordered"}
                    controlSize="small"
                    action={() => updateSetting({ lineSpacingLevel: level })}
                  />
                )
              })}
            </HStack>
          </HStack>
        </VStack>

        {/* 底部云端状态提示 */}
        <HStack alignment="center" spacing={4} frame={{ maxWidth: "infinity" }}>
          <Spacer />
          <Image systemName="icloud.fill" font="caption2" foregroundStyle="secondaryLabel" />
          <Text font="caption2" foregroundStyle="secondaryLabel">
            版式设置已通过 iCloud 跨设备自动同步
          </Text>
          <Spacer />
        </HStack>
      </VStack>
    </ScrollView>
  )
}
