import { useEffect, useMemo, useState, useColorScheme, Rectangle, ZStack } from "scripting"
import { loadSettings, onSettingsChanged, type AmbientIntensity, type AmbientAlgorithm } from "../../store/settings"
import {
  extractIllustAmbientPalette,
  extractUserAmbientPalette,
  getCachedIllustAmbientPalette,
  getCachedUserAmbientPalette,
  type IllustAmbientPalette,
  type UserAmbientPalette,
} from "../../image/colorExtractor"
import { renderAmbientBackground } from "./renderAmbientBackground"

export interface UserAmbientState {
  ambientEnabled: boolean
  ambientIntensity: AmbientIntensity
  ambientPalette: UserAmbientPalette | null
  ambientBackground: any
}

export function useUserAmbientPalette(imageUrl: string | null | undefined): UserAmbientState {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const [ambientEnabled, setAmbientEnabled] = useState(
    () => loadSettings().ambientImmersion
  )
  const [ambientIntensity, setAmbientIntensity] = useState<AmbientIntensity>(
    () => loadSettings().ambientIntensity
  )
  const [experimentalOverride, setExperimentalOverride] = useState(
    () => loadSettings().experimentalImmersion && loadSettings().overrideSecondaryPagesImmersion
  )
  const [ambientAlgorithm, setAmbientAlgorithm] = useState<AmbientAlgorithm>(
    () => loadSettings().experimentalImmersionAlgorithm
  )
  const [experimentalIntensity, setExperimentalIntensity] = useState<AmbientIntensity>(
    () => loadSettings().experimentalImmersionIntensity
  )
  const [ambientPalette, setAmbientPalette] = useState<UserAmbientPalette | null>(() => {
    if (!loadSettings().ambientImmersion || !imageUrl) return null
    return getCachedUserAmbientPalette(imageUrl, isDark, loadSettings().ambientIntensity)
  })
  const [illustPalette, setIllustPalette] = useState<IllustAmbientPalette | null>(() => {
    const s = loadSettings()
    if (!s.ambientImmersion || !s.experimentalImmersion || !s.overrideSecondaryPagesImmersion || !imageUrl) return null
    return getCachedIllustAmbientPalette(imageUrl, isDark, s.experimentalImmersionIntensity)
  })

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      setAmbientEnabled(nextSettings.ambientImmersion)
      setAmbientIntensity(nextSettings.ambientIntensity)
      setExperimentalOverride(nextSettings.experimentalImmersion && nextSettings.overrideSecondaryPagesImmersion)
      setAmbientAlgorithm(nextSettings.experimentalImmersionAlgorithm)
      setExperimentalIntensity(nextSettings.experimentalImmersionIntensity)
    })
  }, [])

  useEffect(() => {
    if (!ambientEnabled || !imageUrl) {
      setAmbientPalette(null)
      setIllustPalette(null)
      return
    }
    let active = true
    const cached = getCachedUserAmbientPalette(imageUrl, isDark, ambientIntensity)
    if (cached) {
      setAmbientPalette(cached)
    }
    void extractUserAmbientPalette(imageUrl).then((result) => {
      if (!active || !result) return
      const modeObj = isDark ? result.dark : result.light
      setAmbientPalette(modeObj[ambientIntensity] ?? modeObj.medium)
    })

    if (experimentalOverride) {
      const cachedIllust = getCachedIllustAmbientPalette(imageUrl, isDark, experimentalIntensity)
      if (cachedIllust) {
        setIllustPalette(cachedIllust)
      }
      void extractIllustAmbientPalette(imageUrl).then((result) => {
        if (!active || !result) return
        const modeObj = isDark ? result.dark : result.light
        setIllustPalette(modeObj[experimentalIntensity] ?? modeObj.medium)
      })
    } else {
      setIllustPalette(null)
    }

    return () => {
      active = false
    }
  }, [imageUrl, isDark, ambientEnabled, ambientIntensity, experimentalOverride, experimentalIntensity])

  const ambientBackground = useMemo(() => {
    if (!ambientEnabled) return undefined
    if (experimentalOverride && illustPalette) {
      return renderAmbientBackground({
        ambientPalette: illustPalette,
        ambientAlgorithm,
        isDark,
        ambientIntensity: experimentalIntensity,
        active: true,
      })
    }
    if (!ambientPalette) return undefined
    return (
      <ZStack ignoresSafeArea={true}>
        <Rectangle
          fill={{
            colors: [
              ambientPalette.topColor,
              ambientPalette.midColor,
              ambientPalette.worksColor,
              ambientPalette.worksColor,
            ],
            startPoint: "top" as const,
            endPoint: "bottom" as const,
          }}
          ignoresSafeArea={true}
        />
      </ZStack>
    )
  }, [ambientEnabled, experimentalOverride, illustPalette, ambientAlgorithm, isDark, experimentalIntensity, ambientPalette])

  return { ambientEnabled, ambientIntensity, ambientPalette, ambientBackground }
}
