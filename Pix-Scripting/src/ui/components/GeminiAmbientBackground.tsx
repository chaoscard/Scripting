import {
  Color,
  Ellipse,
  Rectangle,
  ZStack,
  useEffect,
  useState,
} from "scripting"
import type { AmbientIntensity } from "../../store/settings"

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

// 官方 5 色调色环定义（深色模式：深度压暗保底，防止过曝；浅色模式：柔和水彩粉彩）
const GEMINI_B_PALETTE_DARK: readonly Color[] = [
  "#581c87" as Color, // 1. 紫晶洋红
  "#78350f" as Color, // 2. 暖暗琥珀
  "#064e3b" as Color, // 3. 暗夜翡翠
  "#1e3a8a" as Color, // 4. 皇家深海蓝
  "#0e7490" as Color, // 5. 深邃天青
]

const GEMINI_B_PALETTE_LIGHT: readonly Color[] = [
  "#c084fc" as Color, // 1. 柔紫晶
  "#fbbf24" as Color, // 2. 暖金珀
  "#34d399" as Color, // 3. 翡翠青
  "#60a5fa" as Color, // 4. 晴空蓝
  "#38bdf8" as Color, // 5. 冰川青
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

export function GeminiAmbientBackground(props: GeminiAmbientBackgroundProps) {
  // 克制透明度：深色模式 0.33，明亮模式 0.24
  const intensityAlpha =
    props.intensity === "high"
      ? props.isDark ? 0.42 : 0.32
      : props.intensity === "low"
        ? props.isDark ? 0.24 : 0.16
        : props.isDark ? 0.33 : 0.24

  // 1. 构建色彩流转调色环（实色化处理，彻底剥离双重 Alpha 衰减）
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

  // 2. 状态机：每 2.4 秒平滑随机流转左右双主色（绝不撞色，每次步进必定换色）
  const [leftIndex, setLeftIndex] = useState(0)
  const [rightIndex, setRightIndex] = useState(1)

  useEffect(() => {
    let active = true
    let timerId: any = null

    const scheduleNext = () => {
      timerId = setTimeout(() => {
        if (!active) return
        void withAnimation(Animation.smooth({ duration: 2.2 }), () => {
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
      }, 2400)
    }

    scheduleNext()

    return () => {
      active = false
      if (timerId != null) {
        clearTimeout(timerId)
      }
    }
  }, [paletteLen])

  // 3. 当前时刻的双主色（左侧与右侧双色温对流）
  const leftColor = activePalette[leftIndex % paletteLen] ?? activePalette[0]!
  const rightColor = activePalette[rightIndex % paletteLen] ?? (activePalette[1] ?? activePalette[0]!)

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} ignoresSafeArea={true}>
      {/* 1. 深空/曜石黑基底 */}
      <Rectangle fill={props.bgColor} ignoresSafeArea={true} />

      {/* 2. 左上满宽极光漫射场（Left Sky Nebula Field）：安全布局尺寸 + scaleEffect 矩阵缩放，绝不撑大布局树 */}
      <Ellipse
        fill={leftColor}
        frame={{ width: 280, height: 260 }}
        scaleEffect={{ x: 2.1, y: 1.7 }}
        offset={{ x: -75, y: -310 }}
        blur={{ radius: 100, opaque: false }}
        opacity={intensityAlpha}
        swingAnimation={{
          x: { duration: 5.0, distance: 45 },
          y: { duration: 3.8, distance: 35 },
        }}
      />

      {/* 3. 右上满宽极光漫射场（Right Sky Nebula Field）：逆向缓慢推拉，与左侧交融过渡 */}
      <Ellipse
        fill={rightColor}
        frame={{ width: 290, height: 270 }}
        scaleEffect={{ x: 2.1, y: 1.7 }}
        offset={{ x: 75, y: -290 }}
        blur={{ radius: 110, opaque: false }}
        opacity={intensityAlpha * 0.95}
        swingAnimation={{
          x: { duration: 5.6, distance: -50 },
          y: { duration: 4.2, distance: 30 },
        }}
      />

      {/* 4. 纵向自然衰减遮罩（在页面 35%~40% 高度极其平滑地隐入纯黑底色） */}
      <Rectangle
        fill={{
          colors: [
            "clear" as Color,
            "clear" as Color,
            "clear" as Color,
            (props.isDark ? "#00000066" : "#ffffff66") as Color,
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
