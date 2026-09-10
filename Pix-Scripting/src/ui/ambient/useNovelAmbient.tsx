import { useEffect, useMemo, useState, useColorScheme, type Color } from "scripting"
import { loadSettings, onSettingsChanged, type AmbientIntensity, type AmbientAlgorithm } from "../../store/settings"
import {
  extractIllustAmbientPalette,
  getCachedIllustAmbientPalette,
  type IllustAmbientPalette,
} from "../../image/colorExtractor"
import { renderAmbientBackground } from "./renderAmbientBackground"
import { recordActiveAmbientImageUrl } from "./tracker"

export interface NovelAmbientState {
  ambientEnabled: boolean
  ambientIntensity: AmbientIntensity
  ambientAlgorithm: AmbientAlgorithm
  ambientPalette: IllustAmbientPalette | null
  ambientBackground: any
  topColor: Color | undefined
}

function resolveNovelAlgorithm(): AmbientAlgorithm {
  const s = loadSettings()
  return s.experimentalImmersion ? s.experimentalImmersionAlgorithm : s.ambientAlgorithm
}

export function useNovelExperimentalAmbientPalette(
  imageUrl: string | null | undefined,
  active: boolean = true
): NovelAmbientState {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const [ambientIntensity, setAmbientIntensity] = useState<AmbientIntensity>(
    () => loadSettings().ambientIntensity
  )
  const [novelAlgorithm, setNovelAlgorithm] = useState<AmbientAlgorithm>(
    resolveNovelAlgorithm
  )
  const [ambientEnabled, setAmbientEnabled] = useState(
    () => loadSettings().ambientImmersion && loadSettings().novelReaderImmersion
  )
  const [ambientPalette, setAmbientPalette] = useState<IllustAmbientPalette | null>(() => {
    const s = loadSettings()
    if (!s.ambientImmersion || !s.novelReaderImmersion || !imageUrl) {
      return null
    }
    return getCachedIllustAmbientPalette(
      imageUrl,
      isDark,
      s.ambientIntensity
    )
  })

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      setAmbientEnabled(
        nextSettings.ambientImmersion && nextSettings.novelReaderImmersion
      )
      setAmbientIntensity(nextSettings.ambientIntensity)
      setNovelAlgorithm(
        nextSettings.experimentalImmersion
          ? nextSettings.experimentalImmersionAlgorithm
          : nextSettings.ambientAlgorithm
      )
    })
  }, [])

  useEffect(() => {
    if (!ambientEnabled || !imageUrl) {
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
    ambientEnabled && imageUrl
      ? getCachedIllustAmbientPalette(imageUrl, isDark, ambientIntensity)
      : null
  const effectivePalette = ambientPalette ?? synchronousPalette

  const ambientBackground = useMemo(() => {
    if (!ambientEnabled || !effectivePalette) return undefined
    return renderAmbientBackground({
      ambientPalette: effectivePalette,
      ambientAlgorithm: novelAlgorithm,
      isDark,
      ambientIntensity,
      active,
    })
  }, [ambientEnabled, effectivePalette, novelAlgorithm, isDark, ambientIntensity, active])

  const topColor =
    ambientEnabled && effectivePalette
      ? novelAlgorithm === "transcend" ||
        novelAlgorithm === "ultimate" ||
        novelAlgorithm === "geminiA" ||
        novelAlgorithm === "geminiB"
        ? (effectivePalette.ultimateLeadingColor ?? effectivePalette.topColor)
        : novelAlgorithm === "explore"
          ? (effectivePalette.exploreTopColor ?? effectivePalette.topColor)
          : effectivePalette.topColor
      : undefined

  useEffect(() => {
    if (active && ambientEnabled && imageUrl && effectivePalette) {
      recordActiveAmbientImageUrl(imageUrl)
    }
  }, [active, ambientEnabled, imageUrl, effectivePalette])

  return {
    ambientEnabled,
    ambientIntensity,
    ambientAlgorithm: novelAlgorithm,
    ambientPalette: effectivePalette,
    ambientBackground,
    topColor,
  }
}
