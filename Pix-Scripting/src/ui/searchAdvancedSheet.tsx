import {
  Button,
  DatePicker,
  Divider,
  HStack,
  Image,
  Label,
  List,
  NavigationStack,
  Picker,
  ScrollView,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"
import { compileSearchQuery, searchAutocomplete, stripBookmarkFilterFromWord } from "../api/pixiv"
import { session } from "../api/session"
import { sheetTopBar } from "./components/pageChrome"
import { SheetScaffold } from "./components/SheetScaffold"
import type {
  AdvancedSearchParams,
  BookmarkThreshold,
  PixivAutocompleteTag,
  SearchCategory,
  SearchMediaFilter,
  SearchScope,
  SearchSort,
} from "../types"
import { loadSettings, type AppSettings } from "../store/settings"
import { triggerHaptic } from "../platform/haptics"

declare const Dialog: any

export function extractActiveWordToken(text: string): { prefix: string; token: string } {
  if (!text) return { prefix: "", token: "" }
  const match = /^(.*[\s()（）|&+-])?([^\s()（）|&+-]+)$/u.exec(text)
  if (match) {
    return {
      prefix: match[1] ?? "",
      token: match[2] ?? "",
    }
  }
  return { prefix: "", token: text.trim() }
}

export function formatDateToPixivDate(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export interface SearchQueryInspection {
  shouldShow: boolean
  compiled: string
  humanSummary: string
  hints: string[]
  warnings: string[]
  errors: string[]
  hasError: boolean
}

function buildHumanSummary(compiled: string): string {
  if (!compiled) return ""
  const topTokens: string[] = []
  let depth = 0
  let cur = ""
  for (let i = 0; i < compiled.length; i++) {
    const ch = compiled[i]
    if (ch === "(" && (i === 0 || compiled[i - 1] === " ")) {
      if (cur.trim()) {
        topTokens.push(...cur.trim().split(/\s+/))
        cur = ""
      }
      cur += ch
      depth++
    } else if (ch === ")" && depth > 0) {
      cur += ch
      depth--
      if (depth === 0) {
        topTokens.push(cur.trim())
        cur = ""
      }
    } else {
      cur += ch
    }
  }
  if (cur.trim()) {
    topTokens.push(...cur.trim().split(/\s+/))
  }

  const plainIncludes: string[] = []
  const orGroups: string[] = []
  const mustExclude: string[] = []

  for (const t of topTokens) {
    if (!t || t === "OR" || t === "-") continue
    if (t.startsWith("-") && t.length > 1) {
      mustExclude.push(`「${t.replace(/^-+/, "")}」`)
    } else if (t.startsWith("(") && t.endsWith(")") && /\bOR\b/.test(t)) {
      const inner = t.slice(1, -1).trim()
      const parts = inner.split(/\s+OR\s+/).filter(Boolean)
      if (parts.length > 1) {
        orGroups.push(`「${parts.join(" 或 ")}」的任一`)
      } else if (parts.length === 1) {
        plainIncludes.push(`「${parts[0]}」`)
      }
    } else {
      plainIncludes.push(`「${t}」`)
    }
  }

  const clauses: string[] = []
  if (plainIncludes.length === 1) {
    clauses.push(`包含${plainIncludes[0]}`)
  } else if (plainIncludes.length > 1) {
    clauses.push(`同时包含${plainIncludes.join("、")}`)
  }

  if (orGroups.length > 0) {
    const orText = orGroups.join("，且包含")
    clauses.push(clauses.length > 0 ? `且包含${orText}` : `包含${orText}`)
  }

  const segments: string[] = []
  if (clauses.length > 0) {
    segments.push(clauses.join("，"))
  }
  if (mustExclude.length > 0) {
    segments.push(`排除${mustExclude.join("、")}`)
  }

  return segments.join("；")
}

export function inspectSearchQuery(rawQuery: string): SearchQueryInspection {
  const cleanRaw = stripBookmarkFilterFromWord(rawQuery || "")
  if (!cleanRaw) {
    return { shouldShow: false, compiled: "", humanSummary: "", hints: [], warnings: [], errors: [], hasError: false }
  }

  const normalized = cleanRaw
    .replace(/\u3000/g, " ")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[—－]/g, "-")

  const warnings: string[] = []

  const errors: string[] = []
  // 仅在真实末尾运算符悬挂时拦截报错（排除 -、未闭合的独立 or/not 等）
  // 彻底释放 /、+ 等标签自带合法字符
  if (/(?:(^|\s)[-—－]|(^|[\s(])\b(?:or|not))\s*$/i.test(normalized)) {
    errors.push("末尾运算符后缺少关键词，请继续输入或删除该符号")
  }

  const compiled = compileSearchQuery(cleanRaw)
  const humanSummary = buildHumanSummary(compiled)

  const hints: string[] = []
  const negatedMatch = normalized.match(/(?:^|[\s(])(?:-|not\s*)\(([^()]+)\)/i)
  if (negatedMatch && negatedMatch[1]) {
    const innerTerms = negatedMatch[1].replace(/\b(?:OR|and)\b/gi, " ").trim().split(/\s+/).filter(Boolean)
    if (innerTerms.length > 1) {
      hints.push("提示：受 Pixiv 检索机制限制，复合排除将按分别排除处理（即同时排除所列标签）")
    }
  }

  // 检测是否存在词内连字符（如 A-B），给予明确的单词语义说明与空格排除引导
  const chunks = normalized.split(/\s+/).filter(Boolean)
  const hasEmbeddedHyphen = chunks.some((chunk) => {
    const body = chunk.replace(/^-+/, "")
    return body.includes("-") && !body.endsWith("-")
  })
  if (hasEmbeddedHyphen) {
    hints.push("提示：连字符无空格将被视为单个词汇；若需排除请在减号前留空格（如 A -B）")
  }

  if (compiled && !errors.some((w) => w.includes("末尾运算符"))) {
    const tokens = compiled.split(/\s+/).filter(Boolean)
    if (tokens.length > 0 && tokens.every((t) => t.startsWith("-"))) {
      errors.push("不能仅包含排除词，请至少输入一个正向搜索关键词")
    }
  }

  // 存在布尔语法（空格、排除词、OR 运算）、提示、警告或错误时展开语义详情卡片，保持单标签检索清爽简洁
  const hasOperators =
    /\s+|^[-—－]|(^|\s)[-—－]\S|(?:\b(?:OR|or|not)\b)/i.test(normalized) ||
    (normalized.includes("(") && /\b(?:OR|or)\b/i.test(normalized))
  const shouldShow =
    hasOperators ||
    hasEmbeddedHyphen ||
    warnings.length > 0 ||
    errors.length > 0 ||
    hints.length > 0

  return {
    shouldShow,
    compiled,
    humanSummary,
    hints,
    warnings,
    errors,
    hasError: errors.length > 0,
  }
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
  mediaFilter: SearchMediaFilter = "all",
  settings?: AppSettings
): AdvancedSearchParams {
  const resolvedSettings = settings ?? loadSettings()
  const now = Date.now()
  const category = categoryFromParams(scope, mediaFilter)
  const todayStr = formatDateToPixivDate(now)
  return {
    word: initialWord,
    category,
    scope: scope === "novel" ? "novel" : "illust",
    target: "partial_match_for_tags",
    sort: "date_desc",
    mediaFilter: scope === "novel" ? "all" : mediaFilter,
    bookmarkThreshold: 0,
    useDateRange: false,
    startDate: todayStr,
    endDate: todayStr,
    startTimestamp: now,
    endTimestamp: now,
    datePresetLabel: undefined,
    includeR18: resolvedSettings.showR18,
    includeR18G: resolvedSettings.showR18 && resolvedSettings.showR18G,
    includeAI: resolvedSettings.showAI,
  }
}

interface QuickDatePreset {
  label: string
  getTimestamps: () => { start: number; end: number }
}

function makeDatePreset(label: string, days?: number, years?: number): QuickDatePreset {
  return {
    label,
    getTimestamps: () => {
      const now = Date.now()
      if (days) return { start: now - days * 86400000, end: now }
      const d = new Date(now)
      d.setFullYear(d.getFullYear() - (years || 1))
      return { start: d.getTime(), end: now }
    },
  }
}

const QUICK_DATE_PRESETS: QuickDatePreset[] = [
  makeDatePreset("过去24小时", 1),
  makeDatePreset("过去7天", 7),
  makeDatePreset("过去30天", 30),
  makeDatePreset("过去半年", 180),
  makeDatePreset("过去1年", 0, 1),
  makeDatePreset("过去3年", 0, 3),
  makeDatePreset("过去5年", 0, 5),
  makeDatePreset("过去10年", 0, 10),
]

export function SearchAdvancedSheet(props: {
  currentParams: AdvancedSearchParams
  settings: AppSettings
  onApply: (params: AdvancedSearchParams) => void
  onCancel: () => void
  lockScope?: "illust" | "novel"
}) {
  const { currentParams, settings, onApply, onCancel, lockScope } = props

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
  const [datePresetLabel, setDatePresetLabel] = useState<string | undefined>(
    currentParams.datePresetLabel
  )
  const [includeR18, setIncludeR18] = useState<boolean>(() =>
    currentParams.includeR18 ?? settings.showR18
  )
  const [includeR18G, setIncludeR18G] = useState<boolean>(() =>
    currentParams.includeR18G ?? (settings.showR18 && settings.showR18G)
  )
  const [includeAI, setIncludeAI] = useState<boolean>(() =>
    currentParams.includeAI ?? settings.showAI
  )
  // 智能一次性自动聚焦：若初始词条为空（从热门/未搜索进入），首次打开自动聚焦唤起键盘；
  // 挂载后或输入发生变化时立即关闭自动聚焦，防止后续滚动到底部时被虚拟列表反复唤起键盘。
  const [shouldAutoFocus, setShouldAutoFocus] = useState<boolean>(
    () => !currentParams.word?.trim()
  )
  const [tagSuggestions, setTagSuggestions] = useState<PixivAutocompleteTag[]>([])
  const [tagSuggestionsLoading, setTagSuggestionsLoading] = useState(false)
  const tagSeqRef = useRef(0)
  const debounceTimerRef = useRef<any>(null)

  const queryInspection = useMemo(() => inspectSearchQuery(word), [word])

  useEffect(() => {
    setWord(currentParams.word)
    setCategory(
      currentParams.category ||
        categoryFromParams(currentParams.scope, currentParams.mediaFilter)
    )
    setTarget(currentParams.target)
    setSort(currentParams.sort)
    setBookmarkThreshold(currentParams.bookmarkThreshold)
    setUseDateRange(currentParams.useDateRange)
    setStartTimestamp(currentParams.startTimestamp)
    setEndTimestamp(currentParams.endTimestamp)
    setDatePresetLabel(currentParams.datePresetLabel)
    setIncludeR18(currentParams.includeR18 ?? settings.showR18)
    setIncludeR18G(currentParams.includeR18G ?? (settings.showR18 && settings.showR18G))
    setIncludeAI(currentParams.includeAI ?? settings.showAI)
    if (!currentParams.word?.trim()) {
      setShouldAutoFocus(true)
    }
  }, [currentParams])

  useEffect(() => {
    if (shouldAutoFocus) {
      const timer = setTimeout(() => {
        setShouldAutoFocus(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [shouldAutoFocus])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  const handleWordChanged = (val: string) => {
    setWord(val)
    if (shouldAutoFocus) {
      setShouldAutoFocus(false)
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    const { token } = extractActiveWordToken(val)
    const trimmed = token.trim()
    if (!trimmed) {
      tagSeqRef.current++
      setTagSuggestions([])
      setTagSuggestionsLoading(false)
      return
    }

    const seq = ++tagSeqRef.current
    debounceTimerRef.current = setTimeout(() => {
      setTagSuggestionsLoading(true)
      session
        .call((authToken) => searchAutocomplete(trimmed, authToken))
        .then((tags) => {
          if (seq === tagSeqRef.current) {
            setTagSuggestions(tags)
            setTagSuggestionsLoading(false)
          }
        })
        .catch(() => {
          if (seq === tagSeqRef.current) {
            setTagSuggestions([])
            setTagSuggestionsLoading(false)
          }
        })
    }, 300)
  }

  const handleApplySuggestion = (suggestionTag: string) => {
    try {
      triggerHaptic("selection")
    } catch {}
    const { prefix } = extractActiveWordToken(word)
    if (prefix) {
      setWord(`${prefix}${suggestionTag} `)
    } else {
      setWord(suggestionTag)
    }
    setTagSuggestions([])
    setTagSuggestionsLoading(false)
  }
  const minTimestamp = useMemo(() => new Date("2007-09-09").getTime(), [])
  const maxTimestamp = useMemo(() => Date.now(), [])

  function handleTargetChange(val: string) {
    if (val === "exact_match_for_tags" && bookmarkThreshold > 0) {
      try {
        triggerHaptic("selection")
      } catch {}
      setBookmarkThreshold(0)
    }
    setTarget(val)
  }

  function handleBookmarkThresholdChange(val: BookmarkThreshold) {
    setBookmarkThreshold(val)
    if (val > 0 && target === "exact_match_for_tags") {
      try {
        triggerHaptic("selection")
      } catch {}
      setTarget("partial_match_for_tags")
    }
  }

  function handleCategoryChange(nextCategory: SearchCategory) {
    setCategory(nextCategory)
    if (nextCategory !== "novel") {
      if (target === "text" || target === "keyword") {
        setTarget("partial_match_for_tags")
      }
    }
  }

  function handleReset() {
    setTagSuggestions([])
    setTagSuggestionsLoading(false)
    const { scope, mediaFilter } = scopeAndMediaFilterFromCategory(category)
    const defaults = getDefaultAdvancedSearchParams(scope, word, mediaFilter)
    setTarget(defaults.target)
    setSort(defaults.sort)
    setBookmarkThreshold(defaults.bookmarkThreshold)
    setUseDateRange(defaults.useDateRange)
    setStartTimestamp(defaults.startTimestamp)
    setEndTimestamp(defaults.endTimestamp)
    setDatePresetLabel(defaults.datePresetLabel)
    setIncludeR18(settings.showR18)
    setIncludeR18G(settings.showR18 && settings.showR18G)
    setIncludeAI(settings.showAI)
  }

  function handleApply() {
    if (queryInspection.hasError) {
      triggerHaptic("error")
      return
    }
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
      word: word.trim(),
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
      datePresetLabel: useDateRange ? datePresetLabel : undefined,
      includeR18,
      includeR18G,
      includeAI,
    })
  }

  const isNovel = category === "novel"

  return (
    <SheetScaffold detents={["large"]}>
      <List
        {...sheetTopBar()}
        navigationTitle="高级搜索"
        navigationBarTitleDisplayMode="inline"
        contentMargins={{
          edges: ["top", "horizontal"],
          insets: { top: 0, leading: 8, bottom: 0, trailing: 8 },
          placement: "scrollContent",
        }}
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
              disabled={queryInspection.hasError}
              action={handleApply}
            />,
          ],
        }}
      >
        <Section
          header={<Text>搜索关键词</Text>}
          footer={
            <Text>
              {"提示：空格或 and 表示且；or 表示或；- 或 not 表示排除；支持用 () 组合优先级。\n示例：(初音 or 巡音) 桜 not 3D"}
            </Text>
          }
        >
          <TextField
            title="关键词"
            prompt="输入搜索关键词…"
            value={word}
            onChanged={handleWordChanged}
            autofocus={shouldAutoFocus}
          />
          {tagSuggestions.length > 0 ? (
            <VStack
              alignment="leading"
              spacing={0}
              listRowInsets={{ top: 0, bottom: 0, leading: 16, trailing: 16 }}
            >
              {tagSuggestions.map((item, idx) => (
                <VStack key={`${item.name}-${idx}`} spacing={0} frame={{ maxWidth: "infinity" }}>
                  {idx > 0 ? <Divider /> : null}
                  <Button
                    buttonStyle="plain"
                    action={() => handleApplySuggestion(item.name)}
                    contentShape="rect"
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    <HStack
                      alignment="center"
                      spacing={10}
                      padding={{ horizontal: 4, vertical: 10 }}
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
                      <Image
                        systemName="arrow.up.left"
                        font="caption"
                        foregroundStyle="tertiaryLabel"
                      />
                    </HStack>
                  </Button>
                </VStack>
              ))}
            </VStack>
          ) : null}
          {queryInspection.shouldShow ? (
            <VStack alignment="leading" spacing={6} padding={{ top: 4, bottom: 4 }}>
              {queryInspection.humanSummary ? (
                <HStack alignment="top" spacing={6}>
                  <Image
                    systemName="sparkles"
                    font="caption"
                    foregroundStyle="systemYellow"
                    padding={{ top: 2 }}
                  />
                  <Text font="caption" foregroundStyle="label">
                    搜索语义：{queryInspection.humanSummary}
                  </Text>
                </HStack>
              ) : null}
              {queryInspection.compiled ? (
                <HStack alignment="top" spacing={6}>
                  <Image
                    systemName="magnifyingglass"
                    font="caption"
                    foregroundStyle="systemBlue"
                    padding={{ top: 2 }}
                  />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    最终检索：{queryInspection.compiled}
                  </Text>
                </HStack>
              ) : null}
              {queryInspection.hints.map((hint, idx) => (
                <HStack key={`hint-${idx}`} alignment="top" spacing={6}>
                  <Image
                    systemName="info.circle"
                    font="caption"
                    foregroundStyle="secondaryLabel"
                    padding={{ top: 2 }}
                  />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {hint}
                  </Text>
                </HStack>
              ))}
              {queryInspection.warnings.map((warn, idx) => (
                <HStack key={`warn-${idx}`} alignment="top" spacing={6}>
                  <Image
                    systemName="exclamationmark.triangle.fill"
                    font="caption"
                    foregroundStyle="systemOrange"
                    padding={{ top: 2 }}
                  />
                  <Text font="caption" foregroundStyle="systemOrange">
                    {warn}
                  </Text>
                </HStack>
              ))}
              {queryInspection.errors.map((err, idx) => (
                <HStack key={`err-${idx}`} alignment="top" spacing={6}>
                  <Image
                    systemName="exclamationmark.circle.fill"
                    font="caption"
                    foregroundStyle="systemRed"
                    padding={{ top: 2 }}
                  />
                  <Text font="caption" foregroundStyle="systemRed">
                    {err}
                  </Text>
                </HStack>
              ))}
            </VStack>
          ) : null}
        </Section>

        {lockScope === "novel" && !settings.showR18 && !settings.showAI ? null : (
          <Section header={<Text>搜索范围与内容</Text>}>
            {lockScope === "novel" ? null : (
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
                {settings.hideNovels || lockScope === "illust" ? null : (
                  <Label tag="novel" title="小说" systemImage="book" />
                )}
              </Picker>
            )}

            {settings.showR18 ? (
              <Toggle
                title="包含 R-18 作品"
                value={includeR18}
                onChanged={(val: boolean) => {
                  setIncludeR18(val)
                  if (!val) {
                    setIncludeR18G(false)
                  }
                }}
              />
            ) : null}

            {settings.showR18 && settings.showR18G ? (
              <Toggle
                title="包含 R-18G 作品"
                value={includeR18 && includeR18G}
                disabled={!includeR18}
                onChanged={(val: boolean) => setIncludeR18G(val)}
              />
            ) : null}

            {settings.showAI ? (
              <Toggle
                title="包含 AI 生成作品"
                value={includeAI}
                onChanged={(val: boolean) => setIncludeAI(val)}
              />
            ) : null}
          </Section>
        )}

        <Section header={<Text>匹配维度与排序</Text>}>
          <Picker
            title="匹配目标"
            value={target}
            onChanged={(val: string) => handleTargetChange(val)}
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
            onChanged={(val: string) => {
              if (val === "popular_desc" && !session.user?.is_premium) {
                try {
                  triggerHaptic("warning")
                } catch {}
                if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
                  void Dialog.alert({
                    title: "提示",
                    message:
                      "当前账号非 Pixiv Premium 会员，无法使用按热门排序，可在「高级搜索」中使用「收藏数筛选」替代。",
                  })
                }
                return
              }
              setSort(val as SearchSort)
            }}
          >
            <Label tag="date_desc" title="最新优先" systemImage="clock" />
            <Label
              tag="popular_desc"
              title="热门优先"
              systemImage="flame"
            />
            <Label
              tag="date_asc"
              title="最早优先"
              systemImage="clock.arrow.circlepath"
            />
          </Picker>
        </Section>

        <Section
          header={<Text>收藏数筛选</Text>}
          footer={
            bookmarkThreshold > 0 ? (
              <Text font="caption" foregroundStyle="secondaryLabel">
                按收藏数筛选将自动采用「标签部分一致」检索，以匹配含 users入り 复合标签的高赞作品。
              </Text>
            ) : undefined
          }
        >
          <Picker
            title="最低收藏数"
            value={String(bookmarkThreshold)}
            onChanged={(val: string) =>
              handleBookmarkThresholdChange(Number(val) as BookmarkThreshold)
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
            <Text tag="100000">至少 100,000 收藏</Text>
          </Picker>
        </Section>

        <Section
          header={
            <Text>
              {useDateRange
                ? `投稿时间 · ${
                    datePresetLabel ||
                    (formatDateToPixivDate(startTimestamp) ===
                    formatDateToPixivDate(endTimestamp)
                      ? formatDateToPixivDate(startTimestamp)
                      : `${formatDateToPixivDate(
                          startTimestamp
                        )} 至 ${formatDateToPixivDate(endTimestamp)}`)
                  }`
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
                  {QUICK_DATE_PRESETS.map((preset) => {
                    const isSelected = datePresetLabel === preset.label
                    return (
                      <Button
                        key={preset.label}
                        buttonStyle={
                          isSelected ? "borderedProminent" : "bordered"
                        }
                        controlSize="small"
                        action={() => {
                          const range = preset.getTimestamps()
                          setStartTimestamp(range.start)
                          setEndTimestamp(range.end)
                          setDatePresetLabel(preset.label)
                        }}
                      >
                        <Text font="caption">{preset.label}</Text>
                      </Button>
                    )
                  })}
                </HStack>
              </ScrollView>

              <DatePicker
                title="开始日期"
                displayedComponents={["date"]}
                datePickerStyle="compact"
                value={startTimestamp}
                onChanged={(val) => {
                  setStartTimestamp(val)
                  setDatePresetLabel(undefined)
                }}
                startDate={minTimestamp}
                endDate={endTimestamp}
              />

              <DatePicker
                title="结束日期"
                displayedComponents={["date"]}
                datePickerStyle="compact"
                value={endTimestamp}
                onChanged={(val) => {
                  setEndTimestamp(val)
                  setDatePresetLabel(undefined)
                }}
                startDate={startTimestamp}
                endDate={maxTimestamp}
              />
            </>
          ) : null}
        </Section>
      </List>
    </SheetScaffold>
  )
}
