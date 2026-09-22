import {
  Circle,
  Color,
  Rectangle,
  ZStack,
} from "scripting"
import type { AmbientIntensity } from "../../store/settings"
import { useLayoutMetrics } from "../Hooks"

export interface TranscendAmbientBackgroundProps {
  leadColor: Color
  prismColor: Color
  trailColor: Color
  midColor: Color
  bgColor: Color
  leadCoreColor?: Color
  prismCoreColor?: Color
  trailCoreColor?: Color
  isDark: boolean
  intensity: AmbientIntensity
}

export function TranscendAmbientBackground(props: TranscendAmbientBackgroundProps) {
  const intensityAlpha =
    props.intensity === "high"
      ? props.isDark ? 0.88 : 0.95
      : props.intensity === "low"
        ? props.isDark ? 0.42 : 0.58
        : props.isDark ? 0.65 : 0.80

  /**
   * 光斑几何**比例化**（2026-09-17）：
   * 原来所有尺寸/位移/模糊都是「按手机画布调出来的绝对 pt 值」，
   * 画布一变宽（iPad 全屏、右栏拉宽）光斑就只占中间一小块、四周空掉。
   * 现在一律按画布换算：横向东西随宽度、纵向东西随高度，基准 = 手机竖屏 390×844。
   * ⇒ iPhone 上比值恒为 1，观感与改前完全一致；画布变大时自动铺开并放大。
   */
  const { width: canvasWidth, height: canvasHeight } = useLayoutMetrics()
  const relX = canvasWidth > 0 ? canvasWidth / 390 : 1
  const relY = canvasHeight > 0 ? canvasHeight / 844 : 1
  /** 横向尺寸相对化 */
  const px = (value: number) => Math.round(value * relX)
  /** 纵向尺寸相对化 */
  const py = (value: number) => Math.round(value * relY)

  return (
    <ZStack ignoresSafeArea={true}>
      {/* 1. 基础深空 / 凝霜基底 */}
      <Rectangle fill={props.bgColor} ignoresSafeArea={true} />

      {/* 2. 极光流球 1：左上与状态栏主光斑 */}
      <Circle
        fill={props.leadColor}
        frame={{ width: px(280), height: px(280) }}
        offset={{ x: px(-90), y: py(-330) }}
        blur={{ radius: px(50), opaque: false }}
        opacity={intensityAlpha * 0.88}
        swingAnimation={{
          x: { duration: 4.2, distance: px(95) },
          y: { duration: 3.2, distance: py(60) },
        }}
      />
      {props.leadCoreColor ? (
        <Circle
          fill={props.leadCoreColor}
          frame={{ width: px(95), height: px(95) }}
          offset={{ x: px(-90), y: py(-330) }}
          blur={{ radius: px(20), opaque: false }}
          opacity={intensityAlpha * 0.85}
          swingAnimation={{
            x: { duration: 4.2, distance: px(95) },
            y: { duration: 3.2, distance: py(60) },
          }}
        />
      ) : null}

      {/* 3. 极光流球 2：右上与状态栏右侧棱镜色散光斑 */}
      <Circle
        fill={props.prismColor}
        frame={{ width: px(280), height: px(280) }}
        offset={{ x: px(105), y: py(-250) }}
        blur={{ radius: px(55), opaque: false }}
        opacity={intensityAlpha * 0.82}
        swingAnimation={{
          x: { duration: 4.8, distance: px(-105) },
          y: { duration: 3.6, distance: py(65) },
        }}
      />
      {props.prismCoreColor ? (
        <Circle
          fill={props.prismCoreColor}
          frame={{ width: px(100), height: px(100) }}
          offset={{ x: px(105), y: py(-250) }}
          blur={{ radius: px(22), opaque: false }}
          opacity={intensityAlpha * 0.80}
          swingAnimation={{
            x: { duration: 4.8, distance: px(-105) },
            y: { duration: 3.6, distance: py(65) },
          }}
        />
      ) : null}

      {/* 4. 极光流球 3：右下方谐波光斑（靠下方） */}
      <Circle
        fill={props.trailColor}
        frame={{ width: px(220), height: px(220) }}
        offset={{ x: px(75), y: py(100) }}
        blur={{ radius: px(48), opaque: false }}
        opacity={intensityAlpha * 0.72}
        swingAnimation={{
          x: { duration: 5.6, distance: px(85) },
          y: { duration: 4.2, distance: py(-65) },
        }}
      />
      {props.trailCoreColor ? (
        <Circle
          fill={props.trailCoreColor}
          frame={{ width: px(85), height: px(85) }}
          offset={{ x: px(75), y: py(100) }}
          blur={{ radius: px(18), opaque: false }}
          opacity={intensityAlpha * 0.75}
          swingAnimation={{
            x: { duration: 5.6, distance: px(85) },
            y: { duration: 4.2, distance: py(-65) },
          }}
        />
      ) : null}

      {/* 5. 极光流球 4：下部浮动能量核（靠下方） */}
      <Circle
        fill={props.midColor}
        frame={{ width: px(210), height: px(210) }}
        offset={{ x: px(-20), y: py(170) }}
        blur={{ radius: px(55), opaque: false }}
        opacity={intensityAlpha * 0.55}
        swingAnimation={{
          x: { duration: 6.4, distance: px(-80) },
          y: { duration: 5.0, distance: py(85) },
        }}
      />

      {/* 6. 纵向柔化遮罩与渐层融合层（去雾化设计，彻底消除浅色白雾） */}
      <Rectangle
        fill={{
          colors: props.isDark
            ? [
                "clear" as Color,
                "clear" as Color,
                "#00000018" as Color,
                (props.bgColor + "bb") as Color,
                props.bgColor,
              ]
            : [
                "clear" as Color,
                "clear" as Color,
                (props.bgColor + "22") as Color,
                (props.bgColor + "bb") as Color,
                props.bgColor,
              ],
          startPoint: "top",
          endPoint: "bottom",
        }}
        ignoresSafeArea={true}
      />
    </ZStack>
  )
}
