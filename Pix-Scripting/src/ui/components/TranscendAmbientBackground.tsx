import {
  Circle,
  Color,
  Rectangle,
  ZStack,
} from "scripting"
import type { AmbientIntensity } from "../../store/settings"

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
    props.intensity === "high" ? 0.88 : props.intensity === "low" ? 0.42 : 0.65

  return (
    <ZStack ignoresSafeArea={true}>
      {/* 1. 基础深空 / 凝霜基底 */}
      <Rectangle fill={props.bgColor} ignoresSafeArea={true} />

      {/* 2. 极光流球 1：左上与状态栏主光斑 */}
      <Circle
        fill={props.leadColor}
        frame={{ width: 280, height: 280 }}
        offset={{ x: -90, y: -330 }}
        blur={{ radius: 50, opaque: false }}
        opacity={intensityAlpha * 0.88}
        swingAnimation={{
          x: { duration: 4.2, distance: 95 },
          y: { duration: 3.2, distance: 60 },
        }}
      />
      {props.leadCoreColor ? (
        <Circle
          fill={props.leadCoreColor}
          frame={{ width: 95, height: 95 }}
          offset={{ x: -90, y: -330 }}
          blur={{ radius: 20, opaque: false }}
          opacity={intensityAlpha * 0.85}
          swingAnimation={{
            x: { duration: 4.2, distance: 95 },
            y: { duration: 3.2, distance: 60 },
          }}
        />
      ) : null}

      {/* 3. 极光流球 2：右上与状态栏右侧棱镜色散光斑 */}
      <Circle
        fill={props.prismColor}
        frame={{ width: 280, height: 280 }}
        offset={{ x: 105, y: -250 }}
        blur={{ radius: 55, opaque: false }}
        opacity={intensityAlpha * 0.82}
        swingAnimation={{
          x: { duration: 4.8, distance: -105 },
          y: { duration: 3.6, distance: 65 },
        }}
      />
      {props.prismCoreColor ? (
        <Circle
          fill={props.prismCoreColor}
          frame={{ width: 100, height: 100 }}
          offset={{ x: 105, y: -250 }}
          blur={{ radius: 22, opaque: false }}
          opacity={intensityAlpha * 0.80}
          swingAnimation={{
            x: { duration: 4.8, distance: -105 },
            y: { duration: 3.6, distance: 65 },
          }}
        />
      ) : null}

      {/* 4. 极光流球 3：右下方谐波光斑（靠下方） */}
      <Circle
        fill={props.trailColor}
        frame={{ width: 220, height: 220 }}
        offset={{ x: 75, y: 100 }}
        blur={{ radius: 48, opaque: false }}
        opacity={intensityAlpha * 0.72}
        swingAnimation={{
          x: { duration: 5.6, distance: 85 },
          y: { duration: 4.2, distance: -65 },
        }}
      />
      {props.trailCoreColor ? (
        <Circle
          fill={props.trailCoreColor}
          frame={{ width: 85, height: 85 }}
          offset={{ x: 75, y: 100 }}
          blur={{ radius: 18, opaque: false }}
          opacity={intensityAlpha * 0.75}
          swingAnimation={{
            x: { duration: 5.6, distance: 85 },
            y: { duration: 4.2, distance: -65 },
          }}
        />
      ) : null}

      {/* 5. 极光流球 4：下部浮动能量核（靠下方） */}
      <Circle
        fill={props.midColor}
        frame={{ width: 210, height: 210 }}
        offset={{ x: -20, y: 170 }}
        blur={{ radius: 55, opaque: false }}
        opacity={intensityAlpha * 0.55}
        swingAnimation={{
          x: { duration: 6.4, distance: -80 },
          y: { duration: 5.0, distance: 85 },
        }}
      />

      {/* 6. 纵向柔化遮罩与渐层融合层 */}
      <Rectangle
        fill={{
          colors: [
            "clear" as Color,
            "clear" as Color,
            (props.isDark ? "#00000018" : "#ffffff18") as Color,
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
