import {
  Button,
  HStack,
  Image,
  Link,
  Script,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
} from "scripting"
import { BookmarkArtworkIntent, NextArtworkIntent } from "./app_intents"
import { loadSettings } from "./src/store/settings"
import {
  getCurrentWidgetArtwork,
  isWidgetArtworkBookmarked,
  type WidgetArtwork,
} from "./src/store/widgetStore"

// 获取准确的小组件尺寸（修复 Scripting 在 systemMedium 下 displaySize.width 错误返回 158 的问题）
function getAccurateWidgetDisplaySize(
  family: string,
  displaySize: { width: number; height: number }
): { width: number; height: number } {
  const w = displaySize?.width || 158
  const h = displaySize?.height || 158

  switch (family) {
    case "systemSmall":
      return { width: w, height: h }
    case "systemMedium":
      return {
        width: w <= h ? Math.round(h * (338 / 158)) : w,
        height: h,
      }
    case "systemLarge":
      return {
        width: w <= 160 ? 338 : w,
        height: h <= 160 ? 354 : h,
      }
    case "systemExtraLarge":
      return {
        width: w <= 360 ? 708 : w,
        height: h <= 200 ? 354 : h,
      }
    default:
      return { width: w, height: h }
  }
}

// 桌面小组件单图纯画框视图
function PureArtworkWidgetView(props: {
  artwork: WidgetArtwork | null
  parameter: string
}) {
  const { artwork, parameter } = props
  const size = getAccurateWidgetDisplaySize(Widget.family, Widget.displaySize)
  const isTrans = Widget.isTransparentMode || Widget.isTransparentBackground
  const isBlur = Widget.isBlurMode
  const isLarge = Widget.family === "systemLarge"
  const isExtraLarge = Widget.family === "systemExtraLarge"
  // 玻璃保持紧凑尺寸：小/中号 30×30，大号 34×34，iPad 特大号 40×40
  const btnSize = isExtraLarge ? 40 : isLarge ? 34 : 30
  const paddingValue = isExtraLarge ? 16 : isLarge ? 14 : 10
  // 恢复饱满图标尺寸：原版大号图标，填满紧凑玻璃胶囊
  const iconFont = isExtraLarge ? "title2" : isLarge ? "title3" : "subheadline"

  const isBookmarked = isWidgetArtworkBookmarked(artwork)
  const isPixivision = artwork?.sourceType === "pixivision"
  const bookmarkParam = artwork ? `${parameter}::${artwork.id}` : parameter

  const targetRoute =
    artwork?.route ||
    (artwork?.sourceType === "pixivision"
      ? `pixivision:${artwork.id}`
      : artwork
      ? `illust:${artwork.id}`
      : undefined)

  const runUrl = targetRoute
    ? Script.createRunSingleURLScheme("Pix-Scripting", {
        route: targetRoute,
      })
    : undefined

  return (
    <ZStack
      frame={size}
      background={isTrans ? undefined : isBlur ? undefined : "black"}
      alignment="topLeading"
      widgetURL={runUrl}
    >
      {/* 纯图底层：不套 Link，依靠根视图 widgetURL 全图直达作品详情，避免层叠遮挡 */}
      {artwork && artwork.localImagePath ? (
        <Image
          filePath={artwork.localImagePath}
          resizable
          scaleToFill
          frame={size}
          clipped
          widgetAccentedRenderingMode="fullColor"
        />
      ) : (
        <VStack
          alignment="center"
          spacing={8}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        >
          <Image
            systemName="paintpalette.fill"
            font="largeTitle"
            foregroundStyle="secondaryLabel"
            widgetAccentedRenderingMode="fullColor"
          />
          <Text font="caption" foregroundStyle="secondaryLabel">
            Pix-Scripting
          </Text>
        </VStack>
      )}

      {/* 控制操作层：弹性推导对齐，右上角刷新 + 右下角收藏 */}
      <VStack
        spacing={0}
        padding={paddingValue}
        frame={size}
      >
        {/* 顶部行：右上角独立刷新按钮 (AppIntent 原地切图) */}
        <HStack spacing={0}>
          <Spacer />
          <Button
            intent={NextArtworkIntent(parameter)}
            buttonStyle="plain"
          >
            <ZStack
              frame={{ width: btnSize, height: btnSize }}
              background="rgba(0, 0, 0, 0.45)"
              clipShape="circle"
              alignment="center"
            >
              <Image
                systemName="arrow.clockwise"
                font={iconFont}
                fontWeight="bold"
                foregroundStyle="white"
                widgetAccentedRenderingMode="fullColor"
              />
            </ZStack>
          </Button>
        </HStack>

        <Spacer />

        {/* 底部行：右下角独立收藏按钮 (AppIntent 原地收藏 + 触觉反馈) */}
        {artwork ? (
          <HStack spacing={0}>
            <Spacer />
            <Button
              intent={BookmarkArtworkIntent(bookmarkParam)}
              buttonStyle="plain"
            >
              <ZStack
                frame={{ width: btnSize, height: btnSize }}
                background="rgba(0, 0, 0, 0.45)"
                clipShape="circle"
                alignment="center"
              >
                <Image
                  systemName={isBookmarked ? "heart.fill" : "heart"}
                  font={iconFont}
                  fontWeight="bold"
                  foregroundStyle={isBookmarked ? "#FF2D55" : "white"}
                  widgetAccentedRenderingMode="fullColor"
                />
              </ZStack>
            </Button>
          </HStack>
        ) : null}
      </VStack>
    </ZStack>
  )
}

async function main() {
  const family = Widget.family
  // 只支持桌面小组件（小、中、大、iPad特大），锁屏与配件小组件不做
  if (
    family === "accessoryCircular" ||
    family === "accessoryRectangular" ||
    family === "accessoryInline"
  ) {
    Widget.present(<Text>仅支持桌面小组件</Text>)
    return
  }

  const rawParam = Widget.parameter || ""
  const intentParam = rawParam ? rawParam : `__family:${family}`
  const artwork = await getCurrentWidgetArtwork(rawParam, family)

  const intervalMinutes = loadSettings().widgetReloadIntervalMinutes || 60
  const reloadDate = new Date(Date.now() + 1000 * 60 * intervalMinutes)

  Widget.present(
    <PureArtworkWidgetView artwork={artwork} parameter={intentParam} />,
    {
      reloadPolicy: {
        policy: "after",
        date: reloadDate,
      },
    }
  )
}

main()
