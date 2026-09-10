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
import { recordActiveAmbientImageUrl } from "./tracker"

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
  const [isExperimental, setIsExperimental] = useState(
    () => loadSettings().experimentalImmersion
  )
  const [ambientAlgorithm, setAmbientAlgorithm] = useState<AmbientAlgorithm>(
    () =>
      loadSettings().experimentalImmersion
        ? loadSettings().experimentalImmersionAlgorithm
        : loadSettings().ambientAlgorithm
  )
  const [ambientPalette, setAmbientPalette] = useState<UserAmbientPalette | null>(() => {
    if (!loadSettings().ambientImmersion || !imageUrl) return null
    return getCachedUserAmbientPalette(imageUrl, isDark, loadSettings().ambientIntensity)
  })
  const [illustPalette, setIllustPalette] = useState<IllustAmbientPalette | null>(() => {
    const s = loadSettings()
    if (!s.ambientImmersion || !s.experimentalImmersion || !imageUrl) return null
    return getCachedIllustAmbientPalette(imageUrl, isDark, s.ambientIntensity)
  })

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      setAmbientEnabled(nextSettings.ambientImmersion)
      setAmbientIntensity(nextSettings.ambientIntensity)
      setIsExperimental(nextSettings.experimentalImmersion)
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

    if (isExperimental) {
      const cachedIllust = getCachedIllustAmbientPalette(imageUrl, isDark, ambientIntensity)
      if (cachedIllust) {
        setIllustPalette(cachedIllust)
      }
      void extractIllustAmbientPalette(imageUrl).then((result) => {
        if (!active || !result) return
        const modeObj = isDark ? result.dark : result.light
        setIllustPalette(modeObj[ambientIntensity] ?? modeObj.medium)
      })
    } else {
      setIllustPalette(null)
    }

    return () => {
      active = false
    }
  }, [imageUrl, isDark, ambientEnabled, ambientIntensity, isExperimental])

  const ambientBackground = useMemo(() => {
    if (!ambientEnabled) return undefined
    if (isExperimental && illustPalette) {
      return renderAmbientBackground({
        ambientPalette: illustPalette,
        ambientAlgorithm,
        isDark,
        ambientIntensity,
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
  }, [ambientEnabled, isExperimental, illustPalette, ambientAlgorithm, isDark, ambientIntensity, ambientPalette])

  useEffect(() => {
    if (ambientEnabled && imageUrl && (illustPalette || ambientPalette)) {
      recordActiveAmbientImageUrl(imageUrl)
    }
  }, [ambientEnabled, imageUrl, illustPalette, ambientPalette])

  return { ambientEnabled, ambientIntensity, ambientPalette, ambientBackground }
}
