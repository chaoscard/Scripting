import { Rectangle, ZStack, type Color } from "scripting"
import type { AmbientAlgorithm, AmbientIntensity } from "../../store/settings"
import type { IllustAmbientPalette } from "../../image/colorExtractor"
import { TranscendAmbientBackground } from "../components/TranscendAmbientBackground"
import { GeminiAmbientBackground } from "../components/GeminiAmbientBackground"

export interface RenderAmbientOptions {
  ambientPalette: IllustAmbientPalette | null | undefined
  ambientAlgorithm: AmbientAlgorithm
  isDark: boolean
  ambientIntensity: AmbientIntensity
  active?: boolean
}

/**
 * 统一环境光渲染分发器
 * 支持 Classic、Explore、Ultimate、Transcend、GeminiA、GeminiB 等多种算法
 */
export function renderAmbientBackground(options: RenderAmbientOptions): any {
  const { ambientPalette, ambientAlgorithm, isDark, ambientIntensity, active = true } = options
  if (!ambientPalette) return undefined

  if (ambientAlgorithm === "geminiA" || ambientAlgorithm === "geminiB") {
    const primary = ambientPalette.ultimateLeadingColor ?? ambientPalette.topColor
    const secondary = ambientPalette.ultimatePrismColor ?? ambientPalette.exploreAccentColor ?? ambientPalette.topColor
    const tertiary = ambientPalette.ultimateMidColor ?? ambientPalette.midColor
    const accent = ambientPalette.exploreAccentColor ?? ambientPalette.ultimateTrailingColor
    const core = ambientPalette.ultimateLeadingCoreColor
    const bg = ambientPalette.ultimateBgColor ?? ambientPalette.backgroundColor
    return (
      <GeminiAmbientBackground
        variant={ambientAlgorithm}
        primaryColor={primary}
        secondaryColor={secondary}
        tertiaryColor={tertiary}
        accentColor={accent}
        coreColor={core}
        bgColor={bg}
        isDark={isDark}
        intensity={ambientIntensity}
        active={active}
      />
    )
  }

  if (ambientAlgorithm === "transcend") {
    const lead = ambientPalette.ultimateLeadingColor ?? ambientPalette.topColor
    const prism = ambientPalette.ultimatePrismColor ?? ambientPalette.topColor
    const trail = ambientPalette.ultimateTrailingColor ?? ambientPalette.topColor
    const mid = ambientPalette.ultimateMidColor ?? ambientPalette.midColor
    const bg = ambientPalette.ultimateBgColor ?? ambientPalette.backgroundColor
    return (
      <TranscendAmbientBackground
        leadColor={lead}
        prismColor={prism}
        trailColor={trail}
        midColor={mid}
        bgColor={bg}
        leadCoreColor={ambientPalette.ultimateLeadingCoreColor}
        prismCoreColor={ambientPalette.ultimatePrismCoreColor}
        trailCoreColor={ambientPalette.ultimateTrailingCoreColor}
        isDark={isDark}
        intensity={ambientIntensity}
      />
    )
  }

  if (ambientAlgorithm === "ultimate") {
    const lead = ambientPalette.ultimateLeadingColor ?? ambientPalette.topColor
    const prism = ambientPalette.ultimatePrismColor ?? ambientPalette.topColor
    const trail = ambientPalette.ultimateTrailingColor ?? ambientPalette.topColor
    const mid = ambientPalette.ultimateMidColor ?? ambientPalette.midColor
    const bg = ambientPalette.ultimateBgColor ?? ambientPalette.backgroundColor
    return (
      <ZStack ignoresSafeArea={true}>
        <Rectangle
          fill={{
            colors: [lead, prism, trail, mid, bg],
            startPoint: "topLeading" as const,
            endPoint: "bottomTrailing" as const,
          }}
          ignoresSafeArea={true}
        />
      </ZStack>
    )
  }

  if (ambientAlgorithm === "explore") {
    const accent = ambientPalette.exploreAccentColor ?? ambientPalette.topColor
    const top = ambientPalette.exploreTopColor ?? ambientPalette.topColor
    const mid = ambientPalette.exploreMidColor ?? ambientPalette.midColor
    const bg = ambientPalette.exploreBgColor ?? ambientPalette.backgroundColor
    return (
      <ZStack ignoresSafeArea={true}>
        <Rectangle
          fill={{
            colors: [accent, top, mid, bg],
            startPoint: "topLeading" as const,
            endPoint: "bottomTrailing" as const,
          }}
          ignoresSafeArea={true}
        />
      </ZStack>
    )
  }

  // 经典算法 (Classic)
  return (
    <ZStack ignoresSafeArea={true}>
      <Rectangle
        fill={{
          colors: [
            ambientPalette.topColor,
            ambientPalette.midColor,
            ambientPalette.backgroundColor,
            ambientPalette.backgroundColor,
          ],
          startPoint: "top" as const,
          endPoint: "bottom" as const,
        }}
        ignoresSafeArea={true}
      />
    </ZStack>
  )
}

/**
 * 统一 WebKit CSS 环境光渐变生成器
 * 适配 WebView 内部无法直接透出原生 SwiftUI 背景的场景
 */
export function generateAmbientBackgroundCss(
  palette: IllustAmbientPalette | null | undefined,
  algorithm: AmbientAlgorithm,
  isDark: boolean
): string {
  if (!palette) {
    return isDark ? "#000000" : "#FAFAFA"
  }

  if (algorithm === "geminiA" || algorithm === "geminiB") {
    const primary = palette.ultimateLeadingColor ?? palette.topColor
    const secondary = palette.ultimatePrismColor ?? palette.exploreAccentColor ?? palette.topColor
    const tertiary = palette.ultimateMidColor ?? palette.midColor
    const accent = palette.exploreAccentColor ?? palette.ultimateTrailingColor
    const bg = palette.ultimateBgColor ?? palette.backgroundColor
    return `radial-gradient(circle at 18% 18%, ${primary} 0%, transparent 62%),
            radial-gradient(circle at 82% 22%, ${secondary} 0%, transparent 58%),
            radial-gradient(circle at 48% 54%, ${tertiary} 0%, transparent 68%),
            radial-gradient(circle at 76% 82%, ${accent} 0%, transparent 58%),
            ${bg}`
  }

  if (algorithm === "transcend") {
    const lead = palette.ultimateLeadingColor ?? palette.topColor
    const prism = palette.ultimatePrismColor ?? palette.topColor
    const trail = palette.ultimateTrailingColor ?? palette.topColor
    const mid = palette.ultimateMidColor ?? palette.midColor
    const bg = palette.ultimateBgColor ?? palette.backgroundColor
    return `radial-gradient(circle at 22% 16%, ${lead} 0%, transparent 60%),
            radial-gradient(circle at 78% 24%, ${prism} 0%, transparent 55%),
            radial-gradient(circle at 50% 50%, ${mid} 0%, transparent 65%),
            radial-gradient(circle at 72% 78%, ${trail} 0%, transparent 60%),
            ${bg}`
  }

  if (algorithm === "ultimate") {
    const lead = palette.ultimateLeadingColor ?? palette.topColor
    const prism = palette.ultimatePrismColor ?? palette.topColor
    const trail = palette.ultimateTrailingColor ?? palette.topColor
    const mid = palette.ultimateMidColor ?? palette.midColor
    const bg = palette.ultimateBgColor ?? palette.backgroundColor
    return `linear-gradient(135deg, ${lead} 0%, ${prism} 25%, ${trail} 50%, ${mid} 75%, ${bg} 100%)`
  }

  if (algorithm === "explore") {
    const accent = palette.exploreAccentColor ?? palette.topColor
    const top = palette.exploreTopColor ?? palette.topColor
    const mid = palette.exploreMidColor ?? palette.midColor
    const bg = palette.exploreBgColor ?? palette.backgroundColor
    return `linear-gradient(135deg, ${accent} 0%, ${top} 30%, ${mid} 65%, ${bg} 100%)`
  }

  // 经典算法 (Classic)
  return `linear-gradient(180deg, ${palette.topColor} 0%, ${palette.midColor} 38%, ${palette.backgroundColor} 75%, ${palette.backgroundColor} 100%)`
}
