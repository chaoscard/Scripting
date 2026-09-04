import {
  Button,
  Image,
  Link,
  Script,
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

// 桌面小组件单图纯画框视图
function PureArtworkWidgetView(props: {
  artwork: WidgetArtwork | null
  parameter: string
}) {
  const { artwork, parameter } = props
  const size = Widget.displaySize
  const isTrans = Widget.isTransparentMode || Widget.isTransparentBackground
  const isBlur = Widget.isBlurMode
  const isLarge = Widget.family === "systemLarge"
  const isExtraLarge = Widget.family === "systemExtraLarge"
  // 尺寸阶梯：小/中号 38×38，大号 46×46，iPad 特大号 52×52
  const btnSize = isExtraLarge ? 52 : isLarge ? 46 : 38
  const paddingValue = isExtraLarge ? 18 : isLarge ? 16 : 12
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
      {/* 纯图底层：通过 Link 包裹实现全图点击直达作品详情 */}
      {artwork && artwork.localImagePath ? (
        <Link url={runUrl || ""}>
          <Image
            filePath={artwork.localImagePath}
            resizable
            scaleToFill
            frame={size}
            clipped
            widgetAccentedRenderingMode="fullColor"
          />
        </Link>
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

      {/* 右上角独立按钮：加大一号微透圆形液态玻璃手动刷新按钮 (AppIntent 原地切图) */}
      <ZStack alignment="topTrailing" frame={size}>
        <Button
          intent={NextArtworkIntent(parameter)}
          buttonStyle="plain"
          padding={paddingValue}
        >
          <ZStack
            frame={{ width: btnSize, height: btnSize }}
            background="#00000040"
            clipShape="circle"
            alignment="center"
            shadow={{
              color: "#00000038",
              radius: 4,
              x: 0,
              y: 2,
            }}
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
      </ZStack>

      {/* 右下角独立按钮：微透圆形液态玻璃一键轻收藏按钮 (AppIntent 原地收藏 + 触觉反馈) */}
      {artwork ? (
        <ZStack alignment="bottomTrailing" frame={size}>
          <Button
            intent={BookmarkArtworkIntent(bookmarkParam)}
            buttonStyle="plain"
            padding={paddingValue}
          >
            <ZStack
              frame={{ width: btnSize, height: btnSize }}
              background="#00000040"
              clipShape="circle"
              alignment="center"
              shadow={{
                color: "#00000038",
                radius: 4,
                x: 0,
                y: 2,
              }}
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
        </ZStack>
      ) : null}
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
