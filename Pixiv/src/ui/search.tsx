import {
  Button,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  NavigationLink,
  Picker,
  ScrollView,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  nextIllustrations,
  nextNovels,
  nextUsers,
  searchAutocomplete,
  searchIllustrations,
  searchNovels,
  searchUsers,
  trendingTags,
} from "../api/pixiv"
import { session } from "../api/session"
import {
  cardThumbUrlOf,
  novelThumbUrlOf,
  prefetch,
  thumbUrlOf,
  type PrefetchHandle,
} from "../image/imageLoader"
import {
  isIllustContentVisible,
  isR18ContentVisible,
  isUserBlocked,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { destinationElement } from "./routes"
import {
  dedupeByID,
  dedupeByKey,
  mergeUniqueByID,
  mergeUniqueByKey,
  useDebouncedCallback,
  useLatest,
} from "./hooks"
import type {
  PixivIllustration,
  PixivNovel,
  PixivTrendingTag,
  PixivUserPreview,
} from "../types"
import {
  appToolbar,
  AuthorRow,
  CachedImage,
  EmptyView,
  ErrorView,
  LoadingView,
  LoadMoreTrigger,
  MasonryIllustFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

type SearchScope = "illust" | "novel" | "user"
type SearchSort = "date_desc" | "popular_desc" | "date_asc"
type SearchMode = "results" | "advanced"

type SearchResult =
  | {
      kind: "illust"
      items: PixivIllustration[]
      pendingItems: PixivIllustration[]
      nextURL: string | null
    }
  | {
      kind: "novel"
      items: PixivNovel[]
      pendingItems: PixivNovel[]
      nextURL: string | null
    }
  | { kind: "user"; items: PixivUserPreview[]; nextURL: string | null }

const UI_BATCH_SIZE = 10
const AUTOCOMPLETE_DEBOUNCE_MS = 300

export function SearchView(props: { onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [scope, setScope] = useState<SearchScope>("illust")
  const [sort, setSort] = useState<SearchSort>("date_desc")
  const [mode, setMode] = useState<SearchMode>("results")
  const [trending, setTrending] = useState<PixivTrendingTag[]>([])
  const [suggestions, setSuggestions] = useState<
    { name: string; translated_name?: string | null }[]
  >([])
  const [result, setResult] = useState<SearchResult | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const searchSeq = useRef(0)
  const loadingMoreRef = useRef(false)
  const consumedTailRef = useRef<string | null>(null)
  const searchPrefetchRef = useRef<PrefetchHandle | null>(null)
  const submittedRef = useLatest(submitted)
  const modeRef = useLatest(mode)

  function prefetchNextIllustBatch(items: PixivIllustration[]) {
    searchPrefetchRef.current?.cancel()
    searchPrefetchRef.current = prefetch(items.slice(0, UI_BATCH_SIZE).map(cardThumbUrlOf))
  }

  function prefetchNextNovelBatch(items: PixivNovel[]) {
    searchPrefetchRef.current?.cancel()
    searchPrefetchRef.current = prefetch(items.slice(0, UI_BATCH_SIZE).map(novelThumbUrlOf))
  }

  async function loadTrending() {
    try {
      const tags = await session.call((token) => trendingTags(token))
      setTrending(tags)
    } catch {
      // 热门标签加载失败不影响正常搜索。
    }
  }

  async function doSearch(word: string, keepOld = false) {
    const trimmed = word.trim()
    if (!trimmed) return
    const seq = ++searchSeq.current
    searchPrefetchRef.current?.cancel()
    consumedTailRef.current = null
    setMode("results")
    setSubmitted(trimmed)
    setSuggestions([])
    if (!keepOld) {
      setSearchLoading(true)
      setSearchError(null)
      setResult(null)
    }

    try {
      const settings = loadSettings()
      if (scope === "illust") {
        const page = await session.call((token) =>
          searchIllustrations(
            {
              word: trimmed,
              target: "partial_match_for_tags",
              sort,
              aiFilter: settings.showAI ? 0 : 1,
            },
            token
          )
        )
        if (seq !== searchSeq.current) return
        const filtered = dedupeByID(
          page.items.filter(
            (item) =>
              isIllustContentVisible(item, settings)
          )
        )
        setResult({
          kind: "illust",
          items: filtered.slice(0, UI_BATCH_SIZE),
          pendingItems: filtered.slice(UI_BATCH_SIZE),
          nextURL: page.nextURL,
        })
        prefetchNextIllustBatch(filtered.slice(UI_BATCH_SIZE))
      } else if (scope === "novel") {
        const page = await session.call((token) => searchNovels(trimmed, sort, token))
        if (seq !== searchSeq.current) return
        const filtered = dedupeByID(
          page.items.filter(
            (novel) =>
              isR18ContentVisible(
                novel.x_restrict,
                settings.showR18,
                settings.showR18G
              ) && (settings.showAI || novel.novel_ai_type !== 2)
          )
        )
        setResult({
          kind: "novel",
          items: filtered.slice(0, UI_BATCH_SIZE),
          pendingItems: filtered.slice(UI_BATCH_SIZE),
          nextURL: page.nextURL,
        })
        prefetchNextNovelBatch(filtered.slice(UI_BATCH_SIZE))
      } else {
        const page = await session.call((token) => searchUsers(trimmed, token))
        if (seq !== searchSeq.current) return
        const filtered = filterUserPreviews(page.items, settings)
        setResult({ kind: "user", items: filtered, nextURL: page.nextURL })
      }
    } catch (err: any) {
      if (seq === searchSeq.current && !keepOld) {
        setSearchError(err?.message ?? "搜索失败")
      }
    } finally {
      if (seq === searchSeq.current && !keepOld) {
        setSearchLoading(false)
        setLoadingMore(false)
        loadingMoreRef.current = false
      }
    }
  }

  async function loadMore(anchor?: number | string) {
    const current = result
    if (!current || loadingMoreRef.current) return
    const tailID =
      current.kind === "user"
        ? current.items[current.items.length - 1]?.user.id
        : current.items[current.items.length - 1]?.id
    if (tailID == null) return
    const tailKey = String(anchor ?? tailID)
    if (anchor != null && tailKey !== String(tailID)) return
    if (consumedTailRef.current === tailKey) return
    consumedTailRef.current = tailKey

    if (current.kind !== "user" && current.pendingItems.length > 0) {
      if (current.kind === "illust") {
        const illustCurrent = current as Extract<SearchResult, { kind: "illust" }>
        const batch = illustCurrent.pendingItems.slice(0, UI_BATCH_SIZE)
        prefetchNextIllustBatch(illustCurrent.pendingItems.slice(UI_BATCH_SIZE))
        setResult({
          kind: "illust",
          items: mergeUniqueByID<PixivIllustration>(illustCurrent.items, batch),
          pendingItems: illustCurrent.pendingItems.slice(UI_BATCH_SIZE),
          nextURL: illustCurrent.nextURL,
        })
      } else {
        const novelCurrent = current as Extract<SearchResult, { kind: "novel" }>
        const batch = novelCurrent.pendingItems.slice(0, UI_BATCH_SIZE)
        prefetchNextNovelBatch(novelCurrent.pendingItems.slice(UI_BATCH_SIZE))
        setResult({
          kind: "novel",
          items: mergeUniqueByID<PixivNovel>(novelCurrent.items, batch),
          pendingItems: novelCurrent.pendingItems.slice(UI_BATCH_SIZE),
          nextURL: novelCurrent.nextURL,
        })
      }
      return
    }
    if (!current.nextURL) return

    loadingMoreRef.current = true
    setLoadingMore(true)
    const seq = searchSeq.current
    const url = current.nextURL

    try {
      const settings = loadSettings()
      if (current.kind === "illust") {
        const page = await session.call((token) => nextIllustrations(url, token))
        if (seq !== searchSeq.current) return
        const filtered = dedupeByID(
          page.items.filter(
            (item) =>
              isIllustContentVisible(item, settings)
          )
        )
        const unique = mergeUniqueByID(current.items, filtered).slice(current.items.length)
        const batch = unique.slice(0, UI_BATCH_SIZE)
        const pendingItems = unique.slice(UI_BATCH_SIZE)
        setResult({
          kind: "illust",
          items: mergeUniqueByID(current.items, batch),
          pendingItems,
          nextURL: page.nextURL,
        })
        prefetchNextIllustBatch(pendingItems)
      } else if (current.kind === "novel") {
        const page = await session.call((token) => nextNovels(url, token))
        if (seq !== searchSeq.current) return
        const filtered = dedupeByID(
          page.items.filter(
            (novel) =>
              isR18ContentVisible(
                novel.x_restrict,
                settings.showR18,
                settings.showR18G
              ) && (settings.showAI || novel.novel_ai_type !== 2)
          )
        )
        const unique = mergeUniqueByID(current.items, filtered).slice(current.items.length)
        const batch = unique.slice(0, UI_BATCH_SIZE)
        const pendingItems = unique.slice(UI_BATCH_SIZE)
        setResult({
          kind: "novel",
          items: mergeUniqueByID(current.items, batch),
          pendingItems,
          nextURL: page.nextURL,
        })
        prefetchNextNovelBatch(pendingItems)
      } else {
        const page = await session.call((token) => nextUsers(url, token))
        if (seq !== searchSeq.current) return
        const filtered = filterUserPreviews(page.items, settings)
        setResult({
          kind: "user",
          items: mergeUniqueByKey(current.items, filtered, (preview) => preview.user.id),
          nextURL: page.nextURL,
        })
      }
    } catch {
      consumedTailRef.current = null
    } finally {
      loadingMoreRef.current = false
      if (seq === searchSeq.current) setLoadingMore(false)
    }
  }

  useEffect(() => {
    return () => {
      searchPrefetchRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    loadTrending()
  }, [])

  useEffect(() => {
    if (submittedRef.current) void doSearch(submittedRef.current)
    // scope 变化需要重新搜索；sort 仅在作品和小说请求中发送。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sort])

  const doSearchRef = useLatest(doSearch)
  useEffect(() => {
    return onSettingsChanged(() => {
      if (submittedRef.current && modeRef.current === "results") {
        void doSearchRef.current(submittedRef.current, true)
      }
    })
  }, [])

  const autocompleteSeq = useRef(0)
  const debouncedAutocomplete = useDebouncedCallback((value: string) => {
    const trimmed = value.trim()
    if (trimmed.length < 2 || scope === "user") {
      setSuggestions([])
      return
    }
    const seq = ++autocompleteSeq.current
    session
      .call((token) => searchAutocomplete(trimmed, token))
      .then((tags) => {
        if (seq === autocompleteSeq.current) setSuggestions(tags.slice(0, 8))
      })
      .catch(() => {
        if (seq === autocompleteSeq.current) setSuggestions([])
      })
  }, AUTOCOMPLETE_DEBOUNCE_MS)

  function onQueryChanged(value: string) {
    setQuery(value)
    debouncedAutocomplete(value)
  }

  function selectSort(value: SearchSort) {
    setMode("results")
    setSort(value)
  }

  return (
    <RefreshableScrollView
      navigationBarTitleDisplayMode="inline"
      refreshable={async () => {
        if (submittedRef.current && modeRef.current === "results") {
          await doSearch(submittedRef.current, true)
        }
      }}
      navigationDestination={destinationElement}
      toolbar={searchToolbar({
        onClose: props.onClose,
        sort,
        onSortChange: selectSort,
        onAdvanced: () => setMode("advanced"),
      })}
      searchable={{
        value: query,
        onChanged: onQueryChanged,
        placement: "toolbar",
        prompt: scope === "user" ? "搜索用户…" : "搜索作品、标签、用户…",
      }}
      searchSuggestions={
        suggestions.length > 0 ? (
          <VStack>
            {suggestions.map((suggestion) => (
              <Text key={suggestion.name} searchCompletion={suggestion.name}>
                {`${suggestion.name}${
                  suggestion.translated_name
                    ? `（${suggestion.translated_name}）`
                    : ""
                }`}
              </Text>
            ))}
          </VStack>
        ) : undefined
      }
      onSubmit={{ triggers: "search" as const, action: () => doSearch(query) }}
      submitLabel="search"
    >
      {mode === "advanced" ? (
        <AdvancedSearchPlaceholder />
      ) : (
        <VStack alignment="leading" spacing={10} padding={{ top: 4 }}>
          <SearchScopePicker scope={scope} onScopeChange={setScope} />

            {!submitted ? (
            <VStack alignment="leading" spacing={8} padding={{ horizontal: 14 }}>
              <Text font="footnote" fontWeight="semibold" foregroundStyle="secondaryLabel">
                热门标签
              </Text>
              <ScrollView axes="horizontal">
                <HStack spacing={8}>
                  {trending.map((tag) => (
                    <Button
                      key={tag.tag}
                      title={`#${tag.translated_name ?? tag.tag}`}
                      buttonStyle="glass"
                      controlSize="small"
                      action={() => {
                        setQuery(tag.tag)
                        void doSearch(tag.tag)
                      }}
                    />
                  ))}
                </HStack>
              </ScrollView>
            </VStack>
          ) : null}

          {submitted ? (
            searchLoading ? (
              <LoadingView />
            ) : searchError ? (
              <ErrorView
                message={searchError}
                onRetry={() => void doSearch(submitted)}
              />
            ) : !result || result.items.length === 0 ? (
              <EmptyView text="没有找到相关内容" systemImage="magnifyingglass" />
            ) : result.kind === "illust" ? (
              <SearchIllustrationResults
                items={result.items}
                loadingMore={loadingMore}
                hasMore={result.pendingItems.length > 0 || result.nextURL != null}
                onLoadMore={loadMore}
              />
            ) : result.kind === "novel" ? (
              <NovelResults
                items={result.items}
                loadingMore={loadingMore}
                hasMore={result.pendingItems.length > 0 || result.nextURL != null}
                onLoadMore={loadMore}
              />
            ) : (
              <UserResults
                items={result.items}
                loadingMore={loadingMore}
                hasMore={result.nextURL != null}
                onLoadMore={loadMore}
              />
            )
          ) : null}
        </VStack>
      )}
    </RefreshableScrollView>
  )
}

function searchToolbar(props: {
  onClose: () => void
  sort: SearchSort
  onSortChange: (sort: SearchSort) => void
  onAdvanced: () => void
}) {
  return appToolbar(
    props.onClose,
    "搜索",
    <Menu label={<Image systemName="ellipsis.circle" />}>
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

function SearchScopePicker(props: {
  scope: SearchScope
  onScopeChange: (scope: SearchScope) => void
}) {
  return (
    <Picker
      title="搜索范围"
      value={props.scope}
      onChanged={(value: string) => props.onScopeChange(value as SearchScope)}
      pickerStyle="segmented"
      padding={{ horizontal: 14 }}
    >
      <Text tag="illust">插画·漫画</Text>
      <Text tag="novel">小说</Text>
      <Text tag="user">用户</Text>
    </Picker>
  )
}

function AdvancedSearchPlaceholder() {
  return (
    <VStack
      alignment="leading"
      spacing={12}
      padding={{ horizontal: 20, top: 24 }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      <EmptyView text="高级搜索即将推出" systemImage="slider.horizontal.3" />
    </VStack>
  )
}

function SearchIllustrationResults(props: {
  items: PixivIllustration[]
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: (anchor: number | string) => void
}) {
  return (
    <>
      <MasonryIllustFeed
        items={props.items}
        onLoadMore={props.onLoadMore}
        hasMore={props.hasMore}
        isLoading={props.loadingMore}
      />
    </>
  )
}

function NovelResults(props: {
  items: PixivNovel[]
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: (anchor: number | string) => void
}) {
  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
      {props.items.map((novel) => (
        <NovelCard key={novel.id} novel={novel} />
      ))}
      <LoadMoreTrigger
        anchor={props.items[props.items.length - 1].id}
        onLoadMore={props.onLoadMore}
        hasMore={props.hasMore}
        isLoading={props.loadingMore}
      />
    </LazyVStack>
  )
}

function UserResults(props: {
  items: PixivUserPreview[]
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: (anchor: number | string) => void
}) {
  const tail = props.items[props.items.length - 1]
  return (
    <VStack alignment="leading" spacing={8} padding={{ horizontal: 8 }}>
      {props.items.map((preview) => (
        <NavigationLink key={preview.user.id} value={`user:${preview.user.id}`}>
          <VStack
            alignment="leading"
            spacing={6}
            padding={10}
            glassEffect={{ type: "rect", cornerRadius: 8 }}
            glassEffectTransition="materialize"
            frame={{ maxWidth: "infinity" }}
          >
            <AuthorRow user={preview.user} size={26} />
            <HStack spacing={6} padding={{ leading: 8 }}>
              {preview.illusts.slice(0, 3).map((illustration) => (
                <CachedImage
                  key={illustration.id}
                  url={thumbUrlOf(illustration)}
                  aspectRatioValue={1}
                  cornerRadius={6}
                />
              ))}
            </HStack>
          </VStack>
        </NavigationLink>
      ))}
      {tail ? (
        <LoadMoreTrigger
          anchor={tail.user.id}
          onLoadMore={props.onLoadMore}
          hasMore={props.hasMore}
          isLoading={props.loadingMore}
        />
      ) : null}
    </VStack>
  )
}

function filterUserPreviews(
  items: PixivUserPreview[],
  settings: ReturnType<typeof loadSettings>
): PixivUserPreview[] {
  return dedupeByKey(
    items
      .filter((preview) => !isUserBlocked(preview.user.id, settings.blockedUsers))
      .map((preview) => ({
        ...preview,
        illusts: dedupeByID(
          preview.illusts.filter((illust) => isIllustContentVisible(illust, settings))
        ),
      })),
    (preview) => preview.user.id
  )
}

