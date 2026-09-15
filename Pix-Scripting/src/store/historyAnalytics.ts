// 历史记录纯本地数据分析与足迹计算引擎
// 纯前端单次遍历 O(N) 毫秒级计算，零网络依赖，支持全维度画像与时间范围筛选
import { getHistory, type HistoryContentKind, type IllustrationHistoryEntry, type NovelHistoryEntry } from "./history"
import type { PixivIllustration, PixivNovel } from "../types"

export type AnalyticsTimeRange = "all" | "year" | "quarter" | "month" | "week"
export type AnalyticsScopeKind = "all" | HistoryContentKind

export interface SummaryMetrics {
  totalViews: number
  uniqueCreators: number
  activeDays: number
  currentStreak: number
  maxStreak: number
  bookmarkedCount: number
  bookmarkRate: number // 0~100 百分比
  novelWordCount: number
  peakDay: { dateStr: string; count: number } | null
  timeSpanDesc: string
}

export interface HourlyDistribution {
  hours: number[] // 0 ~ 23 小时计数
  maxCount: number
  peakHour: number
  peakTimeRangeDesc: string
  persona: string
}

export interface HeatmapDay {
  dateStr: string // YYYY-MM-DD
  count: number
  level: number // 0 ~ 4 级深浅
  dayOfWeek: number // 1 (Mon) ~ 7 (Sun)
}

export interface HeatmapData {
  weeks: { days: HeatmapDay[] }[]
  maxDailyCount: number
  startDateStr: string
  endDateStr: string
}

export interface TopTagItem {
  name: string
  translatedName: string | null
  count: number
  percentage: number
}

export interface TopCreatorItem {
  id: number
  name: string
  viewCount: number
  bookmarkCount: number
  bookmarkRate: number
}

export interface AspectAndFormatDistribution {
  aspectRatio: {
    ultraTall: number // 手机超高壁纸 (h/w >= 1.6)
    tall: number // 常规竖屏 (1.1 <= h/w < 1.6)
    square: number // 方形 (0.9 <= h/w < 1.1)
    wide: number // 横屏电脑壁纸 (h/w < 0.9)
  }
  mediaType: {
    singleIllust: number
    multiIllust: number
    ugoira: number
    manga: number
    novel: number
  }
  aiDistribution: {
    ai: number
    nonAi: number
  }
  /**
   * 漫画篇幅分档（按作品总页数 page_count 划分）
   * 仅「仅漫画」作用域的第二栏环形图使用，其它作用域不使用但保持同构输出
   */
  mangaPageBuckets: {
    single: number // 1 页
    short: number // 2 ~ 10 页
    medium: number // 11 ~ 30 页
    long: number // 31 页及以上
  }
}

export interface NovelMilestone {
  totalWords: number
  averageWords: number
  comparisonText: string
  readingTimeMinutes: number
  /** 小说专属 AI 分布（只统计小说，与全局 aiDistribution 口径不同） */
  aiDistribution: {
    ai: number
    nonAi: number
  }
}

export interface HistoryAnalyticsResult {
  scope: AnalyticsScopeKind
  timeRange: AnalyticsTimeRange
  calculatedAt: number
  summary: SummaryMetrics
  hourly: HourlyDistribution
  heatmap: HeatmapData
  topTags: TopTagItem[]
  topCreators: TopCreatorItem[]
  aspectAndFormat: AspectAndFormatDistribution
  novelMilestone: NovelMilestone | null
}

function formatDateKey(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function getRangeStartTime(timeRange: AnalyticsTimeRange): number {
  const now = Date.now()
  switch (timeRange) {
    case "week":
      return now - 7 * 86400 * 1000
    case "month":
      return now - 30 * 86400 * 1000
    case "quarter":
      return now - 90 * 86400 * 1000
    case "year":
      return now - 365 * 86400 * 1000
    case "all":
    default:
      return 0
  }
}

function determinePersona(peakHour: number, nightShare: number): string {
  if (peakHour >= 0 && peakHour < 5) {
    return "深夜鉴赏家 · 灵感在子夜绽放"
  } else if (peakHour >= 5 && peakHour < 9) {
    return "晨曦探索者 · 随晨光开启视觉之旅"
  } else if (peakHour >= 9 && peakHour < 12) {
    return "专注采风者 · 享受上午的沉浸灵感"
  } else if (peakHour >= 12 && peakHour < 14) {
    return "午间摸鱼派 · 惬意的正午碎片拾光"
  } else if (peakHour >= 14 && peakHour < 18) {
    return "午后漫游者 · 伴随红茶与画卷"
  } else if (peakHour >= 18 && peakHour < 21) {
    return "暮色归航者 · 卸下疲惫的治愈时刻"
  } else {
    if (nightShare > 0.4) {
      return "月夜守望者 · 沉迷静谧的深夜绘卷"
    }
    return "黄金夜读人 · 享受睡前的视觉盛宴"
  }
}

function buildNovelComparison(totalWords: number): string {
  if (totalWords <= 0) return ""

  // 统一句式「相当于读完 N 部××」，只用通用体量分类，不点名任何具体作品
  const tiers = [
    { limit: 10 * 10000, unit: 10000, label: "短篇小说" },
    { limit: 50 * 10000, unit: 8 * 10000, label: "中篇小说" },
    { limit: 200 * 10000, unit: 25 * 10000, label: "长篇小说" },
    { limit: Number.POSITIVE_INFINITY, unit: 100 * 10000, label: "超长连载作品" },
  ]
  const tier = tiers.find((t) => totalWords < t.limit) ?? tiers[tiers.length - 1]
  const volumes = totalWords / tier.unit
  // N ≥ 10 取整，否则保留 1 位小数；整数值不带 .0
  const display =
    volumes >= 10 ? String(Math.round(volumes)) : volumes.toFixed(1).replace(/\.0$/, "")

  return `相当于读完 ${display} 部${tier.label}`
}

// 缓存管理
let memoizedResult: HistoryAnalyticsResult | null = null
let memoizedCacheKey = ""

/** 热力图窗口周数：下限 20 周（与旧版观感一致），上限 53 周（近一年） */
export const HEATMAP_WEEKS_MIN = 20
export const HEATMAP_WEEKS_MAX = 53
export const HEATMAP_WEEKS_DEFAULT = 20

export interface HistoryAnalyticsOptions {
  /** 热力图窗口周数（视图按容器真实宽度自适应推导，超出范围会被收敛到 20 ~ 53） */
  heatmapWeeks?: number
  /** 强制绕过指纹缓存 */
  forceRefresh?: boolean
}

/**
 * 核心分析计算引擎：单次遍历多数据源并快速聚合
 */
export function computeHistoryAnalytics(
  scope: AnalyticsScopeKind = "all",
  timeRange: AnalyticsTimeRange = "all",
  options: HistoryAnalyticsOptions = {}
): HistoryAnalyticsResult {
  // 热力图窗口周数：视图层按容器真实宽度推导后传入，此处再做一次收敛
  const heatmapWeeksCount = Math.max(
    HEATMAP_WEEKS_MIN,
    Math.min(HEATMAP_WEEKS_MAX, Math.round(options.heatmapWeeks ?? HEATMAP_WEEKS_DEFAULT))
  )
  const illustList = (scope === "all" || scope === "illustration") ? (getHistory("illustration") as IllustrationHistoryEntry[]) : []
  const mangaList = (scope === "all" || scope === "manga") ? (getHistory("manga") as IllustrationHistoryEntry[]) : []
  const novelList = (scope === "all" || scope === "novel") ? (getHistory("novel") as NovelHistoryEntry[]) : []

  // 生成轻量快照指纹作为缓存 Key
  const cacheKey = `${scope}_${timeRange}_${heatmapWeeksCount}_${illustList.length}_${mangaList.length}_${
    novelList.length
  }_${illustList[0]?.viewedAt ?? 0}_${mangaList[0]?.viewedAt ?? 0}_${
    novelList[0]?.viewedAt ?? 0
  }`

  if (!options.forceRefresh && memoizedResult && memoizedCacheKey === cacheKey) {
    return memoizedResult
  }

  const startTime = getRangeStartTime(timeRange)

  let totalViews = 0
  let bookmarkedCount = 0
  let novelWordCount = 0
  let novelCount = 0

  const creatorMap = new Map<number, { id: number; name: string; viewCount: number; bookmarkCount: number }>()
  const tagMap = new Map<string, { name: string; translatedName: string | null; count: number }>()
  const hours = new Array<number>(24).fill(0)
  const dayCountMap = new Map<string, number>()

  const aspectCounts = {
    ultraTall: 0,
    tall: 0,
    square: 0,
    wide: 0,
  }

  const mediaTypeCounts = {
    singleIllust: 0,
    multiIllust: 0,
    ugoira: 0,
    manga: 0,
    novel: 0,
  }

  // 漫画篇幅分档（仅「仅漫画」作用域的第二栏环形图使用）
  const mangaPageBuckets = {
    single: 0,
    short: 0,
    medium: 0,
    long: 0,
  }

  const aiCounts = {
    ai: 0,
    nonAi: 0,
  }

  // 小说专属 AI 分布（仅用于「小说阅读里程碑」卡片的 AI 率环形图）
  const novelAiCounts = {
    ai: 0,
    nonAi: 0,
  }

  // 1. 处理插画与漫画列表
  const processIllustEntry = (entry: IllustrationHistoryEntry, defaultManga = false) => {
    if (entry.viewedAt < startTime) return
    totalViews++
    const ill = entry.illustration
    if (!ill) return

    if (ill.is_bookmarked) {
      bookmarkedCount++
    }

    // 活跃小时与日期分布
    const d = new Date(entry.viewedAt)
    const hour = d.getHours()
    hours[hour] = (hours[hour] || 0) + 1
    const dateKey = formatDateKey(entry.viewedAt)
    dayCountMap.set(dateKey, (dayCountMap.get(dateKey) || 0) + 1)

    // 作者聚合
    if (ill.user?.id) {
      const u = ill.user
      const existing = creatorMap.get(u.id)
      if (existing) {
        existing.viewCount++
        if (ill.is_bookmarked) existing.bookmarkCount++
        if (u.name && !existing.name) existing.name = u.name
      } else {
        creatorMap.set(u.id, {
          id: u.id,
          name: u.name || `UID ${u.id}`,
          viewCount: 1,
          bookmarkCount: ill.is_bookmarked ? 1 : 0,
        })
      }
    }

    // 标签聚合
    if (ill.tags && Array.isArray(ill.tags)) {
      for (const t of ill.tags) {
        if (!t?.name) continue
        const existing = tagMap.get(t.name)
        if (existing) {
          existing.count++
          if (!existing.translatedName && t.translated_name) {
            existing.translatedName = t.translated_name
          }
        } else {
          tagMap.set(t.name, {
            name: t.name,
            translatedName: t.translated_name || null,
            count: 1,
          })
        }
      }
    }

    // 媒体格式与画集判定
    const isUgoira = ill.type === "ugoira"
    const isManga = defaultManga || ill.type === "manga"
    const pageCount = ill.page_count || 1

    if (isUgoira) {
      mediaTypeCounts.ugoira++
    } else if (isManga) {
      mediaTypeCounts.manga++
    } else if (pageCount > 1) {
      mediaTypeCounts.multiIllust++
    } else {
      mediaTypeCounts.singleIllust++
    }

    // 漫画篇幅分档：单页 / 短篇 / 中篇 / 长篇
    if (isManga) {
      if (pageCount <= 1) {
        mangaPageBuckets.single++
      } else if (pageCount <= 10) {
        mangaPageBuckets.short++
      } else if (pageCount <= 30) {
        mangaPageBuckets.medium++
      } else {
        mangaPageBuckets.long++
      }
    }

    // 构图比例
    if (ill.width && ill.height && ill.width > 0 && ill.height > 0) {
      const ratio = ill.height / ill.width
      if (ratio >= 1.6) {
        aspectCounts.ultraTall++
      } else if (ratio >= 1.1) {
        aspectCounts.tall++
      } else if (ratio >= 0.9) {
        aspectCounts.square++
      } else {
        aspectCounts.wide++
      }
    }

    // AI 判定 (illust_ai_type: 2 代表 AI 生成作品)
    if (ill.illust_ai_type === 2) {
      aiCounts.ai++
    } else {
      aiCounts.nonAi++
    }
  }

  // 2. 处理小说列表
  const processNovelEntry = (entry: NovelHistoryEntry) => {
    if (entry.viewedAt < startTime) return
    totalViews++
    const nov = entry.novel
    if (!nov) return

    mediaTypeCounts.novel++

    if (nov.is_bookmarked) {
      bookmarkedCount++
    }

    // 字数累计
    if (nov.text_length && nov.text_length > 0) {
      novelWordCount += nov.text_length
      novelCount++
    }

    // 活跃小时与日期分布
    const d = new Date(entry.viewedAt)
    const hour = d.getHours()
    hours[hour] = (hours[hour] || 0) + 1
    const dateKey = formatDateKey(entry.viewedAt)
    dayCountMap.set(dateKey, (dayCountMap.get(dateKey) || 0) + 1)

    // 作者聚合
    if (nov.user?.id) {
      const u = nov.user
      const existing = creatorMap.get(u.id)
      if (existing) {
        existing.viewCount++
        if (nov.is_bookmarked) existing.bookmarkCount++
        if (u.name && !existing.name) existing.name = u.name
      } else {
        creatorMap.set(u.id, {
          id: u.id,
          name: u.name || `UID ${u.id}`,
          viewCount: 1,
          bookmarkCount: nov.is_bookmarked ? 1 : 0,
        })
      }
    }

    // 标签聚合
    if (nov.tags && Array.isArray(nov.tags)) {
      for (const t of nov.tags) {
        if (!t?.name) continue
        const existing = tagMap.get(t.name)
        if (existing) {
          existing.count++
          if (!existing.translatedName && t.translated_name) {
            existing.translatedName = t.translated_name
          }
        } else {
          tagMap.set(t.name, {
            name: t.name,
            translatedName: t.translated_name || null,
            count: 1,
          })
        }
      }
    }

    // AI 判定 (novel_ai_type: 2 代表 AI 生成作品)
    if (nov.novel_ai_type === 2) {
      aiCounts.ai++
      novelAiCounts.ai++
    } else {
      aiCounts.nonAi++
      novelAiCounts.nonAi++
    }
  }

  // 执行遍历
  for (const item of illustList) processIllustEntry(item, false)
  for (const item of mangaList) processIllustEntry(item, true)
  for (const item of novelList) processNovelEntry(item)

  // 3. 计算小时分布与时段画像
  let maxHourlyCount = 0
  let peakHour = 22
  let nightCount = 0
  for (let h = 0; h < 24; h++) {
    const c = hours[h]
    if (c > maxHourlyCount) {
      maxHourlyCount = c
      peakHour = h
    }
    if (h >= 22 || h < 4) {
      nightCount += c
    }
  }
  const nightShare = totalViews > 0 ? nightCount / totalViews : 0
  const peakTimeRangeDesc = `${String(peakHour).padStart(2, "0")}:00 ~ ${String((peakHour + 1) % 24).padStart(2, "0")}:00`
  const persona = determinePersona(peakHour, nightShare)

  // 4. 计算活跃天数、连续打卡天数（Streak）与单日最高
  const sortedDates = Array.from(dayCountMap.keys()).sort()
  const activeDays = sortedDates.length

  let peakDay: { dateStr: string; count: number } | null = null
  let maxDailyCount = 0
  for (const [dateStr, count] of dayCountMap.entries()) {
    if (count > maxDailyCount) {
      maxDailyCount = count
      peakDay = { dateStr, count }
    }
  }

  // 连续打卡计算
  let currentStreak = 0
  let maxStreak = 0
  if (sortedDates.length > 0) {
    const todayStr = formatDateKey(Date.now())
    const yesterdayStr = formatDateKey(Date.now() - 86400 * 1000)

    // 检查今天或昨天是否有记录（保证如果今天还没看但昨天看了，打卡不立即断）
    const hasToday = dayCountMap.has(todayStr)
    const hasYesterday = dayCountMap.has(yesterdayStr)

    if (hasToday || hasYesterday) {
      let checkDate = new Date(hasToday ? Date.now() : Date.now() - 86400 * 1000)
      while (true) {
        const k = formatDateKey(checkDate.getTime())
        if (dayCountMap.has(k)) {
          currentStreak++
          checkDate = new Date(checkDate.getTime() - 86400 * 1000)
        } else {
          break
        }
      }
    }

    // 最长连续天数
    let streakCounter = 0
    let prevDateTimestamp = 0
    for (const dStr of sortedDates) {
      const [y, m, d] = dStr.split("-").map(Number)
      const curTimestamp = new Date(y, m - 1, d).getTime()
      if (prevDateTimestamp === 0) {
        streakCounter = 1
      } else {
        const diffDays = Math.round((curTimestamp - prevDateTimestamp) / (86400 * 1000))
        if (diffDays === 1) {
          streakCounter++
        } else {
          streakCounter = 1
        }
      }
      if (streakCounter > maxStreak) {
        maxStreak = streakCounter
      }
      prevDateTimestamp = curTimestamp
    }
  }

  // 5. 生成热力图数据（窗口周数由视图按容器真实宽度自适应推导，列数恒等于周数）
  const heatmapDays: HeatmapDay[] = []
  const today = new Date()

  // 起始日：本周周一回退 (heatmapWeeksCount - 1) 周，保证首列是完整的周一~周日
  const todayMondayIdx = (today.getDay() + 6) % 7
  const startDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - todayMondayIdx - (heatmapWeeksCount - 1) * 7
  )
  // 末列补齐到本周周日，总天数恒等于 周数 × 7
  const totalHeatmapSlots = heatmapWeeksCount * 7

  const p75 = maxDailyCount > 0 ? Math.max(1, Math.round(maxDailyCount * 0.75)) : 10
  const p50 = maxDailyCount > 0 ? Math.max(1, Math.round(maxDailyCount * 0.5)) : 5
  const p25 = maxDailyCount > 0 ? Math.max(1, Math.round(maxDailyCount * 0.25)) : 2

  const todayTimestamp = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()

  for (let i = 0; i < totalHeatmapSlots; i++) {
    const cur = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + i)
    const curTimestamp = cur.getTime()
    const k = formatDateKey(curTimestamp)
    const isFuture = curTimestamp > todayTimestamp
    const c = isFuture ? 0 : dayCountMap.get(k) || 0

    let level = 0
    if (c > 0) {
      if (c >= p75) level = 4
      else if (c >= p50) level = 3
      else if (c >= p25) level = 2
      else level = 1
    }

    heatmapDays.push({
      dateStr: k,
      count: c,
      level,
      dayOfWeek: cur.getDay() === 0 ? 7 : cur.getDay(),
    })
  }

  // 将天按周切片 (每周 7 天)
  const heatmapWeeks: { days: HeatmapDay[] }[] = []
  for (let i = 0; i < heatmapDays.length; i += 7) {
    const weekSlice = heatmapDays.slice(i, i + 7)
    if (weekSlice.length > 0) {
      heatmapWeeks.push({
        days: weekSlice,
      })
    }
  }

  // 6. Top 标签排序与占比 (取 Top 15)
  const topTags: TopTagItem[] = Array.from(tagMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .map((t) => ({
      name: t.name,
      translatedName: t.translatedName,
      count: t.count,
      percentage: totalViews > 0 ? Math.round((t.count / totalViews) * 100) : 0,
    }))

  // 7. Top 创作者排序 (取 Top 15)
  const topCreators: TopCreatorItem[] = Array.from(creatorMap.values())
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, 15)
    .map((c) => ({
      id: c.id,
      name: c.name,
      viewCount: c.viewCount,
      bookmarkCount: c.bookmarkCount,
      bookmarkRate: c.viewCount > 0 ? Math.round((c.bookmarkCount / c.viewCount) * 100) : 0,
    }))

  // 8. 汇总指标卡片数据
  const bookmarkRate = totalViews > 0 ? Number(((bookmarkedCount / totalViews) * 100).toFixed(1)) : 0
  const timeSpanDesc =
    timeRange === "week"
      ? "近一周"
      : timeRange === "month"
      ? "近一月"
      : timeRange === "quarter"
      ? "近一季"
      : timeRange === "year"
      ? "近一年"
      : "历史全量"

  const summary: SummaryMetrics = {
    totalViews,
    uniqueCreators: creatorMap.size,
    activeDays,
    currentStreak,
    maxStreak,
    bookmarkedCount,
    bookmarkRate,
    novelWordCount,
    peakDay,
    timeSpanDesc,
  }

  // 9. 小说专属里程碑
  let novelMilestone: NovelMilestone | null = null
  if (novelCount > 0 || scope === "novel") {
    const avg = novelCount > 0 ? Math.round(novelWordCount / novelCount) : 0
    novelMilestone = {
      totalWords: novelWordCount,
      averageWords: avg,
      comparisonText: buildNovelComparison(novelWordCount),
      readingTimeMinutes: Math.round(novelWordCount / 500), // 按 Pixiv 官方 500 字/分钟速读基准换算
      aiDistribution: { ...novelAiCounts },
    }
  }

  const result: HistoryAnalyticsResult = {
    scope,
    timeRange,
    calculatedAt: Date.now(),
    summary,
    hourly: {
      hours,
      maxCount: maxHourlyCount,
      peakHour,
      peakTimeRangeDesc,
      persona,
    },
    heatmap: {
      weeks: heatmapWeeks,
      maxDailyCount,
      startDateStr: heatmapDays[0]?.dateStr || "",
      endDateStr: heatmapDays[heatmapDays.length - 1]?.dateStr || "",
    },
    topTags,
    topCreators,
    aspectAndFormat: {
      aspectRatio: aspectCounts,
      mediaType: mediaTypeCounts,
      aiDistribution: aiCounts,
      mangaPageBuckets,
    },
    novelMilestone,
  }

  memoizedResult = result
  memoizedCacheKey = cacheKey

  return result
}
