import {
  Button,
  HStack,
  Image,
  NavigationStack,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  type Color,
} from "scripting"
import { triggerHaptic } from "../../platform/haptics"
import { sheetTopBar } from "./pageChrome"
import { loadSettings, updateSettings } from "../../store/settings"

interface FeatureItem {
  id: string
  title: string
  description: string
  symbol: string
  iconColor: Color
  iconBg: Color
}

const IPAD_SPLIT_FEATURES: FeatureItem[] = [
  {
    id: "dualColumn",
    title: "双栏并列浏览",
    description: "左边刷列表，右边看作品，浏览不被打断，再也不用反复返回。",
    symbol: "rectangle.split.2x1.fill",
    iconColor: "white",
    iconBg: "systemBlue",
  },
  {
    id: "detailView",
    title: "作品大屏展开",
    description: "点击作品卡片右栏即刻大屏展示，沉浸品味画作与正文。",
    symbol: "rectangle.portrait.and.arrow.forward",
    iconColor: "white",
    iconBg: "systemGreen",
  },
  {
    id: "proportions",
    title: "左右比例随心调",
    description: "横屏与竖屏支持自由调节分栏宽度，量身定制舒适的大屏视角。",
    symbol: "slider.horizontal.2.square",
    iconColor: "white",
    iconBg: "systemIndigo",
  },
  {
    id: "control",
    title: "随时自由开关",
    description: "可在「我的 → 应用设置 → 外观布局」随时切换单栏或双栏。",
    symbol: "hand.tap.fill",
    iconColor: "white",
    iconBg: "systemOrange",
  },
]

export function IpadSplitViewNoticeSheet(props: { onClose: () => void }) {
  const { onClose } = props

  const handleDismiss = (enableSplit: boolean) => {
    try {
      triggerHaptic("light")
    } catch {}
    const updates: any = {
      hasSeenIpadSplitViewNotice: true,
    }
    if (enableSplit) {
      updates.splitViewEnabledLandscape = true
      updates.splitViewEnabledPortrait = true
    }
    updateSettings(updates)
    onClose()
  }

  const currentSettings = loadSettings()
  const isAlreadyEnabled =
    currentSettings.splitViewEnabledLandscape ||
    currentSettings.splitViewEnabledPortrait

  return (
    <NavigationStack
      presentationDetents={["large"]}
      presentationDragIndicator="visible"
    >
      <VStack
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        {...sheetTopBar()}
        navigationTitle="iPad 平行视界"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button action={() => handleDismiss(false)}>
              <Image systemName="xmark" font="headline" />
            </Button>
          ),
        }}
      >
        <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <VStack
            alignment="leading"
            spacing={18}
            padding={{ horizontal: 20, top: 10, bottom: 20 }}
          >
            {/* 顶部标题区 */}
            <VStack
              alignment="center"
              spacing={8}
              frame={{ maxWidth: "infinity", alignment: "center" }}
              padding={{ top: 4, bottom: 6 }}
            >
              <ZStack
                alignment="center"
                frame={{ width: 52, height: 52 }}
                background="systemBlue"
                clipShape={{ type: "rect", cornerRadius: 16 }}
                shadow={{ color: "rgba(0, 122, 255, 0.32)", radius: 10, y: 3 }}
              >
                <Image
                  systemName="rectangle.split.2x1"
                  font={26}
                  foregroundStyle="white"
                />
              </ZStack>
              <Text font="title3" fontWeight="bold">
                iPad 平行视界
              </Text>
              <Text font="subheadline" foregroundStyle="secondaryLabel">
                在大屏上，边逛边看
              </Text>
            </VStack>

            {/* 核心特性列表 */}
            <VStack spacing={16}>
              {IPAD_SPLIT_FEATURES.map((item) => (
                <HStack
                  key={item.id}
                  spacing={14}
                  alignment="center"
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  <ZStack
                    alignment="center"
                    frame={{ width: 42, height: 42 }}
                    background={item.iconBg}
                    clipShape={{ type: "rect", cornerRadius: 12 }}
                  >
                    <Image
                      systemName={item.symbol}
                      font={19}
                      foregroundStyle={item.iconColor}
                    />
                  </ZStack>

                  <VStack
                    alignment="leading"
                    spacing={3}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    <Text font="body" fontWeight="semibold">
                      {item.title}
                    </Text>
                    <Text
                      font="footnote"
                      foregroundStyle="secondaryLabel"
                      lineLimit={2}
                    >
                      {item.description}
                    </Text>
                  </VStack>
                </HStack>
              ))}
            </VStack>

            {/* 底部操作按钮 */}
            <VStack spacing={10} padding={{ top: 16 }} frame={{ maxWidth: "infinity" }}>
              {isAlreadyEnabled ? (
                <Button
                  action={() => handleDismiss(false)}
                  buttonStyle="borderedProminent"
                  controlSize="large"
                  frame={{ maxWidth: "infinity" }}
                >
                  <Text font="headline" fontWeight="bold" foregroundStyle="white">
                    开始探索
                  </Text>
                </Button>
              ) : (
                <>
                  <Button
                    action={() => handleDismiss(true)}
                    buttonStyle="borderedProminent"
                    controlSize="large"
                    frame={{ maxWidth: "infinity" }}
                  >
                    <Text font="headline" fontWeight="bold" foregroundStyle="white">
                      开启平行视界并开始探索
                    </Text>
                  </Button>
                  <Button
                    action={() => handleDismiss(false)}
                    buttonStyle="plain"
                    controlSize="regular"
                    frame={{ maxWidth: "infinity" }}
                  >
                    <Text font="subheadline" foregroundStyle="secondaryLabel">
                      稍后在设置中开启
                    </Text>
                  </Button>
                </>
              )}
            </VStack>
          </VStack>
        </ScrollView>
      </VStack>
    </NavigationStack>
  )
}

export default function IpadSplitViewNoticePreview() {
  return <IpadSplitViewNoticeSheet onClose={() => {}} />
}
