// 浏览历史数据与足迹看板视图 (iOS 26 原生 Liquid Glass 毛玻璃卡片体系与系统色彩体系)
import {
  Button,
  Circle,
  Device,
  Divider,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  NavigationLink,
  NavigationStack,
  Picker,
  Rectangle,
  RoundedRectangle,
  ScrollView,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useMemo,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { appGlass } from "./components/glass"
import {
  sheetDetents,
  unifiedTopBar,
} from "./components/pageChrome"
import { session } from "../api/session"
import { useExperimentalAmbientPalette, useLastActiveAmbientImageUrl } from "./ambient"
import {
  computeHistoryAnalytics,
  HEATMAP_WEEKS_MAX,
  HEATMAP_WEEKS_MIN,
  type AnalyticsScopeKind,
  type AnalyticsTimeRange,
  type HistoryAnalyticsResult,
  type TopCreatorItem,
  type TopTagItem,
} from "../store/historyAnalytics"
import { ResponsiveContainer, useLayoutMetrics } from "./hooks"
import { useDualRoute } from "./DualRouteContext"
import { requestPixivRoute } from "../store/routeNavigation"
import { triggerHaptic } from "../platform/haptics"

export interface HistoryAnalyticsViewProps {
  initialScope?: AnalyticsScopeKind
  initialTimeRange?: AnalyticsTimeRange
  onDismiss?: () => void
  onSelectTag?: (tag: string) => void
  onSelectCreator?: (creatorId: number, creatorName: string) => void
  onOpenUserDetail?: (userId: number) => void
}

/**
 * 核心指标单项
 */
function MetricItem(props: {
  title: string
  value: string | number
  unit?: string
  icon: string
  iconColor?: string
}) {
  return (
    <VStack
      alignment="leading"
      spacing={6}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack alignment="center" spacing={6}>
        <Image
          systemName={props.icon}
          font="subheadline"
          foregroundStyle={(props.iconColor || "secondaryLabel") as any}
        />
        <Text
          font="subheadline"
          fontWeight="semibold"
          foregroundStyle="secondaryLabel"
        >
          {props.title}
        </Text>
      </HStack>

      <HStack alignment="lastTextBaseline" spacing={3}>
        <Text font="title" fontWeight="bold">
          {String(props.value)}
        </Text>
        {props.unit ? (
          <Text
            font="footnote"
            fontWeight="semibold"
            foregroundStyle="secondaryLabel"
          >
            {props.unit}
          </Text>
        ) : null}
      </HStack>
    </VStack>
  )
}

/**
 * 概览指标卡片 (四项共用单一毛玻璃背景卡片)
 */
function OverviewMetricsCard(props: {
  summary: HistoryAnalyticsResult["summary"]
  isWide?: boolean
}) {
  const { totalViews, uniqueCreators, activeDays, bookmarkRate } = props.summary

  return (
    <VStack
      alignment="leading"
      spacing={14}
      padding={16}
      glassEffect={appGlass({ type: "rect", cornerRadius: 16 })}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack alignment="center" spacing={6}>
        <Image
          systemName="square.grid.2x2.fill"
          font="headline"
          foregroundStyle={"systemCyan" as any}
        />
        <Text font="headline" fontWeight="bold">
          概览
        </Text>
      </HStack>

      {props.isWide ? (
        <HStack
          alignment="center"
          spacing={16}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <MetricItem
            title="累计浏览"
            value={totalViews}
            unit="部"
            icon="eye.fill"
            iconColor="systemBlue"
          />
          <MetricItem
            title="创作者"
            value={uniqueCreators}
            unit="位"
            icon="person.2.fill"
            iconColor="systemOrange"
          />
          <MetricItem
            title="活跃天数"
            value={activeDays}
            unit="天"
            icon="calendar"
            iconColor="systemGreen"
          />
          <MetricItem
            title="心动转化"
            value={`${bookmarkRate}%`}
            icon="heart.fill"
            iconColor="systemPink"
          />
        </HStack>
      ) : (
        <VStack spacing={14} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <HStack spacing={16} frame={{ maxWidth: "infinity" }}>
            <MetricItem
              title="累计浏览"
              value={totalViews}
              unit="部"
              icon="eye.fill"
              iconColor="systemBlue"
            />
            <MetricItem
              title="创作者"
              value={uniqueCreators}
              unit="位"
              icon="person.2.fill"
              iconColor="systemOrange"
            />
          </HStack>

          <Divider />

          <HStack spacing={16} frame={{ maxWidth: "infinity" }}>
            <MetricItem
              title="活跃天数"
              value={activeDays}
              unit="天"
              icon="calendar"
              iconColor="systemGreen"
            />
            <MetricItem
              title="心动转化"
              value={`${bookmarkRate}%`}
              icon="heart.fill"
              iconColor="systemPink"
            />
          </HStack>
        </VStack>
      )}
    </VStack>
  )
}

/**
 * 24 小时时段分布图表 (原生毛玻璃卡片与系统蓝色彩体系)
 */
function HourlyDistributionSection(props: {
  hourly: HistoryAnalyticsResult["hourly"]
  totalViews: number
}) {
  const { hours, maxCount, peakHour, peakTimeRangeDesc, persona } = props.hourly

  return (
    <VStack
      alignment="leading"
      spacing={14}
      padding={16}
      glassEffect={appGlass({ type: "rect", cornerRadius: 16 })}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <HStack alignment="center" spacing={6}>
          <Image
            systemName="clock.fill"
            font="headline"
            foregroundStyle={"systemBlue" as any}
          />
          <Text font="headline" fontWeight="bold">
            24 小时活跃时段
          </Text>
          <Spacer />
          <Text font="caption" foregroundStyle={"systemBlue" as any} fontWeight="semibold">
            峰值 {peakTimeRangeDesc}
          </Text>
        </HStack>
        <Text font="footnote" foregroundStyle="secondaryLabel">
          {persona}
        </Text>
      </VStack>

      {/* 24 小时柱状分布 */}
      <HStack
        alignment="bottom"
        spacing={2}
        frame={{ height: 86, maxWidth: "infinity" }}
        padding={{ top: 8, bottom: 4 }}
      >
        {hours.map((count, h) => {
          const ratio = maxCount > 0 ? count / maxCount : 0
          const barHeight = Math.max(4, Math.round(ratio * 70))
          const isPeak = h === peakHour && count > 0

          return (
            <VStack
              key={`hour-${h}`}
              alignment="center"
              spacing={4}
              frame={{ maxWidth: "infinity" }}
            >
              <RoundedRectangle
                cornerRadius={2}
                fill={
                  isPeak
                    ? ("systemBlue" as any)
                    : count > 0
                    ? ("#007AFF99" as any)
                    : ("quaternarySystemFill" as any)
                }
                frame={{ height: barHeight, maxWidth: "infinity" }}
              />
            </VStack>
          )
        })}
      </HStack>

      {/* 底部时间轴刻度 */}
      <HStack frame={{ maxWidth: "infinity" }}>
        <Text font="caption2" foregroundStyle="tertiaryLabel">00:00</Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="tertiaryLabel">06:00</Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="tertiaryLabel">12:00</Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="tertiaryLabel">18:00</Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="tertiaryLabel">23:00</Text>
      </HStack>
    </VStack>
  )
}

/**
 * 热力图排版常量（三级兜底：弹性周数 → 格子放大 → 整体居中）
 */
const HEATMAP_CELL_MIN = 12 // 基准格子边长（与旧版观感一致）
const HEATMAP_CELL_MAX = 16 // 宽屏兜底放大上限，避免格子过大失衡
const HEATMAP_CELL_GAP = 3.5
/** 卡片可用内宽 = 容器宽度 − 页面 padding 16×2 − 卡片 padding 16×2 */
const HEATMAP_CARD_H_PADDING = 64

/**
 * 按卡片真实内宽推导热力图排版
 * 1) 固定 12pt 基准格子，先由宽度决定周数（20 ~ 53 周，53 周 ≈ 近一年）
 * 2) 周数封顶后仍有富余，则把格子放大到最多 16pt 补满
 * 3) 仍补不满（超宽窗口）则整体居中；宽度不足时保持 12pt 并保留横向滚动
 */
export function resolveHeatmapLayout(innerWidth: number, actualWeeks?: number) {
  const usable = Math.max(0, innerWidth)
  const weeksFromWidth = Math.floor(
    (usable + HEATMAP_CELL_GAP) / (HEATMAP_CELL_MIN + HEATMAP_CELL_GAP)
  )
  const weeks = Math.max(
    HEATMAP_WEEKS_MIN,
    Math.min(HEATMAP_WEEKS_MAX, weeksFromWidth)
  )
  const targetWeeks = actualWeeks && actualWeeks > 0 ? actualWeeks : weeks
  const exactCell = (usable - (targetWeeks - 1) * HEATMAP_CELL_GAP) / targetWeeks
  const cell =
    Math.round(
      Math.max(HEATMAP_CELL_MIN, Math.min(HEATMAP_CELL_MAX, exactCell)) * 100
    ) / 100
  const contentWidth = targetWeeks * cell + (targetWeeks - 1) * HEATMAP_CELL_GAP
  const needsScroll = contentWidth > usable + 0.5

  return {
    /** 供数据层使用的目标周数 */
    weeks,
    /** 实际渲染的格子边长（正方形） */
    cell,
    /** 网格实际内容宽度 */
    contentWidth,
    /** 内容溢出容器：保留横向滚动 */
    needsScroll,
    /** 内容无法铺满容器：整体居中 */
    centered: !needsScroll && contentWidth < usable - 0.5,
  }
}

/**
 * 活跃热力日历矩阵 (原生毛玻璃卡片与 GitHub 官方真实渐变色阶体系)
 */
function ActivityHeatmapSection(props: {
  heatmap: HistoryAnalyticsResult["heatmap"]
  activeDays: number
  availableWidth: number
}) {
  const { weeks: weekList, startDateStr, endDateStr } = props.heatmap
  const layout = resolveHeatmapLayout(props.availableWidth, weekList.length)
  const cellRadius = Math.max(2.5, Math.round(layout.cell * 0.2 * 10) / 10)

  const getCellFill = (level: number) => {
    switch (level) {
      case 4:
        return { light: "#216E39", dark: "#39D353" } as any
      case 3:
        return { light: "#30A14E", dark: "#26A641" } as any
      case 2:
        return { light: "#40C463", dark: "#006D32" } as any
      case 1:
        return { light: "#9BE9A8", dark: "#0E4429" } as any
      case 0:
      default:
        return "quaternarySystemFill" as any
    }
  }

  const grid = (
    <HStack spacing={HEATMAP_CELL_GAP} padding={{ top: 4, bottom: 4 }}>
      {weekList.map((week, wIdx) => (
        <VStack key={`week-${wIdx}`} spacing={HEATMAP_CELL_GAP}>
          {week.days.map((day, dIdx) => (
            <RoundedRectangle
              key={`day-${wIdx}-${dIdx}`}
              cornerRadius={cellRadius}
              fill={getCellFill(day.level)}
              frame={{ width: layout.cell, height: layout.cell }}
            />
          ))}
        </VStack>
      ))}
    </HStack>
  )

  return (
    <VStack
      alignment="leading"
      spacing={14}
      padding={16}
      glassEffect={appGlass({ type: "rect", cornerRadius: 16 })}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack alignment="center" spacing={6}>
        <Image
          systemName="square.grid.3x3.fill"
          font="headline"
          foregroundStyle={"systemGreen" as any}
        />
        <Text font="headline" fontWeight="bold">
          活跃足迹热力图
        </Text>
        <Spacer />
        <Text font="footnote" foregroundStyle="secondaryLabel">
          近 {weekList.length} 周 · {props.activeDays} 活跃天
        </Text>
      </HStack>

      {/* 热力网格：宽度自适应（溢出滚动 / 铺满居中 两级兜底） */}
      {layout.needsScroll ? (
        <ScrollView axes="horizontal">{grid}</ScrollView>
      ) : (
        <VStack spacing={0} frame={{ maxWidth: "infinity", alignment: "center" }}>
          {grid}
        </VStack>
      )}

      {/* 图例与时间区间 */}
      <HStack alignment="center" spacing={6} frame={{ maxWidth: "infinity" }}>
        <Text font="caption2" foregroundStyle="tertiaryLabel">
          {startDateStr} ~ {endDateStr}
        </Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="tertiaryLabel">少</Text>
        <HStack spacing={3}>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <RoundedRectangle
              key={`legend-${lvl}`}
              cornerRadius={2}
              fill={getCellFill(lvl)}
              frame={{ width: 10, height: 10 }}
            />
          ))}
        </HStack>
        <Text font="caption2" foregroundStyle="tertiaryLabel">多</Text>
      </HStack>
    </VStack>
  )
}

/**
 * Top 标签排行 (原生毛玻璃卡片，更名为「标签」，只显示 Top 15)
 */
function TopTagsSection(props: {
  tags: TopTagItem[]
  onSelectTag?: (tag: string) => void
}) {
  if (!props.tags || props.tags.length === 0) return null

  const getRankColor = (idx: number) => {
    if (idx === 0) return "#FF9500" // 金牌橙
    if (idx === 1) return "#30B0C7" // 青蓝
    if (idx === 2) return "#5856D6" // 靛青紫
    return "secondaryLabel"
  }

  return (
    <VStack
      alignment="leading"
      spacing={14}
      padding={16}
      glassEffect={appGlass({ type: "rect", cornerRadius: 16 })}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack alignment="center" spacing={6}>
        <Image
          systemName="tag.fill"
          font="headline"
          foregroundStyle={"systemTeal" as any}
        />
        <Text font="headline" fontWeight="bold">
          标签
        </Text>
        <Spacer />
        <Text
          font="footnote"
          fontWeight="semibold"
          foregroundStyle={"systemTeal" as any}
        >
          Top {props.tags.length}
        </Text>
      </HStack>

      <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
        {props.tags.map((tag, idx) => {
          const rankColor = getRankColor(idx)
          const isTop3 = idx < 3
          const itemColor = isTop3 ? rankColor : undefined

          return (
            <Button
              key={`tag-${idx}-${tag.name}`}
              buttonStyle="plain"
              action={() => {
                triggerHaptic("selection")
                if (props.onSelectTag) {
                  props.onSelectTag(tag.name)
                }
              }}
            >
              <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
                <HStack alignment="center" spacing={8}>
                  <Text
                    font="caption"
                    fontWeight="bold"
                    foregroundStyle={rankColor as any}
                    frame={{ width: 24, alignment: "leading" }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </Text>
                  <Text
                    font="subheadline"
                    fontWeight={isTop3 ? "bold" : "medium"}
                    foregroundStyle={(itemColor || "label") as any}
                    lineLimit={1}
                  >
                    {tag.name}
                  </Text>
                  {tag.translatedName && tag.translatedName !== tag.name ? (
                    <Text
                      font="caption"
                      foregroundStyle={(itemColor || "secondaryLabel") as any}
                      lineLimit={1}
                    >
                      {tag.translatedName}
                    </Text>
                  ) : null}
                  <Spacer />
                  <Text
                    font="footnote"
                    foregroundStyle={(itemColor || "secondaryLabel") as any}
                  >
                    {tag.count} 部
                  </Text>
                  <Text
                    font="caption"
                    fontWeight="semibold"
                    foregroundStyle={(itemColor || "secondaryLabel") as any}
                    frame={{ width: 36, alignment: "trailing" }}
                  >
                    {tag.percentage}%
                  </Text>
                </HStack>

                {/* 占比横条 */}
                <ZStack frame={{ height: 4, maxWidth: "infinity" }} alignment="leading">
                  <RoundedRectangle
                    cornerRadius={2}
                    fill={"quaternarySystemFill" as any}
                    frame={{ height: 4, maxWidth: "infinity" }}
                  />
                  <RoundedRectangle
                    cornerRadius={2}
                    fill={isTop3 ? (rankColor as any) : ("tertiaryLabel" as any)}
                    frame={{
                      height: 4,
                      width: Math.max(8, Math.round((Math.max(2, Math.min(100, tag.percentage)) / 100) * 200)),
                    }}
                  />
                </ZStack>
              </VStack>
            </Button>
          )
        })}
      </VStack>
    </VStack>
  )
}

/**
 * Top 创作者图谱 (原生毛玻璃卡片，更名为「创作者」，symbol 为 person.2.fill，严格左对齐)
 */
function TopCreatorsSection(props: {
  creators: TopCreatorItem[]
  onSelectCreator?: (creatorId: number, creatorName: string) => void
  onOpenUserDetail?: (userId: number) => void
}) {
  if (!props.creators || props.creators.length === 0) return null

  const getRankColor = (idx: number) => {
    if (idx === 0) return "#FF9500"
    if (idx === 1) return "#30B0C7"
    if (idx === 2) return "#5856D6"
    return "secondaryLabel"
  }

  return (
    <VStack
      alignment="leading"
      spacing={14}
      padding={16}
      glassEffect={appGlass({ type: "rect", cornerRadius: 16 })}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack alignment="center" spacing={6}>
        <Image
          systemName="person.2.fill"
          font="headline"
          foregroundStyle={"systemOrange" as any}
        />
        <Text font="headline" fontWeight="bold">
          创作者
        </Text>
        <Spacer />
        <Text
          font="footnote"
          fontWeight="semibold"
          foregroundStyle={"systemOrange" as any}
        >
          Top {props.creators.length}
        </Text>
      </HStack>

      <VStack spacing={10} frame={{ maxWidth: "infinity" }}>
        {props.creators.map((c, idx) => {
          const rankColor = getRankColor(idx)
          const isTop3 = idx < 3
          const itemColor = isTop3 ? rankColor : undefined
          const buttonColor = isTop3 ? rankColor : "systemBlue"

          return (
            <HStack
              key={`creator-${idx}-${c.id}`}
              alignment="center"
              spacing={10}
              padding={{ vertical: 2 }}
              frame={{ maxWidth: "infinity" }}
            >
              {/* 排名标号 (固定宽度杜绝折行) */}
              <Text
                font="subheadline"
                fontWeight="bold"
                foregroundStyle={rankColor as any}
                frame={{ width: 24, alignment: "leading" }}
              >
                {String(idx + 1).padStart(2, "0")}
              </Text>

              {/* 画师名称与心动信息 (严格靠左对齐，去除居中偏差) */}
              <VStack
                alignment="leading"
                spacing={2}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                <Text
                  font="subheadline"
                  fontWeight={isTop3 ? "bold" : "medium"}
                  foregroundStyle={(itemColor || "label") as any}
                  lineLimit={1}
                >
                  {c.name}
                </Text>
                <HStack alignment="center" spacing={8}>
                  <Text
                    font="caption"
                    foregroundStyle={(itemColor || "secondaryLabel") as any}
                  >
                    浏览 {c.viewCount} 部
                  </Text>
                  {c.bookmarkCount > 0 ? (
                    <HStack alignment="center" spacing={2}>
                      <Image
                        systemName="heart.fill"
                        font="caption2"
                        foregroundStyle={"systemPink" as any}
                      />
                      <Text
                        font="caption"
                        foregroundStyle={(itemColor || "systemPink") as any}
                      >
                        心动 {c.bookmarkCount} 部 ({c.bookmarkRate}%)
                      </Text>
                    </HStack>
                  ) : null}
                </HStack>
              </VStack>

              {/* 右侧操作按钮 (交换顺序：主页在上，历史在下；非前三为蓝色，前三为专属主题色) */}
              <VStack alignment="trailing" spacing={4}>
                {props.onOpenUserDetail ? (
                  <Button
                    buttonStyle="glass"
                    controlSize="mini"
                    action={() => {
                      triggerHaptic("light")
                      props.onOpenUserDetail!(c.id)
                    }}
                  >
                    <HStack spacing={3}>
                      <Image
                        systemName="person.crop.circle"
                        font="caption2"
                        foregroundStyle={buttonColor as any}
                      />
                      <Text
                        font="caption2"
                        foregroundStyle={buttonColor as any}
                      >
                        主页
                      </Text>
                    </HStack>
                  </Button>
                ) : null}

                {props.onSelectCreator ? (
                  <Button
                    buttonStyle="glass"
                    controlSize="mini"
                    action={() => {
                      triggerHaptic("selection")
                      props.onSelectCreator!(c.id, c.name)
                    }}
                  >
                    <HStack spacing={3}>
                      <Image
                        systemName="clock.arrow.circlepath"
                        font="caption2"
                        foregroundStyle={buttonColor as any}
                      />
                      <Text
                        font="caption2"
                        foregroundStyle={buttonColor as any}
                      >
                        历史
                      </Text>
                    </HStack>
                  </Button>
                ) : null}
              </VStack>
            </HStack>
          )
        })}
      </VStack>
    </VStack>
  )
}

/**
 * 环形饼图数据切片
 */
interface DonutSlice {
  value: number
  color: string
}

/**
 * 原生 SwiftUI 纯矢量环形切片 (零额外背景、原生抗锯齿)
 */
function DonutChart(props: {
  slices: DonutSlice[]
  size?: number
  lineWidth?: number
}) {
  const size = props.size || 50
  const lineWidth = props.lineWidth || 6
  const total = props.slices.reduce((acc, s) => acc + (s.value > 0 ? s.value : 0), 0)

  if (total <= 0) return null

  const activeSlices = props.slices.filter((s) => s.value > 0)
  let currentPct = 0

  return (
    <ZStack frame={{ width: size, height: size }} rotationEffect={-90}>
      {activeSlices.map((slice, idx) => {
        const ratio = slice.value / total
        const start = currentPct
        const end = currentPct + ratio
        currentPct += ratio

        return (
          <Circle
            key={`slice-${idx}`}
            trim={{ from: start, to: end }}
            stroke={{
              shapeStyle: slice.color as any,
              strokeStyle: {
                lineWidth: lineWidth,
                lineCap: "round",
              },
            }}
            frame={{ width: size - lineWidth, height: size - lineWidth }}
          />
        )
      })}
    </ZStack>
  )
}

/**
 * 环形图图例单项
 */
function DonutLegendItem(props: {
  color: string
  label: string
  pct: number
}) {
  return (
    <HStack spacing={3} alignment="center" frame={{ maxWidth: "infinity" }}>
      <Circle frame={{ width: 5, height: 5 }} fill={props.color as any} />
      <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
        {props.label}
      </Text>
      <Spacer />
      <Text font="caption2" fontWeight="semibold" lineLimit={1}>
        {props.pct}%
      </Text>
    </HStack>
  )
}

/**
 * 最大余数法整数百分比分配：保证同一栏内各分类合计恰好 100%
 */
function allocatePercentages(values: number[]): number[] {
  const total = values.reduce((acc, v) => acc + (v > 0 ? v : 0), 0)
  if (total <= 0) return values.map(() => 0)

  const exact = values.map((v) => ((v > 0 ? v : 0) / total) * 100)
  const floors = exact.map((v) => Math.floor(v))
  const result = floors.slice()

  // 余数从大到小依次补 1，保证总和回到 100
  let remaining = 100 - floors.reduce((acc, v) => acc + v, 0)
  const order = exact
    .map((v, index) => ({ index, fraction: v - Math.floor(v) }))
    .sort((a, b) => b.fraction - a.fraction)
  let cursor = 0
  while (remaining > 0 && cursor < order.length) {
    result[order[cursor].index] += 1
    remaining -= 1
    cursor += 1
  }

  return result
}

/**
 * 环形图栏目分类项
 */
interface DonutColumnSlice {
  label: string
  value: number
  color: string
}

/**
 * 环形图栏目：同一栏内「切片集合 ≡ 图例集合 ≡ 百分比分母」
 */
interface DonutColumn {
  key: string
  title: string
  slices: DonutColumnSlice[]
}

/**
 * 按作用域构建「美学构图与形态」栏目
 * 不变量：同一栏的分母即本栏各分类值之和，且值为 0 的分类一律不显示，
 * 因此只要该栏有数据，图例百分比必然合计 100%。
 */
function buildDonutColumns(
  scope: AnalyticsScopeKind,
  distribution: HistoryAnalyticsResult["aspectAndFormat"]
): DonutColumn[] {
  const { aspectRatio, mediaType, aiDistribution, mangaPageBuckets } = distribution

  // ① 长宽比画像（仅美术作品；小说无尺寸维度）
  const aspectColumn: DonutColumn = {
    key: "aspect",
    title: "长宽比画像",
    slices: [
      { label: "常规竖屏", value: aspectRatio.tall, color: "#AF52DE" },
      { label: "超高壁纸", value: aspectRatio.ultraTall, color: "#5856D6" },
      { label: "电脑横屏", value: aspectRatio.wide, color: "#30B0C7" },
      { label: "方形", value: aspectRatio.square, color: "#8E8E93" },
    ],
  }

  // ② 美术形态：插画 / 全部口径为「画集与动图」（美术口径，不含小说）
  const mediaColumn: DonutColumn = {
    key: "media",
    title: "画集与动图",
    slices: [
      { label: "单图插画", value: mediaType.singleIllust, color: "#007AFF" },
      { label: "多图画集", value: mediaType.multiIllust, color: "#FF9500" },
      { label: "动图作品", value: mediaType.ugoira, color: "#00C7BE" },
      { label: "漫画", value: mediaType.manga, color: "#5856D6" },
    ],
  }

  // ② 仅漫画：篇幅分布（按作品总页数分档）
  const mangaPageColumn: DonutColumn = {
    key: "mangaPages",
    title: "篇幅分布",
    slices: [
      { label: "单页", value: mangaPageBuckets.single, color: "#007AFF" },
      { label: "短篇", value: mangaPageBuckets.short, color: "#FF9500" },
      { label: "中篇", value: mangaPageBuckets.medium, color: "#00C7BE" },
      { label: "长篇", value: mangaPageBuckets.long, color: "#5856D6" },
    ],
  }

  // ③ 创作类型：分母含小说（AI 属性对小说同样成立）
  const aiColumn: DonutColumn = {
    key: "ai",
    title: "创作类型",
    slices: [
      { label: "原创作者", value: aiDistribution.nonAi, color: "#34C759" },
      { label: "AI 生成", value: aiDistribution.ai, color: "#8E8E93" },
    ],
  }

  switch (scope) {
    case "illustration":
      return [aspectColumn, mediaColumn, aiColumn]
    case "manga":
      return [aspectColumn, mangaPageColumn, aiColumn]
    case "novel":
      // 小说不存在美术维度，整张卡片隐藏
      return []
    case "all":
    default:
      return [aspectColumn, mediaColumn, aiColumn]
  }
}

/**
 * 美学构图与形态仪表盘 (原生环形切片 Bento 卡片，严格按作用域分栏)
 */
function FormatAndAspectSection(props: {
  distribution: HistoryAnalyticsResult["aspectAndFormat"]
  scope: AnalyticsScopeKind
}) {
  const columns = useMemo(() => {
    return buildDonutColumns(props.scope, props.distribution)
      .map((column) => {
        const activeSlices = column.slices.filter((s) => s.value > 0)
        return {
          ...column,
          activeSlices,
          percentages: allocatePercentages(activeSlices.map((s) => s.value)),
        }
      })
      .filter((column) => column.activeSlices.length > 0)
  }, [props.scope, props.distribution])

  // 仅小说无任何美术维度；无有效分类时同样隐藏整卡
  if (props.scope === "novel" || columns.length === 0) {
    return null
  }

  return (
    <VStack
      alignment="leading"
      spacing={14}
      padding={16}
      glassEffect={appGlass({ type: "rect", cornerRadius: 16 })}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack alignment="center" spacing={6}>
        <Image
          systemName="aspectratio.fill"
          font="headline"
          foregroundStyle={"systemPurple" as any}
        />
        <Text font="headline" fontWeight="bold">
          美学构图与形态
        </Text>
      </HStack>

      {/* 栏目数量随作用域变化（仅小说为 0 栏并隐藏整卡） */}
      <HStack spacing={12} alignment="top" frame={{ maxWidth: "infinity" }}>
        {columns.map((column) => (
          <VStack
            key={column.key}
            alignment="center"
            spacing={8}
            frame={{ maxWidth: "infinity" }}
          >
            <DonutChart
              slices={column.activeSlices.map((s) => ({
                value: s.value,
                color: s.color,
              }))}
            />
            <Text font="caption" fontWeight="bold">
              {column.title}
            </Text>
            <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
              {column.activeSlices.map((s, idx) => (
                <DonutLegendItem
                  key={s.label}
                  color={s.color}
                  label={s.label}
                  pct={column.percentages[idx]}
                />
              ))}
            </VStack>
          </VStack>
        ))}
      </HStack>
    </VStack>
  )
}

/**
 * 小说专属阅读里程碑 (原生毛玻璃卡片与靛青紫风格)
 */
function NovelMilestoneSection(props: {
  milestone: HistoryAnalyticsResult["novelMilestone"]
}) {
  if (!props.milestone || props.milestone.totalWords <= 0) return null
  const { totalWords, averageWords, comparisonText, readingTimeMinutes, aiDistribution } =
    props.milestone

  const formatReadingTime = (minutes: number) => {
    if (minutes < 60) {
      return `${Math.max(1, minutes)} 分钟`
    }
    if (minutes < 600) {
      const hours = (minutes / 60).toFixed(1)
      return `${hours.endsWith(".0") ? hours.slice(0, -2) : hours} 小时`
    }
    return `${Math.round(minutes / 60)} 小时`
  }

  // AI 率（小说专属口径）：复刻美学卡片的环形图与图例
  // 右栏保持自然宽度且右对齐 —— 左栏占剩余宽度（保证「累计阅读约…」正常换行），
  // 环靠右与百分比对齐，图例行不用 Spacer 撑开，标签与百分比紧邻
  const aiSlices = [
    { label: "原创作者", value: aiDistribution.nonAi, color: "#34C759" },
    { label: "AI 生成", value: aiDistribution.ai, color: "#8E8E93" },
  ].filter((s) => s.value > 0)
  const aiPercentages = allocatePercentages(aiSlices.map((s) => s.value))

  return (
    <VStack
      alignment="leading"
      spacing={10}
      padding={16}
      glassEffect={appGlass({ type: "rect", cornerRadius: 16 })}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack alignment="center" spacing={6}>
        <Image
          systemName="book.closed.fill"
          font="headline"
          foregroundStyle={"systemIndigo" as any}
        />
        <Text font="headline" fontWeight="bold">
          小说阅读里程碑
        </Text>
      </HStack>

      {/* 左栏：累计字数与阅读量；右栏：AI 率环形图与紧邻图例 */}
      <HStack alignment="top" spacing={16} frame={{ maxWidth: "infinity" }}>
        <VStack
          alignment="leading"
          spacing={4}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <HStack alignment="lastTextBaseline" spacing={4}>
            <Text font="title" fontWeight="heavy" foregroundStyle={"systemIndigo" as any}>
              {(totalWords / 10000).toFixed(1)}
            </Text>
            <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
              万字
            </Text>
          </HStack>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            累计阅读约 {formatReadingTime(readingTimeMinutes)} · 篇均 {averageWords} 字
          </Text>
          {comparisonText ? (
            <Text font="callout" foregroundStyle="secondaryLabel">
              {comparisonText}
            </Text>
          ) : null}
        </VStack>

        {aiSlices.length > 0 ? (
          /* 外栏居中：环水平居中对齐到图例行（含圆点与百分比的整行）的正上方 */
          <VStack alignment="center" spacing={6}>
            <DonutChart
              slices={aiSlices.map((s) => ({ value: s.value, color: s.color }))}
            />
            <Text font="caption" fontWeight="bold">
              创作类型
            </Text>
            <VStack spacing={3} alignment="leading">
              {aiSlices.map((s, idx) => (
                <HStack key={s.label} spacing={3} alignment="center">
                  <Circle frame={{ width: 5, height: 5 }} fill={s.color as any} />
                  <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                    {s.label}
                  </Text>
                  <Text font="caption2" fontWeight="semibold" lineLimit={1}>
                    {aiPercentages[idx]}%
                  </Text>
                </HStack>
              ))}
            </VStack>
          </VStack>
        ) : null}
      </HStack>
    </VStack>
  )
}

/**
 * 完整数据与足迹看板核心视图
 */
export function HistoryAnalyticsView(props: HistoryAnalyticsViewProps) {
  const [scope, setScope] = useState<AnalyticsScopeKind>(props.initialScope || "all")
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>(props.initialTimeRange || "all")
  const { isSplitViewActive, openDetailRoute } = useDualRoute()

  // 当外部传入的分类类型（如插画、漫画、小说）变化时，自动联动切换看板类型
  useEffect(() => {
    if (props.initialScope) {
      setScope(props.initialScope)
    }
  }, [props.initialScope])

  const handleOpenUserDetail = useCallback(
    (userId: number) => {
      if (props.onOpenUserDetail) {
        props.onOpenUserDetail(userId)
        return
      }
      if (props.onDismiss) {
        props.onDismiss()
        setTimeout(() => {
          requestPixivRoute(`user:${userId}`)
        }, 260)
      } else {
        requestPixivRoute(`user:${userId}`)
      }
    },
    [props.onOpenUserDetail, props.onDismiss]
  )

  const user = session.user
  const avatarURL = user?.profile_image_urls?.px_170x170 ?? null
  const lastActiveUrl = useLastActiveAmbientImageUrl()
  const ambientUrl = lastActiveUrl || avatarURL
  const { ambientBackground } = useExperimentalAmbientPalette(ambientUrl, true)

  const content = (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      navigationTitle="我的足迹"
      navigationBarTitleDisplayMode="inline"
      {...unifiedTopBar()}
      toolbar={{
        topBarLeading: props.onDismiss ? (
          <Button
            action={() => {
              triggerHaptic("light")
              props.onDismiss!()
            }}
          >
            <Image systemName="xmark" />
          </Button>
        ) : undefined,
        principal: (
          <Text font="headline" fontWeight="semibold">
            我的足迹
          </Text>
        ),
        topBarTrailing: (
          <Menu
            label={
              <Image systemName="line.3.horizontal.decrease" />
            }
          >
            <Picker
              title="时间范围"
              value={timeRange}
              onChanged={(val: string) => {
                triggerHaptic("selection")
                setTimeRange(val as AnalyticsTimeRange)
              }}
            >
              <Label tag="all" title="全部时间" systemImage="calendar" />
              <Label tag="week" title="近一周" systemImage="clock.arrow.circlepath" />
              <Label tag="month" title="近一月" systemImage="clock" />
              <Label tag="quarter" title="近一季" systemImage="calendar.badge.clock" />
              <Label tag="year" title="近一年" systemImage="calendar" />
            </Picker>

            <Picker
              title="记录类型"
              value={scope}
              onChanged={(val: string) => {
                triggerHaptic("selection")
                setScope(val as AnalyticsScopeKind)
              }}
            >
              <Label tag="all" title="全部类型" systemImage="square.grid.2x2" />
              <Label tag="illustration" title="插画" systemImage="photo" />
              <Label tag="manga" title="漫画" systemImage="photo.on.rectangle" />
              <Label tag="novel" title="小说" systemImage="book" />
            </Picker>
          </Menu>
        ),
      }}
    >
      {typeof ambientBackground === "object" && ambientBackground !== null ? (
        ambientBackground
      ) : (
        <Rectangle fill={ambientBackground ?? "clear"} ignoresSafeArea={true} />
      )}
      <ResponsiveContainer>
        <HistoryAnalyticsBoard
          scope={scope}
          timeRange={timeRange}
          onSelectTag={props.onSelectTag}
          onSelectCreator={props.onSelectCreator}
          onOpenUserDetail={handleOpenUserDetail}
        />
      </ResponsiveContainer>
    </ZStack>
  )

  if (props.onDismiss) {
    return (
      <NavigationStack
        presentationDetents={sheetDetents()}
        presentationDragIndicator="visible"
      >
        {content}
      </NavigationStack>
    )
  }

  return content
}

/**
 * 看板内容区（位于 ResponsiveContainer 内部）
 * 因为调用 useLayoutMetrics()，所以必须作为容器测量组件的子节点，
 * 这样在 iPad form sheet / 分屏 / 台前调度下拿到的是本容器真实宽度而非窗口宽度
 */
function HistoryAnalyticsBoard(props: {
  scope: AnalyticsScopeKind
  timeRange: AnalyticsTimeRange
  onSelectTag?: (tag: string) => void
  onSelectCreator?: (creatorId: number, creatorName: string) => void
  onOpenUserDetail: (userId: number) => void
}) {
  const metrics = useLayoutMetrics()

  // 热力图排版：卡片真实内宽（容器宽 − 页面 padding − 卡片 padding）→ 目标周数
  const heatmapAvailableWidth = Math.max(0, metrics.width - HEATMAP_CARD_H_PADDING)
  const heatmapLayout = useMemo(
    () => resolveHeatmapLayout(heatmapAvailableWidth),
    [heatmapAvailableWidth]
  )

  // 计算分析数据（热力图窗口周数随容器宽度变化，需一并纳入指纹缓存）
  const data = useMemo(() => {
    return computeHistoryAnalytics(props.scope, props.timeRange, {
      heatmapWeeks: heatmapLayout.weeks,
    })
  }, [props.scope, props.timeRange, heatmapLayout.weeks])

  const isWide = metrics.width >= 620

  return (
    <ScrollView
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      presentationContentInteraction="scrolls"
      scrollContentBackground="hidden"
    >
      <VStack
        spacing={12}
        padding={{ horizontal: 16, top: 12, bottom: 32 }}
        frame={{ maxWidth: "infinity" }}
      >
        {/* 1. 核心概览指标 (共用单一毛玻璃背景卡片) */}
        <OverviewMetricsCard summary={data.summary} isWide={isWide} />

        {/* 2. 小说专属阅读里程碑（若有） */}
        {data.novelMilestone && data.novelMilestone.totalWords > 0 ? (
          <NovelMilestoneSection milestone={data.novelMilestone} />
        ) : null}

        {/* 3. 24 小时活跃时段分布 */}
        <HourlyDistributionSection
          hourly={data.hourly}
          totalViews={data.summary.totalViews}
        />

        {/* 4. 活跃热力日历矩阵（窗口周数与格子尺寸随容器宽度自适应） */}
        <ActivityHeatmapSection
          heatmap={data.heatmap}
          activeDays={data.summary.activeDays}
          availableWidth={heatmapAvailableWidth}
        />

        {/* 5. 题材偏好与创作者榜单 (大屏并排，小屏单列) */}
        {isWide ? (
          <HStack alignment="top" spacing={16} frame={{ maxWidth: "infinity" }}>
            <TopTagsSection tags={data.topTags} onSelectTag={props.onSelectTag} />
            <TopCreatorsSection
              creators={data.topCreators}
              onSelectCreator={props.onSelectCreator}
              onOpenUserDetail={props.onOpenUserDetail}
            />
          </HStack>
        ) : (
          <VStack spacing={16} frame={{ maxWidth: "infinity" }}>
            <TopTagsSection tags={data.topTags} onSelectTag={props.onSelectTag} />
            <TopCreatorsSection
              creators={data.topCreators}
              onSelectCreator={props.onSelectCreator}
              onOpenUserDetail={props.onOpenUserDetail}
            />
          </VStack>
        )}

        {/* 6. 美学构图与创作形态（严格按作用域分栏，仅小说隐藏整卡） */}
        <FormatAndAspectSection
          distribution={data.aspectAndFormat}
          scope={props.scope}
        />
      </VStack>
    </ScrollView>
  )
}

export default HistoryAnalyticsView
