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
import {
  computeHistoryAnalytics,
  type AnalyticsScopeKind,
  type AnalyticsTimeRange,
  type HistoryAnalyticsResult,
  type TopCreatorItem,
  type TopTagItem,
} from "../store/historyAnalytics"
import { useLayoutMetrics } from "./hooks"
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
      glassEffect={{ type: "rect", cornerRadius: 16 }}
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
      glassEffect={{ type: "rect", cornerRadius: 16 }}
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
 * 活跃热力日历矩阵 (原生毛玻璃卡片与 GitHub 官方真实渐变色阶体系)
 */
function ActivityHeatmapSection(props: {
  heatmap: HistoryAnalyticsResult["heatmap"]
  activeDays: number
}) {
  const { weeks, startDateStr, endDateStr } = props.heatmap

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

  return (
    <VStack
      alignment="leading"
      spacing={14}
      padding={16}
      glassEffect={{ type: "rect", cornerRadius: 16 }}
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
          近 {weeks.length} 周 · {props.activeDays} 活跃天
        </Text>
      </HStack>

      {/* 热力网格 */}
      <ScrollView axes="horizontal">
        <HStack spacing={3.5} padding={{ top: 4, bottom: 4 }}>
          {weeks.map((week, wIdx) => (
            <VStack key={`week-${wIdx}`} spacing={3.5}>
              {week.days.map((day, dIdx) => (
                <RoundedRectangle
                  key={`day-${wIdx}-${dIdx}`}
                  cornerRadius={2.5}
                  fill={getCellFill(day.level)}
                  frame={{ width: 12, height: 12 }}
                />
              ))}
            </VStack>
          ))}
        </HStack>
      </ScrollView>

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
      glassEffect={{ type: "rect", cornerRadius: 16 }}
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
      glassEffect={{ type: "rect", cornerRadius: 16 }}
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
 * 美学构图与形态仪表盘 (原生三环饼图 Bento 卡片)
 */
function FormatAndAspectSection(props: {
  distribution: HistoryAnalyticsResult["aspectAndFormat"]
}) {
  const { aspectRatio, mediaType, aiDistribution } = props.distribution
  const visualArtworkCount =
    mediaType.singleIllust + mediaType.multiIllust + mediaType.ugoira + mediaType.manga
  const totalAspect = aspectRatio.ultraTall + aspectRatio.tall + aspectRatio.square + aspectRatio.wide

  // 纯小说浏览或无美术作品记录时隐藏美学构图卡片
  if (visualArtworkCount <= 0 && totalAspect <= 0) {
    return null
  }

  const totalMedia =
    mediaType.singleIllust + mediaType.multiIllust + mediaType.ugoira + mediaType.manga + mediaType.novel
  const totalAi = aiDistribution.ai + aiDistribution.nonAi

  const calcPct = (cnt: number, total: number) => (total > 0 ? Math.round((cnt / total) * 100) : 0)

  return (
    <VStack
      alignment="leading"
      spacing={14}
      padding={16}
      glassEffect={{ type: "rect", cornerRadius: 16 }}
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

      {/* 3 列并排环形图仪表盘 */}
      <HStack spacing={12} alignment="top" frame={{ maxWidth: "infinity" }}>
        {/* 第 1 列：长宽比画像 */}
        <VStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
          <DonutChart
            slices={[
              { value: aspectRatio.tall, color: "#AF52DE" },
              { value: aspectRatio.ultraTall, color: "#5856D6" },
              { value: aspectRatio.wide, color: "#30B0C7" },
              { value: aspectRatio.square, color: "#8E8E93" },
            ]}
          />
          <Text font="caption" fontWeight="bold">
            长宽比画像
          </Text>
          <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
            <DonutLegendItem color="#AF52DE" label="常规竖屏" pct={calcPct(aspectRatio.tall, totalAspect)} />
            <DonutLegendItem color="#5856D6" label="超高壁纸" pct={calcPct(aspectRatio.ultraTall, totalAspect)} />
            <DonutLegendItem color="#30B0C7" label="电脑横屏" pct={calcPct(aspectRatio.wide, totalAspect)} />
          </VStack>
        </VStack>

        {/* 第 2 列：画集与动图 */}
        <VStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
          <DonutChart
            slices={[
              { value: mediaType.singleIllust, color: "#007AFF" },
              { value: mediaType.multiIllust, color: "#FF9500" },
              { value: mediaType.ugoira, color: "#00C7BE" },
              { value: mediaType.manga + mediaType.novel, color: "#5856D6" },
            ]}
          />
          <Text font="caption" fontWeight="bold">
            画集与动图
          </Text>
          <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
            <DonutLegendItem color="#007AFF" label="单图插画" pct={calcPct(mediaType.singleIllust, totalMedia)} />
            <DonutLegendItem color="#FF9500" label="多图画集" pct={calcPct(mediaType.multiIllust, totalMedia)} />
            <DonutLegendItem color="#00C7BE" label="动图作品" pct={calcPct(mediaType.ugoira, totalMedia)} />
          </VStack>
        </VStack>

        {/* 第 3 列：创作类型 */}
        <VStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
          <DonutChart
            slices={[
              { value: aiDistribution.nonAi, color: "#34C759" },
              { value: aiDistribution.ai, color: "#8E8E93" },
            ]}
          />
          <Text font="caption" fontWeight="bold">
            创作类型
          </Text>
          <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
            <DonutLegendItem color="#34C759" label="原创绘师" pct={calcPct(aiDistribution.nonAi, totalAi)} />
            <DonutLegendItem color="#8E8E93" label="AI 生成" pct={calcPct(aiDistribution.ai, totalAi)} />
          </VStack>
        </VStack>
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
  const { totalWords, averageWords, comparisonText, readingTimeMinutes } = props.milestone

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

  return (
    <VStack
      alignment="leading"
      spacing={10}
      padding={16}
      glassEffect={{ type: "rect", cornerRadius: 16 }}
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

      <HStack alignment="lastTextBaseline" spacing={4}>
        <Text font="title" fontWeight="heavy" foregroundStyle={"systemIndigo" as any}>
          {(totalWords / 10000).toFixed(1)}
        </Text>
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
          万字
        </Text>
        <Spacer />
        <Text font="footnote" foregroundStyle="secondaryLabel">
          累计阅读约 {formatReadingTime(readingTimeMinutes)} (篇均 {averageWords} 字)
        </Text>
      </HStack>

      {comparisonText ? (
        <Text font="subheadline" foregroundStyle="secondaryLabel">
          {comparisonText}
        </Text>
      ) : null}
    </VStack>
  )
}

/**
 * 完整数据与足迹看板核心视图
 */
export function HistoryAnalyticsView(props: HistoryAnalyticsViewProps) {
  const [scope, setScope] = useState<AnalyticsScopeKind>(props.initialScope || "all")
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>(props.initialTimeRange || "all")
  const metrics = useLayoutMetrics()
  const { isSplitViewActive, openDetailRoute } = useDualRoute()

  // 当外部传入的分类类型（如插画、漫画、小说）变化时，自动联动切换看板类型
  useEffect(() => {
    if (props.initialScope) {
      setScope(props.initialScope)
    }
  }, [props.initialScope])

  // 计算分析数据
  const data = useMemo(() => {
    return computeHistoryAnalytics(scope, timeRange)
  }, [scope, timeRange])

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

  const isWide = metrics.width >= 620

  return (
    <NavigationStack
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
    >
      <VStack
        alignment="leading"
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        navigationTitle="我的足迹"
        navigationBarTitleDisplayMode="inline"
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
        {/* 滚动看板内容区：标准 ScrollView + presentationContentInteraction="scrolls" */}
        <ScrollView
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          presentationContentInteraction="scrolls"
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

            {/* 4. 活跃热力日历矩阵 */}
            <ActivityHeatmapSection
              heatmap={data.heatmap}
              activeDays={data.summary.activeDays}
            />

            {/* 5. 题材偏好与创作者榜单 (大屏并排，小屏单列) */}
            {isWide ? (
              <HStack alignment="top" spacing={16} frame={{ maxWidth: "infinity" }}>
                <TopTagsSection
                  tags={data.topTags}
                  onSelectTag={props.onSelectTag}
                />
                <TopCreatorsSection
                  creators={data.topCreators}
                  onSelectCreator={props.onSelectCreator}
                  onOpenUserDetail={handleOpenUserDetail}
                />
              </HStack>
            ) : (
              <VStack spacing={16} frame={{ maxWidth: "infinity" }}>
                <TopTagsSection
                  tags={data.topTags}
                  onSelectTag={props.onSelectTag}
                />
                <TopCreatorsSection
                  creators={data.topCreators}
                  onSelectCreator={props.onSelectCreator}
                  onOpenUserDetail={handleOpenUserDetail}
                />
              </VStack>
            )}

            {/* 6. 美学构图与创作形态 */}
            <FormatAndAspectSection distribution={data.aspectAndFormat} />
          </VStack>
        </ScrollView>
      </VStack>
    </NavigationStack>
  )
}

export default HistoryAnalyticsView
