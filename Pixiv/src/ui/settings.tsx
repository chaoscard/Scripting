import { SCRIPT_VERSION } from "../config"
import {
  Button,
  HStack,
  Image,
  List,
  NavigationLink,
  Picker,
  Section,
  Spacer,
  Text,
  Toggle,
  useEffect,
  useState,
  VStack,
} from "scripting"
import {
  clearCache,
  cacheUsageBytes,
} from "../image/imageLoader"
import { loadSettings, onSettingsChanged, updateSettings } from "../store/settings"
import { session } from "../api/session"
import { clearUgoiraCache } from "../ugoira/ugoira"
import { applyHistoryLimit, clearHistory, historyCount } from "../store/history"
import { useTimedFlag } from "./hooks"

// 可选缓存上限（MB）
const CACHE_LIMIT_OPTIONS = [200, 300, 500, 1000] as const

// 可选浏览记录条数上限
const HISTORY_LIMIT_OPTIONS = [100, 300, 500, 1000] as const

export function SettingsView() {
  const [settings, setSettings] = useState(loadSettings())
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [cleared, setClearedOn] = useTimedFlag()
  const [ugoiraCleared, setUgoiraClearedOn] = useTimedFlag()
  const [historyCleared, setHistoryClearedOn] = useTimedFlag()

  function refreshCacheSize() {
    setCacheSize(cacheUsageBytes())
  }

  // 进入页面时计算一次；设置/清缓存后也刷新（保持数字不过期）
  useEffect(() => {
    refreshCacheSize()
    return onSettingsChanged(() => {
      refreshCacheSize()
    })
  }, [])

  function update(patch: Partial<typeof settings>) {
    // 走 updateSettings：持久化 + 通知各列表页立即重载过滤
    setSettings(updateSettings(patch))
  }

  function onClearCache() {
    clearCache()
    setClearedOn()
    setCacheSize(0)
  }

  function onClearUgoira() {
    clearUgoiraCache()
    setUgoiraClearedOn()
  }

  function onClearHistory() {
    clearHistory()
    setHistoryClearedOn()
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
      <Section header={<Text>内容显示</Text>}>
        <Toggle
          title="显示 R18 作品"
          value={settings.showR18}
          onChanged={(v) => update({ showR18: v })}
        />
        <Toggle
          title="显示 R18G 作品"
          value={settings.showR18G}
          onChanged={(v) => update({ showR18G: v })}
        />
        <Toggle
          title="显示 AI 生成作品"
          value={settings.showAI}
          onChanged={(v) => update({ showAI: v })}
        />
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
        <Picker
          title="收藏按钮长按行为"
          value={settings.longPressBookmarkAction}
          onChanged={(value: string) =>
            update({
              longPressBookmarkAction: value as "off" | "follow" | "detail",
            })
          }
        >
          <Text tag="off">关闭长按功能</Text>
          <Text tag="follow">收藏并关注作者</Text>
          <Text tag="detail">打开详情收藏窗口</Text>
        </Picker>
      </Section>

      <Section header={<Text>详情图片质量</Text>}>
        <Button
          title="标准图"
          buttonStyle={settings.imageQuality === "medium" ? "glassProminent" : "glass"}
          action={() => update({ imageQuality: "medium" })}
        />
        <Button
          title="大图"
          buttonStyle={settings.imageQuality === "large" ? "glassProminent" : "glass"}
          action={() => update({ imageQuality: "large" })}
        />
        <Button
          title="原图"
          buttonStyle={settings.imageQuality === "original" ? "glassProminent" : "glass"}
          action={() => update({ imageQuality: "original" })}
        />
      </Section>

      <Section header={<Text>浏览记录</Text>}>
        <Toggle
          title="记录浏览历史"
          value={settings.recordHistory}
          onChanged={(v) => update({ recordHistory: v })}
        />
        <VStack alignment="leading" spacing={4} padding={{ vertical: 4 }}>
          <Text font="caption2" foregroundStyle="secondaryLabel">
            打开作品时自动记录并同步至 iCloud（无需会员）。当前 {historyCount()} 条
          </Text>
        </VStack>
        <HStack spacing={8} padding={{ vertical: 4 }}>
          {HISTORY_LIMIT_OPTIONS.map((n) => (
            <Button
              key={n}
              title={`${n} 条`}
              buttonStyle={settings.historyLimit === n ? "glassProminent" : "glass"}
              tint={settings.historyLimit === n ? "#0096FA" : undefined}
              controlSize="small"
              action={() => {
                update({ historyLimit: n })
                applyHistoryLimit()
              }}
            />
          ))}
        </HStack>
        <Button
          title={historyCleared ? "已清空 ✓" : "清空浏览记录"}
          buttonStyle="glass"
          action={onClearHistory}
        />
      </Section>

      <Section header={<Text>缓存管理</Text>}>
        <VStack alignment="leading" spacing={4} padding={{ vertical: 6 }}>
          <Text font="subheadline">
            图片缓存占用：{cacheSize != null ? formatSize(cacheSize) : "计算中…"}
          </Text>
          <Text font="caption2" foregroundStyle="secondaryLabel">
            自动按使用时间清理，超过上限后淘汰最久未用的图片
          </Text>
        </VStack>
        <HStack spacing={8} padding={{ vertical: 4 }}>
          {CACHE_LIMIT_OPTIONS.map((mb) => (
            <Button
              key={mb}
              title={`${mb} MB`}
              buttonStyle={settings.cacheLimitMB === mb ? "glassProminent" : "glass"}
              tint={settings.cacheLimitMB === mb ? "#0096FA" : undefined}
              controlSize="small"
              action={() => update({ cacheLimitMB: mb })}
            />
          ))}
        </HStack>
        <Button
          title={cleared ? "已清空 ✓" : "清空图片缓存"}
          buttonStyle="glass"
          action={onClearCache}
        />
        <Button
          title={ugoiraCleared ? "已清空 ✓" : "清空动图缓存"}
          buttonStyle="glass"
          action={onClearUgoira}
        />
      </Section>

      <Section header={<Text>账号</Text>}>
        <Button
          title="退出登录"
          buttonStyle="glass"
          foregroundStyle="systemRed"
          action={() => {
            // signOut 内部会 emitAuthChanged，RootView 自动切回登录页
            session.signOut()
          }}
        />
      </Section>

      <Section footer={<Text>Pixiv 客户端 v{SCRIPT_VERSION} · 液态玻璃风格</Text>}>
        <Text font="caption2" foregroundStyle="secondaryLabel">
          数据来自 Pixiv 官方 API，仅供个人学习使用
        </Text>
      </Section>
    </List>
  )
}
