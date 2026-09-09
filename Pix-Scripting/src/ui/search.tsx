import {
  Button,
  Device,
  Divider,
  Group,
  HStack,
  Image,
  Label,
  LazyVStack,
  List,
  Menu,
  NavigationLink,
  Picker,
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
import { useIsCurrentTab } from "./routeNavigation"
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
  getSearchHistory,
  onSearchHistoryChanged,
  removeSearchHistory,
} from "../store/searchHistory"
import { destinationElement } from "./routes"
import { requestPixivRoute, setActiveTabKind } from "./routeNavigation"

declare const Pasteboard: any
import { triggerHaptic } from "../utils/haptics"
import {
  currentBatchSize,
  dedupeByID,
  useDebouncedCallback,
  useLatest,
  usePagedList,
  useLayoutMetrics,
} from "./hooks"
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
import {
  categoryFromParams,
  getDefaultAdvancedSearchParams,
  SearchAdvancedSheet,
} from "./searchAdvancedSheet"
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
        color: "#007AFF",
      })
      targets.push({
        type: "user",
        id,
        title: `访问画师主页`,
        subtitle: `UID: ${id}`,
        icon: "person.circle",
        color: "#34C759",
      })
      if (!hideNovels) {
        targets.push({
          type: "novel",
          id,
          title: `查看小说`,
          subtitle: `UID: ${id}`,
          icon: "book.closed",
          color: "#FF9500",
        })
      }
    } else if (scope === "novel") {
      targets.push({
        type: "novel",
        id,
        title: `查看小说`,
        subtitle: `UID: ${id}`,
        icon: "book.closed",
        color: "#FF9500",
      })
      targets.push({
        type: "illust",
        id,
        title: `查看插画 / 漫画`,
        subtitle: `PID: ${id}`,
        icon: "photo.stack",
        color: "#007AFF",
      })
      targets.push({
        type: "user",
        id,
        title: `访问画师主页`,
        subtitle: `UID: ${id}`,
        icon: "person.circle",
        color: "#34C759",
      })
    } else {
      targets.push({
        type: "user",
        id,
        title: `访问画师主页`,
        subtitle: `UID: ${id}`,
        icon: "person.circle",
        color: "#34C759",
      })
      targets.push({
        type: "illust",
        id,
        title: `查看插画 / 漫画`,
        subtitle: `PID: ${id}`,
        icon: "photo.stack",
        color: "#007AFF",
      })
      if (!hideNovels) {
        targets.push({
          type: "novel",
          id,
          title: `查看小说`,
          subtitle: `UID: ${id}`,
          icon: "book.closed",
          color: "#FF9500",
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
          color: "#007AFF",
        },
      ]
    }
  }

  // 用户主页：pixiv.net/users/123456 或 pixiv.net/u/123456 或 member.php?id=123456
  const userMatch =
    trimmed.match(/(?:pixiv\.net\/(?:[a-z]{2}\/)?(?:users|u)\/|users\/)(\d+)/i) ||
    trimmed.match(/member\.php\?id=(\d+)/i)
  if (userMatch) {
    const id = parseInt(userMatch[1], 10)
    if (id > 0) {
      return [
        {
          type: "user",
          id,
          title: `直达画师主页`,
          subtitle: `UID: ${id}`,
          icon: "person.circle",
          color: "#34C759",
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
          subtitle: `UID: ${id}`,
          icon: "books.vertical",
          color: "#FF9500",
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
          subtitle: `UID: ${id}`,
          icon: "book.closed",
          color: "#FF9500",
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
          color: "#AF52DE",
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

export function SearchView(props: { onClose: () => void; active?: boolean }) {
  useEffect(() => {
    setActiveTabKind("search")
  }, [])

  const [query, setQuery] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [searchPresented, setSearchPresented] = useState(false)
  const [isSearchingMode, setIsSearchingMode] = useState(false)
  const [scope, setScope] = useState<SearchScope>("illust")
  const [sort, setSort] = useState<SearchSort>("date_desc")
  const [isAdvancedSheetOpen, setIsAdvancedSheetOpen] = useState(false)
  const [advancedParams, setAdvancedParams] = useState<AdvancedSearchParams>(() =>
    getDefaultAdvancedSearchParams(scope, query)
  )
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"
  const [visitedScopes, setVisitedScopes] = useState<Set<SearchScope>>(() => new Set([scope]))

  useEffect(() => {
    setVisitedScopes((prev) => {
      if (prev.has(scope)) return prev
      const next = new Set(prev)
      next.add(scope)
      return next
    })
  }, [scope])

  // 搜索记录
  const [historyItems, setHistoryItems] = useState<string[]>(() => getSearchHistory(scope))

  // 热门标签状态
  const [trendingIllust, setTrendingIllust] = useState<PixivTrendingTag[]>([])
  const [trendingNovel, setTrendingNovel] = useState<PixivTrendingTag[]>([])
  const [trendingIllustLoading, setTrendingIllustLoading] = useState(false)
  const [trendingNovelLoading, setTrendingNovelLoading] = useState(false)
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
      return searchIllustrations(
        {
          word: submitted,
          target: advancedParams.target || "partial_match_for_tags",
          sort,
          aiFilter: settings.showAI ? undefined : 0,
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
      let filtered = items.filter((item) => isIllustContentVisible(item, settings))
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
      return searchNovels(
        {
          word: submitted,
          target: advancedParams.target || "partial_match_for_tags",
          sort,
          aiFilter: settings.showAI ? undefined : 0,
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
      return dedupeByID(
        items.filter((novel) => isNovelContentVisible(novel, settings))
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
    setHistoryItems(getSearchHistory(scope))
    return onSearchHistoryChanged(() => {
      setHistoryItems(getSearchHistory(scope))
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
      for (const t of tags) {
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
    if (trimmed) {
      setIsSearchingMode(true)
    }
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
    setAdvancedParams((prev) => ({ ...prev, scope: newScope }))
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

  useRegisterBottomAccessory(
    "search",
    searchScopeItems.length <= 1 ? null : (
      <DockSegmentedBar
        items={searchScopeItems}
        value={scope}
        onChanged={handleScopeChange}
      />
    ),
    isAppleMusic
  )

  function submitSearch(textToSearch: string) {
    const trimmed = textToSearch.trim()
    if (!trimmed) return
    tagSeq.current += 1
    userSeq.current += 1
    debouncedTagAutocomplete.cancel()
    debouncedUserAutocomplete.cancel()
    addSearchHistory(trimmed, scope)
    setSubmitted(trimmed)
    setQuery("")
    setIsSearchingMode(true)
    setAdvancedParams((prev) => ({ ...prev, word: trimmed, scope }))
    setTagSuggestions([])
    setUserSuggestions([])
    setTagSuggestionsLoading(false)
    setUserSuggestionsLoading(false)
    setSearchPresented(false)
  }

  const activePaged =
    scope === "illust"
      ? illustPaged
      : scope === "novel"
        ? novelPaged
        : userSearchPaged

  // 实验性沉浸环境光背景
  const ambientImageUrl = useMemo(() => {
    if (submitted) {
      if (scope === "illust" && illustPaged.items[0]) {
        return cardThumbUrlOf(illustPaged.items[0])
      }
      if (scope === "novel" && novelPaged.items[0]) {
        return novelThumbUrlOf(novelPaged.items[0])
      }
      if (scope === "user" && userSearchPaged.items[0]?.user?.profile_image_urls?.medium) {
        return userSearchPaged.items[0].user.profile_image_urls.medium
      }
    } else {
      if (scope === "illust" && trendingIllust[0]) {
        return trendingTagHeroUrl(trendingIllust[0])
      }
      if (scope === "novel" && trendingNovel[0]) {
        return trendingTagHeroUrl(trendingNovel[0])
      }
      if (scope === "user" && userRecommendedPaged.items[0]?.user?.profile_image_urls?.medium) {
        return userRecommendedPaged.items[0].user.profile_image_urls.medium
      }
    }
    return null
  }, [
    submitted,
    scope,
    illustPaged.items[0]?.id,
    novelPaged.items[0]?.id,
    userSearchPaged.items[0]?.id,
    trendingIllust[0]?.tag,
    trendingNovel[0]?.tag,
    userRecommendedPaged.items[0]?.id,
  ])
  const isTabActive = useIsCurrentTab("search")
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl, isTabActive)

  const directTargets = useMemo(
    () => parseDirectRouteTargets(query, scope, hideNovels),
    [query, scope, hideNovels]
  )
  const submittedDirectTargets = useMemo(
    () => parseDirectRouteTargets(submitted, scope, hideNovels),
    [submitted, scope, hideNovels]
  )

  // 是否处于搜索提示词展示态：输入框有内容，且处于输入或查看提示词状态（未提交或键盘激活中）
  const isSuggestingActive =
    query.trim().length > 0 && (!submitted || searchPresented || isSearchingMode)

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
          } else if (!submitted && !searchPresented && !query.trim()) {
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
          {/* 1. 搜索提示词与精准直达 */}
          {isSuggestingActive ? (
            <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
              {directTargets.length > 0 ? (
                <DirectRouteSection
                  targets={directTargets}
                  onSelect={() => {
                    addSearchHistory(query.trim(), targetScope)
                  }}
                />
              ) : null}
              {targetScope === "user" ? (
                <UserSuggestionsSection
                  items={userSuggestions}
                  loading={userSuggestionsLoading}
                  hideNovels={hideNovels}
                />
              ) : (
                <TagSuggestionsSection
                  suggestions={tagSuggestions}
                  loading={tagSuggestionsLoading}
                  onSelect={submitSearch}
                />
              )}
            </VStack>
          ) : null}

          {/* 2. 搜索激活态且未输入关键词：展示搜索历史记录 */}
          {!isSuggestingActive && (isSearchingMode || searchPresented) && !submitted && !query.trim() ? (
            <SearchHistorySection
              history={historyItems}
              onSelect={submitSearch}
              onRemove={(item) => removeSearchHistory(item, targetScope)}
              onClear={() => clearSearchHistory(targetScope)}
              onBackToTrending={() => {
                setIsSearchingMode(false)
                setSearchPresented(false)
                setQuery("")
              }}
            />
          ) : null}

          {/* 3. 默认未搜索状态：展示对应分类的热门标签或推荐用户 */}
          {!isSuggestingActive && !submitted && !isSearchingMode && !searchPresented && !query.trim() ? (
            targetScope === "illust" ? (
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
            )
          ) : null}

          {/* 4. 已提交搜索：展示当前搜索结果列表 */}
          {submitted && !searchPresented ? (
            <VStack spacing={10} frame={{ maxWidth: "infinity" }}>
              <HStack
                alignment="center"
                spacing={8}
                padding={{ horizontal: 16, top: 2, bottom: 2 }}
                frame={{ maxWidth: "infinity" }}
              >
                <HStack
                  alignment="center"
                  spacing={6}
                  padding={{ horizontal: 12, vertical: 6 }}
                  glassEffect="capsule"
                  contentShape="capsule"
                >
                  <Image systemName="magnifyingglass" font="caption" foregroundStyle="secondaryLabel" />
                  <Text font="subheadline" fontWeight="medium" foregroundStyle="label" lineLimit={1}>
                    {submitted}
                  </Text>
                  <Button
                    buttonStyle="plain"
                    action={() => {
                      setSubmitted("")
                      setQuery("")
                      setIsSearchingMode(false)
                      setSearchPresented(false)
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
                    setSubmitted("")
                    setQuery("")
                    setIsSearchingMode(false)
                    setSearchPresented(false)
                  }}
                >
                  <HStack alignment="center" spacing={4}>
                    <Image systemName="arrow.uturn.backward" font="caption" foregroundStyle="#007AFF" />
                    <Text font="subheadline" foregroundStyle="#007AFF">
                      返回热门
                    </Text>
                  </HStack>
                </Button>
              </HStack>

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
                />
              ) : targetScope === "novel" ? (
                <NovelResults
                  items={novelPaged.items}
                  loadingMore={novelPaged.loadingMore}
                  hasMore={novelPaged.hasMore}
                  onLoadMore={novelPaged.loadMore}
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

  return (
    <ZStack
      navigationBarTitleDisplayMode="inline"
      toolbarBackground="clear"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      navigationDestination={destinationElement}
      sheet={{
        isPresented: isAdvancedSheetOpen,
        onChanged: (presented: boolean) => setIsAdvancedSheetOpen(presented),
        content: (
          <SearchAdvancedSheet
            currentParams={advancedParams}
            settings={loadSettings()}
            onApply={(params) => {
              setAdvancedParams(params)
              setScope(params.scope)
              setSort(params.sort)
              if (params.word.trim()) {
                setQuery(params.word.trim())
                setSubmitted(params.word.trim())
                addSearchHistory(params.word.trim(), params.scope)
              }
              setIsAdvancedSheetOpen(false)
            }}
            onCancel={() => setIsAdvancedSheetOpen(false)}
          />
        ),
      }}
      toolbar={searchToolbar({
        scope,
        hideNovels,
        isAppleMusic,
        onClose: props.onClose,
        onScopeChange: handleScopeChange,
        sort,
        onSortChange: selectSort,
        onAdvanced: () => {
          setAdvancedParams((prev) => ({
            ...prev,
            word: query.trim() || submitted || prev.word,
            scope: scope === "user" ? "illust" : scope,
            sort,
            category: categoryFromParams(
              scope === "user" ? "illust" : scope,
              prev.mediaFilter
            ),
          }))
          setIsAdvancedSheetOpen(true)
        },
      })}
      searchable={{
        value: query,
        onChanged: onQueryChanged,
        placement: "toolbar",
        prompt: "输入关键词",
        presented: {
          value: searchPresented,
          onChanged: (val: boolean) => {
            setSearchPresented(val)
            if (val) {
              setIsSearchingMode(true)
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
    </ZStack>
  )
}

function searchToolbar(props: {
  scope: SearchScope
  hideNovels: boolean
  isAppleMusic?: boolean
  onClose: () => void
  onScopeChange: (scope: SearchScope) => void
  sort: SearchSort
  onSortChange: (sort: SearchSort) => void
  onAdvanced: () => void
}) {
  const isiPad = Device.isiPad
  const isClassic = !props.isAppleMusic
  const scopeLabel =
    props.scope === "illust"
      ? "插画·漫画"
      : props.scope === "novel"
        ? "小说"
        : "用户"

  const fullTitle = `搜索 · ${scopeLabel}`

  const titleNode = (
    <Text font={isiPad ? "headline" : "title2"} fontWeight="bold">
      {isClassic ? fullTitle : "搜索"}
    </Text>
  )

  const sortLabel =
    props.sort === "date_desc"
      ? "最新"
      : props.sort === "popular_desc"
        ? "热门"
        : "最早"

  const trailingMenuLabel = isiPad ? (
    <HStack alignment="center" spacing={4}>
      <Text font="subheadline" fontWeight="semibold">
        {props.isAppleMusic ? sortLabel : scopeLabel}
      </Text>
      <Image
        systemName="chevron.down"
        font="caption2"
        foregroundStyle="secondaryLabel"
      />
    </HStack>
  ) : (
    <Image systemName="ellipsis.circle" />
  )

  return appToolbar(
    props.onClose,
    titleNode,
    <Menu label={trailingMenuLabel}>
      {isClassic && (
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
      )}
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
      <Button
        title="高级"
        systemImage="slider.horizontal.3"
        action={props.onAdvanced}
      />
    </Menu>
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
    <VStack alignment="leading" spacing={8} padding={{ horizontal: 16, top: 4, bottom: 6 }} frame={{ maxWidth: "infinity" }}>
      <VStack
        spacing={0}
        glassEffect={{ type: "rect", cornerRadius: 12 }}
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
              <NavigationLink
                value={routeValue}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                contentShape="rect"
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
                    glassEffect="circle"
                    contentShape="circle"
                  >
                    <Image
                      systemName={target.icon}
                      font="body"
                      foregroundStyle={(target.color ?? "#007AFF") as any}
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
              </NavigationLink>
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
    <VStack alignment="leading" spacing={8} padding={{ horizontal: 16, top: 4, bottom: 20 }}>
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
          glassEffect={{ type: "rect", cornerRadius: 12 }}
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
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10, bottom: 20 }}>
      {items.map((preview) => (
        <ConnectionRow
          key={preview.user.id}
          preview={preview}
          showFollowControl={preview.user.id !== session.userID}
          hideNovels={hideNovels}
        />
      ))}
    </LazyVStack>
  )
}

// -------------------- 搜索记录组件（iOS 现代卡片设计） --------------------

function SearchHistorySection(props: {
  history: string[]
  onSelect: (query: string) => void
  onRemove: (query: string) => void
  onClear: () => void
  onBackToTrending?: () => void
}) {
  const { history, onSelect, onRemove, onClear, onBackToTrending } = props

  const handleClear = async () => {
    try {
      triggerHaptic("heavy")
    } catch {}
    let confirmed = false
    try {
      if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
        confirmed = await Dialog.confirm({
          title: "清空搜索记录",
          message: "确定要清空全部搜索记录吗？",
          confirmLabel: "清空",
          cancelLabel: "取消",
        })
      }
    } catch {
      confirmed = false
    }
    if (confirmed) {
      onClear()
    }
  }

  return (
    <VStack alignment="leading" spacing={8} padding={{ horizontal: 16, top: 4, bottom: 20 }} frame={{ maxWidth: "infinity" }}>
      <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }} padding={{ horizontal: 4, vertical: 4 }}>
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
          搜索记录（{history.length}）
        </Text>
        <Spacer />
        {history.length > 0 ? (
          <Button
            buttonStyle="plain"
            action={() => void handleClear()}
          >
            <HStack alignment="center" spacing={4} padding={{ horizontal: 6, vertical: 4 }}>
              <Image
                systemName="trash"
                font="subheadline"
                fontWeight="semibold"
                foregroundStyle="#FF3B30"
              />
            </HStack>
          </Button>
        ) : null}
        {onBackToTrending ? (
          <Button
            buttonStyle="plain"
            action={onBackToTrending}
          >
            <HStack alignment="center" spacing={4} padding={{ horizontal: 6, vertical: 4 }}>
              <Image systemName="arrow.uturn.backward" font="caption" foregroundStyle="#007AFF" />
              <Text font="subheadline" foregroundStyle="#007AFF">
                返回热门
              </Text>
            </HStack>
          </Button>
        ) : null}
      </HStack>

      {history.length === 0 ? (
        <VStack
          alignment="center"
          spacing={8}
          padding={{ vertical: 36 }}
          frame={{ maxWidth: "infinity" }}
        >
          <Image systemName="clock" font="title2" foregroundStyle="tertiaryLabel" />
          <Text font="subheadline" foregroundStyle="tertiaryLabel">
            暂无搜索记录
          </Text>
        </VStack>
      ) : (
        <VStack
          spacing={0}
          glassEffect={{ type: "rect", cornerRadius: 12 }}
          clipShape={{ type: "rect", cornerRadius: 12 }}
          frame={{ maxWidth: "infinity" }}
        >
          {history.map((item, index) => (
            <VStack key={`${item}-${index}`} spacing={0} frame={{ maxWidth: "infinity" }}>
              {index > 0 ? <Divider /> : null}
              <HStack
                alignment="center"
                spacing={8}
                padding={{ horizontal: 14, vertical: 11 }}
                frame={{ maxWidth: "infinity" }}
              >
                <Button
                  buttonStyle="plain"
                  action={() => onSelect(item)}
                  contextMenu={{
                    menuItems: (
                      <Group>
                        <Button
                          title="搜索"
                          systemImage="magnifyingglass"
                          action={() => onSelect(item)}
                        />
                        <Button
                          title="复制关键词"
                          systemImage="doc.on.doc"
                          action={() => {
                            try {
                              if (typeof Pasteboard !== "undefined") {
                                void Pasteboard.setString(item)
                              }
                              triggerHaptic("selection")
                            } catch {}
                          }}
                        />
                        <Button
                          title="删除记录"
                          systemImage="trash"
                          role="destructive"
                          action={() => {
                            try {
                              triggerHaptic("medium")
                            } catch {}
                            onRemove(item)
                          }}
                        />
                      </Group>
                    ),
                  }}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                    <Image
                      systemName="magnifyingglass"
                      font="subheadline"
                      foregroundStyle="secondaryLabel"
                    />
                    <Text font="body" foregroundStyle="label" lineLimit={1}>
                      {item}
                    </Text>
                    <Spacer />
                  </HStack>
                </Button>
                <Button
                  buttonStyle="plain"
                  action={() => {
                    try {
                      triggerHaptic("medium")
                    } catch {}
                    onRemove(item)
                  }}
                >
                  <HStack
                    alignment="center"
                    padding={{ horizontal: 8, vertical: 6 }}
                  >
                    <Image
                      systemName="xmark.circle.fill"
                      font="subheadline"
                      foregroundStyle="secondaryLabel"
                    />
                  </HStack>
                </Button>
              </HStack>
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
  const bannerWidth = Math.max(0, screenWidth - 24)
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
          centerCropAspect={1}
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
  onSelect: (tag: string) => void
}) {
  const { tags, loading, error, onRetry, onSelect } = props
  const { width: screenWidth } = useLayoutMetrics()
  const heroTag = tags[0]
  // 取 3 的倍数项，去除多余的单个尾项，确保网格每一行都是完整的 3 列
  const gridCount = Math.floor((tags.length - 1) / 3) * 3
  const gridTags = tags.slice(1, 1 + gridCount)

  const cardSide = Math.max(0, Math.floor((screenWidth - 24 - 12) / 3))
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
    <VStack alignment="center" spacing={10} padding={{ horizontal: 12, bottom: 20 }}>
      {heroTag ? <TrendingHeroBanner item={heroTag} onSelect={onSelect} /> : null}
      <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
        {rows.map((row, rowIndex) => (
          <HStack key={`row-${rowIndex}`} spacing={6} frame={{ maxWidth: "infinity" }}>
            {row.map((tag) => (
              <TrendingGridCard
                key={tag.tag}
                item={tag}
                side={cardSide}
                onSelect={onSelect}
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
    return <EmptyView text="暂无推荐用户" systemImage="person.2" />
  }

  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10, bottom: 20 }}>
      {paged.items.map((preview) => (
        <ConnectionRow
          key={preview.user.id}
          preview={preview}
          showFollowControl={preview.user.id !== session.userID}
          hideNovels={hideNovels}
        />
      ))}
      {tail ? (
        <LoadMoreTrigger
          anchor={tail.user.id}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
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
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10, bottom: 20 }}>
      {paged.items.map((preview) => (
        <ConnectionRow
          key={preview.user.id}
          preview={preview}
          showFollowControl={preview.user.id !== session.userID}
          hideNovels={hideNovels}
        />
      ))}
      {tail ? (
        <LoadMoreTrigger
          anchor={tail.user.id}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
        />
      ) : null}
    </LazyVStack>
  )
}

function NovelResults(props: {
  items: PixivNovel[]
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: (anchor?: number | string) => void
}) {
  const lastNovel = props.items[props.items.length - 1]
  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10, bottom: 20 }}>
      {props.items.map((novel, index) => (
        <NovelCard key={novel.id} novel={novel} priority={index} />
      ))}
      {lastNovel ? (
        <LoadMoreTrigger
          anchor={lastNovel.id}
          onLoadMore={props.onLoadMore}
          hasMore={props.hasMore}
          isLoading={props.loadingMore}
        />
      ) : null}
    </LazyVStack>
  )
}
