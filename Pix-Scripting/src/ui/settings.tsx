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
} from "../store/settings"
import { loadBlocklist, onBlocklistChanged } from "../store/blocklist"
import { editAIShowSettings } from "../api/pixiv"
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

      <Section header={<Text>图片质量</Text>}>
        <Picker title="瀑布流" value={settings.feedImageQuality} onChanged={(value: string) => update({ feedImageQuality: value as "medium" | "large" })}>
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

      <Section
        header={<Text>下载与存储</Text>}
        footer={
          <Text>
            {settings.downloadStorageMode === "icloud"
              ? "iCloud 存储模式下，保存在 /Scripting/Pix-Scripting 目录中，可在各个设备间同步，请在“文件”App 查看。"
              : settings.downloadCustomDirectoryPath
              ? `当前自定义存储路径：${settings.downloadCustomDirectoryPath}，请在“文件”App 查看。`
              : "默认保存在 /Scripting/Pix-Scripting 目录中，请在“文件”App 查看。"}
          </Text>
        }
      >
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
            defaultValue={150}
            min={1}
            max={500}
            onSave={(val) => update({ imageFadeInDuration: val })}
          />
          <AdvancedNumberRow
            title="模糊消融时长"
            unit="ms"
            value={settings.blurCrossFadeDuration}
            defaultValue={150}
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

