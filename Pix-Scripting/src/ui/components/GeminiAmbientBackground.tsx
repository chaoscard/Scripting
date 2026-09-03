import {
  Color,
  Ellipse,
  Rectangle,
  ZStack,
  useEffect,
  useState,
} from "scripting"
import {
  loadSettings,
  onSettingsChanged,
  type AmbientIntensity,
} from "../../store/settings"

export interface GeminiAmbientBackgroundProps {
  /**
   * geminiA: 纯净插画自适应流体（100% 提取原画色彩流转）
   * geminiB: 官方 5 色暗夜极光天幕流转（紫晶/琥珀/翡翠/深海/天青）
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

// 官方 Gemini 色调调色环定义（融合 Google 蓝 #4285f4、罗兰紫 #9059ff、星云粉 #f772bb、冰川青 #06b6d4）
const GEMINI_B_PALETTE_DARK: readonly Color[] = [
  "#4285f4" as Color, // 1. Google 科技天蓝
  "#9059ff" as Color, // 2. Gemini 标志罗兰紫
  "#f772bb" as Color, // 3. 星云柔品红
  "#06b6d4" as Color, // 4. 深邃冰川青
  "#7c3aed" as Color, // 5. 暗夜深空紫
]

const GEMINI_B_PALETTE_LIGHT: readonly Color[] = [
  "#3b82f6" as Color, // 1. 科技湛蓝
  "#8b5cf6" as Color, // 2. 鲜明罗兰紫
  "#ec4899" as Color, // 3. 鲜润星云粉
  "#06b6d4" as Color, // 4. 晶莹深天青
  "#a855f7" as Color, // 5. 水晶亮紫
]

function toOpaqueColor(color: Color): Color {
  if (typeof color === "string") {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
    if (match) {
      return `rgb(${match[1]}, ${match[2]}, ${match[3]})` as Color
    }
  }
  return color
}

function parseRgb(color: Color): [number, number, number] | null {
  if (typeof color === "string") {
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
    if (color.startsWith("#")) {
      const hex = color.slice(1)
      if (hex.length >= 6) {
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16),
        ]
      }
    }
  }
  return null
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

function buildHarmonicAccentColor(baseColor: Color, isDark: boolean): Color {
  const rgb = parseRgb(baseColor)
  if (!rgb) return baseColor
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2])
  const shiftedH = (h + 0.11) % 1
  const targetS = Math.max(0.45, Math.min(0.85, s * 1.15))
  const targetL = isDark ? Math.max(0.35, Math.min(0.55, l)) : Math.max(0.55, Math.min(0.75, l))
  const [nr, ng, nb] = hslToRgb(shiftedH, targetS, targetL)
  return `rgb(${nr}, ${ng}, ${nb})` as Color
}

function buildLuminousCoreColor(c1: Color, c2: Color, isDark: boolean, boostRatio: number = 0.25): Color {
  const rgb1 = parseRgb(c1)
  const rgb2 = parseRgb(c2)
  if (!rgb1 && !rgb2) return c1
  const r1 = rgb1 ? rgb1[0] : 120
  const g1 = rgb1 ? rgb1[1] : 120
  const b1 = rgb1 ? rgb1[2] : 120
  const r2 = rgb2 ? rgb2[0] : r1
  const g2 = rgb2 ? rgb2[1] : g1
  const b2 = rgb2 ? rgb2[2] : b1
  const midR = Math.round((r1 + r2) / 2)
  const midG = Math.round((g1 + g2) / 2)
  const midB = Math.round((b1 + b2) / 2)
  const [h, s, l] = rgbToHsl(midR, midG, midB)
  const targetL = isDark
    ? Math.min(0.78, l * (1 + boostRatio * 1.4) + boostRatio * 0.4)
    : Math.max(0.44, Math.min(0.82, l * 0.95 + boostRatio * 0.2))
  const targetS = isDark
    ? Math.min(0.95, s * (1 + boostRatio * 0.5) + 0.05)
    : Math.min(0.95, Math.max(0.60, s * 1.25))
  const [nr, ng, nb] = hslToRgb(h, targetS, targetL)
  return `rgb(${nr}, ${ng}, ${nb})` as Color
}

export function GeminiAmbientBackground(props: GeminiAmbientBackgroundProps) {
  const [settings, setSettings] = useState(() => loadSettings())

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  // 1. 综合物理参数计算（预设联动 vs 高级自定义）
  const custom = settings.geminiCustomParamsEnabled
  const speed = settings.geminiMotionSpeed

  const intervalMs = custom
    ? settings.geminiTransitionIntervalMs
    : speed === "official"
      ? 3500
      : speed === "calm"
        ? 5000
        : 2000

  const durationMs = custom
    ? Math.min(settings.geminiTransitionDurationMs, Math.max(300, intervalMs - 50))
    : speed === "official"
      ? 3000
      : speed === "calm"
        ? 4400
        : 1800

  const rotLeftSec = custom
    ? settings.geminiRotationPeriodSec
    : speed === "official"
      ? 8.5
      : speed === "calm"
        ? 14
        : 7

  const rotRightSec = rotLeftSec > 0 ? (custom ? rotLeftSec * 1.2 : rotLeftSec * 1.2) : 0

  const swingBaseMs = custom
    ? settings.geminiSwingDurationMs
    : speed === "official"
      ? 5200
      : speed === "calm"
        ? 7000
        : 3800

  const swingLeftXSec = swingBaseMs / 1000
  const swingLeftYSec = (swingBaseMs * 0.78) / 1000
  const swingRightXSec = (swingBaseMs * 1.15) / 1000
  const swingRightYSec = (swingBaseMs * 0.88) / 1000

  const centerOffsetY = custom ? settings.geminiCenterOffsetY : -200
  const wingOffsetX = custom ? settings.geminiWingOffsetX : 95
  const swingDist = custom ? settings.geminiSwingDistance : speed === "calm" ? 35 : 40
  const blurRadius = custom ? settings.geminiBlurRadius : speed === "calm" ? 110 : 95
  const luminousBoost = (custom ? settings.geminiLuminousBoostRatio : 25) / 100
  const lightAlphaRatio = (custom ? settings.geminiLightModeAlphaRatio : 52) / 100

  // 浅色模式专属对比度增强
  const intensityAlpha =
    props.intensity === "high"
      ? props.isDark ? 0.42 : lightAlphaRatio * 1.25
      : props.intensity === "low"
        ? props.isDark ? 0.24 : lightAlphaRatio * 0.75
        : props.isDark ? 0.33 : lightAlphaRatio

  // 2. 构建色彩流转调色环（实色化处理，彻底剥离双重 Alpha 衰减）
  const bPalette = props.isDark ? GEMINI_B_PALETTE_DARK : GEMINI_B_PALETTE_LIGHT
  
  const rawPrimary = toOpaqueColor(props.primaryColor)
  const rawSecondary = toOpaqueColor(props.secondaryColor)
  const rawTertiary = toOpaqueColor(props.tertiaryColor)
  const rawAccent = props.accentColor ? toOpaqueColor(props.accentColor) : buildHarmonicAccentColor(rawPrimary, props.isDark)
  const rawDerived = buildHarmonicAccentColor(rawSecondary, props.isDark)

  const aPalette: Color[] = [
    rawPrimary,
    rawSecondary,
    rawTertiary,
    rawAccent,
    rawDerived,
  ]

  const activePalette = props.variant === "geminiB" ? bPalette : aPalette
  const paletteLen = activePalette.length

  // 3. 状态机：平滑随机流转左右双主色
  const [leftIndex, setLeftIndex] = useState(0)
  const [rightIndex, setRightIndex] = useState(1)

  useEffect(() => {
    let active = true
    let timerId: any = null

    const scheduleNext = () => {
      timerId = setTimeout(() => {
        if (!active) return
        void withAnimation(Animation.smooth({ duration: durationMs / 1000 }), () => {
          setLeftIndex((currLeft) => {
            const availableLeft: number[] = []
            for (let i = 0; i < paletteLen; i++) {
              if (i !== currLeft) availableLeft.push(i)
            }
            const nextLeft =
              availableLeft.length > 0
                ? availableLeft[Math.floor(Math.random() * availableLeft.length)]!
                : 0

            setRightIndex((currRight) => {
              const availableRight: number[] = []
              for (let i = 0; i < paletteLen; i++) {
                if (i !== nextLeft && i !== currRight) availableRight.push(i)
              }
              if (availableRight.length > 0) {
                return availableRight[Math.floor(Math.random() * availableRight.length)]!
              }
              return (nextLeft + 1) % paletteLen
            })

            return nextLeft
          })
        })
        scheduleNext()
      }, intervalMs)
    }

    scheduleNext()

    return () => {
      active = false
      if (timerId != null) {
        clearTimeout(timerId)
      }
    }
  }, [paletteLen, intervalMs, durationMs])

  // 4. 当前时刻的双主色与 3 阶中心微提亮流光渐变（实现 Gemini 官方 Gradient Flow & Luminous Core）
  const leftColor = activePalette[leftIndex % paletteLen] ?? activePalette[0]!
  const leftGradColor = activePalette[(leftIndex + 2) % paletteLen] ?? activePalette[(leftIndex + 1) % paletteLen] ?? activePalette[0]!
  const leftCoreColor = buildLuminousCoreColor(leftColor, leftGradColor, props.isDark, luminousBoost)

  const rightColor = activePalette[rightIndex % paletteLen] ?? (activePalette[1] ?? activePalette[0]!)
  const rightGradColor = activePalette[(rightIndex + 2) % paletteLen] ?? activePalette[(rightIndex + 1) % paletteLen] ?? activePalette[0]!
  const rightCoreColor = buildLuminousCoreColor(rightColor, rightGradColor, props.isDark, luminousBoost)

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} ignoresSafeArea={true}>
      {/* 1. 深空/曜石黑基底 */}
      <Rectangle fill={props.bgColor} ignoresSafeArea={true} />

      {/* 2. 左上 3 阶对角流光场（Left 3-Stop Gradient Nebula） */}
      <Ellipse
        fill={{
          colors: [leftColor, leftCoreColor, leftGradColor],
          startPoint: "topLeading",
          endPoint: "bottomTrailing",
        }}
        frame={{ width: 280, height: 260 }}
        clockHandRotationEffect={rotLeftSec > 0 ? (rotLeftSec as any) : undefined}
        scaleEffect={{ x: 2.1, y: 1.8 }}
        offset={{ x: -wingOffsetX, y: centerOffsetY - 10 }}
        blur={{ radius: blurRadius, opaque: false }}
        opacity={intensityAlpha}
        swingAnimation={
          swingDist > 0
            ? {
                x: { duration: swingLeftXSec, distance: swingDist },
                y: { duration: swingLeftYSec, distance: Math.round(swingDist * 0.75) },
              }
            : undefined
        }
      />

      {/* 3. 右上 3 阶对角流光场（Right 3-Stop Gradient Nebula） */}
      <Ellipse
        fill={{
          colors: [rightColor, rightCoreColor, rightGradColor],
          startPoint: "topTrailing",
          endPoint: "bottomLeading",
        }}
        frame={{ width: 290, height: 270 }}
        clockHandRotationEffect={rotRightSec > 0 ? (rotRightSec as any) : undefined}
        scaleEffect={{ x: 2.1, y: 1.8 }}
        offset={{ x: wingOffsetX, y: centerOffsetY + 10 }}
        blur={{ radius: Math.round(blurRadius * 1.08), opaque: false }}
        opacity={intensityAlpha * 0.95}
        swingAnimation={
          swingDist > 0
            ? {
                x: { duration: swingRightXSec, distance: -Math.round(swingDist * 1.1) },
                y: { duration: swingRightYSec, distance: Math.round(swingDist * 0.7) },
              }
            : undefined
        }
      />

      {/* 4. 纵向自然衰减遮罩（在页面 24%~30% 高度极其平滑地隐入纯净底色） */}
      <Rectangle
        fill={{
          colors: props.isDark
            ? [
                "clear" as Color,
                "clear" as Color,
                "#00000033" as Color,
                "#00000088" as Color,
                (props.bgColor + "ee") as Color,
                props.bgColor,
              ]
            : [
                "clear" as Color,
                "clear" as Color,
                (props.bgColor + "33") as Color,
                (props.bgColor + "99") as Color,
                (props.bgColor + "ee") as Color,
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
