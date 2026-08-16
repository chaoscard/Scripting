import type { Color } from "scripting"
import { cachedFilePath, loadImage } from "./imageLoader"

export interface UserAmbientPalette {
  topColor: Color
  midColor: Color
  worksColor: Color
}

export interface UserAmbientResult {
  light: UserAmbientPalette
  dark: UserAmbientPalette
}

// 内存缓存：URL -> UserAmbientResult
const paletteCache = new Map<string, UserAmbientResult>()

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
 * 提升色彩饱和度与明度，使氛围延伸柔和、高级而不过度浓艳
 */
function boostVibrancy(
  red: number,
  green: number,
  blue: number,
  isDark: boolean
): [number, number, number] {
  const [h, s, l] = rgbToHsl(red, green, blue)
  // 适度调整饱和度，保持柔和优雅
  const boostedS = Math.min(0.80, Math.max(0.18, s * 1.15 + 0.05))
  // 约束明度在清爽舒适的区间
  const targetL = isDark
    ? Math.min(0.55, Math.max(0.28, l * 0.9))
    : Math.min(0.78, Math.max(0.50, l * 1.05))
  return hslToRgb(h, boostedS, targetL)
}

/**
 * 同步尝试从内存缓存中获取已计算的氛围色盘
 */
export function getCachedUserAmbientPalette(
  url: string | null | undefined,
  isDark: boolean
): UserAmbientPalette | null {
  if (!url) return null
  const cached = paletteCache.get(url)
  if (!cached) return null
  return isDark ? cached.dark : cached.light
}

/**
 * 异步从用户背景图提取双色标氛围色（底边采样 + 核心主色），并生成适度柔和、适配深浅模式的渐变色阶
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

    // 浅色模式色彩调和（适度减弱浓度，清爽自然）
    const [bLightR, bLightG, bLightB] = boostVibrancy(bRawR, bRawG, bRawB, false)
    const [dLightR, dLightG, dLightB] = boostVibrancy(dRawR, dRawG, dRawB, false)

    const lightPalette: UserAmbientPalette = {
      topColor: `rgba(${bLightR},${bLightG},${bLightB},0.50)` as Color,
      midColor: `rgba(${dLightR},${dLightG},${dLightB},0.24)` as Color,
      worksColor: `rgba(${dLightR},${dLightG},${dLightB},0.10)` as Color,
    }

    // 深色模式色彩调和（暗夜微光，深邃通透）
    const [bDarkR, bDarkG, bDarkB] = boostVibrancy(bRawR, bRawG, bRawB, true)
    const [dDarkR, dDarkG, dDarkB] = boostVibrancy(dRawR, dRawG, dRawB, true)

    const darkPalette: UserAmbientPalette = {
      topColor: `rgba(${bDarkR},${bDarkG},${bDarkB},0.60)` as Color,
      midColor: `rgba(${dDarkR},${dDarkG},${dDarkB},0.30)` as Color,
      worksColor: `rgba(${dDarkR},${dDarkG},${dDarkB},0.12)` as Color,
    }

    const result: UserAmbientResult = {
      light: lightPalette,
      dark: darkPalette,
    }
    paletteCache.set(url, result)
    return result
  } catch (err) {
    console.log("extractUserAmbientPalette error:", err)
    return null
  }
}
