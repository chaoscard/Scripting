import {
  Capsule,
  Device,
  HStack,
  Image,
  Text,
  useEffect,
  useState,
} from "scripting"
import { appGlass, appThemeColor } from "./glass"
import { onSettingsChanged } from "../../store/settings"
import { getSessionBrandFont } from "./brandFont"

/**
 * 灵动岛中心线自适应算法
 *
 * 【硬件物理公式】
 * 灵动岛下沿至安全区顶边有固定的 11.33pt 安全间隙，灵动岛高 36.67pt（半径 18.33pt）。
 * 灵动岛几何中心点恒定等于：
 *   islandCenterY = topInset - 29.67pt
 *
 * 【设备排他与自适应分档】
 * 1. 排除 iPad、Mac 与横屏
 * 2. 排除老 iPhone、刘海屏与 iPhone Duo 折叠屏：
 *    - SE (667)、iPhone Duo 5.4" 外屏 (678)、X/mini (812)、iPhone 16e 及 12/13/14 刘海屏 (844) 均 < 852
 *    - iPhone Duo 7.6" 内屏 (626 × 890pt，宽 626 > 440 且高 890)
 *    - 老款大刘海屏 XR/11/11PM (896)、12PM/13PM/14 Plus (926)
 * 3. 灵动岛机型自适应：
 *    - 912 (iPhone Air): topInset = 68.0
 *    - 874 / >=956 (16/17/18 Pro 系列): topInset = 62.0
 *    - 其余 (14 Pro/15/16 等标准灵动岛 852 / 932): topInset = 59.0
 */
function getDynamicIslandCenterY(): number | null {
  // 1. 仅限竖屏 iPhone，排除 iPad、Mac 与横屏
  if (
    Device.isiPad ||
    Device.isLandscape ||
    Device.model !== "iPhone" ||
    Device.systemName !== "iOS"
  ) {
    return null
  }

  const { width, height: rawHeight } = Device.screen
  const screenWidth = Math.min(width, rawHeight)
  const height = Math.max(width, rawHeight)

  // 2. 排除老 iPhone、刘海屏（含 16e）与 iPhone Duo 折叠屏
  if (
    height < 852 ||
    height === 890 ||
    height === 896 ||
    height === 926 ||
    screenWidth > 440
  ) {
    return null
  }

  // 3. 灵动岛机型自适应 topInset
  let topInset = 59.0

  if (height === 912) {
    topInset = 68.0 // iPhone Air 超薄
  } else if (height === 874 || height >= 956) {
    topInset = 62.0 // 16 Pro / Pro Max，17/18 Pro 系列
  }

  // 严格代入核心动态守恒公式：islandCenterY = topInset - 29.67
  return topInset - 29.67
}

/**
 * 灵动岛区域自绘玻璃品牌胶囊（截屏彩蛋 / 品牌标识）
 */
export function DynamicIslandBrandCapsule() {
  const islandCenterY = getDynamicIslandCenterY()
  if (islandCenterY === null) {
    return null
  }

  // 1. 品牌调色板图标：默认系统蓝（systemBlue），并实时响应跟随用户的自定义色调
  const [tintColor, setTintColor] = useState(() => appThemeColor("systemBlue"))

  useEffect(() => {
    return onSettingsChanged(() => {
      setTintColor(appThemeColor("systemBlue"))
    })
  }, [])

  // 2. 品牌字标字体：单次会话随机锁定 15 款开机内置原厂英文字体之一
  const brandFontName = getSessionBrandFont()

  const capsuleHeight = 28

  return (
    <HStack
      alignment="center"
      spacing={3}
      frame={{ width: 72, height: capsuleHeight }}
      background="ultraThinMaterial"
      glassEffect={appGlass("capsule")}
      clipShape="capsule"
      overlay={
        <Capsule
          stroke={{
            shapeStyle: "rgba(255, 255, 255, 0.22)",
            strokeStyle: { lineWidth: 0.5 },
          }}
        />
      }
      shadow={{ color: "rgba(0, 0, 0, 0.12)", radius: 4, y: 1 }}
      position={{
        x: Device.screen.width / 2,
        y: islandCenterY,
      }}
      allowsHitTesting={false}
      ignoresSafeArea={true}
    >
      {/* 品牌调色板图标：默认系统蓝，跟随自定义色调 */}
      <Image
        systemName="paintpalette"
        font={14}
        fontWeight="semibold"
        foregroundStyle={tintColor}
        frame={{ width: 16, height: 16, alignment: "center" }}
      />

      {/* 品牌名称：16pt，15款开机自带顶级英文字体随机轮换 */}
      <Text
        font={{ name: brandFontName, size: 16 }}
        fontWeight="semibold"
        foregroundStyle="label"
        lineLimit={1}
        minScaleFactor={0.6}
      >
        Pixiv
      </Text>
    </HStack>
  )
}

export default DynamicIslandBrandCapsule
