import {
  Button,
  Device,
  DisclosureGroup,
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
import {
  loadCustomAIProfile,
  onCustomAIConfigChanged,
  updateCustomAIProfile,
  isScriptingPro,
  getCustomAIProviderName,
  type CustomAIProfile,
} from "../store/customAI"
import { editAIShowSettings, syncWebCookies } from "../api/pixiv"
import { session } from "../api/session"
import { clearUgoiraCache, enforceUgoiraCacheLimit, ugoiraCacheUsageBytes } from "../ugoira/ugoira"
import { useTimedFlag } from "./hooks"

const CACHE_LIMIT_OPTIONS = [300, 500, 1000, 2000] as const

interface SectionExpandedState {
  content: boolean
  ranking: boolean
  features: boolean
  ai: boolean
  widgets: boolean
  quality: boolean
  download: boolean
  history: boolean
  cache: boolean
  debug: boolean
}

const DEFAULT_EXPANDED_STATE: SectionExpandedState = {
  content: false,
  ranking: false,
  features: false,
  ai: false,
  widgets: false,
  quality: false,
  download: false,
  history: false,
  cache: false,
  debug: false,
}

export function SettingsView() {
  const [settings, setSettings] = useState(loadSettings())
  const [blocklist, setBlocklist] = useState(loadBlocklist())
  const [aiProfile, setAiProfile] = useState<CustomAIProfile>(() => loadCustomAIProfile())
  const [settingsReset, setSettingsReset] = useTimedFlag()
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [cacheCleared, setCacheCleared] = useTimedFlag()
  const [historyTotal, setHistoryTotal] = useState<number>(() => historyCount())
  const [historyCleared, setHistoryCleared] = useTimedFlag()
  const [syncingWebCookie, setSyncingWebCookie] = useState(false)
  const [widgetRefreshed, setWidgetRefreshed] = useTimedFlag()
  const [, setWebCookieVersion] = useState(0)

  const [expanded, setExpanded] = useState<SectionExpandedState>(DEFAULT_EXPANDED_STATE)

  function setExpandedKey<K extends keyof SectionExpandedState>(key: K, value: boolean) {
    setExpanded((prev) => ({ ...prev, [key]: value }))
  }

  function expandAll() {
    setExpanded({
      content: true,
      ranking: true,
      features: true,
      ai: true,
      widgets: true,
      quality: true,
      download: true,
      history: true,
      cache: true,
      debug: true,
    })
  }

  function collapseAll() {
    setExpanded({
      content: false,
      ranking: false,
      features: false,
      ai: false,
      widgets: false,
      quality: false,
      download: false,
      history: false,
      cache: false,
      debug: false,
    })
  }

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
    const unsubscribeCustomAI = onCustomAIConfigChanged((updated) => {
      setAiProfile({ ...updated })
    })
    return () => {
      unsubscribeSettings()
      unsubscribeBlocklist()
      unsubscribeHistory()
      unsubscribeCustomAI()
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

  const activeKeys: (keyof SectionExpandedState)[] = [
    "content",
    "ranking",
    "features",
    "ai",
    "widgets",
    "quality",
    "download",
    "history",
    "cache",
    ...(settings.advancedSettingsUnlocked ? (["debug"] as (keyof SectionExpandedState)[]) : []),
  ]

  const isAllExpanded = activeKeys.every((key) => expanded[key])

  function toggleExpandAll() {
    void Haptics.transient()
    if (isAllExpanded) {
      collapseAll()
    } else {
      expandAll()
    }
  }

  return (
    <List
      navigationTitle="设置"
      navigationBarTitleDisplayMode="inline"
      listSectionSpacing="compact"
      toolbar={{
        topBarTrailing: [
          <Button
            action={toggleExpandAll}
          >
            <Image
              systemName={isAllExpanded ? "rectangle.compress.vertical" : "rectangle.expand.vertical"}
            />
          </Button>,
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
      {/* 1. 内容显示 */}
      <Section>
        <DisclosureGroup
          isExpanded={expanded.content}
          onChanged={(v) => setExpandedKey("content", v)}
          label={
            <HStack spacing={10} alignment="center">
              <Image systemName="eye.fill" font="body" foregroundStyle="systemBlue" />
              <Text font="headline">内容显示</Text>
              <Spacer />
              {!expanded.content ? (
                <Text font="footnote" foregroundStyle="tertiaryLabel">
                  {`R18:${settings.showR18 ? "开" : "关"} · AI:${settings.showAI ? "开" : "关"}`}
                </Text>
              ) : null}
            </HStack>
          }
        >
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
        </DisclosureGroup>
      </Section>

      {/* 2. 排行榜单 */}
      <Section>
        <DisclosureGroup
          isExpanded={expanded.ranking}
          onChanged={(v) => setExpandedKey("ranking", v)}
          label={
            <HStack spacing={10} alignment="center">
              <Image systemName="chart.bar.xaxis" font="body" foregroundStyle="systemOrange" />
              <Text font="headline">排行与榜单</Text>
              <Spacer />
              {!expanded.ranking ? (
                <Text font="footnote" foregroundStyle="tertiaryLabel">
                  {settings.customRankingEnabled ? "自定义榜单" : "默认榜单"}
                </Text>
              ) : null}
            </HStack>
          }
        >
          <Toggle
            title="自定义榜单"
            value={settings.customRankingEnabled}
            onChanged={(value) => update({ customRankingEnabled: value })}
          />
          {settings.customRankingEnabled ? (
            <>
              <NavigationLink value="rankingCustomPicker:illust">
                <HStack spacing={8}>
                  <Text font="body">插画</Text>
                  <Spacer />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {formatCustomRankingSummary("illust", settings)}
                  </Text>
                </HStack>
              </NavigationLink>
              <NavigationLink value="rankingCustomPicker:manga">
                <HStack spacing={8}>
                  <Text font="body">漫画</Text>
                  <Spacer />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {formatCustomRankingSummary("manga", settings)}
                  </Text>
                </HStack>
              </NavigationLink>
              {!settings.hideNovels ? (
                <NavigationLink value="rankingCustomPicker:novel">
                  <HStack spacing={8}>
                    <Text font="body">小说</Text>
                    <Spacer />
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      {formatCustomRankingSummary("novel", settings)}
                    </Text>
                  </HStack>
                </NavigationLink>
              ) : null}
            </>
          ) : null}
        </DisclosureGroup>
      </Section>

      {/* 3. 功能与交互 */}
      <Section>
        <DisclosureGroup
          isExpanded={expanded.features}
          onChanged={(v) => setExpandedKey("features", v)}
          label={
            <HStack spacing={10} alignment="center">
              <Image systemName="slider.horizontal.3" font="body" foregroundStyle="systemIndigo" />
              <Text font="headline">功能与交互</Text>
              <Spacer />
              {!expanded.features ? (
                <Text font="footnote" foregroundStyle="tertiaryLabel">
                  {settings.launchPage === "discovery" ? "探索" : settings.launchPage === "ranking" ? "排行" : "关注"}
                </Text>
              ) : null}
            </HStack>
          }
        >
          <Toggle
            title="预取后续图片"
            value={settings.prefetchEnabled}
            onChanged={(value) => update({ prefetchEnabled: value })}
          />
          <Picker
            title="启动页面"
            value={settings.launchPage}
            onChanged={(value: string) =>
              update({ launchPage: value as LaunchPage })
            }
          >
            <Text tag="discovery">探索</Text>
            <Text tag="ranking">排行</Text>
            <Text tag="following">关注</Text>
          </Picker>
          <Toggle
            title="沉浸效果"
            value={settings.ambientImmersion}
            onChanged={(value) => {
              if (!value) {
                update({
                  ambientImmersion: false,
                  experimentalImmersion: false,
                })
              } else {
                update({ ambientImmersion: true })
              }
            }}
          />
          {settings.ambientImmersion ? (
            <>
              <Picker
                title="效果强度"
                value={settings.ambientIntensity}
                onChanged={(value: string) =>
                  update({ ambientIntensity: value as "low" | "medium" | "high" })
                }
              >
                <Text tag="low">低</Text>
                <Text tag="medium">中</Text>
                <Text tag="high">高</Text>
              </Picker>
              <Toggle
                title="实验性沉浸效果"
                value={settings.experimentalImmersion}
                onChanged={async (value) => {
                  if (value) {
                    const confirmed = await Dialog.confirm({
                      title: "提示",
                      message: "此功能可能会导致发热和崩溃",
                      confirmLabel: "确认开启",
                      cancelLabel: "取消",
                    })
                    if (confirmed) {
                      update({ experimentalImmersion: true })
                    }
                  } else {
                    update({ experimentalImmersion: false })
                  }
                }}
              />
              {settings.experimentalImmersion ? (
                <>
                  <Picker
                    title="实验性沉浸效果算法"
                    value={settings.experimentalImmersionAlgorithm}
                    onChanged={(value: string) =>
                      update({
                        experimentalImmersionAlgorithm: value as "classic" | "explore" | "ultimate" | "transcend",
                      })
                    }
                  >
                    <Text tag="classic">经典</Text>
                    <Text tag="explore">探索</Text>
                    <Text tag="ultimate">极致</Text>
                    <Text tag="transcend">超越</Text>
                  </Picker>
                  <Picker
                    title="小说正文实验性算法"
                    value={settings.novelReaderExperimentalAlgorithm}
                    onChanged={(value: string) =>
                      update({
                        novelReaderExperimentalAlgorithm: value as "off" | "classic" | "explore" | "ultimate" | "transcend",
                      })
                    }
                  >
                    <Text tag="off">关闭</Text>
                    <Text tag="classic">经典</Text>
                    <Text tag="explore">探索</Text>
                    <Text tag="ultimate">极致</Text>
                    <Text tag="transcend">超越</Text>
                  </Picker>
                  <Picker
                    title="实验性沉浸效果强度"
                    value={settings.experimentalImmersionIntensity}
                    onChanged={(value: string) =>
                      update({
                        experimentalImmersionIntensity: value as "low" | "medium" | "high",
                      })
                    }
                  >
                    <Text tag="low">低</Text>
                    <Text tag="medium">中</Text>
                    <Text tag="high">高</Text>
                  </Picker>
                </>
              ) : null}
            </>
          ) : null}
          <Picker title="追更顺序" value={settings.watchlistSortOrder} onChanged={(value: string) => update({ watchlistSortOrder: value as "asc" | "desc" })}>
            <Text tag="asc">从第一话开始</Text>
            <Text tag="desc">从最新话开始</Text>
          </Picker>
          <Picker title="长按收藏按钮" value={settings.longPressBookmarkAction} onChanged={(value: string) => update({ longPressBookmarkAction: value as "off" | "follow" | "detail" })}>
            <Text tag="off">关闭长按功能</Text>
            <Text tag="follow">一键关注作者</Text>
            <Text tag="detail">打开收藏窗口</Text>
          </Picker>
          <Picker title="关闭按钮行为" value={settings.closeButtonAction} onChanged={(value: string) => update({ closeButtonAction: value as "minimize" | "exit" })}>
            <Text tag="minimize">后台运行</Text>
            <Text tag="exit">完全关闭</Text>
          </Picker>
          <Toggle
            title="关注后推荐相似创作者"
            value={settings.showRelatedUsersOnFollow}
            onChanged={(value) => update({ showRelatedUsersOnFollow: value })}
          />
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
          <HStack spacing={8} alignment="center">
            <VStack alignment="leading" spacing={2}>
              <Text font="body">Web 登录态</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                部分功能需要Web接口
              </Text>
            </VStack>
            <Spacer />
            <Button
              buttonStyle="glass"
              controlSize="small"
              disabled={syncingWebCookie}
              action={async () => {
                setSyncingWebCookie(true)
                void Haptics.transient()
                try {
                  const ok = await syncWebCookies()
                  if (ok) {
                    void Haptics.transient()
                  }
                  setWebCookieVersion((v) => v + 1)
                } catch (e: any) {
                  console.log("syncWebCookies error:", e?.message ?? e)
                } finally {
                  setSyncingWebCookie(false)
                }
              }}
            >
              {session.webCookie ? (
                <HStack spacing={4} alignment="center">
                  <Text font="body">{syncingWebCookie ? "同步中…" : "已同步"}</Text>
                  {!syncingWebCookie ? (
                    <Image
                      systemName="checkmark"
                      font="subheadline"
                      fontWeight="bold"
                      foregroundStyle="systemGreen"
                    />
                  ) : null}
                </HStack>
              ) : (
                <Text font="body">
                  {syncingWebCookie ? "同步中…" : "立即同步"}
                </Text>
              )}
            </Button>
          </HStack>
        </DisclosureGroup>
      </Section>

      {/* 4. AI 助手 */}
      <Section
        footer={
          expanded.ai ? (
            <Text>
              {aiProfile.enabled
                ? "已启用自定义 AI 服务（优先级高于 Scripting 原生助手）。配置与密钥已通过钥匙串加密安全存储，支持 iCloud 跨设备同步。"
                : isScriptingPro()
                ? "当前已激活 Scripting PRO 会员（默认使用原生 Assistant 助手）。开启自定义服务后可接入各大主流 AI 模型。"
                : "当前未开通 Scripting PRO 会员。开启自定义 AI 服务并填入您的 API 密钥（支持 DeepSeek、OpenAI、Google、Anthropic 等主流厂商），即可免费使用完整AI助手功能"}
            </Text>
          ) : undefined
        }
      >
        <DisclosureGroup
          isExpanded={expanded.ai}
          onChanged={(v) => setExpandedKey("ai", v)}
          label={
            <HStack spacing={10} alignment="center">
              <Image systemName="sparkles" font="body" foregroundStyle="systemPurple" />
              <Text font="headline">AI 助手</Text>
              <Spacer />
              {!expanded.ai ? (
                <Text font="footnote" foregroundStyle="tertiaryLabel">
                  {aiProfile.enabled
                    ? getCustomAIProviderName(aiProfile)
                    : isScriptingPro()
                    ? "PRO 原生"
                    : "未开启"}
                </Text>
              ) : null}
            </HStack>
          }
        >
          <HStack spacing={8} alignment="center">
            <Text font="body">AI 助手状态</Text>
            <Spacer />
            {aiProfile.enabled ? (
              <HStack spacing={4} alignment="center">
                <Image systemName="bolt.fill" font="caption" foregroundStyle="systemGreen" />
                <Text font="caption" foregroundStyle="systemGreen">
                  {getCustomAIProviderName(aiProfile)}
                </Text>
              </HStack>
            ) : isScriptingPro() ? (
              <HStack spacing={4} alignment="center">
                <Image systemName="crown.fill" font="caption" foregroundStyle="systemYellow" />
                <Text font="caption" foregroundStyle="systemBlue">
                  Scripting PRO (原生助手)
                </Text>
              </HStack>
            ) : (
              <HStack spacing={4} alignment="center">
                <Image systemName="info.circle" font="caption" foregroundStyle="systemOrange" />
                <Text font="caption" foregroundStyle="systemOrange">
                  未开启 (建议配置自定义 AI)
                </Text>
              </HStack>
            )}
          </HStack>

          <Toggle
            title="启用自定义 AI 模型"
            value={aiProfile.enabled}
            onChanged={(value) => {
              const next = updateCustomAIProfile({ enabled: value })
              setAiProfile(next)
            }}
          />

          {aiProfile.enabled ? (
            <NavigationLink value="customAISettings">
              <HStack spacing={8}>
                <Text font="body">模型配置与端点管理</Text>
                <Spacer />
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {getCustomAIProviderName(aiProfile)}
                </Text>
              </HStack>
            </NavigationLink>
          ) : null}
        </DisclosureGroup>
      </Section>

      {/* 5. 桌面小组件 */}
      <Section
        footer={
          expanded.widgets ? (
            <Text>
              您可在上方按不同尺寸选择默认内容源；若在桌面长按小组件选择“编辑小组件”，亦可在“参数”栏输入关键词进行单个小组件个性化覆盖（支持输入：日榜、周榜、月榜、关注、推荐、专辑）。
            </Text>
          ) : undefined
        }
      >
        <DisclosureGroup
          isExpanded={expanded.widgets}
          onChanged={(v) => setExpandedKey("widgets", v)}
          label={
            <HStack spacing={10} alignment="center">
              <Image systemName="square.grid.2x2.fill" font="body" foregroundStyle="systemGreen" />
              <Text font="headline">桌面小组件</Text>
              <Spacer />
              {!expanded.widgets ? (
                <Text font="footnote" foregroundStyle="tertiaryLabel">
                  {formatWidgetSummary(settings)}
                </Text>
              ) : null}
            </HStack>
          }
        >
          <Picker
            title="小型小组件"
            value={Device.isiPad ? settings.widgetSourceSmallIpad : settings.widgetSourceSmallIos}
            onChanged={(value: string) => {
              update(
                Device.isiPad
                  ? { widgetSourceSmallIpad: value as WidgetDefaultSource }
                  : { widgetSourceSmallIos: value as WidgetDefaultSource }
              )
              try {
                Widget.reloadAll()
              } catch {}
            }}
          >
            <Text tag="ranking_day">日榜</Text>
            <Text tag="ranking_week">周榜</Text>
            <Text tag="ranking_month">月榜</Text>
            <Text tag="follow">关注</Text>
            <Text tag="discovery">推荐</Text>
            <Text tag="pixivision">专辑</Text>
          </Picker>

          <Picker
            title="中型小组件"
            value={Device.isiPad ? settings.widgetSourceMediumIpad : settings.widgetSourceMediumIos}
            onChanged={(value: string) => {
              update(
                Device.isiPad
                  ? { widgetSourceMediumIpad: value as WidgetDefaultSource }
                  : { widgetSourceMediumIos: value as WidgetDefaultSource }
              )
              try {
                Widget.reloadAll()
              } catch {}
            }}
          >
            <Text tag="ranking_day">日榜</Text>
            <Text tag="ranking_week">周榜</Text>
            <Text tag="ranking_month">月榜</Text>
            <Text tag="follow">关注</Text>
            <Text tag="discovery">推荐</Text>
            <Text tag="pixivision">专辑</Text>
          </Picker>

          <Picker
            title="大型小组件"
            value={Device.isiPad ? settings.widgetSourceLargeIpad : settings.widgetSourceLargeIos}
            onChanged={(value: string) => {
              update(
                Device.isiPad
                  ? { widgetSourceLargeIpad: value as WidgetDefaultSource }
                  : { widgetSourceLargeIos: value as WidgetDefaultSource }
              )
              try {
                Widget.reloadAll()
              } catch {}
            }}
          >
            <Text tag="ranking_day">日榜</Text>
            <Text tag="ranking_week">周榜</Text>
            <Text tag="ranking_month">月榜</Text>
            <Text tag="follow">关注</Text>
            <Text tag="discovery">推荐</Text>
            <Text tag="pixivision">专辑</Text>
          </Picker>

          {Device.isiPad && (
            <Picker
              title="超大小组件"
              value={settings.widgetSourceExtraLargeIpad}
              onChanged={(value: string) => {
                update({ widgetSourceExtraLargeIpad: value as WidgetDefaultSource })
                try {
                  Widget.reloadAll()
                } catch {}
              }}
            >
              <Text tag="ranking_day">日榜</Text>
              <Text tag="ranking_week">周榜</Text>
              <Text tag="ranking_month">月榜</Text>
              <Text tag="follow">关注</Text>
              <Text tag="discovery">推荐</Text>
              <Text tag="pixivision">专辑</Text>
            </Picker>
          )}

          <HStack spacing={8} alignment="center">
            <Text font="body">桌面小组件</Text>
            <Spacer />
            <Button
              buttonStyle="glass"
              controlSize="small"
              action={() => {
                void Haptics.transient()
                try {
                  Widget.reloadAll()
                  setWidgetRefreshed()
                } catch {}
              }}
            >
              {widgetRefreshed ? (
                <HStack spacing={4} alignment="center">
                  <Text font="body">已刷新</Text>
                  <Image
                    systemName="checkmark"
                    font="subheadline"
                    fontWeight="bold"
                    foregroundStyle="systemGreen"
                  />
                </HStack>
              ) : (
                <Text font="body">立即刷新</Text>
              )}
            </Button>
          </HStack>
        </DisclosureGroup>
      </Section>

      {/* 6. 图片质量 */}
      <Section>
        <DisclosureGroup
          isExpanded={expanded.quality}
          onChanged={(v) => setExpandedKey("quality", v)}
          label={
            <HStack spacing={10} alignment="center">
              <Image systemName="photo.on.rectangle.angled" font="body" foregroundStyle="systemTeal" />
              <Text font="headline">图片质量</Text>
              <Spacer />
              {!expanded.quality ? (
                <Text font="footnote" foregroundStyle="tertiaryLabel">
                  {`流:${(Device.isiPad ? settings.feedImageQualityIpad : settings.feedImageQualityIos) === "medium" ? "中等" : "大图"} · 详:${(Device.isiPad ? settings.detailImageQualityIpad : settings.detailImageQualityIos) === "large" ? "大图" : "原图"} · 载:${(Device.isiPad ? settings.downloadImageQualityIpad : settings.downloadImageQualityIos) === "large" ? "大图" : "原图"}`}
                </Text>
              ) : null}
            </HStack>
          }
        >
          <Picker
            title="瀑布流"
            value={Device.isiPad ? settings.feedImageQualityIpad : settings.feedImageQualityIos}
            onChanged={(value: string) =>
              update(
                Device.isiPad
                  ? { feedImageQualityIpad: value as "medium" | "large" }
                  : { feedImageQualityIos: value as "medium" | "large" }
              )
            }
          >
            <Text tag="medium">中等</Text>
            <Text tag="large">大图</Text>
          </Picker>
          <Picker
            title="详情页面"
            value={Device.isiPad ? settings.detailImageQualityIpad : settings.detailImageQualityIos}
            onChanged={(value: string) =>
              update(
                Device.isiPad
                  ? { detailImageQualityIpad: value as "large" | "original" }
                  : { detailImageQualityIos: value as "large" | "original" }
              )
            }
          >
            <Text tag="large">大图</Text>
            <Text tag="original">原图</Text>
          </Picker>
          <Picker
            title="下载图片"
            value={Device.isiPad ? settings.downloadImageQualityIpad : settings.downloadImageQualityIos}
            onChanged={(value: string) =>
              update(
                Device.isiPad
                  ? { downloadImageQualityIpad: value as "large" | "original" }
                  : { downloadImageQualityIos: value as "large" | "original" }
              )
            }
          >
            <Text tag="large">大图</Text>
            <Text tag="original">原图</Text>
          </Picker>
        </DisclosureGroup>
      </Section>

      {/* 7. 下载与存储 */}
      <Section
        footer={
          expanded.download ? (
            <Text>
              {settings.downloadStorageMode === "icloud"
                ? `iCloud 存储模式下，图片默认保存在${settings.downloadPhotoAlbumName || "Pix-Scripting"}相簿中，请在“照片”App查看；文件默认保存在 /Scripting/Pix-Scripting 目录中，可在各设备间同步，请在“文件”App 查看。`
                : settings.downloadCustomDirectoryPath
                ? `图片默认保存在${settings.downloadPhotoAlbumName || "Pix-Scripting"}相簿中，请在“照片”App查看；文件保存在 ${settings.downloadCustomDirectoryPath} 目录中，请在“文件”App 查看。`
                : `图片默认保存在${settings.downloadPhotoAlbumName || "Pix-Scripting"}相簿中，请在“照片”App查看；文件默认保存在 /Scripting/Pix-Scripting 目录中，请在“文件”App 查看。`}
            </Text>
          ) : undefined
        }
      >
        <DisclosureGroup
          isExpanded={expanded.download}
          onChanged={(v) => setExpandedKey("download", v)}
          label={
            <HStack spacing={10} alignment="center">
              <Image systemName="arrow.down.circle.fill" font="body" foregroundStyle="systemCyan" />
              <Text font="headline">下载与存储</Text>
              <Spacer />
              {!expanded.download ? (
                <Text font="footnote" foregroundStyle="tertiaryLabel">
                  {settings.downloadStorageMode === "icloud" ? "iCloud" : "本地存储"}
                </Text>
              ) : null}
            </HStack>
          }
        >
          <Picker
            title="动图导出格式"
            value={settings.ugoiraExportFormat}
            onChanged={(value: string) =>
              update({ ugoiraExportFormat: value as "mp4" | "gif" })
            }
          >
            <Text tag="mp4">MP4 视频</Text>
            <Text tag="gif">GIF 动图</Text>
          </Picker>

          <Picker
            title="存储模式"
            value={settings.downloadStorageMode}
            onChanged={(value: string) =>
              update({ downloadStorageMode: value as "local" | "icloud" })
            }
          >
            <Text tag="local">本地存储</Text>
            <Text tag="icloud">iCloud</Text>
          </Picker>

          {settings.downloadStorageMode === "local" ? (
            <HStack spacing={8}>
              <VStack alignment="leading" spacing={2}>
                <Text font="body">本地存储目录</Text>
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {settings.downloadCustomDirectoryPath || "/Scripting/Pix-Scripting"}
                </Text>
              </VStack>
              <Spacer />
              {settings.downloadCustomDirectoryBookmark ? (
                <Button
                  buttonStyle="plain"
                  foregroundStyle="systemRed"
                  action={() => {
                    update({
                      downloadCustomDirectoryBookmark: null,
                      downloadCustomDirectoryPath: null,
                    })
                  }}
                >
                  <Image systemName="arrow.counterclockwise" />
                </Button>
              ) : null}
              <Button
                buttonStyle="plain"
                foregroundStyle="systemBlue"
                action={async () => {
                  try {
                    const res = await DocumentPicker.pickDirectoryBookmark({
                      preferredName: "Pixiv_Download_Dir",
                    })
                    if (res && res.bookmarkName) {
                      update({
                        downloadCustomDirectoryBookmark: res.bookmarkName,
                        downloadCustomDirectoryPath: res.path,
                      })
                    }
                  } catch (err: any) {
                    console.log("pickDirectoryBookmark error:", err?.message ?? err)
                  }
                }}
              >
                <Image systemName="folder.badge.plus" />
              </Button>
            </HStack>
          ) : null}

          <HStack spacing={8}>
            <Text font="body">相簿名称</Text>
            <Spacer />
            <Button
              buttonStyle="plain"
              action={async () => {
                try {
                  const currentName = settings.downloadPhotoAlbumName || "Pix-Scripting"
                  const nextName = await Dialog.prompt({
                    title: "修改相簿名称",
                    message: "插画和动图保存至相册时将自动归类到此相簿",
                    defaultValue: currentName,
                    placeholder: "请输入相簿名称",
                    confirmLabel: "保存",
                    cancelLabel: "取消",
                  })
                  if (nextName !== null && nextName.trim().length > 0) {
                    update({ downloadPhotoAlbumName: nextName.trim() })
                  }
                } catch (e: any) {
                  console.log("prompt album name error:", e?.message ?? e)
                }
              }}
            >
              <HStack spacing={4} alignment="center">
                <Text font="body" foregroundStyle="secondaryLabel">
                  {settings.downloadPhotoAlbumName || "Pix-Scripting"}
                </Text>
                <Image systemName="pencil" font="caption" foregroundStyle="tertiaryLabel" />
              </HStack>
            </Button>
          </HStack>

          <NavigationLink value="downloadManager">
            <HStack spacing={8} alignment="center">
              <Text font="body">下载与文件管理</Text>
              <Spacer />
              <Text font="caption" foregroundStyle="secondaryLabel">
                分类浏览与清理
              </Text>
            </HStack>
          </NavigationLink>
        </DisclosureGroup>
      </Section>

      {/* 8. 浏览记录 */}
      <Section>
        <DisclosureGroup
          isExpanded={expanded.history}
          onChanged={(v) => setExpandedKey("history", v)}
          label={
            <HStack spacing={10} alignment="center">
              <Image systemName="clock.arrow.circlepath" font="body" foregroundStyle="systemBrown" />
              <Text font="headline">浏览记录</Text>
              <Spacer />
              {!expanded.history ? (
                <Text font="footnote" foregroundStyle="tertiaryLabel">
                  {settings.recordHistory ? `${historyTotal} 条` : "已关闭"}
                </Text>
              ) : null}
            </HStack>
          }
        >
          <Toggle title="记录浏览历史" value={settings.recordHistory} onChanged={(value) => update({ recordHistory: value })} />
          <HStack spacing={8}>
            <Text>当前记录数量</Text>
            <Spacer />
            <Text font="body" foregroundStyle="secondaryLabel">{`${historyTotal} 条`}</Text>
            <Button
              action={() => {}}
              buttonStyle="glass"
              frame={{ width: 30, height: 30 }}
              clipShape={{ type: "rect", cornerRadius: 15 }}
              contentShape="rect"
              contextMenu={{
                menuItems: (
                  <Group>
                    <Button
                      title="清除全部浏览历史"
                      systemImage="trash"
                      role="destructive"
                      action={clearAllHistory}
                    />
                  </Group>
                ),
              }}
            >
              <Image systemName={historyCleared ? "checkmark" : "trash"} foregroundStyle={historyCleared ? "systemGreen" : "systemRed"} />
            </Button>
          </HStack>
        </DisclosureGroup>
      </Section>

      {/* 9. 缓存管理 */}
      <Section>
        <DisclosureGroup
          isExpanded={expanded.cache}
          onChanged={(v) => setExpandedKey("cache", v)}
          label={
            <HStack spacing={10} alignment="center">
              <Image systemName="internaldrive.fill" font="body" foregroundStyle="systemGray" />
              <Text font="headline">缓存管理</Text>
              <Spacer />
              {!expanded.cache ? (
                <Text font="footnote" foregroundStyle="tertiaryLabel">
                  {cacheSize == null ? "计算中…" : formatSize(cacheSize)}
                </Text>
              ) : null}
            </HStack>
          }
        >
          <Picker title="图片缓存上限" value={settings.cacheLimitMB == null ? "unlimited" : String(settings.cacheLimitMB)} onChanged={(value: string) => {
            const cacheLimitMB = value === "unlimited" ? null : Number(value)
            update({ cacheLimitMB })
            enforceCacheLimit()
            enforceUgoiraCacheLimit()
            refreshCacheSize()
          }}>
            {CACHE_LIMIT_OPTIONS.map((limit) => <Text key={limit} tag={String(limit)}>{limit}M</Text>)}
            <Text tag="unlimited">无限</Text>
          </Picker>
          <HStack spacing={8}>
            <Text>当前缓存占用</Text>
            <Spacer />
            <Text font="body" foregroundStyle="secondaryLabel">{cacheSize == null ? "计算中…" : formatSize(cacheSize)}</Text>
            <Button
              action={() => {}}
              buttonStyle="glass"
              frame={{ width: 30, height: 30 }}
              clipShape={{ type: "rect", cornerRadius: 15 }}
              contentShape="rect"
              contextMenu={{
                menuItems: (
                  <Group>
                    <Button
                      title="清除全部图片缓存"
                      systemImage="trash"
                      role="destructive"
                      action={clearAllCaches}
                    />
                  </Group>
                ),
              }}
            >
              <Image systemName={cacheCleared ? "checkmark" : "trash"} foregroundStyle={cacheCleared ? "systemGreen" : "systemRed"} />
            </Button>
          </HStack>
        </DisclosureGroup>
      </Section>

      {/* 10. 调试与高级设置 */}
      {settings.advancedSettingsUnlocked ? (
        <Section>
          <DisclosureGroup
            isExpanded={expanded.debug}
            onChanged={(v) => setExpandedKey("debug", v)}
            label={
              <HStack spacing={10} alignment="center">
                <Image systemName="wrench.and.screwdriver.fill" font="body" foregroundStyle="systemRed" />
                <Text font="headline">调试与高级参数</Text>
                <Spacer />
                {!expanded.debug ? (
                  <Text font="footnote" foregroundStyle="tertiaryLabel">
                    12 项参数
                  </Text>
                ) : null}
              </HStack>
            }
          >
            <AdvancedNumberRow
              title="小组件池大小"
              unit="张"
              value={settings.widgetPoolCapacity}
              defaultValue={30}
              min={10}
              max={30}
              onSave={(val) => update({ widgetPoolCapacity: val })}
            />
            <AdvancedNumberRow
              title="小组件刷新时长"
              unit="min"
              value={settings.widgetReloadIntervalMinutes}
              defaultValue={60}
              min={30}
              max={1440}
              onSave={(val) => update({ widgetReloadIntervalMinutes: val })}
            />
            <AdvancedNumberRow
              title="图片并发数"
              unit="张"
              value={settings.imageBatchConcurrency}
              defaultValue={30}
              min={1}
              max={90}
              onSave={(val) => update({ imageBatchConcurrency: val })}
            />
            <AdvancedNumberRow
              title="图片翻译并发数"
              unit="张"
              value={settings.aiTranslateConcurrency}
              defaultValue={4}
              min={1}
              max={6}
              onSave={(val) => update({ aiTranslateConcurrency: val })}
            />
            <AdvancedNumberRow
              title="下载并发比例"
              unit="%"
              value={settings.imageDownloadConcurrencyRatio}
              defaultValue={100}
              min={0}
              max={100}
              onSave={(val) => update({ imageDownloadConcurrencyRatio: val })}
            />
            <AdvancedNumberRow
              title="预取并发比例"
              unit="%"
              value={settings.imagePrefetchConcurrencyRatio}
              defaultValue={100}
              min={0}
              max={100}
              onSave={(val) => update({ imagePrefetchConcurrencyRatio: val })}
            />
            <AdvancedNumberRow
              title="淡入动画时长"
              unit="ms"
              value={settings.imageFadeInDuration}
              defaultValue={100}
              min={1}
              max={500}
              onSave={(val) => update({ imageFadeInDuration: val })}
            />
            <AdvancedNumberRow
              title="模糊消融时长"
              unit="ms"
              value={settings.blurCrossFadeDuration}
              defaultValue={100}
              min={0}
              max={250}
              onSave={(val) => update({ blurCrossFadeDuration: val })}
            />
            <AdvancedNumberRow
              title="背景预热时长"
              unit="ms"
              value={settings.backgroundPreheatDuration}
              defaultValue={1000}
              min={0}
              max={2000}
              onSave={(val) => update({ backgroundPreheatDuration: val })}
            />
            <AdvancedNumberRow
              title="加载动画时长"
              unit="ms"
              value={settings.loadingAnimationDuration}
              defaultValue={400}
              min={0}
              max={10000}
              onSave={(val) => update({ loadingAnimationDuration: val })}
            />
            <AdvancedNumberRow
              title="小说加载时长"
              unit="ms"
              value={settings.novelLoadingDuration}
              defaultValue={1000}
              min={0}
              max={5000}
              onSave={(val) => update({ novelLoadingDuration: val })}
            />
            <AdvancedNumberRow
              title="启动动画时长"
              unit="ms"
              value={settings.launchAnimationDuration}
              defaultValue={1500}
              min={0}
              max={10000}
              onSave={(val) => update({ launchAnimationDuration: val })}
            />
          </DisclosureGroup>
        </Section>
      ) : null}
    </List>
  )
}

function formatWidgetSummary(settings: any): string {
  const s = sourceLabel(Device.isiPad ? settings.widgetSourceSmallIpad : settings.widgetSourceSmallIos)
  const m = sourceLabel(Device.isiPad ? settings.widgetSourceMediumIpad : settings.widgetSourceMediumIos)
  const l = sourceLabel(Device.isiPad ? settings.widgetSourceLargeIpad : settings.widgetSourceLargeIos)
  if (Device.isiPad) {
    const xl = sourceLabel(settings.widgetSourceExtraLargeIpad)
    return `小:${s} · 中:${m} · 大:${l} · 特大:${xl}`
  }
  return `小:${s} · 中:${m} · 大:${l}`
}

function sourceLabel(source?: string): string {
  switch (source) {
    case "ranking_day": return "日榜"
    case "ranking_week": return "周榜"
    case "ranking_month": return "月榜"
    case "follow": return "关注"
    case "discovery": return "推荐"
    case "pixivision": return "专辑"
    default: return "默认"
  }
}

function AdvancedNumberRow(props: {
  title: string
  unit: string
  value: number
  defaultValue: number
  min?: number
  max?: number
  onSave: (num: number) => void
}) {
  const { title, unit, value, defaultValue, min = 0, max = 30000, onSave } = props
  const [text, setText] = useState(String(value ?? defaultValue))

  useEffect(() => {
    setText(String(value ?? defaultValue))
  }, [value, defaultValue])

  const commit = (inputStr: string) => {
    const raw = parseInt(inputStr.replace(/\D/g, ""), 10)
    const finalVal = !isNaN(raw) ? Math.max(min, Math.min(max, raw)) : defaultValue
    setText(String(finalVal))
    onSave(finalVal)
  }

  return (
    <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
      <Text>{title}</Text>
      <Spacer />
      <HStack alignment="center" spacing={4}>
        <TextField
          label={<Text>{title}</Text>}
          prompt={String(defaultValue)}
          value={text}
          onChanged={(v: string) => {
            const sanitized = v.replace(/\D/g, "")
            setText(sanitized)
            if (sanitized) {
              const num = parseInt(sanitized, 10)
              if (!isNaN(num)) {
                onSave(Math.max(min, Math.min(max, num)))
              }
            }
          }}
          onBlur={() => commit(text)}
          axis="horizontal"
          textFieldStyle="plain"
          multilineTextAlignment="trailing"
          foregroundStyle="secondaryLabel"
          frame={{ minWidth: 60, alignment: "trailing" }}
        />
        {unit ? (
          <Text font="body" foregroundStyle="secondaryLabel">
            {unit}
          </Text>
        ) : null}
      </HStack>
    </HStack>
  )
}


