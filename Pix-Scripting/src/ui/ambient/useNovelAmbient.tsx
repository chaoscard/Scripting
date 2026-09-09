import { useEffect, useMemo, useState, useColorScheme, type Color } from "scripting"
import { loadSettings, onSettingsChanged, type AmbientIntensity, type NovelReaderExperimentalAlgorithm } from "../../store/settings"
import {
  extractIllustAmbientPalette,
  getCachedIllustAmbientPalette,
  type IllustAmbientPalette,
} from "../../image/colorExtractor"
import { renderAmbientBackground } from "./renderAmbientBackground"

export interface NovelAmbientState {
  ambientEnabled: boolean
  ambientIntensity: AmbientIntensity
  ambientAlgorithm: NovelReaderExperimentalAlgorithm
  ambientPalette: IllustAmbientPalette | null
  ambientBackground: any
  topColor: Color | undefined
}

export function useNovelExperimentalAmbientPalette(
  imageUrl: string | null | undefined,
  active: boolean = true
): NovelAmbientState {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const [ambientIntensity, setAmbientIntensity] = useState<AmbientIntensity>(
    () => loadSettings().experimentalImmersionIntensity
  )
  const [novelAlgorithm, setNovelAlgorithm] = useState<NovelReaderExperimentalAlgorithm>(
    () => loadSettings().novelReaderExperimentalAlgorithm
  )
  const [ambientEnabled, setAmbientEnabled] = useState(
    () =>
      loadSettings().ambientImmersion &&
      loadSettings().experimentalImmersion &&
      loadSettings().novelReaderExperimentalAlgorithm !== "off"
  )
  const [ambientPalette, setAmbientPalette] = useState<IllustAmbientPalette | null>(() => {
    const s = loadSettings()
    if (
      !s.ambientImmersion ||
      !s.experimentalImmersion ||
      s.novelReaderExperimentalAlgorithm === "off" ||
      !imageUrl
    ) {
      return null
    }
    return getCachedIllustAmbientPalette(
      imageUrl,
      isDark,
      s.experimentalImmersionIntensity
    )
  })

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      setAmbientEnabled(
        nextSettings.ambientImmersion &&
        nextSettings.experimentalImmersion &&
        nextSettings.novelReaderExperimentalAlgorithm !== "off"
      )
      setAmbientIntensity(nextSettings.experimentalImmersionIntensity)
      setNovelAlgorithm(nextSettings.novelReaderExperimentalAlgorithm)
    })
  }, [])

  useEffect(() => {
    if (!ambientEnabled || !imageUrl || novelAlgorithm === "off") {
      setAmbientPalette(null)
      return
    }
    let isActive = true
    const cached = getCachedIllustAmbientPalette(imageUrl, isDark, ambientIntensity)
    if (cached) {
      setAmbientPalette(cached)
    }
    void extractIllustAmbientPalette(imageUrl).then((result) => {
      if (!isActive || !result) return
      const modeObj = isDark ? result.dark : result.light
      setAmbientPalette(modeObj[ambientIntensity] ?? modeObj.medium)
    })
    return () => {
      isActive = false
    }
  }, [imageUrl, isDark, ambientEnabled, ambientIntensity, novelAlgorithm])

  const synchronousPalette =
    ambientEnabled && imageUrl && novelAlgorithm !== "off"
      ? getCachedIllustAmbientPalette(imageUrl, isDark, ambientIntensity)
      : null
  const effectivePalette = ambientPalette ?? synchronousPalette

  const ambientBackground = useMemo(() => {
    if (!ambientEnabled || !effectivePalette || novelAlgorithm === "off") return undefined
    return renderAmbientBackground({
      ambientPalette: effectivePalette,
      ambientAlgorithm: novelAlgorithm,
      isDark,
      ambientIntensity,
      active,
    })
  }, [ambientEnabled, effectivePalette, novelAlgorithm, isDark, ambientIntensity, active])

  const topColor =
    ambientEnabled && effectivePalette && novelAlgorithm !== "off"
      ? novelAlgorithm === "transcend" ||
        novelAlgorithm === "ultimate" ||
        novelAlgorithm === "geminiA" ||
        novelAlgorithm === "geminiB"
        ? (effectivePalette.ultimateLeadingColor ?? effectivePalette.topColor)
        : novelAlgorithm === "explore"
          ? (effectivePalette.exploreTopColor ?? effectivePalette.topColor)
          : effectivePalette.topColor
      : undefined

  return {
    ambientEnabled,
    ambientIntensity,
    ambientAlgorithm: novelAlgorithm,
    ambientPalette: effectivePalette,
    ambientBackground,
    topColor,
  }
}
