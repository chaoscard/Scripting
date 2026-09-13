import {
  HStack,
  Image,
  NavigationLink,
  Spacer,
  Text,
  useEffect,
  useState,
  ZStack,
} from "scripting"
import {
  fetchSeriesNav,
  getCachedSeriesNav,
  getSeriesByWorkID,
  recordWorkSeriesAssociation,
  type SeriesNavData,
} from "../store/seriesCache"

export interface UseSeriesEpisodeNavOptions {
  workID: number
  seriesID?: number | null
  seriesTitleFallback?: string | null
  kind: "manga" | "novel"
  initialPrev?: { id: number; title?: string } | null
  initialNext?: { id: number; title?: string } | null
  initialEpisodeNumber?: number | null
}

export interface SeriesEpisodeNavState {
  seriesID: number | null
  seriesTitle: string
  episodeNumber: number | null
  hasPrev: boolean
  prevID: number | null
  hasNext: boolean
  nextID: number | null
  totalCount: number | null
  loading: boolean
}

export function useSeriesEpisodeNav(options: UseSeriesEpisodeNavOptions): SeriesEpisodeNavState {
  const {
    workID,
    seriesID: propSeriesID,
    seriesTitleFallback: propTitle,
    kind,
    initialPrev,
    initialNext,
    initialEpisodeNumber,
  } = options

  const isNovel = kind === "novel"
  const resolvedRef = getSeriesByWorkID(workID, kind)
  const seriesID = propSeriesID ?? resolvedRef?.seriesID ?? null
  const defaultTitle = propTitle?.trim() || resolvedRef?.seriesTitle || (isNovel ? "小说系列" : "漫画系列")
  const episodeNumberFallback = initialEpisodeNumber ?? resolvedRef?.episodeNumber ?? null

  const [state, setState] = useState<SeriesEpisodeNavState>(() => {
    if (!seriesID) {
      return {
        seriesID: null,
        seriesTitle: defaultTitle,
        episodeNumber: episodeNumberFallback,
        hasPrev: false,
        prevID: null,
        hasNext: false,
        nextID: null,
        totalCount: null,
        loading: false,
      }
    }

    const cached = getCachedSeriesNav(seriesID, kind)
    if (cached) {
      const idx = cached.items.findIndex((it) => it.id === workID)
      if (idx >= 0) {
        return {
          seriesID,
          seriesTitle: cached.title || defaultTitle,
          episodeNumber: idx + 1,
          hasPrev: idx > 0,
          prevID: idx > 0 ? cached.items[idx - 1].id : null,
          hasNext: idx < cached.items.length - 1,
          nextID: idx < cached.items.length - 1 ? cached.items[idx + 1].id : null,
          totalCount: cached.totalCount,
          loading: false,
        }
      }
    }

    return {
      seriesID,
      seriesTitle: defaultTitle,
      episodeNumber: episodeNumberFallback,
      hasPrev: Boolean(initialPrev?.id),
      prevID: initialPrev?.id ?? null,
      hasNext: Boolean(initialNext?.id),
      nextID: initialNext?.id ?? null,
      totalCount: null,
      loading: true,
    }
  })

  useEffect(() => {
    if (!seriesID) {
      setState({
        seriesID: null,
        seriesTitle: defaultTitle,
        episodeNumber: episodeNumberFallback,
        hasPrev: false,
        prevID: null,
        hasNext: false,
        nextID: null,
        totalCount: null,
        loading: false,
      })
      return
    }

    let active = true

    // 如果有前后话元数据，顺便预热关联
    if (initialPrev?.id) {
      recordWorkSeriesAssociation(initialPrev.id, kind, seriesID, defaultTitle)
    }
    if (initialNext?.id) {
      recordWorkSeriesAssociation(initialNext.id, kind, seriesID, defaultTitle)
    }
    const cached = getCachedSeriesNav(seriesID, kind)
    if (cached) {
      const idx = cached.items.findIndex((it) => it.id === workID)
      if (idx >= 0) {
        setState({
          seriesID,
          seriesTitle: cached.title || defaultTitle,
          episodeNumber: idx + 1,
          hasPrev: idx > 0,
          prevID: idx > 0 ? cached.items[idx - 1].id : null,
          hasNext: idx < cached.items.length - 1,
          nextID: idx < cached.items.length - 1 ? cached.items[idx + 1].id : null,
          totalCount: cached.totalCount,
          loading: false,
        })
        return
      }
    }

    // 异步拉取（带 targetWorkID 快速按需命中）
    fetchSeriesNav(seriesID, kind, workID).then((navData) => {
      if (!active || !navData) return
      const idx = navData.items.findIndex((it) => it.id === workID)
      if (idx >= 0) {
        setState({
          seriesID,
          seriesTitle: navData.title || defaultTitle,
          episodeNumber: idx + 1,
          hasPrev: idx > 0,
          prevID: idx > 0 ? navData.items[idx - 1].id : null,
          hasNext: idx < navData.items.length - 1,
          nextID: idx < navData.items.length - 1 ? navData.items[idx + 1].id : null,
          totalCount: navData.totalCount,
          loading: false,
        })
      } else {
        // 未匹配到当前 ID 时的保底
        setState((prev) => ({
          ...prev,
          seriesTitle: navData.title || prev.seriesTitle,
          loading: false,
        }))
      }
    })

    return () => {
      active = false
    }
  }, [workID, seriesID, kind, defaultTitle])

  return state
}

export function SeriesEpisodePager(props: {
  workID: number
  seriesID?: number | null
  seriesTitle?: string | null
  kind: "manga" | "novel"
  seriesPrev?: { id: number; title?: string } | null
  seriesNext?: { id: number; title?: string } | null
  episodeNumber?: number | null
}) {
  const {
    workID,
    seriesID: propSeriesID,
    seriesTitle: propSeriesTitle,
    kind,
    seriesPrev,
    seriesNext,
    episodeNumber: propEpisodeNumber,
  } = props

  const isNovel = kind === "novel"
  const resolvedRef = getSeriesByWorkID(workID, kind)
  const seriesID = propSeriesID ?? resolvedRef?.seriesID ?? null
  const seriesTitle = propSeriesTitle ?? resolvedRef?.seriesTitle ?? null
  const episodeNumber = propEpisodeNumber ?? resolvedRef?.episodeNumber ?? null

  const nav = useSeriesEpisodeNav({
    workID,
    seriesID,
    seriesTitleFallback: seriesTitle,
    kind,
    initialPrev: seriesPrev,
    initialNext: seriesNext,
    initialEpisodeNumber: episodeNumber,
  })

  if (!nav.seriesID) return null

  const seriesRoute = isNovel ? `novelSeries:${nav.seriesID}` : `mangaSeries:${nav.seriesID}`
  const prevRoute = nav.prevID != null ? (isNovel ? `novel:${nav.prevID}` : `illust:${nav.prevID}`) : null
  const nextRoute = nav.nextID != null ? (isNovel ? `novel:${nav.nextID}` : `illust:${nav.nextID}`) : null

  const displayTitle = nav.seriesTitle || (isNovel ? "小说系列" : "漫画系列")
  const episodeSuffix = nav.episodeNumber != null ? `（第${nav.episodeNumber}话）` : ""
  const capsuleText = `${displayTitle}${episodeSuffix}`

  return (
    <HStack
      alignment="center"
      padding={{ top: 14, bottom: 20, horizontal: 16 }}
      frame={{ maxWidth: "infinity", alignment: "center" }}
    >
      {/* 左箭头：靠左对齐，首话时占位隐藏 */}
      {nav.hasPrev && prevRoute ? (
        <NavigationLink value={prevRoute} buttonStyle="plain">
          <ZStack
            alignment="center"
            frame={{ width: 44, height: 44 }}
            glassEffect="circle"
            contentShape="circle"
            shadow={{ color: "#0000000D", radius: 8, y: 2 }}
          >
            <Image
              systemName="chevron.left"
              font="body"
              fontWeight="semibold"
              foregroundStyle="#007AFF"
            />
          </ZStack>
        </NavigationLink>
      ) : (
        <ZStack frame={{ width: 44, height: 44 }} />
      )}

      <Spacer />

      {/* 中间系列胶囊：系列symbol + 系列名称（第$话），始终屏幕居中 */}
      <NavigationLink value={seriesRoute} buttonStyle="plain">
        <HStack
          alignment="center"
          spacing={6}
          padding={{ horizontal: 16, vertical: 11 }}
          glassEffect="capsule"
          contentShape="capsule"
          shadow={{ color: "#0000000D", radius: 8, y: 2 }}
        >
          <Image
            systemName="books.vertical"
            font="subheadline"
            fontWeight="semibold"
            foregroundStyle="#007AFF"
          />
          <Text
            font="subheadline"
            fontWeight="semibold"
            foregroundStyle="#007AFF"
            lineLimit={1}
          >
            {capsuleText}
          </Text>
        </HStack>
      </NavigationLink>

      <Spacer />

      {/* 右箭头：靠右对齐，尾话时占位隐藏 */}
      {nav.hasNext && nextRoute ? (
        <NavigationLink value={nextRoute} buttonStyle="plain">
          <ZStack
            alignment="center"
            frame={{ width: 44, height: 44 }}
            glassEffect="circle"
            contentShape="circle"
            shadow={{ color: "#0000000D", radius: 8, y: 2 }}
          >
            <Image
              systemName="chevron.right"
              font="body"
              fontWeight="semibold"
              foregroundStyle="#007AFF"
            />
          </ZStack>
        </NavigationLink>
      ) : (
        <ZStack frame={{ width: 44, height: 44 }} />
      )}
    </HStack>
  )
}
