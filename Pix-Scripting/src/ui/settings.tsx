import {
  Button,
  Group,
  HStack,
  Image,
  List,
  NavigationLink,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  Widget,
  useEffect,
  useState,
  VStack,
} from "scripting"
import {
  cacheUsageBytes,
  clearCache,
  enforceCacheLimit,
} from "../image/imageLoader"
import { clearHistory, historyCount, onHistoryChanged } from "../store/history"
import {
  formatCustomRankingSummary,
  loadSettings,
  onSettingsChanged,
  resetSettings,
  updateSettings,
  type LaunchPage,
  type WidgetDefaultSource,
} from "../store/settings"
import { loadBlocklist, onBlocklistChanged } from "../store/blocklist"
import { editAIShowSettings, syncWebCookies } from "../api/pixiv"
import { session } from "../api/session"
import { clearUgoiraCache, enforceUgoiraCacheLimit, ugoiraCacheUsageBytes } from "../ugoira/ugoira"
import { useTimedFlag } from "./hooks"

const CACHE_LIMIT_OPTIONS = [300, 500, 1000, 2000] as const

export function SettingsView() {
  const [settings, setSettings] = useState(loadSettings())
  const [blocklist, setBlocklist] = useState(loadBlocklist())
  const [settingsReset, setSettingsReset] = useTimedFlag()
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [cacheCleared, setCacheCleared] = useTimedFlag()
  const [historyTotal, setHistoryTotal] = useState<number>(() => historyCount())
  const [historyCleared, setHistoryCleared] = useTimedFlag()
  const [syncingWebCookie, setSyncingWebCookie] = useState(false)
  const [widgetRefreshed, setWidgetRefreshed] = useTimedFlag()
  const [, setWebCookieVersion] = useState(0)

  function refreshCacheSize() {
    setCacheSize(cacheUsageBytes() + ugoiraCacheUsageBytes())
  }

  function refreshHistoryTotal() {
    setHistoryTotal(historyCount())
  }

  useEffect(() => {
    refreshCacheSize()
    refreshHistoryTotal()
    const unsubscribeSettings = onSettingsChanged(() => {
      setSettings(loadSettings())
      refreshCacheSize()
    })
    const unsubscribeBlocklist = onBlocklistChanged(() => {
      setBlocklist(loadBlocklist())
    })
    const unsubscribeHistory = onHistoryChanged(() => {
      refreshHistoryTotal()
    })
    return () => {
      unsubscribeSettings()
      unsubscribeBlocklist()
      unsubscribeHistory()
    }
  }, [])

  function update(patch: Partial<typeof settings>) {
    setSettings(updateSettings(patch))
  }

  function handleResetSettings() {
    const next = resetSettings()
    setSettings(next)
    setSettingsReset()
  }

  function clearAllCaches() {
    clearCache()
    clearUgoiraCache()
    setCacheCleared()
    setCacheSize(0)
  }

  function clearAllHistory() {
    clearHistory()
    setHistoryCleared()
    setHistoryTotal(0)
  }

  function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }
    return `${(bytes / 1024).toFixed(0)} KB`
  }

  return (
    <List
      navigationTitle="设置"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarTrailing: [
          <Button
            action={() => {}}
            contextMenu={{
              menuItems: (
                <Group>
                  <Button
                    title="重置为默认设置"
                    systemImage="arrow.counterclockwise"
                    role="destructive"
                    action={handleResetSettings}
                  />
                </Group>
              ),
            }}
          >
            <Image
              systemName={settingsReset ? "checkmark" : "arrow.counterclockwise"}
              foregroundStyle={settingsReset ? "systemGreen" : undefined}
            />
          </Button>,
        ],
      }}
    >
      <Section header={<Text>内容显示</Text>}>
        <Toggle
          title="显示 R18 作品"
          value={settings.showR18}
          onChanged={(value) => update({ showR18: value })}
        />
        <Toggle
          title="显示 R18G 作品"
          value={settings.showR18G}
          onChanged={(value) => update({ showR18G: value })}
        />
        <Toggle
          title="显示 AI 生成作品"
          value={settings.showAI}
          onChanged={async (value) => {
            update({ showAI: value })
            try {
              const token = await session.getValidToken()
              if (token) {
                await editAIShowSettings(value, token)
              }
            } catch (e: any) {
              console.log("editAIShowSettings error:", e?.message ?? e)
            }
          }}
        />
        <Toggle
          value={settings.exemptFilterForPersonal}
          onChanged={(value) => update({ exemptFilterForPersonal: value })}
        >
          <VStack alignment="leading" spacing={2}>
            <Text font="body">豁免关注/追更/收藏/记录</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              开启后R18/R18G/AI作品过滤对这些项目不再生效
            </Text>
          </VStack>
        </Toggle>
        <Toggle
          title="我不看小说！"
          value={settings.hideNovels}
          onChanged={(value) => update({ hideNovels: value })}
        />
        <NavigationLink value="blockedSettings">
          <HStack spacing={8}>
            <Text font="body">屏蔽设置</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">
              标签 {blocklist.blockedTags.length} · 用户 {blocklist.blockedUsers.length}
            </Text>
          </HStack>
        </NavigationLink>
      </Section>

      <Section header={<Text>排行</Text>}>
        <Toggle
          title="自定义榜单"
          value={settings.customRankingEnabled}
          onChanged={(value) => update({ customRankingEnabled: value })}
        />
        {settings.customRankingEnabled ? (
          <NavigationLink value="rankingCustomPicker:illust">
            <HStack spacing={8}>
              <Text font="body">插画榜单</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {formatCustomRankingSummary(settings.customRankingIllustModes, ALL_ILLUST_RANKING_OPTIONS)}
              </Text>
            </HStack>
          </NavigationLink>
        ) : null}
        {settings.customRankingEnabled ? (
          <NavigationLink value="rankingCustomPicker:manga">
            <HStack spacing={8}>
              <Text font="body">漫画榜单</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {formatCustomRankingSummary(settings.customRankingMangaModes, ALL_MANGA_RANKING_OPTIONS)}
              </Text>
            </HStack>
          </NavigationLink>
        ) : null}
        {settings.customRankingEnabled && !settings.hideNovels ? (
          <NavigationLink value="rankingCustomPicker:novel">
            <HStack spacing={8}>
              <Text font="body">小说榜单</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {formatCustomRankingSummary(settings.customRankingNovelModes, ALL_NOVEL_RANKING_OPTIONS)}
              </Text>
            </HStack>
          </NavigationLink>
        ) : null}
      </Section>

      <Section header={<Text>桌面小组件</Text>} footer={<Text>配置桌面小组件默认展示的内容源，也可在主屏幕长按小组件单独指定参数覆盖。</Text>}>
        <Picker
          title="默认显示内容"
          value={settings.widgetDefaultSource}
          onChanged={(val) => {
            update({ widgetDefaultSource: val as WidgetDefaultSource })
            Widget.reloadAll()
          }}
        >
          <Text value="ranking_day">插画日榜（每日精选）</Text>
          <Text value="ranking_week">插画周榜（每周热门）</Text>
          <Text value="ranking_month">插画月榜（每月殿堂）</Text>
          <Text value="discovery">探索推荐（个性发现）</Text>
          <Text value="follow">关注动态（追更列表）</Text>
          <Text value="pixivision">pixivision（专栏特辑）</Text>
        </Picker>
        <Button
          action={() => {
            Widget.reloadAll()
            void Haptics.transient()
            setWidgetRefreshed()
          }}
        >
          <HStack spacing={8}>
            <Text font="body">立即刷新桌面小组件</Text>
            <Spacer />
            <Image
              systemName={widgetRefreshed ? "checkmark.circle.fill" : "arrow.clockwise"}
              foregroundStyle={widgetRefreshed ? "systemGreen" : "secondaryLabel"}
            />
          </HStack>
        </Button>
      </Section>

      <Section header={<Text>通用</Text>}>
        <Picker
          title="启动页面"
          value={settings.launchPage}
          onChanged={(val) => update({ launchPage: val as LaunchPage })}
        >
          <Text value="discovery">探索</Text>
          <Text value="ranking">排行</Text>
          <Text value="following">关注</Text>
        </Picker>
        <Picker
          title="追更排序"
          value={settings.watchlistSortOrder}
          onChanged={(val) => update({ watchlistSortOrder: val as any })}
        >
          <Text value="asc">正序（第 1 话在前）</Text>
          <Text value="desc">倒序（最新话在前）</Text>
        </Picker>
        <Toggle
          title="沉浸效果"
          value={settings.ambientImmersion}
          onChanged={(value) => update({ ambientImmersion: value })}
        />
        {settings.ambientImmersion ? (
          <Picker
            title="氛围浓度"
            value={settings.ambientIntensity}
            onChanged={(val) => update({ ambientIntensity: val as any })}
          >
            <Text value="low">清透</Text>
            <Text value="medium">标准</Text>
            <Text value="high">浓郁</Text>
          </Picker>
        ) : null}
        <Picker
          title="长按收藏按钮"
          value={settings.longPressBookmarkAction}
          onChanged={(val) => update({ longPressBookmarkAction: val as any })}
        >
          <Text value="off">关闭</Text>
          <Text value="follow">同时关注用户</Text>
          <Text value="detail">显示收藏详情</Text>
        </Picker>
        <Picker
          title="关闭按钮行为"
          value={settings.closeButtonAction}
          onChanged={(val) => update({ closeButtonAction: val as any })}
        >
          <Text value="minimize">后台常驻（秒开）</Text>
          <Text value="exit">完全退出</Text>
        </Picker>
        <Button
          action={async () => {
            if (syncingWebCookie) return
            setSyncingWebCookie(true)
            try {
              const res = await syncWebCookies()
              if (res.success && res.cookie) {
                setWebCookieVersion((v) => v + 1)
              }
            } finally {
              setSyncingWebCookie(false)
            }
          }}
        >
          <HStack spacing={8}>
            <Text font="body">Web 登录态</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">
              {syncingWebCookie
                ? "同步中…"
                : session.webCookie
                  ? "已就绪"
                  : "未同步"}
            </Text>
          </HStack>
        </Button>
      </Section>

      <Section header={<Text>图片与画质</Text>}>
        <Picker
          title="列表画质"
          value={settings.feedImageQuality}
          onChanged={(val) => update({ feedImageQuality: val as any })}
        >
          <Text value="medium">中（速度快，省流量）</Text>
          <Text value="large">高（更清晰）</Text>
        </Picker>
        <Picker
          title="详情画质"
          value={settings.detailImageQuality}
          onChanged={(val) => update({ detailImageQuality: val as any })}
        >
          <Text value="large">高（推荐）</Text>
          <Text value="original">原图（加载较慢）</Text>
        </Picker>
        <Picker
          title="下载画质"
          value={settings.downloadImageQuality}
          onChanged={(val) => update({ downloadImageQuality: val as any })}
        >
          <Text value="large">高</Text>
          <Text value="original">原图（推荐）</Text>
        </Picker>
        <Toggle
          title="自动预加载后续图片"
          value={settings.prefetchEnabled}
          onChanged={(value) => update({ prefetchEnabled: value })}
        />
        <Picker
          title="缓存上限"
          value={settings.cacheLimitMB ?? 0}
          onChanged={(val) => {
            const num = Number(val)
            const nextLimit = num === 0 ? null : num
            update({ cacheLimitMB: nextLimit })
            enforceCacheLimit()
            enforceUgoiraCacheLimit()
          }}
        >
          <Text value={300}>300 MB</Text>
          <Text value={500}>500 MB</Text>
          <Text value={1000}>1 GB</Text>
          <Text value={2000}>2 GB</Text>
          <Text value={0}>不限制</Text>
        </Picker>
      </Section>

      <Section header={<Text>下载与存储</Text>}>
        <Picker
          title="下载保存位置"
          value={settings.downloadStorageMode}
          onChanged={(val) => update({ downloadStorageMode: val as any })}
        >
          <Text value="local">设备本地</Text>
          <Text value="icloud">iCloud 云盘</Text>
        </Picker>
        <TextField
          title="系统相册名称"
          value={settings.downloadPhotoAlbumName}
          onChanged={(value) =>
            update({
              downloadPhotoAlbumName:
                value.trim().length > 0 ? value.trim() : "Pix-Scripting",
            })
          }
        />
        <Picker
          title="漫画导出格式"
          value={settings.downloadMangaFormat}
          onChanged={(val) => update({ downloadMangaFormat: val as any })}
        >
          <Text value="cbz">CBZ 漫画包（推荐）</Text>
          <Text value="epub">EPUB 电子书</Text>
        </Picker>
        <Toggle
          title="灵动岛实时进度"
          value={settings.enableLiveActivity}
          onChanged={(value) => update({ enableLiveActivity: value })}
        />
        <Toggle
          title="任务完成后通知"
          value={settings.enableTaskNotification}
          onChanged={(value) => update({ enableTaskNotification: value })}
        />
      </Section>

      <Section header={<Text>存储空间与记录</Text>}>
        <Toggle
          title="记录本地历史"
          value={settings.recordHistory}
          onChanged={(value) => update({ recordHistory: value })}
        />
        <Button action={clearAllHistory}>
          <HStack spacing={8}>
            <Text font="body">清除历史记录</Text>
            <Spacer />
            <Text font="caption" foregroundStyle={historyCleared ? "systemGreen" : "secondaryLabel"}>
              {historyCleared ? "已清除" : `${historyTotal} 条`}
            </Text>
          </HStack>
        </Button>
        <Button action={clearAllCaches}>
          <HStack spacing={8}>
            <Text font="body">清除图片缓存</Text>
            <Spacer />
            <Text font="caption" foregroundStyle={cacheCleared ? "systemGreen" : "secondaryLabel"}>
              {cacheCleared
                ? "已清除"
                : cacheSize != null
                  ? formatSize(cacheSize)
                  : "计算中…"}
            </Text>
          </HStack>
        </Button>
      </Section>

      <Section header={<Text>调试</Text>}>
        <Toggle
          title="高级设置"
          value={settings.advancedSettingsUnlocked}
          onChanged={(value) => update({ advancedSettingsUnlocked: value })}
        />
        {settings.advancedSettingsUnlocked ? (
          <Group>
            <HStack spacing={8}>
              <Text font="body">批加载步长</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {settings.imageBatchConcurrency} 项/次
              </Text>
            </HStack>
            <HStack spacing={8}>
              <Text font="body">前台解码并发比率</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {settings.imageDownloadConcurrencyRatio}%
              </Text>
            </HStack>
            <HStack spacing={8}>
              <Text font="body">预取并发比率</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {settings.imagePrefetchConcurrencyRatio}%
              </Text>
            </HStack>
            <HStack spacing={8}>
              <Text font="body">淡入时长</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {settings.imageFadeInDuration} ms
              </Text>
            </HStack>
            <HStack spacing={8}>
              <Text font="body">模糊交叉淡入</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {settings.blurCrossFadeDuration} ms
              </Text>
            </HStack>
            <HStack spacing={8}>
              <Text font="body">底图预热时长</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {settings.backgroundPreheatDuration} ms
              </Text>
            </HStack>
            <HStack spacing={8}>
              <Text font="body">加载骨架时长</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {settings.loadingAnimationDuration} ms
              </Text>
            </HStack>
            <HStack spacing={8}>
              <Text font="body">小说翻页缓冲</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {settings.novelLoadingDuration} ms
              </Text>
            </HStack>
            <HStack spacing={8}>
              <Text font="body">启动就绪缓冲</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {settings.launchAnimationDuration} ms
              </Text>
            </HStack>
          </Group>
        ) : null}
      </Section>
    </List>
  )
}
