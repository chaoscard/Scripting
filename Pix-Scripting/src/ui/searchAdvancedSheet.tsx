import {
  Button,
  DatePicker,
  HStack,
  Label,
  List,
  NavigationStack,
  Picker,
  ScrollView,
  Section,
  Text,
  TextField,
  Toggle,
  useMemo,
  useState,
} from "scripting"
import type {
  AdvancedSearchParams,
  BookmarkThreshold,
  SearchCategory,
  SearchMediaFilter,
  SearchScope,
  SearchSort,
} from "../types"
import type { AppSettings } from "../store/settings"

export function formatDateToPixivDate(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function categoryFromParams(
  scope: SearchScope,
  mediaFilter: SearchMediaFilter
): SearchCategory {
  if (scope === "novel") return "novel"
  if (mediaFilter === "illust") return "illust"
  if (mediaFilter === "manga") return "manga"
  if (mediaFilter === "ugoira") return "ugoira"
  return "all_illust"
}

export function scopeAndMediaFilterFromCategory(category: SearchCategory): {
  scope: SearchScope
  mediaFilter: SearchMediaFilter
} {
  if (category === "novel") {
    return { scope: "novel", mediaFilter: "all" }
  }
  if (category === "illust") {
    return { scope: "illust", mediaFilter: "illust" }
  }
  if (category === "manga") {
    return { scope: "illust", mediaFilter: "manga" }
  }
  if (category === "ugoira") {
    return { scope: "illust", mediaFilter: "ugoira" }
  }
  return { scope: "illust", mediaFilter: "all" }
}

export function getDefaultAdvancedSearchParams(
  scope: SearchScope = "illust",
  initialWord = "",
  mediaFilter: SearchMediaFilter = "all"
): AdvancedSearchParams {
  const now = Date.now()
  const oneMonthAgo = now - 30 * 86400000
  const category = categoryFromParams(scope, mediaFilter)
  return {
    word: initialWord,
    category,
    scope: scope === "novel" ? "novel" : "illust",
    target: "partial_match_for_tags",
    sort: "date_desc",
    mediaFilter: scope === "novel" ? "all" : mediaFilter,
    bookmarkThreshold: 0,
    useDateRange: false,
    startDate: formatDateToPixivDate(oneMonthAgo),
    endDate: formatDateToPixivDate(now),
    startTimestamp: oneMonthAgo,
    endTimestamp: now,
  }
}

interface QuickDatePreset {
  label: string
  getTimestamps: () => { start: number; end: number }
}

const QUICK_DATE_PRESETS: QuickDatePreset[] = [
  {
    label: "过去24小时",
    getTimestamps: () => {
      const now = Date.now()
      return { start: now - 86400000, end: now }
    },
  },
  {
    label: "过去7天",
    getTimestamps: () => {
      const now = Date.now()
      return { start: now - 7 * 86400000, end: now }
    },
  },
  {
    label: "过去30天",
    getTimestamps: () => {
      const now = Date.now()
      return { start: now - 30 * 86400000, end: now }
    },
  },
  {
    label: "过去半年",
    getTimestamps: () => {
      const now = Date.now()
      return { start: now - 180 * 86400000, end: now }
    },
  },
  {
    label: "过去1年",
    getTimestamps: () => {
      const now = Date.now()
      const d = new Date(now)
      d.setFullYear(d.getFullYear() - 1)
      return { start: d.getTime(), end: now }
    },
  },
  {
    label: "过去3年",
    getTimestamps: () => {
      const now = Date.now()
      const d = new Date(now)
      d.setFullYear(d.getFullYear() - 3)
      return { start: d.getTime(), end: now }
    },
  },
]

export function SearchAdvancedSheet(props: {
  currentParams: AdvancedSearchParams
  settings: AppSettings
  onApply: (params: AdvancedSearchParams) => void
  onCancel: () => void
}) {
  const { currentParams, settings, onApply, onCancel } = props

  const [word, setWord] = useState(currentParams.word)
  const [category, setCategory] = useState<SearchCategory>(() =>
    currentParams.category ||
    categoryFromParams(currentParams.scope, currentParams.mediaFilter)
  )
  const [target, setTarget] = useState<string>(currentParams.target)
  const [sort, setSort] = useState<SearchSort>(currentParams.sort)
  const [bookmarkThreshold, setBookmarkThreshold] = useState<BookmarkThreshold>(
    currentParams.bookmarkThreshold
  )
  const [useDateRange, setUseDateRange] = useState(currentParams.useDateRange)
  const [startTimestamp, setStartTimestamp] = useState<number>(
    currentParams.startTimestamp
  )
  const [endTimestamp, setEndTimestamp] = useState<number>(
    currentParams.endTimestamp
  )

  const minTimestamp = useMemo(() => new Date("2007-09-09").getTime(), [])
  const maxTimestamp = useMemo(() => Date.now(), [])

  function handleCategoryChange(nextCategory: SearchCategory) {
    setCategory(nextCategory)
    if (nextCategory !== "novel") {
      if (target === "text" || target === "keyword") {
        setTarget("partial_match_for_tags")
      }
    }
  }

  function handleReset() {
    const { scope, mediaFilter } = scopeAndMediaFilterFromCategory(category)
    const defaults = getDefaultAdvancedSearchParams(scope, word, mediaFilter)
    setTarget(defaults.target)
    setSort(defaults.sort)
    setBookmarkThreshold(defaults.bookmarkThreshold)
    setUseDateRange(defaults.useDateRange)
    setStartTimestamp(defaults.startTimestamp)
    setEndTimestamp(defaults.endTimestamp)
  }

  function handleApply() {
    const clampedStart = Math.max(
      minTimestamp,
      Math.min(startTimestamp, endTimestamp)
    )
    const clampedEnd = Math.max(
      clampedStart,
      Math.min(endTimestamp, maxTimestamp)
    )
    const startDate = formatDateToPixivDate(clampedStart)
    const endDate = formatDateToPixivDate(clampedEnd)
    const { scope, mediaFilter } = scopeAndMediaFilterFromCategory(category)

    onApply({
      word,
      category,
      scope,
      target,
      sort,
      mediaFilter,
      bookmarkThreshold,
      useDateRange,
      startDate,
      endDate,
      startTimestamp: clampedStart,
      endTimestamp: clampedEnd,
    })
  }

  const isNovel = category === "novel"

  return (
    <NavigationStack>
      <List
        navigationTitle="高级搜索"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: [
            <Button
              title="关闭"
              systemImage="xmark"
              action={onCancel}
            />,
          ],
          topBarTrailing: [
            <Button
              title="重置"
              systemImage="arrow.counterclockwise"
              action={handleReset}
            />,
            <Button
              title="搜索"
              systemImage="magnifyingglass"
              fontWeight="bold"
              action={handleApply}
            />,
          ],
        }}
      >
        <Section header={<Text>搜索关键词</Text>}>
          <TextField
            title="关键词"
            prompt="输入搜索关键词…"
            value={word}
            onChanged={setWord}
            autofocus={true}
          />
        </Section>

        <Section header={<Text>搜索范围</Text>}>
          <Picker
            title="范围"
            value={category}
            onChanged={(val: string) =>
              handleCategoryChange(val as SearchCategory)
            }
          >
            <Label
              tag="all_illust"
              title="插画·漫画·动图"
              systemImage="photo.stack"
            />
            <Label tag="illust" title="插画" systemImage="photo" />
            <Label
              tag="manga"
              title="漫画"
              systemImage="photo.on.rectangle"
            />
            <Label
              tag="ugoira"
              title="动图"
              systemImage="play.circle"
            />
            {settings.hideNovels ? null : (
              <Label tag="novel" title="小说" systemImage="book" />
            )}
          </Picker>
        </Section>

        <Section header={<Text>匹配维度与排序</Text>}>
          <Picker
            title="匹配目标"
            value={target}
            onChanged={(val: string) => setTarget(val)}
          >
            <Label
              tag="partial_match_for_tags"
              title="标签部分一致"
              systemImage="tag"
            />
            <Label
              tag="exact_match_for_tags"
              title="标签完全一致"
              systemImage="tag.fill"
            />
            {!isNovel ? (
              <Label
                tag="title_and_caption"
                title="标题与简介"
                systemImage="text.quote"
              />
            ) : (
              <>
                <Label
                  tag="keyword"
                  title="标签、标题与简介"
                  systemImage="text.quote"
                />
                <Label
                  tag="text"
                  title="小说正文内容"
                  systemImage="doc.text"
                />
              </>
            )}
          </Picker>

          <Picker
            title="排序方式"
            value={sort}
            onChanged={(val: string) => setSort(val as SearchSort)}
          >
            <Label tag="date_desc" title="最新优先" systemImage="clock" />
            <Label
              tag="date_asc"
              title="最早优先"
              systemImage="clock.arrow.circlepath"
            />
            <Label
              tag="popular_desc"
              title="热门优先（需会员）"
              systemImage="flame"
            />
          </Picker>
        </Section>

        <Section header={<Text>收藏数筛选</Text>}>
          <Picker
            title="最低收藏数"
            value={String(bookmarkThreshold)}
            onChanged={(val: string) =>
              setBookmarkThreshold(Number(val) as BookmarkThreshold)
            }
          >
            <Text tag="0">不限</Text>
            <Text tag="300">至少 300 收藏</Text>
            <Text tag="500">至少 500 收藏</Text>
            <Text tag="1000">至少 1,000 收藏</Text>
            <Text tag="5000">至少 5,000 收藏</Text>
            <Text tag="10000">至少 10,000 收藏</Text>
            <Text tag="20000">至少 20,000 收藏</Text>
            <Text tag="30000">至少 30,000 收藏</Text>
            <Text tag="50000">至少 50,000 收藏</Text>
          </Picker>
        </Section>

        <Section
          header={
            <Text>
              {useDateRange
                ? `投稿时间 · ${formatDateToPixivDate(
                    startTimestamp
                  )} 至 ${formatDateToPixivDate(endTimestamp)}`
                : "投稿时间"}
            </Text>
          }
        >
          <Toggle
            title="指定时间范围"
            value={useDateRange}
            onChanged={(val: boolean) => setUseDateRange(val)}
          />

          {useDateRange ? (
            <>
              <ScrollView axes="horizontal">
                <HStack spacing={8} padding={{ vertical: 4 }}>
                  {QUICK_DATE_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      buttonStyle="bordered"
                      controlSize="small"
                      action={() => {
                        const range = preset.getTimestamps()
                        setStartTimestamp(range.start)
                        setEndTimestamp(range.end)
                      }}
                    >
                      <Text font="caption">{preset.label}</Text>
                    </Button>
                  ))}
                </HStack>
              </ScrollView>

              <DatePicker
                title="开始日期"
                displayedComponents={["date"]}
                datePickerStyle="compact"
                value={startTimestamp}
                onChanged={(val) => setStartTimestamp(val)}
                startDate={minTimestamp}
                endDate={endTimestamp}
              />

              <DatePicker
                title="结束日期"
                displayedComponents={["date"]}
                datePickerStyle="compact"
                value={endTimestamp}
                onChanged={(val) => setEndTimestamp(val)}
                startDate={startTimestamp}
                endDate={maxTimestamp}
              />
            </>
          ) : null}
        </Section>
      </List>
    </NavigationStack>
  )
}
