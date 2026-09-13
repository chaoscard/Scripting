import {
  Button,
  DatePicker,
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
  useMemo,
  useState,
} from "scripting"
import {
  ALL_ILLUST_RANKING_OPTIONS,
  ALL_MANGA_RANKING_OPTIONS,
  ALL_NOVEL_RANKING_OPTIONS,
  getVisibleRankingOptions,
  type AppSettings,
  type RankingOptionDef,
} from "../store/settings"

export interface AdvancedRankingParams {
  category: "illustration" | "manga" | "novel"
  mode: string
  date: string // "YYYY-MM-DD"
  timestamp: number
}

export function formatDateToPixivDate(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function getYesterdayTimestamp(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime() - 86400000
}

export function getInitialAdvancedParams(): AdvancedRankingParams {
  const ts = getYesterdayTimestamp()
  return {
    category: "illustration",
    mode: "day",
    date: formatDateToPixivDate(ts),
    timestamp: ts,
  }
}

interface QuickDatePreset {
  label: string
  getTimestamp: () => number
}

const QUICK_DATE_PRESETS: QuickDatePreset[] = [
  {
    label: "昨天",
    getTimestamp: () => getYesterdayTimestamp(),
  },
  {
    label: "7天前",
    getTimestamp: () => {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      return d.getTime()
    },
  },
  {
    label: "30天前",
    getTimestamp: () => {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      return d.getTime()
    },
  },
  {
    label: "1年前",
    getTimestamp: () => {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 1)
      return d.getTime()
    },
  },
  {
    label: "3年前",
    getTimestamp: () => {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 3)
      return d.getTime()
    },
  },
  {
    label: "5年前",
    getTimestamp: () => {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 5)
      return d.getTime()
    },
  },
  {
    label: "10年前",
    getTimestamp: () => {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 10)
      return d.getTime()
    },
  },
]

export function RankingAdvancedSheet(props: {
  currentParams: AdvancedRankingParams
  settings: AppSettings
  onApply: (params: AdvancedRankingParams) => void
  onCancel: () => void
}) {
  const { currentParams, settings, onApply, onCancel } = props

  const [category, setCategory] = useState<"illustration" | "manga" | "novel">(
    currentParams.category
  )
  const [selectedMode, setSelectedMode] = useState<string>(currentParams.mode)
  const [selectedTimestamp, setSelectedTimestamp] = useState<number>(
    currentParams.timestamp
  )

  const minTimestamp = useMemo(() => new Date("2007-09-09").getTime(), [])
  const maxTimestamp = useMemo(() => getYesterdayTimestamp(), [])

  // 获取当前分类下可见的有效榜单
  const visibleOptions = useMemo<ReadonlyArray<RankingOptionDef>>(() => {
    let all: ReadonlyArray<RankingOptionDef>
    if (category === "illustration") {
      all = ALL_ILLUST_RANKING_OPTIONS
    } else if (category === "manga") {
      all = ALL_MANGA_RANKING_OPTIONS
    } else {
      all = ALL_NOVEL_RANKING_OPTIONS
    }
    return getVisibleRankingOptions(all, settings)
  }, [category, settings])

  // 当分类变更时，若当前 mode 不在可见列表中，自动校准为第一个
  const activeMode = useMemo(() => {
    const exists = visibleOptions.some((o) => o.key === selectedMode)
    if (exists) return selectedMode
    return visibleOptions[0]?.key ?? "day"
  }, [visibleOptions, selectedMode])

  function handleCategoryChange(nextCategory: "illustration" | "manga" | "novel") {
    setCategory(nextCategory)
    let nextOptions: ReadonlyArray<RankingOptionDef>
    if (nextCategory === "illustration") {
      nextOptions = ALL_ILLUST_RANKING_OPTIONS
    } else if (nextCategory === "manga") {
      nextOptions = ALL_MANGA_RANKING_OPTIONS
    } else {
      nextOptions = ALL_NOVEL_RANKING_OPTIONS
    }
    const filtered = getVisibleRankingOptions(nextOptions, settings)
    if (!filtered.some((o) => o.key === selectedMode)) {
      setSelectedMode(filtered[0]?.key ?? "day")
    }
  }

  function handleApply() {
    const clampedTimestamp = Math.max(
      minTimestamp,
      Math.min(selectedTimestamp, maxTimestamp)
    )
    const formattedDate = formatDateToPixivDate(clampedTimestamp)
    onApply({
      category,
      mode: activeMode,
      date: formattedDate,
      timestamp: clampedTimestamp,
    })
  }

  const currentDateFormatted = formatDateToPixivDate(selectedTimestamp)

  return (
    <NavigationStack>
      <List
        navigationTitle="历史排行榜"
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
              title="搜索"
              systemImage="magnifyingglass"
              fontWeight="bold"
              action={handleApply}
            />,
          ],
        }}
      >
        <Section header={<Text>筛选维度</Text>}>
          <Picker
            title="作品类型"
            value={category}
            onChanged={(val: string) =>
              handleCategoryChange(
                val as "illustration" | "manga" | "novel"
              )
            }
          >
            <Label tag="illustration" title="插画" systemImage="photo" />
            <Label tag="manga" title="漫画" systemImage="photo.on.rectangle" />
            {settings.hideNovels ? null : (
              <Label tag="novel" title="小说" systemImage="book" />
            )}
          </Picker>

          <Picker
            title="榜单类型"
            value={activeMode}
            onChanged={(val: string) => setSelectedMode(val)}
          >
            {visibleOptions.map((opt) => (
              <Text key={opt.key} tag={opt.key}>
                {opt.title}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section header={<Text>{`查询日期 · ${currentDateFormatted}`}</Text>}>
          <ScrollView axes="horizontal">
            <HStack spacing={8} padding={{ vertical: 4 }}>
              {QUICK_DATE_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  buttonStyle="bordered"
                  controlSize="small"
                  action={() => {
                    const ts = preset.getTimestamp()
                    setSelectedTimestamp(
                      Math.max(minTimestamp, Math.min(ts, maxTimestamp))
                    )
                  }}
                >
                  <Text font="caption">{preset.label}</Text>
                </Button>
              ))}
            </HStack>
          </ScrollView>

          <DatePicker
            title="选择日期"
            displayedComponents={["date"]}
            datePickerStyle="graphical"
            value={selectedTimestamp}
            onChanged={(val) => {
              setSelectedTimestamp(val)
            }}
            startDate={minTimestamp}
            endDate={maxTimestamp}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}
