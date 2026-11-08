/**
 * 经过真机底层 CoreText 严格度量验证的 15 款开机固化原厂英文字体池
 * 100% 固化在 iOS 系统固件中，无需任何下载或网络，离线秒开，支持全体用户
 */
export const BRAND_FONTS = [
  "Menlo",
  "Superclarendon",
  "Copperplate",
  "Zapfino",
  "Papyrus",
  "Chalkboard SE",
  "Noteworthy",
  "Marker Felt",
  "American Typewriter",
  "Bradley Hand",
  "Snell Roundhand",
  "Verdana",
  "Futura",
  "Bodoni 72",
  "Palatino",
] as const

export type BrandFontName = (typeof BRAND_FONTS)[number]

/**
 * 单次会话随机抽取的品牌字体（保持运行生命周期内全局统一且稳定）
 */
let currentSessionBrandFont: string =
  BRAND_FONTS[Math.floor(Math.random() * BRAND_FONTS.length)]

/**
 * 获取当前会话锁定的随机品牌英文字体名
 */
export function getSessionBrandFont(): string {
  return currentSessionBrandFont
}

/**
 * 手动重置/随机轮换下一款品牌字体
 */
export function rotateBrandFont(): string {
  let next = BRAND_FONTS[Math.floor(Math.random() * BRAND_FONTS.length)]
  if (next === currentSessionBrandFont && BRAND_FONTS.length > 1) {
    next = BRAND_FONTS[(BRAND_FONTS.indexOf(next as any) + 1) % BRAND_FONTS.length]
  }
  currentSessionBrandFont = next
  return currentSessionBrandFont
}
