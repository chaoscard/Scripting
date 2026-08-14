import {
  Button,
  HStack,
  Image,
  List,
  LongPressGesture,
  NavigationLink,
  Picker,
  Section,
  Spacer,
  Text,
  Toggle,
  useEffect,
  useState,
} from "scripting"
import {
  cacheUsageBytes,
  clearCache,
  enforceCacheLimit,
} from "../image/imageLoader"
import { loadSettings, onSettingsChanged, updateSettings } from "../store/settings"
import { clearUgoiraCache, ugoiraCacheUsageBytes } from "../ugoira/ugoira"
import { useTimedFlag } from "./hooks"

const CACHE_LIMIT_OPTIONS = [300, 500, 1000, 2000] as const

export function SettingsView() {
  const [settings, setSettings] = useState(loadSettings())
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [cacheCleared, setCacheCleared] = useTimedFlag()

  function refreshCacheSize() {
    setCacheSize(cacheUsageBytes() + ugoiraCacheUsageBytes())
  }

  useEffect(() => {
    refreshCacheSize()
    return onSettingsChanged(() => {
      refreshCacheSize()
    })
  }, [])

  function update(patch: Partial<typeof settings>) {
    setSettings(updateSettings(patch))
  }

  function clearAllCaches() {
    clearCache()
    clearUgoiraCache()
    setCacheCleared()
    setCacheSize(0)
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
    <List navigationTitle="设置" navigationBarTitleDisplayMode="inline">
      <Section header={<Text>内容过滤</Text>}>
        <Toggle title="显示 R18 作品" value={settings.showR18} onChanged={(value) => update({ showR18: value })} />
        <Toggle title="显示 R18G 作品" value={settings.showR18G} onChanged={(value) => update({ showR18G: value })} />
        <Toggle title="显示 AI 生成作品" value={settings.showAI} onChanged={(value) => update({ showAI: value })} />
        <Toggle title="关注豁免" value={settings.followFilterExempt} onChanged={(value) => update({ followFilterExempt: value })} />
        <NavigationLink value="blockedSettings">
          <HStack spacing={8}>
            <Text font="body">屏蔽设置</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">
              标签 {settings.blockedTags.length} · 用户 {settings.blockedUsers.length}
            </Text>
          </HStack>
        </NavigationLink>
      </Section>

      <Section header={<Text>收藏</Text>}>
        <Picker title="长按按钮" value={settings.longPressBookmarkAction} onChanged={(value: string) => update({ longPressBookmarkAction: value as "off" | "follow" | "detail" })}>
          <Text tag="off">关闭长按功能</Text>
          <Text tag="follow">一键关注作者</Text>
          <Text tag="detail">打开收藏窗口</Text>
        </Picker>
      </Section>

      <Section header={<Text>图片质量</Text>}>
        <Picker title="详情页面" value={settings.detailImageQuality} onChanged={(value: string) => update({ detailImageQuality: value as "medium" | "large" | "original" })}>
          <Text tag="medium">中等</Text>
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
            simultaneousGesture={LongPressGesture({ minDuration: 500 }).onEnded(clearAllCaches)}
          >
            <Image systemName={cacheCleared ? "checkmark" : "trash"} foregroundStyle={cacheCleared ? "systemGreen" : "systemRed"} />
          </Button>
        </HStack>
      </Section>
    </List>
  )
}
