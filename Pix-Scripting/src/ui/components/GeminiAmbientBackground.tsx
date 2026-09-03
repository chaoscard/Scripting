import {
  Circle,
  Color,
  Ellipse,
  Rectangle,
  ZStack,
} from "scripting"
import type { AmbientIntensity } from "../../store/settings"

export interface GeminiAmbientBackgroundProps {
  /**
   * geminiA: 纯净插画自适应流体（100% 提取原画色彩）
   * geminiB: 插画原色与 Gemini 标志性极光光谱融合流体
   */
  variant: "geminiA" | "geminiB"
  primaryColor: Color
  secondaryColor: Color
  tertiaryColor: Color
  accentColor?: Color
  coreColor?: Color
  bgColor: Color
  isDark: boolean
  intensity: AmbientIntensity
}

export function GeminiAmbientBackground(props: GeminiAmbientBackgroundProps) {
  const intensityAlpha =
    props.intensity === "high" ? 0.90 : props.intensity === "low" ? 0.45 : 0.70

  // Gemini B 标志性光谱定义（电光靛蓝、星云洋红紫、天青冰极光）
  const geminiIndigo = (props.isDark ? "#4f46e5" : "#6366f1") as Color
  const geminiPurple = (props.isDark ? "#9333ea" : "#c084fc") as Color
  const geminiCyan = (props.isDark ? "#06b6d4" : "#38bdf8") as Color
  const geminiGlowCore = (props.isDark ? "#e0e7ff" : "#ffffff") as Color

  // 光斑色彩映射
  const wave1Color = props.primaryColor
  const wave2Color =
    props.variant === "geminiB"
      ? geminiPurple
      : props.secondaryColor
  const wave3CoreColor =
    props.coreColor ??
    (props.variant === "geminiB" ? geminiGlowCore : props.primaryColor)
  const wave4Color =
    props.variant === "geminiB"
      ? geminiIndigo
      : props.tertiaryColor
  const wave5GeminiColor =
    props.variant === "geminiB" ? geminiCyan : props.accentColor

  // 黑暗模式下使用 plusLighter 增强流体交汇处的自发光耀斑感，明亮模式使用柔和透明叠加
  const activeBlendMode = props.isDark ? "plusLighter" : "normal"

  return (
    <ZStack ignoresSafeArea={true}>
      {/* 1. 深空/凝霜基底 */}
      <Rectangle fill={props.bgColor} ignoresSafeArea={true} />

      {/* 2. 流体星云 1：左上与顶部状态栏全域主波长拉伸光带 */}
      <Ellipse
        fill={wave1Color}
        frame={{ width: 380, height: 280 }}
        offset={{ x: -80, y: -340 }}
        blur={{ radius: 55, opaque: false }}
        opacity={intensityAlpha * 0.88}
        blendMode={activeBlendMode}
        swingAnimation={{
          x: { duration: 4.8, distance: 95 },
          y: { duration: 3.6, distance: 55 },
        }}
      />

      {/* 3. 同心伴生发光微核：跟随主波长运动的星芒高亮呼吸核（照亮状态栏/灵动岛周边） */}
      <Circle
        fill={wave3CoreColor}
        frame={{ width: 90, height: 90 }}
        offset={{ x: -80, y: -340 }}
        blur={{ radius: 22, opaque: false }}
        opacity={intensityAlpha * 0.85}
        blendMode={activeBlendMode}
        swingAnimation={{
          x: { duration: 4.8, distance: 95 },
          y: { duration: 3.6, distance: 55 },
        }}
      />

      {/* 4. 对流极光 2：右上/状态栏右侧逆向互补色拉伸光弧 */}
      <Ellipse
        fill={wave2Color}
        frame={{ width: 340, height: 260 }}
        offset={{ x: 95, y: -260 }}
        blur={{ radius: 60, opaque: false }}
        opacity={intensityAlpha * 0.82}
        blendMode={activeBlendMode}
        swingAnimation={{
          x: { duration: 5.6, distance: -105 },
          y: { duration: 4.0, distance: 65 },
        }}
      />

      {/* 5. 浮动对流弧 3：下部深层能量波 */}
      <Ellipse
        fill={wave4Color}
        frame={{ width: 300, height: 220 }}
        offset={{ x: -30, y: 100 }}
        blur={{ radius: 52, opaque: false }}
        opacity={intensityAlpha * 0.65}
        blendMode={activeBlendMode}
        swingAnimation={{
          x: { duration: 6.4, distance: 85 },
          y: { duration: 5.0, distance: -60 },
        }}
      />

      {/* 6. Gemini 标志性微光流束（Gemini B 专属天青极光，或 Gemini A 的自适应张力点缀） */}
      {wave5GeminiColor ? (
        <Ellipse
          fill={wave5GeminiColor}
          frame={{ width: 260, height: 180 }}
          offset={{ x: 70, y: 20 }}
          blur={{ radius: 48, opaque: false }}
          opacity={intensityAlpha * (props.variant === "geminiB" ? 0.78 : 0.60)}
          blendMode={activeBlendMode}
          swingAnimation={{
            x: { duration: 7.2, distance: -90 },
            y: { duration: 5.6, distance: 60 },
          }}
        />
      ) : null}

      {/* 7. 纵向柔化遮罩与渐层融合层（保证前景文字、卡片对比度，同时顶部完全透明通透） */}
      <Rectangle
        fill={{
          colors: [
            "clear" as Color,
            "clear" as Color,
            (props.isDark ? "#00000010" : "#ffffff10") as Color,
            (props.bgColor + "cc") as Color,
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
