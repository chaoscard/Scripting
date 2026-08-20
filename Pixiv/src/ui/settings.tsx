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
  useEffect,
  useState,
} from "scripting"
import {
  cacheUsageBytes,
  clearCache,
  enforceCacheLimit,
} from "../image/imageLoader"
import { clearHistory, historyCount, onHistoryChanged } from "../store/history"
import {
  loadSettings,
  onSettingsChanged,
  resetSettings,
  updateSettings,
  type LaunchPage,
  type ImageBatchConcurrency,
  type ImageFadeInDuration,
  type BlurCrossFadeDuration,
  type LoadingAnimationDuration,
  type LaunchAnimationDuration,
} from "../store/settings"
import { loadBlocklist, onBlocklistChanged } from "../store/blocklist"
import { editAIShowSettings } from "../api/pixiv"
import { session } from "../api/session"
import { clearUgoiraCache, ugoiraCacheUsageBytes } from "../ugoira/ugoira"
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
      <Section
        header={<Text>内容过滤</Text>}
        footer={<Text font="caption" foregroundStyle="secondaryLabel">AI 设置切换时将自动同步至 Pixiv 服务端账号设置。</Text>}
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

      <Section header={<Text>功能</Text>}>
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
        <Toggle title="沉浸效果" value={settings.ambientImmersion} onChanged={(value) => update({ ambientImmersion: value })} />
        {settings.ambientImmersion ? (
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
      </Section>

      <Section header={<Text>图片质量</Text>}>
        <Picker title="信息流" value={settings.feedImageQuality} onChanged={(value: string) => update({ feedImageQuality: value as "medium" | "large" })}>
          <Text tag="medium">中等</Text>
          <Text tag="large">大图</Text>
        </Picker>
        <Picker title="详情页面" value={settings.detailImageQuality} onChanged={(value: string) => update({ detailImageQuality: value as "large" | "original" })}>
          <Text tag="large">大图</Text>
          <Text tag="original">原图</Text>
        </Picker>
        <Picker title="下载图片" value={settings.downloadImageQuality} onChanged={(value: string) => update({ downloadImageQuality: value as "large" | "original" })}>
          <Text tag="large">大图</Text>
          <Text tag="original">原图</Text>
        </Picker>
      </Section>

      <Section header={<Text>浏览记录</Text>}>
        <Toggle title="浏览记录" value={settings.recordHistory} onChanged={(value) => update({ recordHistory: value })} />
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
      </Section>

      <Section header={<Text>缓存管理</Text>}>
        <Picker title="图片缓存大小" value={settings.cacheLimitMB == null ? "unlimited" : String(settings.cacheLimitMB)} onChanged={(value: string) => {
          const cacheLimitMB = value === "unlimited" ? null : Number(value)
          update({ cacheLimitMB })
          enforceCacheLimit()
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
      </Section>

      {settings.advancedSettingsUnlocked ? (
        <Section
          header={<Text>调试</Text>}
          footer={<Text>支持自定义数值；并发比例为百分比 (0-100%)；动画时长单位为毫秒 (ms)。</Text>}
        >
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
            defaultValue={200}
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
            title="加载动画时长"
            unit="ms"
            value={settings.loadingAnimationDuration}
            defaultValue={400}
            min={0}
            max={10000}
            onSave={(val) => update({ loadingAnimationDuration: val })}
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
        </Section>
      ) : null}
    </List>
  )
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

