import {
  Button,
  Device,
  Divider,
  FlowLayout,
  Group,
  HStack,
  Image,
  Label,
  LazyVStack,
  List,
  Menu,
  NavigationLink,
  Picker,
  ScrollView,
  Section,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { appGlass, appInteractiveGlass, appThemeColor } from "./components/glass"
import {
  PAGE_TOOLBAR_BACKGROUND,
  PAGE_TOOLBAR_BACKGROUND_VISIBILITY,
} from "./components/pageChrome"
import { AppNavigationLink, useDualRoute } from "./DualRouteContext"
import {
  nextIllustrations,
  nextNovels,
  nextUsers,
  recommendedUsers,
  searchAutocomplete,
  searchIllustrations,
  searchNovels,
  searchUsers,
  trendingNovelTags,
  trendingTags,
} from "../api/pixiv"
import { session } from "../api/session"
import {
  cardThumbUrlOf,
  novelThumbUrlOf,
  prefetch,
} from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  isUserBlocked,
  loadBlocklist,
} from "../store/blocklist"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import {
  cacheIllust,
} from "../store/illustCache"
import {
  addSearchHistory,
  clearSearchHistory,
  getSearchHistoryEntries,
  getTagTranslation,
  onSearchHistoryChanged,
  recordTagTranslation,
  removeSearchHistory,
  type SearchHistoryEntry,
} from "../store/searchHistory"
import {
  requestPixivRoute,
  setActiveTabKind,
  useIsCurrentTab,
} from "../store/routeNavigation"
import {
  createSearchSession,
  getSearchSession,
  searchResultsRoute,
  popTabToRoot,
  popTabLevel,
} from "../store/searchNavigation"
import { destinationElement } from "./DestinationElement"
import { triggerHaptic } from "../platform/haptics"
import {
  currentBatchSize,
  dedupeByID,
  useDebouncedCallback,
  useLatest,
  usePagedList,
  useLayoutMetrics,
  IPAD_WIDE_MIN_WIDTH,
} from "./Hooks"
import { useExperimentalAmbientPalette } from "./ambient"
import type {
  AdvancedSearchParams,
  BookmarkThreshold,
  PixivAutocompleteTag,
  PixivIllustration,
  PixivNovel,
  PixivTrendingTag,
  PixivUserPreview,
  SearchMediaFilter,
  SearchScope,
  SearchSort,
} from "../types"
import { DockSegmentedBar, useRegisterBottomAccessory } from "./bottomAccessory"
import {
  appToolbar,
  ConnectionRow,
  connectionPreviewImageURLs,
  CachedImage,
  EmptyView,
  ErrorView,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

declare const Pasteboard: any

function SearchAdvancedSheet(props: any): any {
  const mod = require("./searchAdvancedSheet")
  const Comp = mod.SearchAdvancedSheet || mod.default
  return <Comp {...props} />
}

function getDefaultAdvancedSearchParams(...args: any[]): any {
  const mod = require("./searchAdvancedSheet")
  return mod.getDefaultAdvancedSearchParams(...args)
}

function categoryFromParams(...args: any[]): any {
  const mod = require("./searchAdvancedSheet")
  return mod.categoryFromParams(...args)
}

function formatDateToPixivDate(...args: any[]): any {
  const mod = require("./searchAdvancedSheet")
  return mod.formatDateToPixivDate(...args)
}

type UserItem = PixivUserPreview & { id: number }

const AUTOCOMPLETE_DEBOUNCE_MS = 250
const USER_AUTOCOMPLETE_DEBOUNCE_MS = 300

export function trendingTagThumbUrl(tag: PixivTrendingTag): string | null {
  return (
    tag.illust?.image_urls?.square_medium ??
    tag.illust?.image_urls?.medium ??
    tag.novel?.image_urls?.square_medium ??
    tag.novel?.image_urls?.medium ??
    null
  )
}

export function trendingTagHeroUrl(tag: PixivTrendingTag): string | null {
  return (
    tag.illust?.image_urls?.large ??
    tag.illust?.image_urls?.medium ??
    tag.novel?.image_urls?.large ??
    tag.novel?.image_urls?.medium ??
    null
  )
}

export type DirectRouteTarget = {
  type: "illust" | "novel" | "user" | "pixivision" | "novelSeries" | "mangaSeries"
  id: number
  title: string
  subtitle?: string
  icon: string
  color?: string
}

export function parseDirectRouteTargets(
  input: string,
  scope: SearchScope,
  hideNovels?: boolean
): DirectRouteTarget[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  // 1. 纯数字 ID 识别：按当前 scope 优先级排布，同时提供跨形态直达选项
  if (/^\d+$/.test(trimmed)) {
    const id = parseInt(trimmed, 10)
    if (!id || id <= 0) return []
    const targets: DirectRouteTarget[] = []

    if (scope === "illust") {
      targets.push({
        type: "illust",
        id,
        title: `查看插画 / 漫画`,
        subtitle: `PID: ${id}`,
        icon: "photo.stack",
        color: "systemBlue",
      })
      targets.push({
        type: "user",
        id,
        title: `访问创作者主页`,
        subtitle: `UID: ${id}`,
        icon: "person.circle",
        color: "systemGreen",
      })
      if (!hideNovels) {
        targets.push({
          type: "novel",
          id,
          title: `查看小说`,
          subtitle: `NID: ${id}`,
          icon: "book.closed",
          color: "systemOrange",
        })
      }
    } else if (scope === "novel") {
      targets.push({
        type: "novel",
        id,
        title: `查看小说`,
        subtitle: `NID: ${id}`,
        icon: "book.closed",
        color: "systemOrange",
      })
      targets.push({
        type: "illust",
        id,
        title: `查看插画 / 漫画`,
        subtitle: `PID: ${id}`,
        icon: "photo.stack",
        color: "systemBlue",
      })
      targets.push({
        type: "user",
        id,
        title: `访问创作者主页`,
        subtitle: `UID: ${id}`,
        icon: "person.circle",
        color: "systemGreen",
      })
    } else {
      targets.push({
        type: "user",
        id,
        title: `访问创作者主页`,
        subtitle: `UID: ${id}`,
        icon: "person.circle",
        color: "systemGreen",
      })
      targets.push({
        type: "illust",
        id,
        title: `查看插画 / 漫画`,
        subtitle: `PID: ${id}`,
        icon: "photo.stack",
        color: "systemBlue",
      })
      if (!hideNovels) {
        targets.push({
          type: "novel",
          id,
          title: `查看小说`,
          subtitle: `NID: ${id}`,
          icon: "book.closed",
          color: "systemOrange",
        })
      }
    }
    return targets
  }

  // 2. Pixiv / Pixivision 网页链接精准识别
  // 插画/漫画：pixiv.net/artworks/123456 或 pixiv.net/i/123456
  const artworkMatch =
    trimmed.match(/(?:pixiv\.net\/(?:[a-z]{2}\/)?(?:artworks|i)\/|artworks\/)(\d+)/i) ||
    trimmed.match(/illust_id=(\d+)/i)
  if (artworkMatch) {
    const id = parseInt(artworkMatch[1], 10)
    if (id > 0) {
      return [
        {
          type: "illust",
          id,
          title: `直达插画 / 漫画详情`,
          subtitle: `PID: ${id}`,
          icon: "photo.stack",
          color: "systemBlue",
        },
      ]
    }
  }

  // 漫画系列：pixiv.net/user/19291125/series/292133 或 pixiv.net/users/19291125/series/292133
  const mangaSeriesMatch =
    trimmed.match(/(?:pixiv\.net\/(?:[a-z]{2}\/)?(?:user|users)\/\d+\/series\/|(?:user|users)\/\d+\/series\/|manga\/series\/)(\d+)/i) ||
    trimmed.match(/(?:illust_series|user_series)\.php\?series_id=(\d+)/i)
  if (mangaSeriesMatch) {
    const id = parseInt(mangaSeriesMatch[1], 10)
    if (id > 0) {
      return [
        {
          type: "mangaSeries",
          id,
          title: `直达漫画系列`,
          subtitle: `SID: ${id}`,
          icon: "photo.stack",
          color: "systemBlue",
        },
      ]
    }
  }

  // 用户主页：pixiv.net/users/123456 或 pixiv.net/u/123456 或 member.php?id=123456
  const userMatch =
    trimmed.match(/(?:pixiv\.net\/(?:[a-z]{2}\/)?(?:users|user|u)\/|(?:users|user)\/)(\d+)/i) ||
    trimmed.match(/member\.php\?id=(\d+)/i)
  if (userMatch) {
    const id = parseInt(userMatch[1], 10)
    if (id > 0) {
      return [
        {
          type: "user",
          id,
          title: `直达创作者主页`,
          subtitle: `UID: ${id}`,
          icon: "person.circle",
          color: "systemGreen",
        },
      ]
    }
  }

  // 小说系列：pixiv.net/novel/series/123456 或 novel/series.php?id=123456
  const novelSeriesMatch =
    trimmed.match(/novel\/series\/(\d+)/i) ||
    trimmed.match(/novel\/series\.php\?id=(\d+)/i)
  if (novelSeriesMatch) {
    const id = parseInt(novelSeriesMatch[1], 10)
    if (id > 0) {
      return [
        {
          type: "novelSeries",
          id,
          title: `直达小说系列`,
          subtitle: `SID: ${id}`,
          icon: "books.vertical",
          color: "systemOrange",
        },
      ]
    }
  }

  // 小说详情：pixiv.net/novel/show.php?id=123456
  const novelMatch = trimmed.match(/novel\/(?:show|show\.php\?id=)(\d+)/i) || trimmed.match(/novel_id=(\d+)/i)
  if (novelMatch) {
    const id = parseInt(novelMatch[1], 10)
    if (id > 0) {
      return [
        {
          type: "novel",
          id,
          title: `直达小说详情`,
          subtitle: `NID: ${id}`,
          icon: "book.closed",
          color: "systemOrange",
        },
      ]
    }
  }

  // 特辑：pixivision.net/.../a/123456
  const pixivisionMatch = trimmed.match(/(?:pixivision\.net)?\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?a\/(\d+)/i)
  if (pixivisionMatch) {
    const id = parseInt(pixivisionMatch[1], 10)
    if (id > 0) {
      return [
        {
          type: "pixivision",
          id,
          title: `直达 Pixivision 特辑`,
          subtitle: `ID: ${id}`,
          icon: "rectangle.stack",
          color: "systemPurple",
        },
      ]
    }
  }

  return []
}

function chunk<T>(array: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

function normalizeUserPage(page: {
  items: PixivUserPreview[]
  nextURL: string | null
}): { items: UserItem[]; nextURL: string | null } {
  return {
    items: page.items.map((preview) => ({ ...preview, id: preview.user.id })),
    nextURL: page.nextURL,
  }
}

function filterUserPreviews(items: UserItem[]): UserItem[] {
  const settings = loadSettings()
  const blocklist = loadBlocklist()
  return items
    .filter((preview) => !isUserBlocked(preview.user.id, blocklist.blockedUsers))
    .map((preview) => ({
      ...preview,
      illusts: dedupeByID(
        (preview.illusts ?? []).filter((illust) =>
          isIllustContentVisible(illust, settings, blocklist)
        )
      ),
      novels: dedupeByID(
        (preview.novels ?? []).filter((novel) =>
          isNovelContentVisible(novel, settings, blocklist)
        )
      ),
    }))
}

declare const Dialog: any
declare const Animation: any

// 模块级热门标签内存预热缓存
let cachedTrendingIllust: PixivTrendingTag[] = []
let cachedTrendingNovel: PixivTrendingTag[] = []

function formatShortDateRange(
  startStr?: string,
  endStr?: string,
  presetLabel?: string
): string {
  if (presetLabel) return presetLabel
  if (!startStr || !endStr) return ""

  const todayStr = formatDateToPixivDate(Date.now())
  if (startStr === todayStr && endStr === todayStr) {
    return "今天"
  }

  const formatSingle = (s: string) => {
    const parts = s.split("-")
    if (parts.length === 3) {
      return `${parts[0].slice(2)}.${parts[1]}.${parts[2]}`
    }
    return s
  }

  if (startStr === endStr) {
    return formatSingle(startStr)
  }

  return `${formatSingle(startStr)} ~ ${formatSingle(endStr)}`
}

export function SearchView(props: {
  onClose?: () => void
  active?: boolean
  sessionID?: number
}) {
  const searchSession = useMemo(() => {
    return props.sessionID ? getSearchSession(props.sessionID) : undefined
  }, [props.sessionID])
  const isResultsPage = props.sessionID !== undefined

  useEffect(() => {
    setActiveTabKind("search")
  }, [])

  const [query, setQuery] = useState("")
  const [submitted, setSubmitted] = useState(() => searchSession?.keyword ?? "")
  const [searchPresented, setSearchPresented] = useState(false)
  const [scope, setScope] = useState<SearchScope>(() => searchSession?.scope ?? "illust")
  const [sort, setSort] = useState<SearchSort>(() => searchSession?.sort ?? "date_desc")
  const [isAdvancedSheetOpen, setIsAdvancedSheetOpen] = useState(false)
  const [advancedParams, setAdvancedParams] = useState<AdvancedSearchParams>(() => {
    if (searchSession?.advancedParams) {
      return searchSession.advancedParams
    }
    return getDefaultAdvancedSearchParams(searchSession?.scope ?? "illust", searchSession?.keyword ?? "")
  })
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"
  const layoutMetrics = useLayoutMetrics()
  const { isCompact } = layoutMetrics
  const { isSplitViewActive } = useDualRoute()
  const isFullScreenPad =
    Device.isiPad &&
    !isSplitViewActive &&
    layoutMetrics.width >= IPAD_WIDE_MIN_WIDTH
  const [visitedScopes, setVisitedScopes] = useState<Set<SearchScope>>(() => new Set([scope]))

  useEffect(() => {
    setVisitedScopes((prev) => {
      if (prev.has(scope)) return prev
      const next = new Set(prev)
      next.add(scope)
      return next
    })
  }, [scope])

  // 搜索记录（支持存储与展示翻译词条）
  const [historyItems, setHistoryItems] = useState<SearchHistoryEntry[]>(() => getSearchHistoryEntries(scope))

  // 热门标签状态
  const [trendingIllust, setTrendingIllust] = useState<PixivTrendingTag[]>(() => cachedTrendingIllust)
  const [trendingNovel, setTrendingNovel] = useState<PixivTrendingTag[]>(() => cachedTrendingNovel)
  const [trendingIllustLoaded, setTrendingIllustLoaded] = useState<boolean>(() => cachedTrendingIllust.length > 0)
  const [trendingNovelLoaded, setTrendingNovelLoaded] = useState<boolean>(() => cachedTrendingNovel.length > 0)
  const [trendingIllustLoading, setTrendingIllustLoading] = useState(() => cachedTrendingIllust.length === 0)
  const [trendingNovelLoading, setTrendingNovelLoading] = useState(() => cachedTrendingNovel.length === 0)
  const [trendingIllustError, setTrendingIllustError] = useState<string | null>(null)
  const [trendingNovelError, setTrendingNovelError] = useState<string | null>(null)

  // 标签搜索提示词状态（插画·漫画、小说）
  const [tagSuggestions, setTagSuggestions] = useState<PixivAutocompleteTag[]>([])
  const [tagSuggestionsLoading, setTagSuggestionsLoading] = useState(false)

  // 用户搜索提示状态（用户）
  const [userSuggestions, setUserSuggestions] = useState<UserItem[]>([])
  const [userSuggestionsLoading, setUserSuggestionsLoading] = useState(false)

  const isIllustActive = Boolean(submitted) && scope === "illust"
  const isNovelActive = Boolean(submitted) && scope === "novel"
  const isUserSearchActive = Boolean(submitted) && scope === "user"
  const isUserRecommendedActive = !submitted && scope === "user"

  // 1. 插画 / 漫画搜索流
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => {
      const settings = loadSettings()
      const aiFilterParam =
        !settings.showAI || advancedParams.includeAI === false ? 0 : undefined
      return searchIllustrations(
        {
          word: submitted,
          target: advancedParams.target || "partial_match_for_tags",
          sort,
          aiFilter: aiFilterParam,
          startDate: advancedParams.useDateRange ? advancedParams.startDate : undefined,
          endDate: advancedParams.useDateRange ? advancedParams.endDate : undefined,
          bookmarkThreshold:
            advancedParams.bookmarkThreshold > 0
              ? advancedParams.bookmarkThreshold
              : undefined,
        },
        token
      )
    },
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const blocklist = loadBlocklist()
      let filtered = items.filter((item) => {
        if (!isIllustContentVisible(item, settings, blocklist)) return false

        if (advancedParams.includeR18 === false) {
          const isR18 =
            (item.x_restrict ?? 0) > 0 ||
            item.tags?.some((t) => /r-?18/i.test(t.name))
          if (isR18) return false
        } else if (advancedParams.includeR18G === false) {
          const isR18G =
            item.x_restrict === 2 ||
            item.tags?.some((t) => /r-?18g/i.test(t.name))
          if (isR18G) return false
        }

        if (advancedParams.includeAI === false) {
          if (item.illust_ai_type === 2) return false
        }

        return true
      })
      if (advancedParams.mediaFilter === "illust") {
        filtered = filtered.filter((item) => item.type === "illust")
      } else if (advancedParams.mediaFilter === "manga") {
        filtered = filtered.filter((item) => item.type === "manga")
      } else if (advancedParams.mediaFilter === "ugoira") {
        filtered = filtered.filter((item) => item.type === "ugoira")
      }
      return dedupeByID(filtered)
    },
    deps: [submitted, sort, advancedParams],
    enabled: isIllustActive,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 小说搜索流
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => {
      const settings = loadSettings()
      const aiFilterParam =
        !settings.showAI || advancedParams.includeAI === false ? 0 : undefined
      return searchNovels(
        {
          word: submitted,
          target: advancedParams.target || "partial_match_for_tags",
          sort,
          aiFilter: aiFilterParam,
          startDate: advancedParams.useDateRange ? advancedParams.startDate : undefined,
          endDate: advancedParams.useDateRange ? advancedParams.endDate : undefined,
          bookmarkThreshold:
            advancedParams.bookmarkThreshold > 0
              ? advancedParams.bookmarkThreshold
              : undefined,
        },
        token
      )
    },
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const blocklist = loadBlocklist()
      return dedupeByID(
        items.filter((novel) => {
          if (!isNovelContentVisible(novel, settings, blocklist)) return false

          if (advancedParams.includeR18 === false) {
            const isR18 =
              (novel.x_restrict ?? 0) > 0 ||
              novel.tags?.some((t) => /r-?18/i.test(t.name))
            if (isR18) return false
          } else if (advancedParams.includeR18G === false) {
            const isR18G =
              novel.x_restrict === 2 ||
              novel.tags?.some((t) => /r-?18g/i.test(t.name))
            if (isR18G) return false
          }

          if (advancedParams.includeAI === false) {
            if (novel.novel_ai_type === 2) return false
          }

          return true
        })
      )
    },
    deps: [submitted, sort, advancedParams],
    enabled: isNovelActive,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  // 3. 用户搜索流
  const userSearchPaged = usePagedList<UserItem>({
    first: async (token) => normalizeUserPage(await searchUsers(submitted, token)),
    more: async (nextURL, token) => normalizeUserPage(await nextUsers(nextURL, token)),
    filter: filterUserPreviews,
    deps: [submitted],
    enabled: isUserSearchActive,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).flatMap(connectionPreviewImageURLs)).cancel,
  })

  // 4. 用户推荐流（未搜索时展示）
  const userRecommendedPaged = usePagedList<UserItem>({
    first: async (token) => normalizeUserPage(await recommendedUsers(token)),
    more: async (nextURL, token) => normalizeUserPage(await nextUsers(nextURL, token)),
    filter: filterUserPreviews,
    deps: [],
    enabled: isUserRecommendedActive,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).flatMap(connectionPreviewImageURLs)).cancel,
  })

  const illustPagedRef = useLatest(illustPaged)
  const novelPagedRef = useLatest(novelPaged)
  const userSearchPagedRef = useLatest(userSearchPaged)
  const userRecommendedPagedRef = useLatest(userRecommendedPaged)

  useEffect(() => {
    setHistoryItems(getSearchHistoryEntries(scope))
    return onSearchHistoryChanged(() => {
      setHistoryItems(getSearchHistoryEntries(scope))
    })
  }, [scope])

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      const next = nextSettings.hideNovels
      setHideNovels(next)
      setPageLayout(nextSettings.pageLayout)
      if (next && scope === "novel") {
        setScope("illust")
      }
      illustPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
      userSearchPagedRef.current.reapplyFilter()
      userRecommendedPagedRef.current.reapplyFilter()
    })
  }, [scope])

  async function loadTrendingIllustData() {
    setTrendingIllustLoading(true)
    setTrendingIllustError(null)
    try {
      const tags = await session.call((token) => trendingTags(token))
      setTrendingIllust(tags)
      cachedTrendingIllust = tags
      setTrendingIllustLoaded(true)
      for (const t of tags) {
        if (t.tag && t.translated_name) {
          recordTagTranslation(t.tag, t.translated_name)
        }
        if (t.illust?.id && (t.illust as any).image_urls) {
          cacheIllust(t.illust as any)
        }
      }
      const urls = tags
        .slice(0, 10)
        .flatMap((t) => [trendingTagHeroUrl(t), trendingTagThumbUrl(t)])
        .filter(Boolean) as string[]
      prefetch(urls)
    } catch (err: any) {
      setTrendingIllustError(err?.message ?? "加载热门标签失败")
    } finally {
      setTrendingIllustLoading(false)
    }
  }

  async function loadTrendingNovelData() {
    setTrendingNovelLoading(true)
    setTrendingNovelError(null)
    try {
      const tags = await session.call((token) => trendingNovelTags(token))
      setTrendingNovel(tags)
      cachedTrendingNovel = tags
      setTrendingNovelLoaded(true)
      for (const t of tags) {
        if (t.tag && t.translated_name) {
          recordTagTranslation(t.tag, t.translated_name)
        }
      }
      const urls = tags
        .slice(0, 10)
        .flatMap((t) => [trendingTagHeroUrl(t), trendingTagThumbUrl(t)])
        .filter(Boolean) as string[]
      prefetch(urls)
    } catch (err: any) {
      setTrendingNovelError(err?.message ?? "加载热门标签失败")
    } finally {
      setTrendingNovelLoading(false)
    }
  }

  useEffect(() => {
    if (scope === "illust" && trendingIllust.length === 0) {
      loadTrendingIllustData()
    } else if (scope === "novel" && trendingNovel.length === 0) {
      loadTrendingNovelData()
    }
  }, [scope])

  // ---------- 搜索提示词防抖与请求 ----------
  const tagSeq = useRef(0)
  const userSeq = useRef(0)

  const fetchTagSuggestions = (keyword: string) => {
    const trimmed = keyword.trim()
    if (!trimmed) {
      setTagSuggestions([])
      setTagSuggestionsLoading(false)
      return
    }
    const seq = ++tagSeq.current
    setTagSuggestionsLoading(true)
    session
      .call((token) => searchAutocomplete(trimmed, token))
      .then((tags) => {
        if (seq === tagSeq.current) {
          setTagSuggestions(tags)
          setTagSuggestionsLoading(false)
          for (const t of tags) {
            if (t.name && t.translated_name) {
              recordTagTranslation(t.name, t.translated_name)
            }
          }
        }
      })
      .catch(() => {
        if (seq === tagSeq.current) {
          setTagSuggestions([])
          setTagSuggestionsLoading(false)
        }
      })
  }

  const fetchUserSuggestions = (keyword: string) => {
    const trimmed = keyword.trim()
    if (!trimmed) {
      setUserSuggestions([])
      setUserSuggestionsLoading(false)
      return
    }
    const seq = ++userSeq.current
    setUserSuggestionsLoading(true)
    session
      .call(async (token) => normalizeUserPage(await searchUsers(trimmed, token)))
      .then((page) => {
        if (seq === userSeq.current) {
          const filtered = filterUserPreviews(page.items)
          setUserSuggestions(filtered)
          setUserSuggestionsLoading(false)
          prefetch(
            filtered
              .slice(0, currentBatchSize())
              .flatMap(connectionPreviewImageURLs)
          )
        }
      })
      .catch(() => {
        if (seq === userSeq.current) {
          setUserSuggestions([])
          setUserSuggestionsLoading(false)
        }
      })
  }

  const debouncedTagAutocomplete = useDebouncedCallback(fetchTagSuggestions, AUTOCOMPLETE_DEBOUNCE_MS)
  const debouncedUserAutocomplete = useDebouncedCallback(fetchUserSuggestions, USER_AUTOCOMPLETE_DEBOUNCE_MS)

  function onQueryChanged(value: string) {
    setQuery(value)
    const trimmed = value.trim()
    if (!trimmed) {
      tagSeq.current += 1
      userSeq.current += 1
      debouncedTagAutocomplete.cancel()
      debouncedUserAutocomplete.cancel()
      setSubmitted("")
      setTagSuggestions([])
      setUserSuggestions([])
      setTagSuggestionsLoading(false)
      setUserSuggestionsLoading(false)
    } else {
      if (scope === "user") {
        debouncedUserAutocomplete(value)
      } else {
        debouncedTagAutocomplete(value)
      }
    }
  }

  function handleScopeChange(newScope: SearchScope) {
    tagSeq.current += 1
    userSeq.current += 1
    debouncedTagAutocomplete.cancel()
    debouncedUserAutocomplete.cancel()
    setScope(newScope)
    const trimmed = query.trim()
    if (trimmed) {
      if (newScope === "user") {
        setTagSuggestions([])
        setTagSuggestionsLoading(false)
        fetchUserSuggestions(trimmed)
      } else {
        setUserSuggestions([])
        setUserSuggestionsLoading(false)
        fetchTagSuggestions(trimmed)
      }
    } else {
      setTagSuggestions([])
      setUserSuggestions([])
      setTagSuggestionsLoading(false)
      setUserSuggestionsLoading(false)
    }
  }

  function selectSort(value: SearchSort) {
    if (value === "popular_desc" && !session.user?.is_premium) {
      try {
        triggerHaptic("warning")
      } catch {}
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        void Dialog.alert({
          title: "提示",
          message: "当前账号非 Pixiv Premium 会员，无法使用按热门排序，可在「高级搜索」中使用「收藏数筛选」替代。",
        })
      }
      return
    }
    setSort(value)
    setAdvancedParams((prev) => ({ ...prev, sort: value }))
  }

  const searchScopeItems = useMemo<Array<{ tag: SearchScope; label: string }>>(() => {
    const items: Array<{ tag: SearchScope; label: string }> = [
      { tag: "illust", label: "插画·漫画" },
    ]
    if (!hideNovels) {
      items.push({ tag: "novel", label: "小说" })
    }
    items.push({ tag: "user", label: "用户" })
    return items
  }, [hideNovels])

  const bottomAccessoryKey = isResultsPage
    ? searchResultsRoute(props.sessionID!)
    : "search"

  useRegisterBottomAccessory(
    bottomAccessoryKey,
    searchScopeItems.length <= 1 ? null : (
      <DockSegmentedBar
        items={searchScopeItems}
        value={scope}
        onChanged={handleScopeChange}
      />
    ),
    isAppleMusic
  )

  function pushSearchResults(
    textToSearch: string,
    targetScope: SearchScope = scope,
    overrideSort: SearchSort = sort,
    overrideAdvanced?: AdvancedSearchParams,
    translatedName?: string | null
  ) {
    const trimmed = textToSearch.trim()
    if (!trimmed) return
    tagSeq.current += 1
    userSeq.current += 1
    debouncedTagAutocomplete.cancel()
    debouncedUserAutocomplete.cancel()
    const trans = translatedName || getTagTranslation(trimmed)
    addSearchHistory(trimmed, targetScope, trans)

    const sessionID = createSearchSession({
      keyword: trimmed,
      scope: targetScope,
      sort: overrideSort,
      advancedParams: overrideAdvanced ?? getDefaultAdvancedSearchParams(targetScope, trimmed),
    })

    requestPixivRoute(searchResultsRoute(sessionID), "search")
  }

  function submitSearch(textToSearch: string, translatedName?: string | null) {
    const trimmed = textToSearch.trim()
    if (!trimmed) return

    setSearchPresented(false)
    setQuery("")
    setTagSuggestions([])
    setUserSuggestions([])
    setTagSuggestionsLoading(false)
    setUserSuggestionsLoading(false)

    pushSearchResults(trimmed, scope, sort, undefined, translatedName)
  }

  const activePaged =
    scope === "illust"
      ? illustPaged
      : scope === "novel"
        ? novelPaged
        : userSearchPaged

  // 实验性沉浸环境光背景（带有持久缓冲保护，切换分类或搜索请求中坚决保留上一张背景图）
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(() => {
    if (cachedTrendingIllust[0]) {
      return trendingTagHeroUrl(cachedTrendingIllust[0])
    }
    return null
  })

  useEffect(() => {
    let nextUrl: string | null = null
    let hasLoaded = false
    let isDataEmpty = false

    if (submitted) {
      if (scope === "illust") {
        hasLoaded = !illustPaged.initialLoading
        isDataEmpty = illustPaged.items.length === 0
        if (illustPaged.items[0]) {
          nextUrl = cardThumbUrlOf(illustPaged.items[0])
        }
      } else if (scope === "novel") {
        hasLoaded = !novelPaged.initialLoading
        isDataEmpty = novelPaged.items.length === 0
        if (novelPaged.items[0]) {
          nextUrl = novelThumbUrlOf(novelPaged.items[0])
        }
      } else if (scope === "user") {
        hasLoaded = !userSearchPaged.initialLoading
        isDataEmpty = userSearchPaged.items.length === 0
        if (userSearchPaged.items[0]?.user?.profile_image_urls?.medium) {
          nextUrl = userSearchPaged.items[0].user.profile_image_urls.medium
        }
      }
    } else {
      if (scope === "illust") {
        hasLoaded = trendingIllustLoaded && !trendingIllustLoading
        isDataEmpty = trendingIllust.length === 0
        if (trendingIllust[0]) {
          nextUrl = trendingTagHeroUrl(trendingIllust[0])
        }
      } else if (scope === "novel") {
        hasLoaded = trendingNovelLoaded && !trendingNovelLoading
        isDataEmpty = trendingNovel.length === 0
        if (trendingNovel[0]) {
          nextUrl = trendingTagHeroUrl(trendingNovel[0])
        }
      } else if (scope === "user") {
        hasLoaded = !userRecommendedPaged.initialLoading
        isDataEmpty = userRecommendedPaged.items.length === 0
        if (userRecommendedPaged.items[0]?.user?.profile_image_urls?.medium) {
          nextUrl = userRecommendedPaged.items[0].user.profile_image_urls.medium
        }
      }
    }

    if (nextUrl) {
      setAmbientImageUrl(nextUrl)
    } else if (hasLoaded && isDataEmpty) {
      // 只有在确定加载结束且当前列表确认为空时才置空环境光
      setAmbientImageUrl(null)
    }
  }, [
    submitted,
    scope,
    illustPaged.items[0]?.id,
    illustPaged.initialLoading,
    illustPaged.items.length,
    novelPaged.items[0]?.id,
    novelPaged.initialLoading,
    novelPaged.items.length,
    userSearchPaged.items[0]?.id,
    userSearchPaged.initialLoading,
    userSearchPaged.items.length,
    trendingIllust[0]?.tag,
    trendingIllustLoaded,
    trendingIllustLoading,
    trendingIllust.length,
    trendingNovel[0]?.tag,
    trendingNovelLoaded,
    trendingNovelLoading,
    trendingNovel.length,
    userRecommendedPaged.items[0]?.id,
    userRecommendedPaged.initialLoading,
    userRecommendedPaged.items.length,
  ])
  const isTabActive = useIsCurrentTab("search")
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl, isTabActive || !isResultsPage)

  const directTargets = useMemo(
    () => parseDirectRouteTargets(query, scope, hideNovels),
    [query, scope, hideNovels]
  )
  const submittedDirectTargets = useMemo(
    () => parseDirectRouteTargets(submitted, scope, hideNovels),
    [submitted, scope, hideNovels]
  )

  interface ActiveFilterBadge {
    key: string
    icon: string
    iconColor: string
    label: string
    onClear: () => void
  }

  const activeFilterBadges = useMemo<ActiveFilterBadge[]>(() => {
    if (scope === "user") return []
    const badges: ActiveFilterBadge[] = []
    if (advancedParams.bookmarkThreshold > 0) {
      badges.push({
        key: "bookmark",
        icon: "heart.fill",
        iconColor: "systemPink",
        label: `≥${
          advancedParams.bookmarkThreshold >= 10000
            ? `${advancedParams.bookmarkThreshold / 10000}万`
            : advancedParams.bookmarkThreshold.toLocaleString()
        } 收藏`,
        onClear: () =>
          setAdvancedParams((prev) => ({ ...prev, bookmarkThreshold: 0 })),
      })
    }
    if (
      advancedParams.useDateRange &&
      advancedParams.startDate &&
      advancedParams.endDate
    ) {
      badges.push({
        key: "date",
        icon: "calendar",
        iconColor: appThemeColor("systemBlue"),
        label: formatShortDateRange(
          advancedParams.startDate,
          advancedParams.endDate,
          advancedParams.datePresetLabel
        ),
        onClear: () =>
          setAdvancedParams((prev) => ({ ...prev, useDateRange: false })),
      })
    }
    if (
      advancedParams.mediaFilter &&
      advancedParams.mediaFilter !== "all" &&
      scope === "illust"
    ) {
      const mediaMap: Record<string, { label: string; icon: string }> = {
        illust: { label: "仅插画", icon: "photo" },
        manga: { label: "仅漫画", icon: "photo.on.rectangle" },
        ugoira: { label: "仅动图", icon: "play.circle" },
      }
      const mediaInfo = mediaMap[advancedParams.mediaFilter] || {
        label: advancedParams.mediaFilter,
        icon: "photo.stack",
      }
      badges.push({
        key: "media",
        icon: mediaInfo.icon,
        iconColor: "systemPurple",
        label: mediaInfo.label,
        onClear: () =>
          setAdvancedParams((prev) => ({
            ...prev,
            mediaFilter: "all",
            category: "all_illust",
          })),
      })
    }
    const currentSettings = loadSettings()
    if (currentSettings.showR18 && advancedParams.includeR18 === false) {
      badges.push({
        key: "r18",
        icon: "nosign",
        iconColor: "systemRed",
        label: "仅全年龄",
        onClear: () =>
          setAdvancedParams((prev) => ({
            ...prev,
            includeR18: true,
            includeR18G: currentSettings.showR18G,
          })),
      })
    } else if (
      currentSettings.showR18 &&
      currentSettings.showR18G &&
      advancedParams.includeR18G === false
    ) {
      badges.push({
        key: "r18g",
        icon: "nosign",
        iconColor: "systemOrange",
        label: "排除 R-18G",
        onClear: () =>
          setAdvancedParams((prev) => ({
            ...prev,
            includeR18G: true,
          })),
      })
    }
    if (currentSettings.showAI && advancedParams.includeAI === false) {
      badges.push({
        key: "ai",
        icon: "nosign",
        iconColor: "systemIndigo",
        label: "排除 AI",
        onClear: () =>
          setAdvancedParams((prev) => ({
            ...prev,
            includeAI: true,
          })),
      })
    }
    return badges
  }, [advancedParams, scope])

  // 是否处于搜索提示词展示态：输入框有内容，且处于输入或查看提示词状态（未提交或键盘激活中）
  const isSuggestingActive =
    query.trim().length > 0 && (!submitted || searchPresented)

  const renderScopeScrollFeed = (targetScope: SearchScope) => {
    const targetPaged =
      targetScope === "illust"
        ? illustPaged
        : targetScope === "novel"
          ? novelPaged
          : userSearchPaged

    return (
      <RefreshableScrollView
        refreshable={async () => {
          if (submitted && !searchPresented) {
            await targetPaged.refresh()
          } else if (!submitted && (!searchPresented || Device.isiPad) && !query.trim()) {
            if (targetScope === "illust") {
              await loadTrendingIllustData()
            } else if (targetScope === "novel") {
              await loadTrendingNovelData()
            } else if (targetScope === "user") {
              await userRecommendedPaged.refresh()
            }
          }
        }}
      >
        <VStack alignment="leading" spacing={10}>
          {/* 1. 创作者搜索建议与精准直达（仅用户分类在输入态时于此渲染） */}
          {isSuggestingActive && targetScope === "user" ? (
            <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
              {directTargets.length > 0 ? (
                <DirectRouteSection
                  targets={directTargets}
                  onSelect={() => {
                    addSearchHistory(query.trim(), targetScope)
                  }}
                />
              ) : null}
              <UserSuggestionsSection
                items={userSuggestions}
                loading={userSuggestionsLoading}
                hideNovels={hideNovels}
              />
            </VStack>
          ) : null}

          {/* 2. 未提交搜索状态：始终纯净展示热门标签或推荐创作者，iPad 未打字常驻展示历史记录 */}
          {!submitted ? (
            <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
              {/* iPad 专属合屏模式：上方常驻搜索历史（有记录则显示，无记录自然隐去） */}
              {Device.isiPad && historyItems.length > 0 && !query.trim() ? (
                <SearchHistorySection
                  entries={historyItems}
                  isDoubleColumn={isFullScreenPad}
                  hideIfEmpty={true}
                  bottomInset={0}
                  onSelect={(entry) => {
                    const trans = entry.translatedName || getTagTranslation(entry.query)
                    submitSearch(entry.query, trans)
                  }}
                  onRemove={(entry) => {
                    removeSearchHistory(entry.query, targetScope)
                    setHistoryItems(getSearchHistoryEntries(targetScope))
                  }}
                  onClear={() => {
                    clearSearchHistory(targetScope)
                    setHistoryItems([])
                  }}
                  onFillQuery={(q) => {
                    setQuery(q)
                  }}
                />
              ) : null}

              {targetScope === "illust" ? (
                <TrendingSection
                  tags={trendingIllust}
                  loading={trendingIllustLoading}
                  error={trendingIllustError}
                  onRetry={loadTrendingIllustData}
                  onSelect={submitSearch}
                />
              ) : targetScope === "novel" ? (
                <TrendingSection
                  tags={trendingNovel}
                  loading={trendingNovelLoading}
                  error={trendingNovelError}
                  onRetry={loadTrendingNovelData}
                  onSelect={submitSearch}
                />
              ) : (
                <RecommendedUsersSection
                  paged={userRecommendedPaged}
                  hideNovels={hideNovels}
                />
              )}
            </VStack>
          ) : null}

          {/* 3. 已提交搜索：展示当前搜索结果列表 */}
          {submitted ? (
            <VStack spacing={10} frame={{ maxWidth: "infinity" }}>
              {/* 第一行：主搜索词胶囊 + 返回热门 */}
              <HStack
                alignment="center"
                spacing={8}
                padding={{ horizontal: 8, top: 2, bottom: 2 }}
                frame={{ maxWidth: "infinity" }}
              >
                <HStack
                  alignment="center"
                  spacing={6}
                  padding={{ horizontal: 12, vertical: 6 }}
                  glassEffect={appInteractiveGlass("capsule")}
                  contentShape="capsule"
                >
                  <Image systemName="magnifyingglass" font="caption" foregroundStyle="secondaryLabel" />
                  <Text font="subheadline" fontWeight="medium" foregroundStyle="label" lineLimit={1}>
                    {submitted}
                  </Text>
                  <Button
                    buttonStyle="plain"
                    contentShape="circle"
                    action={() => {
                      if (isResultsPage) {
                        popTabLevel("search")
                      } else {
                        setSubmitted("")
                        setQuery("")
                        setSearchPresented(false)
                        setAdvancedParams(getDefaultAdvancedSearchParams(scope, ""))
                      }
                    }}
                  >
                    <Image
                      systemName="xmark.circle.fill"
                      font="subheadline"
                      foregroundStyle="secondaryLabel"
                    />
                  </Button>
                </HStack>

                <Spacer />

                <Button
                  buttonStyle="plain"
                  action={() => {
                    if (isResultsPage) {
                      popTabToRoot("search")
                    } else {
                      setSubmitted("")
                      setQuery("")
                      setSearchPresented(false)
                      setAdvancedParams(getDefaultAdvancedSearchParams(scope, ""))
                    }
                  }}
                  contentShape="capsule"
                >
                  <HStack
                    alignment="center"
                    spacing={4}
                    padding={{ horizontal: 10, vertical: 6 }}
                    glassEffect={appInteractiveGlass("capsule")}
                    contentShape="capsule"
                    clipShape="capsule"
                  >
                    <Image
                      systemName="arrow.uturn.backward"
                      font="caption"
                      foregroundStyle={appThemeColor("systemBlue")}
                    />
                    <Text
                      font="subheadline"
                      fontWeight="medium"
                      foregroundStyle={appThemeColor("systemBlue")}
                    >
                      返回热门
                    </Text>
                  </HStack>
                </Button>
              </HStack>

              {/* 第二行：高级筛选标签栏（仅在有筛选条件时展开） */}
              {activeFilterBadges.length > 0 ? (
                <VStack
                  alignment="leading"
                  spacing={6}
                  padding={{ horizontal: 8, top: 0, bottom: 2 }}
                  frame={{ maxWidth: "infinity" }}
                >
                  <FlowLayout spacing={4}>
                    {activeFilterBadges.map((badge) => (
                      <Button
                        key={badge.key}
                        action={badge.onClear}
                        buttonStyle="glass"
                        controlSize="mini"
                        tint={appThemeColor("systemBlue")}
                        fixedSize={{ horizontal: true, vertical: false }}
                      >
                        <HStack alignment="center" spacing={3}>
                          <Image
                            systemName={badge.icon}
                            font="caption2"
                            foregroundStyle={badge.iconColor as any}
                          />
                          <Text
                            font="caption2"
                            fontWeight="medium"
                            foregroundStyle="label"
                            lineLimit={1}
                          >
                            {badge.label}
                          </Text>
                          <Image
                            systemName="xmark"
                            font="caption2"
                            foregroundStyle="secondaryLabel"
                          />
                        </HStack>
                      </Button>
                    ))}

                    {activeFilterBadges.length > 1 ? (
                      <Button
                        buttonStyle="glass"
                        controlSize="mini"
                        tint="systemRed"
                        fixedSize={{ horizontal: true, vertical: false }}
                        action={() => {
                          setAdvancedParams((prev) => ({
                            ...prev,
                            bookmarkThreshold: 0,
                            useDateRange: false,
                            datePresetLabel: undefined,
                            mediaFilter: "all",
                            category: categoryFromParams(scope, "all"),
                          }))
                        }}
                      >
                        <HStack alignment="center" spacing={3}>
                          <Image
                            systemName="arrow.counterclockwise"
                            font="caption2"
                            foregroundStyle="secondaryLabel"
                          />
                          <Text
                            font="caption2"
                            fontWeight="medium"
                            foregroundStyle="secondaryLabel"
                            lineLimit={1}
                          >
                            重置筛选
                          </Text>
                        </HStack>
                      </Button>
                    ) : null}
                  </FlowLayout>
                </VStack>
              ) : null}

              {submittedDirectTargets.length > 0 ? (
                <DirectRouteSection
                  targets={submittedDirectTargets}
                  onSelect={() => {
                    addSearchHistory(submitted.trim(), targetScope)
                  }}
                />
              ) : null}

              {targetPaged.initialLoading ? (
                <LoadingView />
              ) : targetPaged.error ? (
                <ErrorView
                  message={targetPaged.error}
                  onRetry={targetPaged.refresh}
                />
              ) : targetPaged.items.length === 0 ? (
                <EmptyView
                  text={
                    targetPaged.hasFilteredContent
                      ? targetScope === "novel"
                        ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
                        : targetScope === "user"
                          ? "当前页面部分用户内容被内容显示设置过滤，暂时无法显示"
                          : "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                      : "没有找到相关内容"
                  }
                  systemImage={targetPaged.hasFilteredContent ? "eye.slash" : "magnifyingglass"}
                />
              ) : targetScope === "illust" ? (
                <IllustFlowFeed
                  items={illustPaged.items}
                  onLoadMore={illustPaged.loadMore}
                  hasMore={illustPaged.hasMore}
                  isLoading={illustPaged.loadingMore}
                  loadMoreError={illustPaged.loadMoreError}
                  onRetryLoadMore={illustPaged.retryLoadMore}
                />
              ) : targetScope === "novel" ? (
                <NovelResults
                  items={novelPaged.items}
                  loadingMore={novelPaged.loadingMore}
                  loadMoreError={novelPaged.loadMoreError}
                  hasMore={novelPaged.hasMore}
                  onLoadMore={novelPaged.loadMore}
                  onRetry={novelPaged.retryLoadMore}
                />
              ) : (
                <UserResults
                  paged={userSearchPaged}
                  hideNovels={hideNovels}
                />
              )}
            </VStack>
          ) : null}
        </VStack>
      </RefreshableScrollView>
    )
  }

  const scopeTitleLabel =
    scope === "illust"
      ? "插画·漫画"
      : scope === "novel"
        ? "小说"
        : "用户"
  const baseNavTitle = submitted.trim() ? submitted.trim() : "搜索"
  const navTitle = !isAppleMusic
    ? `${baseNavTitle} · ${scopeTitleLabel}`
    : baseNavTitle

  return (
    <ZStack
        navigationTitle={navTitle}
        navigationBarTitleDisplayMode="inline"
        toolbarBackground={PAGE_TOOLBAR_BACKGROUND}
        toolbarBackgroundVisibility={PAGE_TOOLBAR_BACKGROUND_VISIBILITY}
        navigationDestination={destinationElement}
        sheet={{
          isPresented: isAdvancedSheetOpen,
          onChanged: (presented: boolean) => setIsAdvancedSheetOpen(presented),
          content: (
            <SearchAdvancedSheet
              currentParams={{
                ...advancedParams,
                word: submitted.trim() ? submitted : advancedParams.word,
                scope,
                sort,
              }}
              settings={loadSettings()}
              onApply={(params: any) => {
                setIsAdvancedSheetOpen(false)
                setSearchPresented(false)
                const trimmedWord =
                  (params.word && params.word.trim()) || submitted.trim()
                if (!trimmedWord) return

                const isWordChanged = trimmedWord !== submitted.trim()
                const isScopeChanged = params.scope !== scope

                if (isResultsPage && !isWordChanged && !isScopeChanged) {
                  // 关键词与分类未变，仅微调排序或高级参数：在当前结果页就地刷新
                  setSort(params.sort)
                  setAdvancedParams(params)
                } else {
                  // 关键词变更、分类变更，或处于根搜索页：发起新的搜索页面压栈
                  pushSearchResults(
                    trimmedWord,
                    params.scope,
                    params.sort,
                    params
                  )
                }
              }}
              onCancel={() => setIsAdvancedSheetOpen(false)}
            />
          ),
        }}
        toolbar={searchToolbar({
          scope,
          hideNovels,
          isAppleMusic,
          isCompact,
          isSplitViewActive,
          isFullScreenPad,
          submitted,
          hideClose: isResultsPage,
          onClose: props.onClose ?? (() => {}),
          onScopeChange: handleScopeChange,
          sort,
          onSortChange: selectSort,
          hasAdvancedFilters:
            advancedParams.bookmarkThreshold > 0 ||
            Boolean(
              advancedParams.useDateRange &&
                (advancedParams.startDate || advancedParams.startTimestamp)
            ) ||
            (advancedParams.mediaFilter &&
              advancedParams.mediaFilter !== "all" &&
              scope === "illust") ||
            (scope === "novel"
              ? advancedParams.target === "keyword" ||
                advancedParams.target === "text"
              : advancedParams.target === "title_and_caption") ||
            Boolean(loadSettings().showR18 && advancedParams.includeR18 === false) ||
            Boolean(
              loadSettings().showR18 &&
                loadSettings().showR18G &&
                advancedParams.includeR18G === false
            ) ||
            Boolean(loadSettings().showAI && advancedParams.includeAI === false),
          onAdvanced: () => {
            setIsAdvancedSheetOpen(true)
          },
        })}
        searchable={{
          value: query,
          onChanged: onQueryChanged,
          placement: isResultsPage
            ? "navigationBarDrawerAutomaticDisplay"
            : "navigationBarDrawerAlwaysDisplay",
          prompt: "输入关键词",
          presented: {
            value: searchPresented,
            onChanged: (val: boolean) => {
              setSearchPresented(val)
              if (!val) {
                setQuery("")
                setTagSuggestions([])
                setUserSuggestions([])
                setTagSuggestionsLoading(false)
                setUserSuggestionsLoading(false)
              }
            },
          },
        }}
        onSubmit={{ triggers: "search" as const, action: () => submitSearch(query) }}
        submitLabel="search"
        background={ambientBackground}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        {(["illust", "novel", "user"] as const).map((s) => {
          if (!visitedScopes.has(s)) return null
          const isCurrent = scope === s
          return (
            <VStack
              key={s}
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
              opacity={isCurrent ? 1 : 0}
              zIndex={isCurrent ? 1 : 0}
              allowsHitTesting={isCurrent}
            >
              {renderScopeScrollFeed(s)}
            </VStack>
          )
        })}

        {/* 2. 顶层搜索历史与联想建议浮动毛玻璃卡片（输入框聚焦时出现：未打字展示历史，打字展示联想词） */}
        {searchPresented && scope !== "user" && (
          query.trim().length > 0
            ? (tagSuggestions.length > 0 || directTargets.length > 0)
            : (!Device.isiPad && historyItems.length > 0)
        ) ? (
          <ScrollView
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            padding={{ horizontal: 8, top: 1, bottom: 4 }}
            zIndex={10}
          >
            <VStack
              spacing={0}
              glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}
              clipShape={{ type: "rect", cornerRadius: 14 }}
              shadow={{ color: "#00000028", radius: 10, y: 3 }}
              frame={{ maxWidth: "infinity" }}
            >
              {/* 分支 A：尚未输入关键词，展示搜索历史记录（仅 iPhone） */}
              {!Device.isiPad && !query.trim() && historyItems.length > 0 ? (
                <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
                  <HStack alignment="center" spacing={6} padding={{ horizontal: 14, top: 12, bottom: 8 }}>
                    <Image systemName="clock.arrow.circlepath" font="caption" foregroundStyle="secondaryLabel" />
                    <Text font="caption" fontWeight="semibold" foregroundStyle="secondaryLabel">搜索历史</Text>
                    <Spacer />
                    <Button
                      buttonStyle="plain"
                      action={async () => {
                        try { triggerHaptic("heavy") } catch {}
                        let confirmed = false
                        try {
                          if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
                            confirmed = await Dialog.confirm({
                              title: "清空搜索历史",
                              message: "确定要清空全部搜索历史吗？",
                              confirmLabel: "清空",
                              cancelLabel: "取消",
                            })
                          } else {
                            confirmed = true
                          }
                        } catch {
                          confirmed = true
                        }
                        if (confirmed) {
                          clearSearchHistory(scope)
                          setHistoryItems([])
                        }
                      }}
                    >
                      <HStack alignment="center" spacing={4}>
                        <Image systemName="trash" font="caption" foregroundStyle="systemRed" />
                        <Text font="caption" fontWeight="semibold" foregroundStyle="systemRed">清空</Text>
                      </HStack>
                    </Button>
                  </HStack>
                  <Divider />
                  {historyItems.map((entry, index) => {
                    const trans = entry.translatedName || getTagTranslation(entry.query)
                    return (
                      <VStack key={`hist-${entry.query}-${index}`} spacing={0} frame={{ maxWidth: "infinity" }}>
                        {index > 0 ? <Divider /> : null}
                        <HStack alignment="center" spacing={0} frame={{ maxWidth: "infinity" }}>
                          {/* 点击历史条目：直接提交搜索 */}
                          <Button
                            buttonStyle="plain"
                            action={() => {
                              try { triggerHaptic("selection") } catch {}
                              submitSearch(entry.query, trans)
                            }}
                            contentShape="rect"
                            frame={{ maxWidth: "infinity", alignment: "leading" }}
                          >
                            <HStack
                              alignment="center"
                              spacing={10}
                              padding={{ horizontal: 14, vertical: 10 }}
                              frame={{ maxWidth: "infinity", alignment: "leading" }}
                              contentShape="rect"
                            >
                              <Image
                                systemName="clock"
                                font="subheadline"
                                foregroundStyle="secondaryLabel"
                              />
                              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                                <Text font="body" foregroundStyle="label" lineLimit={1}>
                                  {entry.query}
                                </Text>
                                {trans ? (
                                  <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                                    {trans}
                                  </Text>
                                ) : null}
                              </VStack>
                              <Spacer />
                            </HStack>
                          </Button>

                          {/* 单项删除按钮 */}
                          <Button
                            buttonStyle="plain"
                            contentShape="rect"
                            action={() => {
                              try { triggerHaptic("light") } catch {}
                              removeSearchHistory(entry.query, scope)
                              setHistoryItems(getSearchHistoryEntries(scope))
                            }}
                          >
                            <HStack alignment="center" padding={{ horizontal: 10, vertical: 12 }}>
                              <Image
                                systemName="xmark.circle"
                                font="subheadline"
                                foregroundStyle="tertiaryLabel"
                              />
                            </HStack>
                          </Button>

                          {/* 点击右侧角标：仅补全填入输入框 */}
                          <Button
                            buttonStyle="plain"
                            action={() => {
                              try { triggerHaptic("selection") } catch {}
                              setQuery(entry.query + " ")
                            }}
                            contentShape="rect"
                          >
                            <HStack alignment="center" padding={{ leading: 4, trailing: 14, vertical: 12 }}>
                              <Image
                                systemName="arrow.up.left"
                                font="caption"
                                foregroundStyle="tertiaryLabel"
                              />
                            </HStack>
                          </Button>
                        </HStack>
                      </VStack>
                    )
                  })}
                </VStack>
              ) : null}

              {/* 分支 B：输入了关键词，展示精准直达与官方联想建议词 */}
              {query.trim().length > 0 ? (
                <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
                  {/* 精准直达项（若有纯数字 ID 或路由直达） */}
                  {directTargets.map((target, idx) => {
                    const routeValue =
                      target.type === "novelSeries"
                        ? `novelSeries:${target.id}`
                        : target.type === "mangaSeries"
                          ? `mangaSeries:${target.id}`
                          : `${target.type}:${target.id}`
                    return (
                      <VStack key={`direct-${idx}`} spacing={0} frame={{ maxWidth: "infinity" }}>
                        {idx > 0 ? <Divider /> : null}
                        <AppNavigationLink
                          value={routeValue}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                          contentShape="rect"
                          onTap={() => {
                            addSearchHistory(query.trim(), scope)
                          }}
                        >
                          <HStack
                            alignment="center"
                            spacing={12}
                            padding={{ horizontal: 14, vertical: 11 }}
                            frame={{ maxWidth: "infinity", alignment: "leading" }}
                            contentShape="rect"
                          >
                            <ZStack
                              alignment="center"
                              frame={{ width: 28, height: 28 }}
                              glassEffect={appGlass("circle")}
                              contentShape="circle"
                            >
                              <Image
                                systemName={target.icon}
                                font="caption"
                                foregroundStyle={(target.color ?? "systemBlue") as any}
                              />
                            </ZStack>
                            <VStack alignment="leading" spacing={2}>
                              <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
                                {target.title}
                              </Text>
                              {target.subtitle ? (
                                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                                  {target.subtitle}
                                </Text>
                              ) : null}
                            </VStack>
                            <Spacer />
                            <Image systemName="chevron.right" font="caption2" foregroundStyle="tertiaryLabel" />
                          </HStack>
                        </AppNavigationLink>
                      </VStack>
                    )
                  })}

                  {/* 标签提示词列表：完整自然展开，不设截断限制 */}
                  {tagSuggestions.map((item, index) => (
                    <VStack key={`${item.name}-${index}`} spacing={0} frame={{ maxWidth: "infinity" }}>
                      {(index > 0 || directTargets.length > 0) ? <Divider /> : null}
                      <HStack alignment="center" spacing={0} frame={{ maxWidth: "infinity" }}>
                        {/* 点击行主体：直接提交搜索 */}
                        <Button
                          buttonStyle="plain"
                          action={() => {
                            try {
                              triggerHaptic("selection")
                            } catch {}
                            submitSearch(item.name, item.translated_name)
                          }}
                          contentShape="rect"
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                        >
                          <HStack
                            alignment="center"
                            spacing={10}
                            padding={{ horizontal: 14, vertical: 10 }}
                            frame={{ maxWidth: "infinity", alignment: "leading" }}
                            contentShape="rect"
                          >
                            <Image
                              systemName="magnifyingglass"
                              font="subheadline"
                              foregroundStyle="secondaryLabel"
                            />
                            <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                              <Text font="body" foregroundStyle="label" lineLimit={1}>
                                {item.name}
                              </Text>
                              {item.translated_name ? (
                                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                                  {item.translated_name}
                                </Text>
                              ) : null}
                            </VStack>
                            <Spacer />
                          </HStack>
                        </Button>

                        {/* 点击右侧角标：仅补全填入输入框，不提交搜索 */}
                        <Button
                          buttonStyle="plain"
                          action={() => {
                            try {
                              triggerHaptic("selection")
                            } catch {}
                            setQuery(item.name + " ")
                          }}
                          contentShape="rect"
                        >
                          <HStack alignment="center" padding={{ horizontal: 14, vertical: 12 }}>
                            <Image
                              systemName="arrow.up.left"
                              font="caption"
                              foregroundStyle="tertiaryLabel"
                            />
                          </HStack>
                        </Button>
                      </HStack>
                    </VStack>
                  ))}
                </VStack>
              ) : null}
            </VStack>
          </ScrollView>
        ) : null}
      </ZStack>
  )
}

function searchToolbar(props: {
  scope: SearchScope
  hideNovels: boolean
  isAppleMusic?: boolean
  isCompact?: boolean
  isSplitViewActive?: boolean
  isFullScreenPad?: boolean
  submitted?: string
  hasAdvancedFilters?: boolean
  hideClose?: boolean
  onClose: () => void
  onScopeChange: (scope: SearchScope) => void
  sort: SearchSort
  onSortChange: (sort: SearchSort) => void
  onAdvanced: () => void
}) {
  const layoutMetrics = useLayoutMetrics()
  const isCompact = props.isCompact ?? layoutMetrics.isCompact
  const isClassic = !props.isAppleMusic
  const scopeLabel =
    props.scope === "illust"
      ? "插画·漫画"
      : props.scope === "novel"
        ? "小说"
        : "用户"

  const baseTitle = props.submitted?.trim() ? props.submitted.trim() : "搜索"
  const fullTitle = `${baseTitle} · ${scopeLabel}`

  const titleNode = (
    <Text font="title2" fontWeight="bold">
      {isClassic ? fullTitle : baseTitle}
    </Text>
  )

  const menuScopeLabel =
    props.scope === "illust"
      ? "插画"
      : props.scope === "novel"
        ? "小说"
        : "用户"

  const sortLabel =
    props.sort === "date_desc"
      ? "最新"
      : props.sort === "popular_desc"
        ? "热门"
        : "最早"

  const isUserScope = props.scope === "user"
  const isFullScreenPad = props.isFullScreenPad ?? false

  const scopePicker = (
    <Picker
      title="搜索范围"
      value={props.scope}
      onChanged={(v: string) => props.onScopeChange(v as SearchScope)}
    >
      <Label tag="illust" title="插画·漫画" systemImage="photo" />
      {!props.hideNovels && (
        <Label tag="novel" title="小说" systemImage="book" />
      )}
      <Label tag="user" title="用户" systemImage="person.crop.circle" />
    </Picker>
  )

  const sortPicker = (
    <Picker
      title="排序方式"
      value={props.sort}
      onChanged={(value: string) => props.onSortChange(value as SearchSort)}
    >
      <Label tag="date_desc" title="最新" systemImage="clock" />
      <Label tag="popular_desc" title="热门" systemImage="flame" />
      <Label
        tag="date_asc"
        title="最早"
        systemImage="clock.arrow.circlepath"
      />
    </Picker>
  )

  const wideMenuTitle = isUserScope
    ? "用户"
    : `${menuScopeLabel} · ${sortLabel}`

  const wideMenuLabel = (
    <HStack alignment="center" spacing={4}>
      <Text font="subheadline" fontWeight="semibold">
        {wideMenuTitle}
      </Text>
      <Image
        systemName="chevron.down"
        font="caption2"
        foregroundStyle="secondaryLabel"
      />
    </HStack>
  )

  const menuIconName = props.hasAdvancedFilters
    ? "line.3.horizontal.decrease.circle.fill"
    : "ellipsis.circle"

  const menuLabel = isFullScreenPad ? wideMenuLabel : <Image systemName={menuIconName} />

  const searchMenuNode = (
    <Menu key="search-main-menu" label={menuLabel}>
      {isClassic || isFullScreenPad ? scopePicker : null}
      {!isUserScope ? sortPicker : null}
      {!isUserScope ? (
        <Button
          title="高级搜索"
          systemImage="slider.horizontal.3"
          action={props.onAdvanced}
        />
      ) : null}
    </Menu>
  )

  const trailingItems = (() => {
    if (props.isAppleMusic && isUserScope && !isFullScreenPad) return undefined
    return searchMenuNode
  })()

  return appToolbar(
    props.onClose,
    titleNode,
    trailingItems,
    undefined,
    {
      isCompact: !isFullScreenPad,
      isSplitViewActive: props.isSplitViewActive,
      hidePrincipalOnWide: isFullScreenPad || props.isSplitViewActive,
      hideClose: props.hideClose,
    }
  )
}

// -------------------- 精准 ID / 链接直达组件 --------------------

function DirectRouteSection(props: {
  targets: DirectRouteTarget[]
  onSelect?: () => void
}) {
  const { targets, onSelect } = props
  if (targets.length === 0) return null

  return (
    <VStack alignment="leading" spacing={8} padding={{ horizontal: 8 }} frame={{ maxWidth: "infinity" }}>
      <VStack
        spacing={0}
        glassEffect={appGlass({ type: "rect", cornerRadius: 12 })}
        clipShape={{ type: "rect", cornerRadius: 12 }}
        frame={{ maxWidth: "infinity" }}
      >
        {targets.map((target, index) => {
          const routeValue =
            target.type === "novelSeries"
              ? `novelSeries:${target.id}`
              : target.type === "mangaSeries"
                ? `mangaSeries:${target.id}`
                : `${target.type}:${target.id}`

          return (
            <VStack key={`${target.type}-${target.id}`} spacing={0} frame={{ maxWidth: "infinity" }}>
              {index > 0 ? <Divider /> : null}
              <AppNavigationLink
                value={routeValue}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                contentShape="rect"
                onTap={onSelect}
              >
                <HStack
                  alignment="center"
                  spacing={12}
                  padding={{ horizontal: 14, vertical: 11 }}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                  contentShape="rect"
                >
                  <ZStack
                    alignment="center"
                    frame={{ width: 32, height: 32 }}
                    glassEffect={appGlass("circle")}
                    contentShape="circle"
                  >
                    <Image
                      systemName={target.icon}
                      font="body"
                      foregroundStyle={(target.color ?? "systemBlue") as any}
                    />
                  </ZStack>
                  <VStack alignment="leading" spacing={2}>
                    <Text font="body" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
                      {target.title}
                    </Text>
                    {target.subtitle ? (
                      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                        {target.subtitle}
                      </Text>
                    ) : null}
                  </VStack>
                  <Spacer />
                  <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" />
                </HStack>
              </AppNavigationLink>
            </VStack>
          )
        })}
      </VStack>
    </VStack>
  )
}

// -------------------- 搜索提示词组件（插画漫画/小说：官方样式） --------------------

function TagSuggestionsSection(props: {
  suggestions: PixivAutocompleteTag[]
  loading: boolean
  onSelect: (tag: string) => void
}) {
  const { suggestions, loading, onSelect } = props

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ horizontal: 8, bottom: Math.round(loadSettings().feedBottomInset / 2) }}
    >
      {loading && suggestions.length === 0 ? (
        <LoadingView />
      ) : suggestions.length === 0 ? (
        <VStack
          alignment="center"
          spacing={8}
          padding={{ vertical: 36 }}
          frame={{ maxWidth: "infinity" }}
        >
          <Text font="subheadline" foregroundStyle="tertiaryLabel">
            未找到相关提示词
          </Text>
        </VStack>
      ) : (
        <VStack
          spacing={0}
          glassEffect={appGlass({ type: "rect", cornerRadius: 12 })}
          clipShape={{ type: "rect", cornerRadius: 12 }}
          frame={{ maxWidth: "infinity" }}
        >
          {suggestions.map((item, index) => (
            <VStack key={`${item.name}-${index}`} spacing={0} frame={{ maxWidth: "infinity" }}>
              {index > 0 ? <Divider /> : null}
              <Button
                buttonStyle="plain"
                action={() => onSelect(item.name)}
                contentShape="rect"
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                <HStack
                  alignment="center"
                  spacing={10}
                  padding={{ horizontal: 14, vertical: 12 }}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                  contentShape="rect"
                >
                  <Image
                    systemName="magnifyingglass"
                    font="subheadline"
                    foregroundStyle="secondaryLabel"
                  />
                  <Text font="body" foregroundStyle="label" lineLimit={1}>
                    {item.name}
                  </Text>
                  {item.translated_name ? (
                    <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {`（${item.translated_name}）`}
                    </Text>
                  ) : null}
                  <Spacer />
                </HStack>
              </Button>
            </VStack>
          ))}
        </VStack>
      )}
    </VStack>
  )
}

// -------------------- 搜索提示词组件（用户：复用我方样式 + 官方数据） --------------------

function UserSuggestionsSection(props: {
  items: UserItem[]
  loading: boolean
  hideNovels?: boolean
}) {
  const { items, loading, hideNovels } = props

  if (loading && items.length === 0) {
    return <LoadingView />
  }

  if (items.length === 0) {
    return (
      <VStack
        alignment="center"
        spacing={8}
        padding={{ vertical: 48 }}
        frame={{ maxWidth: "infinity" }}
      >
        <Image
          systemName="person.crop.circle.badge.questionmark"
          font="largeTitle"
          foregroundStyle="tertiaryLabel"
        />
        <Text font="subheadline" foregroundStyle="tertiaryLabel">
          未找到相关用户
        </Text>
      </VStack>
    )
  }

  return (
    <LazyVStack
      alignment="leading"
      spacing={8}
      padding={{ horizontal: 8, bottom: Math.round(loadSettings().feedBottomInset / 2) }}
    >
      {items.map((preview, index) => (
        <ConnectionRow
          key={preview.user.id}
          preview={preview}
          showFollowControl={preview.user.id !== session.userID}
          hideNovels={hideNovels}
          priority={index}
        />
      ))}
    </LazyVStack>
  )
}

// -------------------- 搜索记录组件（iOS 现代卡片设计） --------------------

function SearchHistoryItem(props: {
  entry: SearchHistoryEntry
  onSelect: (entry: SearchHistoryEntry) => void
  onRemove: (entry: SearchHistoryEntry) => void
  onFillQuery?: (query: string) => void
}) {
  const { entry, onSelect, onRemove, onFillQuery } = props
  const trans = entry.translatedName || getTagTranslation(entry.query)

  return (
    <HStack alignment="center" spacing={0} frame={{ maxWidth: "infinity" }}>
      {/* 点击历史条目：直接提交搜索 */}
      <Button
        buttonStyle="plain"
        action={() => {
          try {
            triggerHaptic("selection")
          } catch {}
          onSelect(entry)
        }}
        contentShape="rect"
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <HStack
          alignment="center"
          spacing={10}
          padding={{ horizontal: 14, vertical: 10 }}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          contentShape="rect"
        >
          <Image
            systemName="clock"
            font="subheadline"
            foregroundStyle="secondaryLabel"
          />
          <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font="body" foregroundStyle="label" lineLimit={1}>
              {entry.query}
            </Text>
            {trans ? (
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                {trans}
              </Text>
            ) : null}
          </VStack>
          <Spacer />
        </HStack>
      </Button>

      {/* 单项删除按钮 */}
      <Button
        buttonStyle="plain"
        contentShape="rect"
        action={() => {
          try {
            triggerHaptic("light")
          } catch {}
          onRemove(entry)
        }}
      >
        <HStack alignment="center" padding={{ horizontal: 10, vertical: 12 }}>
          <Image
            systemName="xmark.circle"
            font="subheadline"
            foregroundStyle="tertiaryLabel"
          />
        </HStack>
      </Button>

      {/* 点击右侧角标：仅补全填入输入框 */}
      {onFillQuery ? (
        <Button
          buttonStyle="plain"
          action={() => {
            try {
              triggerHaptic("selection")
            } catch {}
            onFillQuery(entry.query + " ")
          }}
          contentShape="rect"
        >
          <HStack alignment="center" padding={{ leading: 4, trailing: 14, vertical: 12 }}>
            <Image
              systemName="arrow.up.left"
              font="caption"
              foregroundStyle="tertiaryLabel"
            />
          </HStack>
        </Button>
      ) : null}
    </HStack>
  )
}

function SearchHistorySection(props: {
  entries: SearchHistoryEntry[]
  isDoubleColumn?: boolean
  hideIfEmpty?: boolean
  bottomInset?: number
  onSelect: (entry: SearchHistoryEntry) => void
  onRemove: (entry: SearchHistoryEntry) => void
  onClear: () => void
  onFillQuery?: (query: string) => void
}) {
  const {
    entries,
    isDoubleColumn = false,
    hideIfEmpty = true,
    bottomInset = 0,
    onSelect,
    onRemove,
    onClear,
    onFillQuery,
  } = props

  if (hideIfEmpty && entries.length === 0) {
    return null
  }

  const handleClear = async () => {
    try {
      triggerHaptic("heavy")
    } catch {}
    let confirmed = false
    try {
      if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
        confirmed = await Dialog.confirm({
          title: "清空搜索历史",
          message: "确定要清空全部搜索历史吗？",
          confirmLabel: "清空",
          cancelLabel: "取消",
        })
      } else {
        confirmed = true
      }
    } catch {
      confirmed = true
    }
    if (confirmed) {
      onClear()
    }
  }

  const pairs: [SearchHistoryEntry, SearchHistoryEntry?][] = []
  if (isDoubleColumn) {
    for (let i = 0; i < entries.length; i += 2) {
      pairs.push([entries[i], entries[i + 1]])
    }
  }

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ horizontal: 8, top: 1, bottom: bottomInset }}
      frame={{ maxWidth: "infinity" }}
    >
      <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }} padding={{ horizontal: 4, vertical: 4 }}>
        <HStack alignment="center" spacing={6}>
          <Image systemName="clock.arrow.circlepath" font="caption" foregroundStyle="secondaryLabel" />
          <Text font="caption" fontWeight="semibold" foregroundStyle="secondaryLabel">
            搜索历史
          </Text>
        </HStack>
        <Spacer />
        {entries.length > 0 ? (
          <Button
            buttonStyle="plain"
            action={() => void handleClear()}
          >
            <HStack alignment="center" spacing={4} padding={{ horizontal: 6, vertical: 4 }}>
              <Image
                systemName="trash"
                font="caption"
                foregroundStyle="systemRed"
              />
              <Text font="caption" fontWeight="semibold" foregroundStyle="systemRed">
                清空
              </Text>
            </HStack>
          </Button>
        ) : null}
      </HStack>

      {entries.length === 0 ? null : (
        <VStack
          spacing={0}
          glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}
          clipShape={{ type: "rect", cornerRadius: 14 }}
          frame={{ maxWidth: "infinity" }}
        >
          {isDoubleColumn
            ? pairs.map((pair, rowIndex) => (
                <VStack key={`pair-${rowIndex}`} spacing={0} frame={{ maxWidth: "infinity" }}>
                  {rowIndex > 0 ? <Divider /> : null}
                  <HStack alignment="center" spacing={0} frame={{ maxWidth: "infinity" }}>
                    <VStack frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <SearchHistoryItem
                        entry={pair[0]}
                        onSelect={onSelect}
                        onRemove={onRemove}
                        onFillQuery={onFillQuery}
                      />
                    </VStack>
                    <Divider />
                    {pair[1] ? (
                      <VStack frame={{ maxWidth: "infinity", alignment: "leading" }}>
                        <SearchHistoryItem
                          entry={pair[1]}
                          onSelect={onSelect}
                          onRemove={onRemove}
                          onFillQuery={onFillQuery}
                        />
                      </VStack>
                    ) : (
                      <Spacer frame={{ maxWidth: "infinity" }} />
                    )}
                  </HStack>
                </VStack>
              ))
            : entries.map((entry, index) => (
                <VStack key={`${entry.query}-${index}`} spacing={0} frame={{ maxWidth: "infinity" }}>
                  {index > 0 ? <Divider /> : null}
                  <SearchHistoryItem
                    entry={entry}
                    onSelect={onSelect}
                    onRemove={onRemove}
                    onFillQuery={onFillQuery}
                  />
                </VStack>
              ))}
        </VStack>
      )}
    </VStack>
  )
}

// -------------------- 热门标签组件（官方样式 + SwiftUI 液态玻璃） --------------------

function TrendingHeroBanner(props: {
  item: PixivTrendingTag
  onSelect: (tag: string) => void
}) {
  const { item, onSelect } = props
  const { width: screenWidth } = useLayoutMetrics()
  const heroUrl = trendingTagHeroUrl(item)
  const bannerWidth = Math.max(0, screenWidth - 16)
  const bannerHeight = Math.floor(bannerWidth * (9 / 16))
  const targetId = item.illust?.id ?? item.novel?.id
  const targetType = item.novel ? "novel" : "illust"
  const targetRoute = targetId ? `${targetType}:${targetId}` : ""

  return (
    <Button
      buttonStyle="plain"
      action={() => onSelect(item.tag)}
      frame={{ width: bannerWidth, height: bannerHeight }}
      contextMenu={{
        menuItems: (
          <Group>
            {targetRoute ? (
              <Button
                title={targetType === "novel" ? "查看小说" : "查看作品"}
                systemImage={targetType === "novel" ? "book" : "photo"}
                action={() => {
                  if (item.illust?.id && (item.illust as any).image_urls) {
                    cacheIllust(item.illust as any)
                  }
                  requestPixivRoute(targetRoute, "search")
                }}
              />
            ) : null}
            <Button
              title="复制标签"
              systemImage="doc.on.doc"
              action={() => {
                if (typeof Pasteboard !== "undefined") {
                  void Pasteboard.setString(item.tag)
                }
                triggerHaptic("light")
              }}
            />
          </Group>
        ),
      }}
    >
      <ZStack
        alignment="bottom"
        clipShape={{ type: "rect", cornerRadius: 16 }}
        frame={{ width: bannerWidth, height: bannerHeight }}
      >
        <CachedImage
          url={heroUrl}
          aspectRatioValue={16 / 9}
          centerCropAspect={16 / 9}
          useIntrinsicAspectRatio={false}
          contentMode="fill"
          cornerRadius={16}
          frame={{ width: bannerWidth, height: bannerHeight }}
        />
        {/* 文本置底与渐变衬底 */}
        <VStack
          alignment="center"
          spacing={4}
          padding={{ horizontal: 16, top: 28, bottom: 12 }}
          frame={{ width: bannerWidth }}
          background={{
            colors: ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.8)"],
            startPoint: "top",
            endPoint: "bottom",
          }}
        >
          <Text
            font="title2"
            fontWeight="bold"
            foregroundStyle="white"
            lineLimit={1}
            multilineTextAlignment="center"
          >
            {`#${item.tag}`}
          </Text>
          {item.translated_name ? (
            <Text
              font="subheadline"
              fontWeight="medium"
              foregroundStyle="rgba(255, 255, 255, 0.9)"
              lineLimit={1}
              multilineTextAlignment="center"
            >
              {item.translated_name}
            </Text>
          ) : null}
        </VStack>
      </ZStack>
    </Button>
  )
}

function TrendingGridCard(props: {
  item: PixivTrendingTag
  side: number
  onSelect: (tag: string) => void
}) {
  const { item, side, onSelect } = props
  const thumbUrl = trendingTagThumbUrl(item)
  const targetId = item.illust?.id ?? item.novel?.id
  const targetType = item.novel ? "novel" : "illust"
  const targetRoute = targetId ? `${targetType}:${targetId}` : ""

  return (
    <Button
      buttonStyle="plain"
      action={() => onSelect(item.tag)}
      frame={{ width: side, height: side }}
      contextMenu={{
        menuItems: (
          <Group>
            {targetRoute ? (
              <Button
                title={targetType === "novel" ? "查看小说" : "查看作品"}
                systemImage={targetType === "novel" ? "book" : "photo"}
                action={() => {
                  if (item.illust?.id && (item.illust as any).image_urls) {
                    cacheIllust(item.illust as any)
                  }
                  requestPixivRoute(targetRoute, "search")
                }}
              />
            ) : null}
            <Button
              title="复制标签"
              systemImage="doc.on.doc"
              action={() => {
                if (typeof Pasteboard !== "undefined") {
                  void Pasteboard.setString(item.tag)
                }
                triggerHaptic("light")
              }}
            />
          </Group>
        ),
      }}
    >
      <ZStack
        alignment="bottom"
        clipShape={{ type: "rect", cornerRadius: 10 }}
        frame={{ width: side, height: side }}
      >
        <CachedImage
          url={thumbUrl}
          aspectRatioValue={1}
          centerCropSquare={true}
          useIntrinsicAspectRatio={false}
          contentMode="fill"
          cornerRadius={10}
          frame={{ width: side, height: side }}
        />
        {/* 文本置底与渐变衬底（不加全图模糊，保持背景清晰） */}
        <VStack
          alignment="center"
          spacing={2}
          padding={{ horizontal: 4, top: 16, bottom: 6 }}
          frame={{ width: side }}
          background={{
            colors: ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.78)"],
            startPoint: "top",
            endPoint: "bottom",
          }}
        >
          <Text
            font="caption"
            fontWeight="bold"
            foregroundStyle="white"
            lineLimit={2}
            multilineTextAlignment="center"
          >
            {`#${item.tag}`}
          </Text>
          {item.translated_name ? (
            <Text
              font="caption2"
              foregroundStyle="rgba(255, 255, 255, 0.88)"
              lineLimit={1}
              multilineTextAlignment="center"
            >
              {item.translated_name}
            </Text>
          ) : null}
        </VStack>
      </ZStack>
    </Button>
  )
}

function TrendingSection(props: {
  tags: PixivTrendingTag[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onSelect: (tag: string, translatedName?: string | null) => void
}) {
  const { tags, loading, error, onRetry, onSelect } = props
  const { width: screenWidth } = useLayoutMetrics()
  const heroTag = tags[0]
  // 取 3 的倍数项，去除多余的单个尾项，确保网格每一行都是完整的 3 列
  const gridCount = Math.floor((tags.length - 1) / 3) * 3
  const gridTags = tags.slice(1, 1 + gridCount)

  const cardSide = Math.max(0, Math.floor((screenWidth - 16 - 8) / 3))
  const rows = useMemo(() => chunk(gridTags, 3), [gridTags])

  if (loading && tags.length === 0) {
    return <LoadingView />
  }

  if (error && tags.length === 0) {
    return <ErrorView message={error} onRetry={onRetry} />
  }

  if (tags.length === 0) {
    return <EmptyView text="暂无热门标签" systemImage="tag" />
  }

  return (
    <VStack
      alignment="center"
      spacing={8}
      padding={{ horizontal: 8, top: 1, bottom: Math.round(loadSettings().feedBottomInset / 2) }}
    >
      {heroTag ? (
        <TrendingHeroBanner
          item={heroTag}
          onSelect={(tag) => onSelect(tag, heroTag.translated_name)}
        />
      ) : null}
      <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
        {rows.map((row, rowIndex) => (
          <HStack key={`row-${rowIndex}`} spacing={4} frame={{ maxWidth: "infinity" }}>
            {row.map((tag) => (
              <TrendingGridCard
                key={tag.tag}
                item={tag}
                side={cardSide}
                onSelect={(selectedTag) => onSelect(selectedTag, tag.translated_name)}
              />
            ))}
            {row.length < 3
              ? Array.from({ length: 3 - row.length }).map((_, i) => (
                  <Spacer
                    key={`spacer-${i}`}
                    frame={{ width: cardSide, height: cardSide }}
                  />
                ))
              : null}
          </HStack>
        ))}
      </VStack>
    </VStack>
  )
}

// -------------------- 推荐用户与用户结果列表（复用我的关注页样式） --------------------

function RecommendedUsersSection(props: {
  paged: ReturnType<typeof usePagedList<UserItem>>
  hideNovels?: boolean
}) {
  const { paged, hideNovels } = props
  const tail = paged.items[paged.items.length - 1]

  if (paged.initialLoading && paged.items.length === 0) {
    return <LoadingView />
  }

  if (paged.error && paged.items.length === 0) {
    return <ErrorView message={paged.error} onRetry={paged.refresh} />
  }

  if (paged.items.length === 0) {
    return <EmptyView text="暂无推荐用户" systemImage="person.crop.circle" />
  }

  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 8 }}>
      {paged.items.map((preview, index) => (
        <ConnectionRow
          key={preview.user.id}
          preview={preview}
          showFollowControl={preview.user.id !== session.userID}
          hideNovels={hideNovels}
          priority={index}
        />
      ))}
      {tail ? (
        <LoadMoreTrigger
          anchor={tail.user.id}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
          loadMoreError={paged.loadMoreError}
          onRetry={paged.retryLoadMore}
        />
      ) : null}
    </LazyVStack>
  )
}

function UserResults(props: {
  paged: ReturnType<typeof usePagedList<UserItem>>
  hideNovels?: boolean
}) {
  const { paged, hideNovels } = props
  const tail = paged.items[paged.items.length - 1]

  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 8 }}>
      {paged.items.map((preview, index) => (
        <ConnectionRow
          key={preview.user.id}
          preview={preview}
          showFollowControl={preview.user.id !== session.userID}
          hideNovels={hideNovels}
          priority={index}
        />
      ))}
      {tail ? (
        <LoadMoreTrigger
          anchor={tail.user.id}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
          loadMoreError={paged.loadMoreError}
          onRetry={paged.retryLoadMore}
        />
      ) : null}
    </LazyVStack>
  )
}

function NovelResults(props: {
  items: PixivNovel[]
  loadingMore: boolean
  loadMoreError?: string | null
  hasMore: boolean
  onLoadMore: (anchor?: number | string) => void
  onRetry?: () => void
}) {
  const lastNovel = props.items[props.items.length - 1]
  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 8 }}>
      {props.items.map((novel, index) => (
        <NovelCard key={novel.id} novel={novel} priority={index} />
      ))}
      {lastNovel ? (
        <LoadMoreTrigger
          anchor={lastNovel.id}
          onLoadMore={props.onLoadMore}
          hasMore={props.hasMore}
          isLoading={props.loadingMore}
          loadMoreError={props.loadMoreError}
          onRetry={props.onRetry}
        />
      ) : null}
    </LazyVStack>
  )
}
