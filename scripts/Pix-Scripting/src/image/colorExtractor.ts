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

    const buildIllustPalette = (
      tRaw: [number, number, number],
      dRaw: [number, number, number],
      isDark: boolean,
      intensity: AmbientIntensity
    ): IllustAmbientPalette => {
      const [tR, tG, tB] = boostVibrancy(tRaw[0], tRaw[1], tRaw[2], isDark, intensity)
      const [dR, dG, dB] = boostVibrancy(dRaw[0], dRaw[1], dRaw[2], isDark, intensity)
      let topAlpha = 0.54
      let midAlpha = 0.28
      let bgAlpha = 0.10
      if (intensity === "low") {
        topAlpha = 0.46
        midAlpha = 0.24
        bgAlpha = 0.08
      } else if (intensity === "high") {
        topAlpha = isDark ? 0.66 : 0.64
        midAlpha = isDark ? 0.36 : 0.34
        bgAlpha = 0.14
      }
      return {
        topColor: `rgba(${tR},${tG},${tB},${topAlpha})` as Color,
        midColor: `rgba(${dR},${dG},${dB},${midAlpha})` as Color,
        backgroundColor: `rgba(${dR},${dG},${dB},${bgAlpha})` as Color,
      }
    }

    const result: IllustAmbientResult = {
      light: {
        low: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], false, "low"),
        medium: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], false, "medium"),
        high: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], false, "high"),
      },
      dark: {
        low: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], true, "low"),
        medium: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], true, "medium"),
        high: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], true, "high"),
      },
    }
    illustPaletteCache.set(url, result)
    return result
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

    const buildIllustPalette = (
      tRaw: [number, number, number],
      dRaw: [number, number, number],
      isDark: boolean,
      intensity: AmbientIntensity
    ): IllustAmbientPalette => {
      const [tR, tG, tB] = boostVibrancy(tRaw[0], tRaw[1], tRaw[2], isDark, intensity)
      const [dR, dG, dB] = boostVibrancy(dRaw[0], dRaw[1], dRaw[2], isDark, intensity)
      let topAlpha = 0.54
      let midAlpha = 0.28
      let bgAlpha = 0.10
      if (intensity === "low") {
        topAlpha = 0.46
        midAlpha = 0.24
        bgAlpha = 0.08
      } else if (intensity === "high") {
        topAlpha = isDark ? 0.66 : 0.64
        midAlpha = isDark ? 0.36 : 0.34
        bgAlpha = 0.14
      }
      return {
        topColor: `rgba(${tR},${tG},${tB},${topAlpha})` as Color,
        midColor: `rgba(${dR},${dG},${dB},${midAlpha})` as Color,
        backgroundColor: `rgba(${dR},${dG},${dB},${bgAlpha})` as Color,
      }
    }

    const result: IllustAmbientResult = {
      light: {
        low: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], false, "low"),
        medium: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], false, "medium"),
        high: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], false, "high"),
      },
      dark: {
        low: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], true, "low"),
        medium: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], true, "medium"),
        high: buildIllustPalette([tRawR, tRawG, tRawB], [dRawR, dRawG, dRawB], true, "high"),
      },
    }
    illustPaletteCache.set(url, result)
    return result
  } catch (err) {
    console.log("extractIllustAmbientPalette error:", err)
    return null
  }
}
