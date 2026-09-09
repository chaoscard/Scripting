import { Rectangle, ZStack, type Color } from "scripting"
import type { AmbientAlgorithm, AmbientIntensity, NovelReaderExperimentalAlgorithm } from "../../store/settings"
import type { IllustAmbientPalette } from "../../image/colorExtractor"
import { TranscendAmbientBackground } from "../components/TranscendAmbientBackground"
import { GeminiAmbientBackground } from "../components/GeminiAmbientBackground"

export interface RenderAmbientOptions {
  ambientPalette: IllustAmbientPalette | null | undefined
  ambientAlgorithm: AmbientAlgorithm | NovelReaderExperimentalAlgorithm
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
  if (!ambientPalette || ambientAlgorithm === "off") return undefined

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
