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
} from "../image/imageLoader"
import {
  isIllustContentVisible,
  isNovelContentVisible,
  isUserBlocked,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { destinationElement } from "./routes"
import {
  currentBatchSize,
  dedupeByID,
  useDebouncedCallback,
  useLatest,
  usePagedList,
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
  IllustFlowFeed,
  NovelCard,
  RefreshableScrollView,
} from "./components"

type SearchScope = "illust" | "novel" | "user"
type SearchSort = "date_desc" | "popular_desc" | "date_asc"
type SearchMode = "results" | "advanced"

interface PixivUserSearchResultItem extends PixivUserPreview {
  id: number
}

const AUTOCOMPLETE_DEBOUNCE_MS = 300

export function SearchView(props: { onClose: () => void; active: boolean }) {
  const [query, setQuery] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [scope, setScope] = useState<SearchScope>("illust")
  const [sort, setSort] = useState<SearchSort>("date_desc")
  const [mode, setMode] = useState<SearchMode>("results")
  const [trending, setTrending] = useState<PixivTrendingTag[]>([])
  const [suggestions, setSuggestions] = useState<
    { name: string; translated_name?: string | null }[]
  >([])

  const isResultsMode = mode === "results"
  const isIllustActive = props.active && Boolean(submitted) && scope === "illust" && isResultsMode
  const isNovelActive = props.active && Boolean(submitted) && scope === "novel" && isResultsMode
  const isUserActive = props.active && Boolean(submitted) && scope === "user" && isResultsMode

  // 1. 插画 / 漫画搜索流
  const illustPaged = usePagedList<PixivIllustration>({
    first: (token) => {
      const settings = loadSettings()
      return searchIllustrations(
        {
          word: submitted,
          target: "partial_match_for_tags",
          sort,
          aiFilter: settings.showAI ? 0 : 1,
        },
        token
      )
    },
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      return dedupeByID(
        items.filter((item) => isIllustContentVisible(item, settings))
      )
    },
    deps: [submitted, sort],
    enabled: isIllustActive,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 2. 小说搜索流
  const novelPaged = usePagedList<PixivNovel>({
    first: (token) => searchNovels(submitted, sort, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      return dedupeByID(
        items.filter((novel) => isNovelContentVisible(novel, settings))
      )
    },
    deps: [submitted, sort],
    enabled: isNovelActive,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  // 3. 用户搜索流
  const userPaged = usePagedList<PixivUserSearchResultItem>({
    first: async (token) => {
      const page = await searchUsers(submitted, token)
      return {
        items: page.items.map((preview) => ({ id: preview.user.id, ...preview })),
        nextURL: page.nextURL,
      }
    },
    more: async (nextURL, token) => {
      const page = await nextUsers(nextURL, token)
      return {
        items: page.items.map((preview) => ({ id: preview.user.id, ...preview })),
        nextURL: page.nextURL,
      }
    },
    filter: (items) => {
      const settings = loadSettings()
      return items
        .filter((preview) => !isUserBlocked(preview.user.id, settings.blockedUsers))
        .map((preview) => ({
          ...preview,
          illusts: dedupeByID(
            preview.illusts.filter((illust) => isIllustContentVisible(illust, settings))
          ),
        }))
    },
    deps: [submitted],
    enabled: isUserActive,
  })

  const illustPagedRef = useLatest(illustPaged)
  const novelPagedRef = useLatest(novelPaged)
  const userPagedRef = useLatest(userPaged)

  useEffect(() => {
    return onSettingsChanged(() => {
      illustPagedRef.current.reapplyFilter()
      novelPagedRef.current.reapplyFilter()
      userPagedRef.current.reapplyFilter()
    })
  }, [])

  useEffect(() => {
    session
      .call((token) => trendingTags(token))
      .then((tags) => setTrending(tags))
      .catch(() => {})
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

  function submitSearch(textToSearch: string) {
    const trimmed = textToSearch.trim()
    if (!trimmed) return
    setMode("results")
    setSubmitted(trimmed)
    setSuggestions([])
  }

  const activePaged =
    scope === "illust"
      ? illustPaged
      : scope === "novel"
        ? novelPaged
        : userPaged

  return (
    <RefreshableScrollView
      navigationBarTitleDisplayMode="inline"
      refreshable={async () => {
        if (submitted && isResultsMode) {
          await activePaged.refresh()
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
      onSubmit={{ triggers: "search" as const, action: () => submitSearch(query) }}
      submitLabel="search"
    >
      {mode === "advanced" ? (
        <AdvancedSearchPlaceholder />
      ) : (
        <VStack alignment="leading" spacing={8}>
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
                        submitSearch(tag.tag)
                      }}
                    />
                  ))}
                </HStack>
              </ScrollView>
            </VStack>
          ) : null}

          {submitted ? (
            activePaged.initialLoading ? (
              <LoadingView />
            ) : activePaged.error ? (
              <ErrorView
                message={activePaged.error}
                onRetry={activePaged.refresh}
              />
            ) : activePaged.items.length === 0 ? (
              <EmptyView text="没有找到相关内容" systemImage="magnifyingglass" />
            ) : scope === "illust" ? (
              <IllustFlowFeed
                items={illustPaged.items}
                onLoadMore={illustPaged.loadMore}
                hasMore={illustPaged.hasMore}
                isLoading={illustPaged.loadingMore}
              />
            ) : scope === "novel" ? (
              <NovelResults
                items={novelPaged.items}
                loadingMore={novelPaged.loadingMore}
                hasMore={novelPaged.hasMore}
                onLoadMore={novelPaged.loadMore}
              />
            ) : (
              <UserResults
                items={userPaged.items}
                loadingMore={userPaged.loadingMore}
                hasMore={userPaged.hasMore}
                onLoadMore={userPaged.loadMore}
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

function NovelResults(props: {
  items: PixivNovel[]
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: (anchor?: number | string) => void
}) {
  const lastNovel = props.items[props.items.length - 1]
  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
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

function UserResults(props: {
  items: PixivUserSearchResultItem[]
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: (anchor?: number | string) => void
}) {
  const tail = props.items[props.items.length - 1]
  const previewSide = Math.floor((Device.screen.width - 56) / 3)
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
                  frame={{ width: previewSide, height: previewSide }}
                />
              ))}
            </HStack>
          </VStack>
        </NavigationLink>
      ))}
      {tail ? (
        <LoadMoreTrigger
          anchor={tail.id}
          onLoadMore={props.onLoadMore}
          hasMore={props.hasMore}
          isLoading={props.loadingMore}
        />
      ) : null}
    </VStack>
  )
}
