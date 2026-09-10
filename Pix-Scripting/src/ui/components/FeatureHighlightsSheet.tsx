import {
  Button,
  HStack,
  Image,
  NavigationStack,
  ScrollView,
  Text,
  VStack,
  ZStack,
  type Color,
} from "scripting"
import { triggerHaptic } from "../../platform/haptics"

interface FeatureItem {
  id: string
  title: string
  subtitle: string
  description: string
  symbol: string
  iconColor: Color
  iconBg: Color
  badgeColor: Color
}

const FEATURE_LIST: FeatureItem[] = [
  {
    id: "sync",
    title: "跨端同步",
    subtitle: "全量设置 · 黑名单 · 历史双向漫游",
    description: "支持 iCloud 云端同步，本地秒级响应与增量漫游，换机即用，数据安全不丢失。",
    symbol: "icloud.fill",
    iconColor: "white",
    iconBg: "systemBlue",
    badgeColor: "systemBlue",
  },
  {
    id: "ai",
    title: "AI助手",
    subtitle: "生图汉化 · OCR · 智能总结 · 脑洞续写",
    description: "漫画气泡框选抹字汉化，长文梗概总结与脑洞续写，支持自定义模型与私有端点。",
    symbol: "sparkles",
    iconColor: "white",
    iconBg: "systemPurple",
    badgeColor: "systemPurple",
  },
  {
    id: "downloader",
    title: "下载引擎",
    subtitle: "ZIP · EPUB · CBZ · 创作者专属归档",
    description: "全格式打包与导出，支持创作者全量一键归档，动图转码 MP4/GIF 与灵动岛实时监控。",
    symbol: "arrow.down.circle.fill",
    iconColor: "white",
    iconBg: "systemOrange",
    badgeColor: "systemOrange",
  },
  {
    id: "reader",
    title: "沉浸阅读",
    subtitle: "图片氛围光晕 · 小说横竖排版 · 实验特性",
    description: "画廊动态提取环境光沉浸氛围，小说日系竖排/横排与排版定制，丰富实验性功能供探索。",
    symbol: "book.pages.fill",
    iconColor: "white",
    iconBg: "systemGreen",
    badgeColor: "systemGreen",
  },
  {
    id: "appleMusic",
    title: "苹果音乐样式",
    subtitle: "全局悬浮胶囊底栏 · 随动收展 · 快捷掌控",
    description: "致敬 Apple Music 原生悬浮底栏设计，随滚动收放折叠，一键操作单手灵动掌控。",
    symbol: "music.note.list",
    iconColor: "white",
    iconBg: "systemPink",
    badgeColor: "systemPink",
  },
  {
    id: "moreFeatures",
    title: "还有更多",
    subtitle: "桌面组件 · 灵动岛 · 原图寻源 · 镜像图源",
    description: "小组件原地交互、SauceNAO 搜图、镜像图源与自定义网关等更多玩法等您探索。",
    symbol: "ellipsis.circle.fill",
    iconColor: "white",
    iconBg: "systemTeal",
    badgeColor: "systemTeal",
  },
]

export function FeatureHighlightsSheet(props: { onClose: () => void }) {
  const { onClose } = props

  const handleDismiss = () => {
    try {
      triggerHaptic("light")
    } catch {}
    onClose()
  }

  return (
    <NavigationStack
      presentationDetents={["large"]}
      presentationDragIndicator="visible"
    >
      <VStack
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        navigationTitle="特色功能"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button action={handleDismiss}>
              <Image
                systemName="xmark"
                font="headline"
              />
            </Button>
          ),
        }}
      >
        <ScrollView
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        >
          <VStack
            alignment="leading"
            spacing={16}
            padding={{ horizontal: 20, top: 8, bottom: 16 }}
          >
            {/* 顶部紧凑醒目标题区 */}
            <VStack
              alignment="center"
              spacing={8}
              frame={{ maxWidth: "infinity", alignment: "center" }}
              padding={{ top: 4, bottom: 4 }}
            >
              <ZStack
                alignment="center"
                frame={{ width: 50, height: 50 }}
                background="systemYellow"
                clipShape={{ type: "rect", cornerRadius: 15 }}
                shadow={{ color: "rgba(255, 179, 0, 0.3)", radius: 8, y: 3 }}
              >
                <Image
                  systemName="lightbulb.fill"
                  font={25}
                  foregroundStyle="white"
                />
              </ZStack>
              <Text font="title3" fontWeight="bold">
                感谢您选择 Pix-Scripting
              </Text>
              <HStack spacing={2} alignment="center">
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  专为
                </Text>
                <Image
                  systemName="apple.logo"
                  font={12}
                  foregroundStyle="secondaryLabel"
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  生态深度优化的多维度玩法与特性
                </Text>
              </HStack>
            </VStack>

            {/* 核心特色功能列表 */}
            <VStack spacing={14}>
              {FEATURE_LIST.map((item) => (
                <HStack
                  key={item.id}
                  spacing={12}
                  alignment="top"
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  <ZStack
                    alignment="center"
                    frame={{ width: 40, height: 40 }}
                    background={item.iconBg}
                    clipShape={{ type: "rect", cornerRadius: 11 }}
                  >
                    <Image
                      systemName={item.symbol}
                      font={18}
                      foregroundStyle={item.iconColor}
                    />
                  </ZStack>

                  <VStack
                    alignment="leading"
                    spacing={2}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    <Text font="subheadline" fontWeight="bold">
                      {item.title}
                    </Text>
                    <Text
                      font="caption"
                      fontWeight="semibold"
                      foregroundStyle={item.badgeColor}
                    >
                      {item.subtitle}
                    </Text>
                    <Text
                      font="caption"
                      foregroundStyle="secondaryLabel"
                      lineSpacing={2}
                    >
                      {item.description}
                    </Text>
                  </VStack>
                </HStack>
              ))}
            </VStack>

            {/* 开始探索按钮：无外层分割背景色，自然整体上移 */}
            <VStack
              padding={{ top: 12 }}
              frame={{ maxWidth: "infinity" }}
            >
              <Button
                action={handleDismiss}
                buttonStyle="borderedProminent"
                controlSize="large"
                frame={{ maxWidth: "infinity" }}
              >
                <Text font="headline" fontWeight="bold" foregroundStyle="white">
                  开始探索
                </Text>
              </Button>
            </VStack>
          </VStack>
        </ScrollView>
      </VStack>
    </NavigationStack>
  )
}

export default function FeatureHighlightsPreview() {
  return <FeatureHighlightsSheet onClose={() => {}} />
}
