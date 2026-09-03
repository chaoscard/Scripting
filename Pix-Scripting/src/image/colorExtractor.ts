import type { Color } from "scripting"
import type { AmbientIntensity } from "../store/settings"
import { cachedFilePath, loadImage } from "./imageLoader"

export interface UserAmbientPalette {
  topColor: Color
  midColor: Color
  worksColor: Color
}

export interface IllustAmbientPalette {
  topColor: Color
  midColor: Color
  backgroundColor: Color
  // 探索算法专属（感知自适应 + 极光双焦点）
  exploreAccentColor?: Color
  exploreTopColor?: Color
  exploreMidColor?: Color
  exploreBgColor?: Color
  // 极致算法专属（空间四象限物理光影 + 棱镜色散流光）
  ultimateLeadingColor?: Color
  ultimatePrismColor?: Color
  ultimateTrailingColor?: Color
  ultimateMidColor?: Color
  ultimateBgColor?: Color
  ultimateLeadingCoreColor?: Color
  ultimatePrismCoreColor?: Color
  ultimateTrailingCoreColor?: Color
}

export type IntensityPaletteMap<T> = {
  low: T
  medium: T
  high: T
}

export interface UserAmbientResult {
  light: IntensityPaletteMap<UserAmbientPalette>
  dark: IntensityPaletteMap<UserAmbientPalette>
}

export interface IllustAmbientResult {
  light: IntensityPaletteMap<IllustAmbientPalette>
  dark: IntensityPaletteMap<IllustAmbientPalette>
}

// 内存缓存：URL -> UserAmbientResult
const paletteCache = new Map<string, UserAmbientResult>()

// 内存缓存：URL -> IllustAmbientResult
const illustPaletteCache = new Map<string, IllustAmbientResult>()

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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
      let tt = t
      if (tt < 0) tt += 1
      if (tt > 1) tt -= 1
      if (tt < 1 / 6) return p + (q - p) * 6 * tt
      if (tt < 1 / 2) return q
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
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

/**
 * 适度增强色彩饱和度与明度，使氛围延伸自然生动、层次分明
 */
function boostVibrancy(
  red: number,
  green: number,
  blue: number,
  isDark: boolean,
  intensity: AmbientIntensity = "medium"
): [number, number, number] {
  const [h, s, l] = rgbToHsl(red, green, blue)
  let boostedS: number
  let targetL: number

  if (intensity === "low") {
    boostedS = Math.min(0.65, Math.max(0.15, s * 1.00))
    targetL = isDark
      ? Math.min(0.50, Math.max(0.26, l * 0.90))
      : Math.min(0.80, Math.max(0.52, l * 1.04))
  } else if (intensity === "high") {
    boostedS = Math.min(0.82, Math.max(0.18, s * 1.15))
    targetL = isDark
      ? Math.min(0.52, Math.max(0.24, l * 0.88))
      : Math.min(0.78, Math.max(0.48, l * 1.06))
  } else {
    // medium (标准)
    boostedS = Math.min(0.72, Math.max(0.15, s * 1.05))
    targetL = isDark
      ? Math.min(0.50, Math.max(0.26, l * 0.90))
      : Math.min(0.80, Math.max(0.52, l * 1.04))
  }

  return hslToRgb(h, boostedS, targetL)
}

/**
 * 同步尝试从已缓存到本地的图片提取氛围色
 */
export function extractUserAmbientPaletteSync(
  url: string | null | undefined
): UserAmbientResult | null {
  if (!url) return null
  const cached = paletteCache.get(url)
  if (cached) return cached

  try {
    const filePath = cachedFilePath(url)
    if (!filePath) return null

    const uiImage = UIImage.fromFile(filePath)
    if (!uiImage || uiImage.width <= 0 || uiImage.height <= 0) return null

    // 1. 底边 20% 区域采样（无缝承接背景图底部）
    const cropH = Math.max(2, Math.round(uiImage.height * 0.2))
    const cropY = Math.max(0, uiImage.height - cropH)
    const bottomCrop = uiImage.croppedTo({
      x: 0,
      y: cropY,
      width: uiImage.width,
      height: cropH,
    })
    const bottomAvg = bottomCrop?.averageColor() ?? uiImage.averageColor()

    // 2. 全局主色采样：在主色列表中优先选取鲜活度适中的颜色
    const dominants = uiImage.dominantColors(6)
    let bestDominant = uiImage.averageColor()
    if (dominants && dominants.length > 0) {
      let maxScore = -1
      for (const d of dominants) {
        const c = d.color
        const [, s] = rgbToHsl(c.red ?? 0, c.green ?? 0, c.blue ?? 0)
        const score = s * 1.5 + d.fraction
        if (score > maxScore) {
          maxScore = score
          bestDominant = c
        }
      }
    }

    if (!bottomAvg || !bestDominant) return null

    const bRawR = bottomAvg.red ?? 0
    const bRawG = bottomAvg.green ?? 0
    const bRawB = bottomAvg.blue ?? 0

    const dRawR = bestDominant.red ?? 0
    const dRawG = bestDominant.green ?? 0
    const dRawB = bestDominant.blue ?? 0

    const buildUserPalette = (
      bRaw: [number, number, number],
      dRaw: [number, number, number],
      isDark: boolean,
      intensity: AmbientIntensity
    ): UserAmbientPalette => {
      const [bR, bG, bB] = boostVibrancy(bRaw[0], bRaw[1], bRaw[2], isDark, intensity)
      const [dR, dG, dB] = boostVibrancy(dRaw[0], dRaw[1], dRaw[2], isDark, intensity)
      let topAlpha = 0.44
      let midAlpha = 0.22
      let worksAlpha = 0.08
      if (intensity === "low") {
        topAlpha = 0.38
        midAlpha = 0.18
        worksAlpha = 0.06
      } else if (intensity === "high") {
        topAlpha = isDark ? 0.54 : 0.52
        midAlpha = 0.28
        worksAlpha = 0.11
      }
      return {
        topColor: `rgba(${bR},${bG},${bB},${topAlpha})` as Color,
        midColor: `rgba(${dR},${dG},${dB},${midAlpha})` as Color,
        worksColor: `rgba(${dR},${dG},${dB},${worksAlpha})` as Color,
      }
    }

    const result: UserAmbientResult = {
      light: {
        low: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], false, "low"),
        medium: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], false, "medium"),
        high: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], false, "high"),
      },
      dark: {
        low: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], true, "low"),
        medium: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], true, "medium"),
        high: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], true, "high"),
      },
    }
    paletteCache.set(url, result)
    return result
  } catch (err) {
    console.log("extractUserAmbientPaletteSync error:", err)
    return null
  }
}

/**
 * 同步尝试从内存缓存中获取已计算的氛围色盘（未缓存时自动同步尝试从本地文件解析）
 */
export function getCachedUserAmbientPalette(
  url: string | null | undefined,
  isDark: boolean,
  intensity: AmbientIntensity = "medium"
): UserAmbientPalette | null {
  if (!url) return null
  let cached = paletteCache.get(url)
  if (!cached) {
    cached = extractUserAmbientPaletteSync(url) ?? undefined
  }
  if (!cached) return null
  const modeObj = isDark ? cached.dark : cached.light
  return modeObj[intensity] ?? modeObj.medium
}

/**
 * 异步从用户背景图提取双色标氛围色（底边采样 + 核心主色），并生成适配深浅模式与强度的渐变色阶
 */
export async function extractUserAmbientPalette(
  url: string | null | undefined
): Promise<UserAmbientResult | null> {
  if (!url) return null
  const cached = paletteCache.get(url)
  if (cached) return cached

  try {
    let filePath = cachedFilePath(url)
    if (!filePath) {
      filePath = await loadImage(url, 0)
    }
    if (!filePath) return null

    const uiImage = UIImage.fromFile(filePath)
    if (!uiImage || uiImage.width <= 0 || uiImage.height <= 0) return null

    // 1. 底边 20% 区域采样（无缝承接背景图底部）
    const cropH = Math.max(2, Math.round(uiImage.height * 0.2))
    const cropY = Math.max(0, uiImage.height - cropH)
    const bottomCrop = uiImage.croppedTo({
      x: 0,
      y: cropY,
      width: uiImage.width,
      height: cropH,
    })
    const bottomAvg = bottomCrop?.averageColor() ?? uiImage.averageColor()

    // 2. 全局主色采样：在主色列表中优先选取鲜活度适中的颜色
    const dominants = uiImage.dominantColors(6)
    let bestDominant = uiImage.averageColor()
    if (dominants && dominants.length > 0) {
      let maxScore = -1
      for (const d of dominants) {
        const c = d.color
        const [, s] = rgbToHsl(c.red ?? 0, c.green ?? 0, c.blue ?? 0)
        const score = s * 1.5 + d.fraction
        if (score > maxScore) {
          maxScore = score
          bestDominant = c
        }
      }
    }

    if (!bottomAvg || !bestDominant) return null

    const bRawR = bottomAvg.red ?? 0
    const bRawG = bottomAvg.green ?? 0
    const bRawB = bottomAvg.blue ?? 0

    const dRawR = bestDominant.red ?? 0
    const dRawG = bestDominant.green ?? 0
    const dRawB = bestDominant.blue ?? 0

    const buildUserPalette = (
      bRaw: [number, number, number],
      dRaw: [number, number, number],
      isDark: boolean,
      intensity: AmbientIntensity
    ): UserAmbientPalette => {
      const [bR, bG, bB] = boostVibrancy(bRaw[0], bRaw[1], bRaw[2], isDark, intensity)
      const [dR, dG, dB] = boostVibrancy(dRaw[0], dRaw[1], dRaw[2], isDark, intensity)
      let topAlpha = 0.44
      let midAlpha = 0.22
      let worksAlpha = 0.08
      if (intensity === "low") {
        topAlpha = 0.38
        midAlpha = 0.18
        worksAlpha = 0.06
      } else if (intensity === "high") {
        topAlpha = isDark ? 0.54 : 0.52
        midAlpha = 0.28
        worksAlpha = 0.11
      }
      return {
        topColor: `rgba(${bR},${bG},${bB},${topAlpha})` as Color,
        midColor: `rgba(${dR},${dG},${dB},${midAlpha})` as Color,
        worksColor: `rgba(${dR},${dG},${dB},${worksAlpha})` as Color,
      }
    }

    const result: UserAmbientResult = {
      light: {
        low: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], false, "low"),
        medium: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], false, "medium"),
        high: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], false, "high"),
      },
      dark: {
        low: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], true, "low"),
        medium: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], true, "medium"),
        high: buildUserPalette([bRawR, bRawG, bRawB], [dRawR, dRawG, dRawB], true, "high"),
      },
    }
    paletteCache.set(url, result)
    return result
  } catch (err) {
    console.log("extractUserAmbientPalette error:", err)
    return null
  }
}

/**
 * 针对探索算法的感知明度与舒适度自适应修饰
 */
function adaptPerceptualColor(
  red: number,
  green: number,
  blue: number,
  isDark: boolean,
  intensity: AmbientIntensity = "medium"
): [number, number, number] {
  const [h, s, l] = rgbToHsl(red, green, blue)
  let targetS = s
  let targetL = l

  if (isDark) {
    // 深色模式：限制最高明度防晃眼，适度增强饱和度维持暗夜微光质感
    if (intensity === "low") {
      targetS = Math.min(0.70, Math.max(0.20, s * 1.05))
      targetL = Math.min(0.32, Math.max(0.12, l * 0.70))
    } else if (intensity === "high") {
      targetS = Math.min(0.90, Math.max(0.35, s * 1.25))
      targetL = Math.min(0.42, Math.max(0.18, l * 0.85))
    } else {
      // medium (标准)
      targetS = Math.min(0.80, Math.max(0.25, s * 1.15))
      targetL = Math.min(0.36, Math.max(0.14, l * 0.78))
    }
  } else {
    // 浅色模式：粉彩化提升明度防脏底，收敛过激饱和度
    if (intensity === "low") {
      targetS = Math.min(0.45, Math.max(0.10, s * 0.85))
      targetL = Math.min(0.92, Math.max(0.78, 0.65 + l * 0.30))
    } else if (intensity === "high") {
      targetS = Math.min(0.75, Math.max(0.25, s * 1.10))
      targetL = Math.min(0.84, Math.max(0.62, 0.45 + l * 0.40))
    } else {
      // medium (标准)
      targetS = Math.min(0.60, Math.max(0.18, s * 0.95))
      targetL = Math.min(0.88, Math.max(0.70, 0.55 + l * 0.35))
    }
  }

  return hslToRgb(h, targetS, targetL)
}

/**
 * 从图片裁剪区域中提取饱和度与活力度最高的局部峰值色彩（避免大面积均值稀释高光）
 */
function extractPeakVibrantColor(
  crop: UIImage | null,
  fallback: { red?: number; green?: number; blue?: number } | null | undefined
): { red?: number; green?: number; blue?: number } {
  if (!crop) return fallback ?? { red: 128, green: 128, blue: 128 }
  try {
    const dominants = crop.dominantColors(4)
    if (dominants && dominants.length > 0) {
      let best = dominants[0].color
      let maxScore = -1
      for (const d of dominants) {
        const c = d.color
        const [, s, l] = rgbToHsl(c.red ?? 0, c.green ?? 0, c.blue ?? 0)
        // 过滤极暗或极亮死色，偏好高纯度色彩
        if (l >= 0.12 && l <= 0.90) {
          const score = s * 2.2 + (1 - Math.abs(l - 0.52)) * 1.0 + d.fraction
          if (score > maxScore) {
            maxScore = score
            best = c
          }
        }
      }
      if (maxScore > 0 && best) return best
    }
    return crop.averageColor() ?? fallback ?? { red: 128, green: 128, blue: 128 }
  } catch {
    return crop.averageColor() ?? fallback ?? { red: 128, green: 128, blue: 128 }
  }
}

/**
 * 计算两色之间的色散过渡桥接色（避免冷暖色彩相交时在渐变中段产生泥泞灰暗）
 */
function computePrismaticBridge(
  c1: [number, number, number],
  c2: [number, number, number]
): [number, number, number] {
  const [h1, s1, l1] = rgbToHsl(c1[0], c1[1], c1[2])
  const [h2, s2, l2] = rgbToHsl(c2[0], c2[1], c2[2])

  let diff = h2 - h1
  if (diff > 0.5) diff -= 1
  if (diff < -0.5) diff += 1

  // 取色轮最短弧度中点
  const bridgeH = (h1 + diff * 0.5 + 1) % 1
  // 通透度补偿：提升色散桥接处的纯度与饱满感
  const bridgeS = Math.min(1.0, Math.max(s1, s2, 0.45) * 1.20)
  const bridgeL = Math.min(0.75, Math.max(0.35, (l1 + l2) / 2))

  return hslToRgb(bridgeH, bridgeS, bridgeL)
}

/**
 * 针对极致算法的晶莹通透度与 OLED 深空对比自适应
 */
function adaptUltimatePerceptualColor(
  red: number,
  green: number,
  blue: number,
  isDark: boolean,
  intensity: AmbientIntensity = "medium",
  role: "leading" | "prism" | "trailing" | "mid" | "bg" = "leading"
): [number, number, number] {
  const [h, s, l] = rgbToHsl(red, green, blue)
  let targetS = s
  let targetL = l

  if (isDark) {
    // 深色模式 (OLED Nebula)：高光保留高纯度霓虹发光感，背景收敛于深空黑曜石
    if (role === "bg") {
      targetS = Math.min(0.50, Math.max(0.10, s * 0.80))
      targetL = 0.05
    } else if (role === "mid") {
      targetS = Math.min(0.85, Math.max(0.20, s * 1.10))
      targetL = intensity === "high" ? 0.22 : intensity === "low" ? 0.12 : 0.16
    } else {
      // leading / prism / trailing
      const sMultiplier = intensity === "high" ? 1.35 : intensity === "low" ? 1.10 : 1.25
      const maxL = intensity === "high" ? 0.46 : intensity === "low" ? 0.34 : 0.40
      const minL = intensity === "high" ? 0.20 : intensity === "low" ? 0.14 : 0.16
      targetS = Math.min(0.95, Math.max(0.35, s * sMultiplier))
      targetL = Math.min(maxL, Math.max(minL, l * 0.82))
    }
  } else {
    // 浅色模式 (Frost Crystal)：提升通透清澈感与明度，去除灰雾感
    if (role === "bg") {
      targetS = Math.min(0.25, Math.max(0.04, s * 0.50))
      targetL = 0.96
    } else if (role === "mid") {
      targetS = Math.min(0.55, Math.max(0.12, s * 0.85))
      targetL = intensity === "high" ? 0.82 : intensity === "low" ? 0.90 : 0.86
    } else {
      // leading / prism / trailing
      const sMultiplier = intensity === "high" ? 1.15 : intensity === "low" ? 0.88 : 1.00
      const minL = intensity === "high" ? 0.60 : intensity === "low" ? 0.78 : 0.70
      targetS = Math.min(0.75, Math.max(0.20, s * sMultiplier))
      targetL = Math.min(0.92, Math.max(minL, 0.55 + l * 0.35))
    }
  }

  return hslToRgb(h, targetS, targetL)
}

/**
 * 计算动态流光球中心最高亮度高光核色彩（极高明度 + 适度饱和发光）
 */
function adaptUltimateCoreColor(
  red: number,
  green: number,
  blue: number,
  isDark: boolean
): [number, number, number] {
  const [h, s, l] = rgbToHsl(red, green, blue)
  if (isDark) {
    // 深色模式：大幅拉高明度至 0.76~0.92，保留适度发光纯度，形成超亮发光中心
    const coreS = Math.min(0.55, Math.max(0.18, s * 0.70))
    const coreL = Math.min(0.92, Math.max(0.76, 0.58 + l * 0.38))
    return hslToRgb(h, coreS, coreL)
  } else {
    // 浅色模式：晶莹白光透射，极轻柔淡彩
    const coreS = Math.min(0.25, Math.max(0.06, s * 0.35))
    const coreL = 0.98
    return hslToRgb(h, coreS, coreL)
  }
}

function buildIllustPalette(
  tRaw: [number, number, number],
  dRaw: [number, number, number],
  aRaw: [number, number, number],
  tlRaw: [number, number, number],
  trRaw: [number, number, number],
  prismRaw: [number, number, number],
  bRaw: [number, number, number],
  isDark: boolean,
  intensity: AmbientIntensity
): IllustAmbientPalette {
  // 1. 经典算法色彩 (Classic - 浅色水彩浓郁优化)
  const [tR, tG, tB] = boostVibrancy(tRaw[0], tRaw[1], tRaw[2], isDark, intensity)
  const [dR, dG, dB] = boostVibrancy(dRaw[0], dRaw[1], dRaw[2], isDark, intensity)
  let topAlpha = isDark ? 0.54 : 0.68
  let midAlpha = isDark ? 0.28 : 0.38
  let bgAlpha = isDark ? 0.10 : 0.14
  if (intensity === "low") {
    topAlpha = isDark ? 0.46 : 0.54
    midAlpha = isDark ? 0.24 : 0.28
    bgAlpha = isDark ? 0.08 : 0.10
  } else if (intensity === "high") {
    topAlpha = isDark ? 0.66 : 0.80
    midAlpha = isDark ? 0.36 : 0.48
    bgAlpha = isDark ? 0.14 : 0.18
  }

  // 2. 探索算法色彩 (Explore - 浅色水彩通透增强)
  const [expTR, expTG, expTB] = adaptPerceptualColor(tRaw[0], tRaw[1], tRaw[2], isDark, intensity)
  const [expDR, expDG, expDB] = adaptPerceptualColor(dRaw[0], dRaw[1], dRaw[2], isDark, intensity)
  const [expAR, expAG, expAB] = adaptPerceptualColor(aRaw[0], aRaw[1], aRaw[2], isDark, intensity)

  let expAccentAlpha = isDark ? 0.52 : 0.64
  let expTopAlpha = isDark ? 0.58 : 0.70
  let expMidAlpha = isDark ? 0.24 : 0.32
  let expBgAlpha = 0.00
  if (intensity === "low") {
    expAccentAlpha = isDark ? 0.32 : 0.44
    expTopAlpha = isDark ? 0.38 : 0.50
    expMidAlpha = isDark ? 0.14 : 0.20
    expBgAlpha = 0.00
  } else if (intensity === "high") {
    expAccentAlpha = isDark ? 0.70 : 0.82
    expTopAlpha = isDark ? 0.76 : 0.88
    expMidAlpha = isDark ? 0.38 : 0.46
    expBgAlpha = isDark ? 0.04 : 0.04
  }

  // 3. 极致算法色彩 (Ultimate - 空间四象限物理光影 + 浅色去雾)
  const [ultLeadR, ultLeadG, ultLeadB] = adaptUltimatePerceptualColor(tlRaw[0], tlRaw[1], tlRaw[2], isDark, intensity, "leading")
  const [ultPrismR, ultPrismG, ultPrismB] = adaptUltimatePerceptualColor(prismRaw[0], prismRaw[1], prismRaw[2], isDark, intensity, "prism")
  const [ultTrailR, ultTrailG, ultTrailB] = adaptUltimatePerceptualColor(trRaw[0], trRaw[1], trRaw[2], isDark, intensity, "trailing")
  const [ultMidR, ultMidG, ultMidB] = adaptUltimatePerceptualColor(dRaw[0], dRaw[1], dRaw[2], isDark, intensity, "mid")
  const [ultBgR, ultBgG, ultBgB] = adaptUltimatePerceptualColor(bRaw[0], bRaw[1], bRaw[2], isDark, intensity, "bg")

  const [ultLeadCoreR, ultLeadCoreG, ultLeadCoreB] = adaptUltimateCoreColor(tlRaw[0], tlRaw[1], tlRaw[2], isDark)
  const [ultPrismCoreR, ultPrismCoreG, ultPrismCoreB] = adaptUltimateCoreColor(prismRaw[0], prismRaw[1], prismRaw[2], isDark)
  const [ultTrailCoreR, ultTrailCoreG, ultTrailCoreB] = adaptUltimateCoreColor(trRaw[0], trRaw[1], trRaw[2], isDark)

  let ultLeadAlpha = isDark ? 0.62 : 0.76
  let ultPrismAlpha = isDark ? 0.52 : 0.66
  let ultTrailAlpha = isDark ? 0.46 : 0.58
  let ultMidAlpha = isDark ? 0.20 : 0.26
  let ultBgAlpha = 0.00
  let ultCoreAlpha = isDark ? 0.68 : 0.75
  if (intensity === "low") {
    ultLeadAlpha = isDark ? 0.42 : 0.52
    ultPrismAlpha = isDark ? 0.34 : 0.42
    ultTrailAlpha = isDark ? 0.28 : 0.36
    ultMidAlpha = isDark ? 0.12 : 0.16
    ultBgAlpha = 0.00
    ultCoreAlpha = isDark ? 0.44 : 0.50
  } else if (intensity === "high") {
    ultLeadAlpha = isDark ? 0.80 : 0.90
    ultPrismAlpha = isDark ? 0.70 : 0.80
    ultTrailAlpha = isDark ? 0.62 : 0.72
    ultMidAlpha = isDark ? 0.34 : 0.40
    ultBgAlpha = isDark ? 0.03 : 0.03
    ultCoreAlpha = isDark ? 0.88 : 0.92
  }

  return {
    topColor: `rgba(${tR},${tG},${tB},${topAlpha})` as Color,
    midColor: `rgba(${dR},${dG},${dB},${midAlpha})` as Color,
    backgroundColor: `rgba(${dR},${dG},${dB},${bgAlpha})` as Color,

    exploreAccentColor: `rgba(${expAR},${expAG},${expAB},${expAccentAlpha})` as Color,
    exploreTopColor: `rgba(${expTR},${expTG},${expTB},${expTopAlpha})` as Color,
    exploreMidColor: `rgba(${expDR},${expDG},${expDB},${expMidAlpha})` as Color,
    exploreBgColor: `rgba(${expDR},${expDG},${expDB},${expBgAlpha})` as Color,

    ultimateLeadingColor: `rgba(${ultLeadR},${ultLeadG},${ultLeadB},${ultLeadAlpha})` as Color,
    ultimatePrismColor: `rgba(${ultPrismR},${ultPrismG},${ultPrismB},${ultPrismAlpha})` as Color,
    ultimateTrailingColor: `rgba(${ultTrailR},${ultTrailG},${ultTrailB},${ultTrailAlpha})` as Color,
    ultimateMidColor: `rgba(${ultMidR},${ultMidG},${ultMidB},${ultMidAlpha})` as Color,
    ultimateBgColor: `rgba(${ultBgR},${ultBgG},${ultBgB},${ultBgAlpha})` as Color,

    ultimateLeadingCoreColor: `rgba(${ultLeadCoreR},${ultLeadCoreG},${ultLeadCoreB},${ultCoreAlpha})` as Color,
    ultimatePrismCoreColor: `rgba(${ultPrismCoreR},${ultPrismCoreG},${ultPrismCoreB},${ultCoreAlpha})` as Color,
    ultimateTrailingCoreColor: `rgba(${ultTrailCoreR},${ultTrailCoreG},${ultTrailCoreB},${ultCoreAlpha})` as Color,
  }
}

function processIllustPaletteFromImage(uiImage: UIImage, url?: string): IllustAmbientResult | null {
  if (!uiImage || uiImage.width <= 0 || uiImage.height <= 0) return null

  // 1. 顶部 30% 区域采样（经典/探索共用）
  const cropH = Math.max(2, Math.round(uiImage.height * 0.3))
  const topCrop = uiImage.croppedTo({
    x: 0,
    y: 0,
    width: uiImage.width,
    height: cropH,
  })
  const topAvg = topCrop?.averageColor() ?? uiImage.averageColor()

  // 2. 空间局部角标峰值活力采样（极致算法：21% 黄金微窗口精准捕捉边缘与角部高光）
  const cornerW = Math.max(2, Math.round(uiImage.width * 0.21))
  const cornerH = Math.max(2, Math.round(uiImage.height * 0.21))

  const topLeftCrop = uiImage.croppedTo({
    x: 0,
    y: 0,
    width: cornerW,
    height: cornerH,
  })
  const topLeftColor = extractPeakVibrantColor(topLeftCrop, topAvg)

  const topRightCrop = uiImage.croppedTo({
    x: Math.max(0, uiImage.width - cornerW),
    y: 0,
    width: cornerW,
    height: cornerH,
  })
  const topRightColor = extractPeakVibrantColor(topRightCrop, topAvg)

  const bottomH = Math.max(2, Math.round(uiImage.height * 0.15))
  const bottomCrop = uiImage.croppedTo({
    x: 0,
    y: Math.max(0, uiImage.height - bottomH),
    width: uiImage.width,
    height: bottomH,
  })
  const bottomAvg = bottomCrop?.averageColor() ?? uiImage.averageColor()

  // 3. 全局多主色采样：在主色列表中优先选取鲜活度适中的颜色
  const dominants = uiImage.dominantColors(8)
  let bestDominant = uiImage.averageColor()
  let secondDominant: any = null
  if (dominants && dominants.length > 0) {
    let maxScore = -1
    for (const d of dominants) {
      const c = d.color
      const [, s] = rgbToHsl(c.red ?? 0, c.green ?? 0, c.blue ?? 0)
      const score = s * 1.6 + d.fraction
      if (score > maxScore) {
        maxScore = score
        bestDominant = c
      }
    }

    if (bestDominant) {
      // 寻找与 bestDominant 色相差异明显的主色作为极光副色与空间补充色
      const [dMainH] = rgbToHsl(bestDominant.red ?? 0, bestDominant.green ?? 0, bestDominant.blue ?? 0)
      let bestAccentScore = -1
      for (const d of dominants) {
        const c = d.color
        if (c === bestDominant) continue
        const [h, s] = rgbToHsl(c.red ?? 0, c.green ?? 0, c.blue ?? 0)
        let hueDiff = Math.abs(h - dMainH)
        if (hueDiff > 0.5) hueDiff = 1 - hueDiff
        // 色相差在 30度 (0.083) 以上，饱和度适中
        if (hueDiff >= 0.08 && s >= 0.15) {
          const score = hueDiff * 2.0 + s * 1.2 + d.fraction
          if (score > bestAccentScore) {
            bestAccentScore = score
            secondDominant = c
          }
        }
      }
    }
  }

  if (!topAvg || !bestDominant) return null

  const tRawR = topAvg.red ?? 0
  const tRawG = topAvg.green ?? 0
  const tRawB = topAvg.blue ?? 0

  const dRawR = bestDominant.red ?? 0
  const dRawG = bestDominant.green ?? 0
  const dRawB = bestDominant.blue ?? 0

  // 若没有从主色列表中找到明显的第二副色，通过 HSL 色相偏移衍生和谐极光副色（偏移 ~35°）
  let accentRawR = dRawR
  let accentRawG = dRawG
  let accentRawB = dRawB
  if (secondDominant) {
    accentRawR = secondDominant.red ?? 0
    accentRawG = secondDominant.green ?? 0
    accentRawB = secondDominant.blue ?? 0
  } else {
    const [h, s, l] = rgbToHsl(dRawR, dRawG, dRawB)
    const shiftedH = (h + 0.098) % 1
    const [ar, ag, ab] = hslToRgb(shiftedH, Math.max(0.3, s), l)
    accentRawR = ar
    accentRawG = ag
    accentRawB = ab
  }

  // 极致算法：空间多方位峰值色彩 + 色相张力保底
  let tlRawR = topLeftColor.red ?? tRawR
  let tlRawG = topLeftColor.green ?? tRawG
  let tlRawB = topLeftColor.blue ?? tRawB

  let trRawR = topRightColor.red ?? tRawR
  let trRawG = topRightColor.green ?? tRawG
  let trRawB = topRightColor.blue ?? tRawB

  const [tlH] = rgbToHsl(tlRawR, tlRawG, tlRawB)
  const [trH] = rgbToHsl(trRawR, trRawG, trRawB)
  let cornerHueDiff = Math.abs(tlH - trH)
  if (cornerHueDiff > 0.5) cornerHueDiff = 1 - cornerHueDiff

  // 若两角提取到的色相过于接近（< 36°），启用色相张力保护机制
  if (cornerHueDiff < 0.10) {
    if (secondDominant) {
      trRawR = secondDominant.red ?? 0
      trRawG = secondDominant.green ?? 0
      trRawB = secondDominant.blue ?? 0
    } else {
      const [h, s, l] = rgbToHsl(tlRawR, tlRawG, tlRawB)
      const shiftedH = (h + 0.13) % 1
      const [ar, ag, ab] = hslToRgb(shiftedH, Math.max(0.40, s), l)
      trRawR = ar
      trRawG = ag
      trRawB = ab
    }
  }

  const bRawR = bottomAvg?.red ?? dRawR
  const bRawG = bottomAvg?.green ?? dRawG
  const bRawB = bottomAvg?.blue ?? dRawB

  const prismRaw = computePrismaticBridge([tlRawR, tlRawG, tlRawB], [trRawR, trRawG, trRawB])

  const result: IllustAmbientResult = {
    light: {
      low: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], [accentRawR, accentRawG, accentRawB], [tlRawR, tlRawG, tlRawB], [trRawR, trRawG, trRawB], prismRaw, [bRawR, bRawG, bRawB], false, "low"),
      medium: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], [accentRawR, accentRawG, accentRawB], [tlRawR, tlRawG, tlRawB], [trRawR, trRawG, trRawB], prismRaw, [bRawR, bRawG, bRawB], false, "medium"),
      high: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], [accentRawR, accentRawG, accentRawB], [tlRawR, tlRawG, tlRawB], [trRawR, trRawG, trRawB], prismRaw, [bRawR, bRawG, bRawB], false, "high"),
    },
    dark: {
      low: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], [accentRawR, accentRawG, accentRawB], [tlRawR, tlRawG, tlRawB], [trRawR, trRawG, trRawB], prismRaw, [bRawR, bRawG, bRawB], true, "low"),
      medium: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], [accentRawR, accentRawG, accentRawB], [tlRawR, tlRawG, tlRawB], [trRawR, trRawG, trRawB], prismRaw, [bRawR, bRawG, bRawB], true, "medium"),
      high: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], [accentRawR, accentRawG, accentRawB], [tlRawR, tlRawG, tlRawB], [trRawR, trRawG, trRawB], prismRaw, [bRawR, bRawG, bRawB], true, "high"),
    },
  }
  if (url) {
    illustPaletteCache.set(url, result)
  }
  return result
}

/**
 * 同步尝试从已缓存到本地的插画封面提取氛围色
 */
export function extractIllustAmbientPaletteSync(
  url: string | null | undefined
): IllustAmbientResult | null {
  if (!url) return null
  const cached = illustPaletteCache.get(url)
  if (cached) return cached

  try {
    const filePath = cachedFilePath(url)
    if (!filePath) return null

    const uiImage = UIImage.fromFile(filePath)
    if (!uiImage || uiImage.width <= 0 || uiImage.height <= 0) return null

    return processIllustPaletteFromImage(uiImage, url)
  } catch (err) {
    console.log("extractIllustAmbientPaletteSync error:", err)
    return null
  }
}

/**
 * 同步尝试从内存缓存中获取已计算的插画/漫画氛围色盘（未缓存时自动同步尝试从本地文件解析）
 */
export function getCachedIllustAmbientPalette(
  url: string | null | undefined,
  isDark: boolean,
  intensity: AmbientIntensity = "medium"
): IllustAmbientPalette | null {
  if (!url) return null
  let cached = illustPaletteCache.get(url)
  if (!cached) {
    cached = extractIllustAmbientPaletteSync(url) ?? undefined
  }
  if (!cached) return null
  const modeObj = isDark ? cached.dark : cached.light
  return modeObj[intensity] ?? modeObj.medium
}

/**
 * 异步从插画/漫画封面提取氛围色（顶部主色与全局核心色调），生成与画作呼应的自然渐变
 */
export async function extractIllustAmbientPalette(
  url: string | null | undefined
): Promise<IllustAmbientResult | null> {
  if (!url) return null
  const cached = illustPaletteCache.get(url)
  if (cached) return cached

  try {
    let filePath = cachedFilePath(url)
    if (!filePath) {
      filePath = await loadImage(url, 0)
    }
    if (!filePath) return null

    const uiImage = UIImage.fromFile(filePath)
    if (!uiImage || uiImage.width <= 0 || uiImage.height <= 0) return null

    return processIllustPaletteFromImage(uiImage, url)
  } catch (err) {
    console.log("extractIllustAmbientPalette error:", err)
    return null
  }
}
