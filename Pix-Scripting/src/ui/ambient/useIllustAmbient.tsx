import { useEffect, useMemo, useState, useColorScheme, type Color } from "scripting"
import { loadSettings, onSettingsChanged, type AmbientIntensity, type AmbientAlgorithm } from "../../store/settings"
import {
  extractIllustAmbientPalette,
  getCachedIllustAmbientPalette,
  type IllustAmbientPalette,
} from "../../image/colorExtractor"
import { renderAmbientBackground } from "./renderAmbientBackground"
import { recordActiveAmbientImageUrl } from "./tracker"

export interface IllustAmbientState {
  ambientEnabled: boolean
  ambientIntensity: AmbientIntensity
  ambientAlgorithm: AmbientAlgorithm
  ambientPalette: IllustAmbientPalette | null
  ambientBackground: any
  topColor: Color | undefined
}

function resolveAmbientAlgorithm(): AmbientAlgorithm {
  const s = loadSettings()
  return s.experimentalImmersion ? s.experimentalImmersionAlgorithm : s.ambientAlgorithm
}

export function useExperimentalAmbientPalette(
  imageUrl: string | null | undefined,
  active: boolean = true
): IllustAmbientState {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const [ambientEnabled, setAmbientEnabled] = useState(
    () => loadSettings().ambientImmersion
  )
  const [ambientIntensity, setAmbientIntensity] = useState<AmbientIntensity>(
    () => loadSettings().ambientIntensity
  )
  const [ambientAlgorithm, setAmbientAlgorithm] = useState<AmbientAlgorithm>(
    resolveAmbientAlgorithm
  )
  const [ambientPalette, setAmbientPalette] = useState<IllustAmbientPalette | null>(() => {
    const s = loadSettings()
    if (!s.ambientImmersion || !imageUrl) return null
    return getCachedIllustAmbientPalette(
      imageUrl,
      isDark,
      s.ambientIntensity
    )
  })

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      setAmbientEnabled(nextSettings.ambientImmersion)
      setAmbientIntensity(nextSettings.ambientIntensity)
      setAmbientAlgorithm(
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
  }, [imageUrl, isDark, ambientEnabled, ambientIntensity])

  // 同步直接读取内存缓存中的调色板，无需等待 useEffect 触发二次渲染
  const synchronousPalette =
    ambientEnabled && imageUrl
      ? getCachedIllustAmbientPalette(imageUrl, isDark, ambientIntensity)
      : null

  const effectivePalette = ambientPalette ?? synchronousPalette

  const ambientBackground = useMemo(() => {
    if (!ambientEnabled || !effectivePalette) return undefined
    return renderAmbientBackground({
      ambientPalette: effectivePalette,
      ambientAlgorithm,
      isDark,
      ambientIntensity,
      active,
    })
  }, [ambientEnabled, effectivePalette, ambientAlgorithm, isDark, ambientIntensity, active])

  const topColor =
    ambientEnabled && effectivePalette
      ? ambientAlgorithm === "transcend" ||
        ambientAlgorithm === "ultimate" ||
        ambientAlgorithm === "geminiA" ||
        ambientAlgorithm === "geminiB"
        ? (effectivePalette.ultimateLeadingColor ?? effectivePalette.topColor)
        : ambientAlgorithm === "explore"
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
    ambientAlgorithm,
    ambientPalette: effectivePalette,
    ambientBackground,
    topColor,
  }
}
