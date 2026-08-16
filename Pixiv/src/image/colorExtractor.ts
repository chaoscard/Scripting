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

export interface IllustAmbientPalette {
  topColor: Color
  midColor: Color
  backgroundColor: Color
}

export interface IllustAmbientResult {
  light: IllustAmbientPalette
  dark: IllustAmbientPalette
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
  isDark: boolean
): [number, number, number] {
  const [h, s, l] = rgbToHsl(red, green, blue)
  // 适度提升饱和度，保持色彩丰富与生动
  const boostedS = Math.min(0.72, Math.max(0.15, s * 1.05))
  // 约束明度在清爽舒适的区间
  const targetL = isDark
    ? Math.min(0.50, Math.max(0.26, l * 0.90))
    : Math.min(0.80, Math.max(0.52, l * 1.04))
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

    // 浅色模式色彩调和（适度浓郁，氛围生动）
    const [bLightR, bLightG, bLightB] = boostVibrancy(bRawR, bRawG, bRawB, false)
    const [dLightR, dLightG, dLightB] = boostVibrancy(dRawR, dRawG, dRawB, false)

    const lightPalette: UserAmbientPalette = {
      topColor: `rgba(${bLightR},${bLightG},${bLightB},0.38)` as Color,
      midColor: `rgba(${dLightR},${dLightG},${dLightB},0.18)` as Color,
      worksColor: `rgba(${dLightR},${dLightG},${dLightB},0.06)` as Color,
    }

    // 深色模式色彩调和（暗夜微光，深邃通透）
    const [bDarkR, bDarkG, bDarkB] = boostVibrancy(bRawR, bRawG, bRawB, true)
    const [dDarkR, dDarkG, dDarkB] = boostVibrancy(dRawR, dRawG, dRawB, true)

    const darkPalette: UserAmbientPalette = {
      topColor: `rgba(${bDarkR},${bDarkG},${bDarkB},0.44)` as Color,
      midColor: `rgba(${dDarkR},${dDarkG},${dDarkB},0.22)` as Color,
      worksColor: `rgba(${dDarkR},${dDarkG},${dDarkB},0.08)` as Color,
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

/**
 * 同步尝试从内存缓存中获取已计算的插画/漫画氛围色盘
 */
export function getCachedIllustAmbientPalette(
  url: string | null | undefined,
  isDark: boolean
): IllustAmbientPalette | null {
  if (!url) return null
  const cached = illustPaletteCache.get(url)
  if (!cached) return null
  return isDark ? cached.dark : cached.light
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

    // 1. 顶部 30% 区域采样（无缝衔接顶部导航区）
    const cropH = Math.max(2, Math.round(uiImage.height * 0.3))
    const topCrop = uiImage.croppedTo({
      x: 0,
      y: 0,
      width: uiImage.width,
      height: cropH,
    })
    const topAvg = topCrop?.averageColor() ?? uiImage.averageColor()

    // 2. 全局多主色采样：在主色列表中优先选取鲜活度适中的颜色
    const dominants = uiImage.dominantColors(6)
    let bestDominant = uiImage.averageColor()
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
    }

    if (!topAvg || !bestDominant) return null

    const tRawR = topAvg.red ?? 0
    const tRawG = topAvg.green ?? 0
    const tRawB = topAvg.blue ?? 0

    const dRawR = bestDominant.red ?? 0
    const dRawG = bestDominant.green ?? 0
    const dRawB = bestDominant.blue ?? 0

    // 浅色模式色彩调和（顶部适度浓郁，主体背景自然晕染）
    const [tLightR, tLightG, tLightB] = boostVibrancy(tRawR, tRawG, tRawB, false)
    const [dLightR, dLightG, dLightB] = boostVibrancy(dRawR, dRawG, dRawB, false)

    const lightPalette: IllustAmbientPalette = {
      topColor: `rgba(${tLightR},${tLightG},${tLightB},0.46)` as Color,
      midColor: `rgba(${dLightR},${dLightG},${dLightB},0.24)` as Color,
      backgroundColor: `rgba(${dLightR},${dLightG},${dLightB},0.08)` as Color,
    }

    // 深色模式色彩调和（暗夜微光，深邃通透）
    const [tDarkR, tDarkG, tDarkB] = boostVibrancy(tRawR, tRawG, tRawB, true)
    const [dDarkR, dDarkG, dDarkB] = boostVibrancy(dRawR, dRawG, dRawB, true)

    const darkPalette: IllustAmbientPalette = {
      topColor: `rgba(${tDarkR},${tDarkG},${tDarkB},0.54)` as Color,
      midColor: `rgba(${dDarkR},${dDarkG},${dDarkB},0.28)` as Color,
      backgroundColor: `rgba(${dDarkR},${dDarkG},${dDarkB},0.10)` as Color,
    }

    const result: IllustAmbientResult = {
      light: lightPalette,
      dark: darkPalette,
    }
    illustPaletteCache.set(url, result)
    return result
  } catch (err) {
    console.log("extractIllustAmbientPalette error:", err)
    return null
  }
}
