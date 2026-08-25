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
import { NextArtworkIntent } from "./app_intents"
import { loadSettings } from "./src/store/settings"
import { getCurrentWidgetArtwork, type WidgetArtwork } from "./src/store/widgetStore"

// 桌面小组件单图纯画框视图
function PureArtworkWidgetView(props: {
  artwork: WidgetArtwork | null
  parameter: string
}) {
  const { artwork, parameter } = props
  const size = Widget.displaySize
  const isTrans = Widget.isTransparentMode || Widget.isTransparentBackground
  const isBlur = Widget.isBlurMode
  const isExtraLarge = Widget.family === "systemExtraLarge"
  // 加大一号：普通尺寸 38×38，iPad 特大尺寸 46×46
  const btnSize = isExtraLarge ? 46 : 38
  const paddingValue = isExtraLarge ? 16 : 12

  const runUrl = artwork
    ? Script.createRunSingleURLScheme("Pix-Scripting", {
        route: `illust:${artwork.id}`,
      })
    : undefined

  return (
    <ZStack
      frame={size}
      background={isTrans ? undefined : (isBlur ? undefined : "black")}
      alignment="topTrailing"
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
            font={isExtraLarge ? "title3" : "subheadline"}
            fontWeight="bold"
            foregroundStyle="white"
            widgetAccentedRenderingMode="fullColor"
          />
        </ZStack>
      </Button>
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
