import {
  Button,
  Group,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import {
  ALL_ILLUST_RANKING_OPTIONS,
  ALL_MANGA_RANKING_OPTIONS,
  ALL_NOVEL_RANKING_OPTIONS,
  DEFAULT_ILLUST_RANKING_MODES,
  DEFAULT_MANGA_RANKING_MODES,
  DEFAULT_NOVEL_RANKING_MODES,
  getVisibleRankingOptions,
  loadSettings,
  onSettingsChanged,
  resetCustomRankingKind,
  updateSettings,
  type AppSettings,
  type RankingOptionDef,
} from "../store/settings"
import { useTimedFlag } from "./hooks"

export type CustomRankingPickerKind = "illust" | "manga" | "novel"

export function RankingCustomPickerView(props: { kind: CustomRankingPickerKind }) {
  const { kind } = props
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [isResetSuccess, triggerResetSuccess] = useTimedFlag(2000)
  const [isLimitExceeded, triggerLimitExceeded] = useTimedFlag(2000)

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  const title =
    kind === "illust" ? "插画" : kind === "manga" ? "漫画" : "小说"

  const allOptions = useMemo<ReadonlyArray<RankingOptionDef>>(() => {
    if (kind === "illust") return ALL_ILLUST_RANKING_OPTIONS
    if (kind === "manga") return ALL_MANGA_RANKING_OPTIONS
    return ALL_NOVEL_RANKING_OPTIONS
  }, [kind])

  const defaultModes = useMemo<string[]>(() => {
    if (kind === "illust") return DEFAULT_ILLUST_RANKING_MODES
    if (kind === "manga") return DEFAULT_MANGA_RANKING_MODES
    return DEFAULT_NOVEL_RANKING_MODES
  }, [kind])

  const visibleOptions = useMemo(() => {
    return getVisibleRankingOptions(allOptions, settings)
  }, [allOptions, settings])

  const selectedCurrentKind = useMemo(() => {
    if (kind === "illust") return settings.customRankingIllustModes
    if (kind === "manga") return settings.customRankingMangaModes
    return settings.customRankingNovelModes
  }, [kind, settings])

  // 计算当前类别已选中的有效数量
  const currentKindSelectedCount = useMemo(() => {
    return selectedCurrentKind.filter((m) =>
      visibleOptions.some((o) => o.key === m)
    ).length
  }, [selectedCurrentKind, visibleOptions])

  function handleReset() {
    resetCustomRankingKind(kind)
    triggerResetSuccess()
  }

  function handleToggle(option: RankingOptionDef) {
    const isSelected = selectedCurrentKind.includes(option.key)

    if (isSelected) {
      // 取消选中（允许为空，静默更新）
      const next = selectedCurrentKind.filter((k) => k !== option.key)

      if (kind === "illust") {
        updateSettings({ customRankingIllustModes: next })
      } else if (kind === "manga") {
        updateSettings({ customRankingMangaModes: next })
      } else {
        updateSettings({ customRankingNovelModes: next })
      }
    } else {
      // 检查上限（当前类别最多选择 5 个，达到上限时提示语变红提醒）
      if (currentKindSelectedCount >= 5) {
        triggerLimitExceeded()
        return
      }

      // 添加选中并按原始列表顺序排序
      const nextRaw = [...selectedCurrentKind, option.key]
      const orderKeys = allOptions.map((o) => o.key)
      const next = nextRaw.sort(
        (a, b) => orderKeys.indexOf(a) - orderKeys.indexOf(b)
      )

      if (kind === "illust") {
        updateSettings({ customRankingIllustModes: next })
      } else if (kind === "manga") {
        updateSettings({ customRankingMangaModes: next })
      } else {
        updateSettings({ customRankingNovelModes: next })
      }
    }
  }

  let headerText = "最多可选择 5 个，长按右上角重置按钮恢复默认。"
  let headerColor: "systemRed" | "systemGreen" | "secondaryLabel" =
    "secondaryLabel"

  if (isLimitExceeded) {
    headerText = "最多可选择5个排行榜单"
    headerColor = "systemRed"
  } else if (isResetSuccess) {
    headerText = "已重置回初始状态"
    headerColor = "systemGreen"
  }

  return (
    <List
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarTrailing: [
          <Button
            action={() => {}}
            contextMenu={{
              menuItems: (
                <Group>
                  <Button
                    title="恢复默认榜单"
                    systemImage="arrow.counterclockwise"
                    role="destructive"
                    action={handleReset}
                  />
                </Group>
              ),
            }}
          >
            <Image
              systemName={
                isResetSuccess ? "checkmark" : "arrow.counterclockwise"
              }
              foregroundStyle={isResetSuccess ? "systemGreen" : undefined}
            />
          </Button>,
        ],
      }}
    >
      <Section
        header={
          <Text font="footnote" foregroundStyle={headerColor}>
            {headerText}
          </Text>
        }
      >
        {visibleOptions.map((opt) => {
          const isSelected = selectedCurrentKind.includes(opt.key)
          return (
            <Button
              key={opt.key}
              buttonStyle="plain"
              action={() => handleToggle(opt)}
            >
              <HStack
                alignment="center"
                spacing={12}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                contentShape="rect"
              >
                <Text font="body" foregroundStyle="label">
                  {opt.title}
                </Text>
                <Spacer />
                {isSelected ? (
                  <Image
                    systemName="checkmark"
                    font="body"
                    fontWeight="semibold"
                    foregroundStyle="#007AFF"
                  />
                ) : null}
              </HStack>
            </Button>
          )
        })}
      </Section>
    </List>
  )
}
