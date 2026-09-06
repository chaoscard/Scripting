import {
  Button,
  Group,
  HStack,
  Image,
  Spacer,
  Text,
  useEffect,
  useState,
} from "scripting"
import { session } from "../api/session"
import {
  addBookmark,
  illustrationDetail,
  removeBookmark,
  followUser,
  unfollowUser,
  addNovelBookmark,
  removeNovelBookmark,
  novelDetail,
  novelViewerData,
} from "../api/pixiv"
import { getCachedIllust } from "../store/illustCache"
import { updateHistoryBookmark, updateNovelHistoryBookmark } from "../store/history"
import { useIllustBookmark, useNovelBookmark, useUserFollow } from "./hooks"
import {
  downloadIllustToAlbum,
  exportNovelToEpub,
  exportUgoiraToAlbum,
} from "../downloader"
import { getDownloadImageQuality } from "../store/settings"
import type { PixivIllustration } from "../types"

declare const Haptics: any
declare const ShareSheet: any

type ObservableLike<T> = { value: T }
type AccessoryNode = any

const accessoryRegistry = new Map<string, AccessoryNode>()
const listeners = new Set<() => void>()

export function subscribeBottomAccessory(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyBottomAccessory() {
  for (const fn of listeners) {
    try {
      fn()
    } catch {}
  }
}

export function registerBottomAccessory(key: string, node: AccessoryNode) {
  if (accessoryRegistry.get(key) === node) return
  accessoryRegistry.set(key, node)
  notifyBottomAccessory()
}

export function unregisterBottomAccessory(key: string) {
  if (accessoryRegistry.has(key)) {
    accessoryRegistry.delete(key)
    notifyBottomAccessory()
  }
}

export function useRegisterBottomAccessory(
  key: string,
  node: AccessoryNode,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled || !node) {
      unregisterBottomAccessory(key)
      return
    }
    registerBottomAccessory(key, node)
    return () => {
      unregisterBottomAccessory(key)
    }
  }, [key, node, enabled])
}

export function getActiveAccessoryKey(
  activeTab: string,
  activePath: string[]
): string | null {
  if (activePath.length === 0) {
    if (activeTab === "discovery") return "discovery"
    if (activeTab === "ranking") return "ranking"
    if (activeTab === "following") return "following"
    if (activeTab === "search") return "search"
    if (activeTab === "more") return "more"
    return null
  }

  const top = activePath[activePath.length - 1]
  if (top.startsWith("illust:") || top.startsWith("illustDetail:")) return top
  if (top.startsWith("novel:") || top.startsWith("novelDetail:")) return top
  if (top === "library") return "library"
  if (top === "history") return "history"
  if (top.startsWith("userBookmarks:")) return "userBookmarks"
  if (top.startsWith("user:") || top === "myWorks") return "userWorks"
  return null
}

export function getActiveAccessory(
  activeTab: string,
  activePath: string[]
): any | null {
  const key = getActiveAccessoryKey(activeTab, activePath)
  if (!key) return null
  return accessoryRegistry.get(key) ?? null
}

export interface DockSegmentedItem<T extends string = string> {
  tag: T
  label: string
}

export function DockSegmentedBar<T extends string = string>(props: {
  items: ReadonlyArray<DockSegmentedItem<T>>
  value: T
  onChanged: (val: T) => void
  scrollable?: boolean
}) {
  // 限制榜单数量上限为 3 个后，全 App 统一采用全宽 1:1 均分布局：
  // 1. 未收起状态：在宽胶囊中等分铺满，绝对居中对称，两端不留白；
  // 2. 收起状态：在中央胶囊（180pt）内 3 个选项完整展示，选中的红字项与未选中的蓝字项 100% 清晰可见，绝不遮挡。
  return (
    <HStack
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      padding={{ horizontal: 6 }}
    >
      {props.items.map((item) => {
        const isSelected = item.tag === props.value
        return (
          <Button
            key={item.tag}
            buttonStyle="plain"
            frame={{ maxWidth: "infinity" }}
            action={() => {
              if (item.tag !== props.value) {
                props.onChanged(item.tag)
              }
            }}
          >
            <HStack
              alignment="center"
              frame={{ maxWidth: "infinity" }}
              padding={{ vertical: 6 }}
            >
              <Text
                font="subheadline"
                fontWeight="bold"
                foregroundStyle={isSelected ? "#EE2F49" : "#3172EB"}
                lineLimit={1}
                fixedSize={{ horizontal: true, vertical: false }}
              >
                {item.label}
              </Text>
            </HStack>
          </Button>
        )
      })}
    </HStack>
  )
}

export interface DockActionItem {
  key: string
  label: string
  icon?: string
  color?: string
  disabled?: boolean
  action: () => void
  contextMenu?: any
}

export function DockActionBar(props: {
  items: ReadonlyArray<DockActionItem>
}) {
  return (
    <HStack
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      padding={{ horizontal: 6 }}
    >
      {props.items.map((item) => {
        const color = item.color ?? "#3172EB"
        return (
          <Button
            key={item.key}
            buttonStyle="plain"
            frame={{ maxWidth: "infinity" }}
            disabled={item.disabled}
            action={item.action}
            contextMenu={item.contextMenu}
          >
            <HStack
              alignment="center"
              frame={{ maxWidth: "infinity" }}
              padding={{ vertical: 6 }}
              spacing={3}
            >
              {item.icon ? (
                <Image
                  systemName={item.icon}
                  font={13}
                  foregroundStyle={color as any}
                />
              ) : null}
              <Text
                font="subheadline"
                fontWeight="bold"
                foregroundStyle={color as any}
                lineLimit={1}
                fixedSize={{ horizontal: true, vertical: false }}
              >
                {item.label}
              </Text>
            </HStack>
          </Button>
        )
      })}
    </HStack>
  )
}

export function CapsuleAccessoryContainer(props: { children: any }) {
  return (
    <HStack
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      padding={{ horizontal: 8, top: 1, bottom: 2 }}
    >
      {props.children}
    </HStack>
  )
}

export function IllustDetailDockBar(props: { illustID: number }) {
  const { illustID } = props
  const cached = getCachedIllust(illustID)
  const [illust, setIllust] = useState<PixivIllustration | null>(cached)
  const [bookmarked, setBookmarked] = useIllustBookmark(
    illustID,
    cached?.is_bookmarked ?? false
  )
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const userID = illust?.user?.id ?? cached?.user?.id ?? 0
  const [followed, setFollowed] = useUserFollow(
    userID,
    illust?.user?.is_followed ?? cached?.user?.is_followed ?? false
  )
  const [followLoading, setFollowLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!illust) {
      session
        .call((token) => illustrationDetail(illustID, token))
        .then((detail) => {
          if (detail) setIllust(detail)
        })
        .catch(() => {})
    }
  }, [illustID, illust])

  async function toggleBookmark() {
    if (bookmarkLoading) return
    try {
      void Haptics.transient()
    } catch {}
    setBookmarkLoading(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeBookmark(illustID, token))
        setBookmarked(false)
      } else {
        await session.call((token) => addBookmark(illustID, "public", [], token))
        setBookmarked(true)
      }
      updateHistoryBookmark(illustID, !bookmarked)
    } catch {
    } finally {
      setBookmarkLoading(false)
    }
  }

  async function toggleFollow() {
    if (!userID || followLoading) return
    try {
      void Haptics.transient()
    } catch {}
    setFollowLoading(true)
    try {
      if (followed) {
        await session.call((token) => unfollowUser(userID, token))
        setFollowed(false)
      } else {
        await session.call((token) => followUser(userID, "public", token))
        setFollowed(true)
      }
    } catch {
    } finally {
      setFollowLoading(false)
    }
  }

  async function handleDownload() {
    const current = illust ?? cached
    if (downloading || !current) return
    try {
      void Haptics.transient()
    } catch {}
    setDownloading(true)
    try {
      if (current.type === "ugoira") {
        await exportUgoiraToAlbum(current)
      } else {
        await downloadIllustToAlbum(current, getDownloadImageQuality())
      }
    } finally {
      setDownloading(false)
    }
  }

  const items: DockActionItem[] = [
    {
      key: "follow",
      label: followed ? "已关注" : "关注",
      icon: followed ? "person.crop.circle.badge.checkmark" : "person.crop.circle.badge.plus",
      color: followed ? "#EE2F49" : "#3172EB",
      disabled: !userID || followLoading,
      action: toggleFollow,
    },
    {
      key: "bookmark",
      label: bookmarked ? "已收藏" : "收藏",
      icon: bookmarked ? "heart.fill" : "heart",
      color: bookmarked ? "#EE2F49" : "#3172EB",
      disabled: bookmarkLoading,
      action: toggleBookmark,
    },
    {
      key: "download",
      label: downloading ? "下载中…" : "下载",
      icon: downloading ? "arrow.down.circle.fill" : "arrow.down.circle",
      color: downloading ? "secondaryLabel" : "#3172EB",
      disabled: downloading,
      action: handleDownload,
    },
  ]

  return <DockActionBar items={items} />
}

export function NovelDetailDockBar(props: { novelID: number }) {
  const { novelID } = props
  const [bookmarked, setBookmarked] = useNovelBookmark(novelID, false)
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  async function toggleBookmark() {
    if (bookmarkLoading) return
    try {
      void Haptics.transient()
    } catch {}
    setBookmarkLoading(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeNovelBookmark(novelID, token))
        setBookmarked(false)
      } else {
        await session.call((token) => addNovelBookmark(novelID, "public", token))
        setBookmarked(true)
      }
      updateNovelHistoryBookmark(novelID, !bookmarked)
    } catch {
    } finally {
      setBookmarkLoading(false)
    }
  }

  async function handleDownload() {
    if (downloading) return
    try {
      void Haptics.transient()
    } catch {}
    setDownloading(true)
    try {
      const viewer = await session.call((token) => novelViewerData(novelID, token))
      if (viewer && viewer.text) {
        const detail = await session.call((token) => novelDetail(novelID, token))
        if (detail) {
          const isR18 =
            (detail.x_restrict ?? 0) > 0 ||
            detail.tags?.some((t) => /r-?18/i.test(t.name))
          const cover =
            detail.image_urls?.large ||
            detail.image_urls?.medium ||
            viewer.coverUrl
          const res = await exportNovelToEpub({
            id: detail.id,
            title: detail.title,
            author: detail.user?.name || "Unknown",
            authorId: detail.user?.id,
            description: detail.caption,
            tags: detail.tags?.map((t) => t.name),
            createdDate: detail.create_date,
            isR18,
            coverUrl: cover,
            chapters: [
              {
                id: detail.id,
                title: detail.title,
                text: viewer.text,
                caption: detail.caption,
              },
            ],
          })
          if (res) {
            try {
              void Haptics.transient()
            } catch {}
            await ShareSheet.present([res])
          }
        }
      }
    } catch {
    } finally {
      setDownloading(false)
    }
  }

  const items: DockActionItem[] = [
    {
      key: "bookmark",
      label: bookmarked ? "已收藏" : "收藏",
      icon: bookmarked ? "heart.fill" : "heart",
      color: bookmarked ? "#EE2F49" : "#3172EB",
      disabled: bookmarkLoading,
      action: toggleBookmark,
    },
    {
      key: "download",
      label: downloading ? "下载中…" : "下载",
      icon: downloading ? "arrow.down.circle.fill" : "arrow.down.circle",
      color: downloading ? "secondaryLabel" : "#3172EB",
      disabled: downloading,
      action: handleDownload,
    },
  ]

  return <DockActionBar items={items} />
}

export function GlobalBottomAccessoryHost(props: {
  selection: any
  discoveryPath: any
  rankingPath: any
  followingPath: any
  searchPath: any
  morePath: any
}) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const trigger = () => setTick((t) => t + 1)
    const unsubs = [
      subscribeBottomAccessory(trigger),
      props.selection?.subscribe ? props.selection.subscribe(trigger) : null,
      props.discoveryPath?.subscribe ? props.discoveryPath.subscribe(trigger) : null,
      props.rankingPath?.subscribe ? props.rankingPath.subscribe(trigger) : null,
      props.followingPath?.subscribe ? props.followingPath.subscribe(trigger) : null,
      props.searchPath?.subscribe ? props.searchPath.subscribe(trigger) : null,
      props.morePath?.subscribe ? props.morePath.subscribe(trigger) : null,
    ]
    return () => {
      for (const u of unsubs) {
        if (typeof u === "function") u()
      }
    }
  }, [
    props.selection,
    props.discoveryPath,
    props.rankingPath,
    props.followingPath,
    props.searchPath,
    props.morePath,
  ])

  const activeTab = props.selection.value
  let activePath: string[] = []
  if (activeTab === "discovery") activePath = props.discoveryPath.value
  else if (activeTab === "ranking") activePath = props.rankingPath.value
  else if (activeTab === "following") activePath = props.followingPath.value
  else if (activeTab === "search") activePath = props.searchPath.value
  else if (activeTab === "more") activePath = props.morePath.value

  const top = activePath.length > 0 ? activePath[activePath.length - 1] : null

  // 1. 若当前栈顶为插画详情，第 0 毫秒立即原地呈现插画底栏操作台！
  if (top && (top.startsWith("illust:") || top.startsWith("illustDetail:"))) {
    const parts = top.split(":")
    const id = Number(parts[parts.length - 1])
    if (Number.isFinite(id) && id > 0) {
      return <IllustDetailDockBar illustID={id} />
    }
  }

  // 2. 若当前栈顶为小说详情，第 0 毫秒立即原地呈现小说底栏操作台！
  if (top && (top.startsWith("novel:") || top.startsWith("novelDetail:"))) {
    const parts = top.split(":")
    const id = Number(parts[parts.length - 1])
    if (Number.isFinite(id) && id > 0) {
      return <NovelDetailDockBar novelID={id} />
    }
  }

  // 3. 原生注册中心匹配（探索、排行、追更、我的、收藏库、历史记录等）
  const node = getActiveAccessory(activeTab, activePath)
  if (node) {
    return node
  }

  return null
}
