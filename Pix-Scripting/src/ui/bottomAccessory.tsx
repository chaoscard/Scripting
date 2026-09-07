import {
  Button,
  Group,
  HStack,
  Image,
  LongPressGesture,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useMemo,
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
  pixivisionDetail,
  addWatchlistSeries,
  deleteWatchlistSeries,
  illustrationSeries,
  novelSeries,
} from "../api/pixiv"
import { cacheIllust, getCachedIllust } from "../store/illustCache"
import { cacheNovel, getCachedNovel } from "../store/novelCache"
import { getCachedSeriesNav } from "../store/seriesCache"
import { updateHistoryBookmark, updateNovelHistoryBookmark } from "../store/history"
import {
  isPixivisionBookmarked,
  onPixivisionBookmarksChanged,
  togglePixivisionBookmark,
} from "../store/pixivisionBookmarks"
import {
  useIllustBookmark,
  useNovelBookmark,
  useSeriesWatchlist,
  useUserFollow,
  notifyOpenBookmarkDetail,
} from "./hooks"
import {
  downloadEntireMangaSeries,
  downloadEntireNovelSeries,
  downloadIllustToAlbum,
  exportIllustToZip,
  exportMangaToCbz,
  exportMangaToEpub,
  exportNovelToEpub,
  exportUgoiraToAlbum,
  exportUgoiraZip,
} from "../downloader"
import { imageUrlOf } from "../image/imageLoader"
import { requestPixivRoute } from "./routeNavigation"
import {
  getDownloadImageQuality,
  loadSettings,
  onSettingsChanged,
  updateSettings,
} from "../store/settings"
import type {
  PixivIllustration,
  PixivNovel,
  PixivNovelDetail,
  PixivisionDetail,
} from "../types"

declare const Haptics: any
declare const ShareSheet: any
declare const Dialog: any

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
  if (top === "blockedSettings") return "blockedSettings"
  if (
    top.startsWith("user:") ||
    top === "myWorks" ||
    top.startsWith("userWorks:")
  )
    return "userWorks"
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
  simultaneousGesture?: any
  gesture?: any
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
            simultaneousGesture={item.simultaneousGesture}
            gesture={item.gesture}
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

export function DockInfoBar(props: {
  icon?: string
  title: string
  color?: string
}) {
  const color = props.color ?? "#3172EB"
  return (
    <HStack
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      padding={{ horizontal: 16, vertical: 6 }}
      spacing={6}
    >
      {props.icon ? (
        <Image
          systemName={props.icon}
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
        {props.title}
      </Text>
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
  const [illust, setIllust] = useState<PixivIllustration | null>(() =>
    getCachedIllust(illustID)
  )
  const cached = illust ?? getCachedIllust(illustID)
  const [bookmarked, setBookmarked] = useIllustBookmark(
    illustID,
    cached?.is_bookmarked ?? false
  )
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [bookmarkLongPressLocked, setBookmarkLongPressLocked] = useState(false)
  const userID = illust?.user?.id ?? cached?.user?.id ?? 0
  const [followed, setFollowed, followRestrict, setFollowRestrict] =
    useUserFollow(
      userID,
      illust?.user?.is_followed ?? cached?.user?.is_followed ?? false
    )
  const [followLoading, setFollowLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const c = getCachedIllust(illustID)
    if (c) setIllust(c)
    session
      .call((token) => illustrationDetail(illustID, token))
      .then((detail) => {
        if (detail) {
          cacheIllust(detail)
          setIllust(detail)
        }
      })
      .catch(() => {})
  }, [illustID])

  async function toggleBookmark() {
    if (bookmarkLoading || bookmarkLongPressLocked) return
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

  async function bookmarkAndFollow() {
    if (bookmarkLoading || followLoading) return
    try {
      void Haptics.transient()
    } catch {}
    setBookmarkLoading(true)
    setFollowLoading(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addBookmark(illustID, "public", [], token))
        setBookmarked(true)
        updateHistoryBookmark(illustID, true)
      }
      if (userID && !followed) {
        await session.call((token) => followUser(userID, "public", token))
        setFollowed(true)
      }
    } catch {
    } finally {
      setBookmarkLoading(false)
      setFollowLoading(false)
    }
  }

  function handleBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    try {
      void Haptics.transient()
    } catch {}
    if (action === "follow") {
      void bookmarkAndFollow()
    } else {
      notifyOpenBookmarkDetail("illust", illustID)
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

  async function followWithVisibility(visibility: "public" | "private") {
    if (!userID || followLoading) return
    try {
      void Haptics.transient()
    } catch {}
    setFollowLoading(true)
    try {
      await session.call((token) => followUser(userID, visibility, token))
      setFollowed(true)
      setFollowRestrict(visibility)
    } catch {
    } finally {
      setFollowLoading(false)
    }
  }

  async function handleDownloadDefault() {
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

  async function handleDownloadUgoiraZip() {
    const current = illust ?? cached
    if (downloading || !current) return
    try {
      void Haptics.transient()
    } catch {}
    setDownloading(true)
    try {
      await exportUgoiraZip(current)
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadIllustToZip() {
    const current = illust ?? cached
    if (downloading || !current) return
    try {
      void Haptics.transient()
    } catch {}
    setDownloading(true)
    const downloadQuality = getDownloadImageQuality()
    try {
      const pageCount = current.page_count ?? 1
      const urls: string[] = []
      for (let i = 0; i < pageCount; i++) {
        const url = imageUrlOf(current, i, downloadQuality)
        if (url) urls.push(url)
      }
      await exportIllustToZip({
        illust: current,
        imageUrls: urls,
      })
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadManga(format: "cbz" | "epub") {
    const current = illust ?? cached
    if (downloading || !current) return
    try {
      void Haptics.transient()
    } catch {}
    setDownloading(true)
    const downloadQuality = getDownloadImageQuality()
    try {
      const pageCount = current.page_count ?? 1
      const pages: { pageIndex: number; url: string }[] = []
      for (let i = 0; i < pageCount; i++) {
        const url = imageUrlOf(current, i, downloadQuality)
        if (url) pages.push({ pageIndex: i + 1, url })
      }
      const isR18 =
        (current.x_restrict ?? 0) > 0 ||
        current.tags?.some((t) => /r-?18/i.test(t.name))
      if (format === "cbz") {
        await exportMangaToCbz({
          id: current.id,
          title: current.title,
          author: current.user?.name || "Unknown",
          authorId: current.user?.id,
          description: current.caption,
          tags: current.tags?.map((t) => t.name),
          createdDate: current.create_date,
          isR18,
          pages,
        })
      } else {
        await exportMangaToEpub({
          id: current.id,
          title: current.title,
          author: current.user?.name || "Unknown",
          authorId: current.user?.id,
          description: current.caption,
          tags: current.tags?.map((t) => t.name),
          createdDate: current.create_date,
          isR18,
          pages,
        })
      }
    } finally {
      setDownloading(false)
    }
  }

  const followContextMenu = useMemo(() => {
    if (!userID) return undefined
    return {
      menuItems: (
        <Group>
          <Button
            title="查看主页"
            systemImage="person.crop.circle"
            action={() => void requestPixivRoute(`user:${userID}`)}
          />
          {followed ? (
            followRestrict === "private" ? (
              <Button
                title="设为公开关注"
                systemImage="globe"
                disabled={followLoading}
                action={() => void followWithVisibility("public")}
              />
            ) : (
              <Button
                title="设为私密关注"
                systemImage="lock"
                disabled={followLoading}
                action={() => void followWithVisibility("private")}
              />
            )
          ) : (
            <Button
              title="私密关注"
              systemImage="lock"
              disabled={followLoading}
              action={() => void followWithVisibility("private")}
            />
          )}
        </Group>
      ),
    }
  }, [userID, followed, followRestrict, followLoading])

  const downloadContextMenu = useMemo(() => {
    const current = illust ?? cached
    if (!current) return undefined
    if (current.type === "ugoira") {
      return {
        menuItems: (
          <Group>
            <Button
              title="下载原始 ZIP 帧包"
              systemImage="doc.zipper"
              disabled={downloading}
              action={() => void handleDownloadUgoiraZip()}
            />
          </Group>
        ),
      }
    }
    if (current.type === "manga") {
      return {
        menuItems: (
          <Group>
            <Button
              title="下载为 CBZ 漫画包"
              systemImage="doc.zipper"
              disabled={downloading}
              action={() => void handleDownloadManga("cbz")}
            />
            <Button
              title="下载为 EPUB 电子书"
              systemImage="book"
              disabled={downloading}
              action={() => void handleDownloadManga("epub")}
            />
          </Group>
        ),
      }
    }
    const pageCount = current.page_count ?? 1
    if (pageCount > 1) {
      return {
        menuItems: (
          <Group>
            <Button
              title="打包为 ZIP 归档"
              systemImage="doc.zipper"
              disabled={downloading}
              action={() => void handleDownloadIllustToZip()}
            />
          </Group>
        ),
      }
    }
    return undefined
  }, [illust, cached, downloading])

  const currentItem = illust ?? cached

  const items: DockActionItem[] = [
    {
      key: "follow",
      label: followed ? "已关注" : "关注",
      icon: followed ? "person.crop.circle.badge.checkmark" : "person.crop.circle.badge.plus",
      color: followed ? "#EE2F49" : "#3172EB",
      disabled: !userID || followLoading,
      action: toggleFollow,
      contextMenu: followContextMenu,
    },
    {
      key: "bookmark",
      label: bookmarked ? "已收藏" : "收藏",
      icon: bookmarked ? "heart.fill" : "heart",
      color: bookmarked ? "#EE2F49" : "#3172EB",
      disabled: bookmarkLoading || bookmarkLongPressLocked,
      action: toggleBookmark,
      simultaneousGesture: LongPressGesture({ minDuration: 500 }).onEnded(() => {
        setBookmarkLongPressLocked(true)
        handleBookmarkLongPress()
        setTimeout(() => setBookmarkLongPressLocked(false), 1500)
      }),
    },
    {
      key: "download",
      label: downloading ? "下载中…" : "下载",
      icon: downloading ? "arrow.down.circle.fill" : "arrow.down.circle",
      color: downloading ? "secondaryLabel" : "#3172EB",
      disabled: downloading,
      action: handleDownloadDefault,
      contextMenu: downloadContextMenu,
    },
  ]

  return <DockActionBar items={items} />
}

export function NovelDetailDockBar(props: { novelID: number }) {
  const { novelID } = props
  const [novel, setNovel] = useState<PixivNovelDetail | PixivNovel | null>(() =>
    getCachedNovel(novelID)
  )
  const cached = novel ?? getCachedNovel(novelID)
  const [bookmarked, setBookmarked] = useNovelBookmark(
    novelID,
    cached?.is_bookmarked ?? false
  )
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [bookmarkLongPressLocked, setBookmarkLongPressLocked] = useState(false)
  const userID = novel?.user?.id ?? cached?.user?.id ?? 0
  const [followed, setFollowed, followRestrict, setFollowRestrict] =
    useUserFollow(
      userID,
      novel?.user?.is_followed ?? cached?.user?.is_followed ?? false
    )
  const [followLoading, setFollowLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const c = getCachedNovel(novelID)
    if (c) setNovel(c)
    session
      .call((token) => novelDetail(novelID, token))
      .then((detail) => {
        if (detail) {
          cacheNovel(detail)
          setNovel(detail)
        }
      })
      .catch(() => {})
  }, [novelID])

  async function toggleBookmark() {
    if (bookmarkLoading || bookmarkLongPressLocked) return
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

  async function bookmarkAndFollow() {
    if (bookmarkLoading || followLoading) return
    try {
      void Haptics.transient()
    } catch {}
    setBookmarkLoading(true)
    setFollowLoading(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addNovelBookmark(novelID, "public", token))
        setBookmarked(true)
        updateNovelHistoryBookmark(novelID, true)
      }
      if (userID && !followed) {
        await session.call((token) => followUser(userID, "public", token))
        setFollowed(true)
      }
    } catch {
    } finally {
      setBookmarkLoading(false)
      setFollowLoading(false)
    }
  }

  function handleBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    try {
      void Haptics.transient()
    } catch {}
    if (action === "follow") {
      void bookmarkAndFollow()
    } else {
      notifyOpenBookmarkDetail("novel", novelID)
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

  async function followWithVisibility(visibility: "public" | "private") {
    if (!userID || followLoading) return
    try {
      void Haptics.transient()
    } catch {}
    setFollowLoading(true)
    try {
      await session.call((token) => followUser(userID, visibility, token))
      setFollowed(true)
      setFollowRestrict(visibility)
    } catch {
    } finally {
      setFollowLoading(false)
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
        const detail = novel || (await session.call((token) => novelDetail(novelID, token)))
        if (detail) {
          const isR18 =
            (detail.x_restrict ?? 0) > 0 ||
            detail.tags?.some((t) => /r-?18/i.test(t.name))
          const cover =
            detail.image_urls?.large ||
            detail.image_urls?.medium ||
            viewer.coverUrl
          await exportNovelToEpub({
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
        }
      }
    } catch {
    } finally {
      setDownloading(false)
    }
  }

  const followContextMenu = useMemo(() => {
    if (!userID) return undefined
    return {
      menuItems: (
        <Group>
          <Button
            title="查看主页"
            systemImage="person.crop.circle"
            action={() => void requestPixivRoute(`user:${userID}`)}
          />
          {followed ? (
            followRestrict === "private" ? (
              <Button
                title="设为公开关注"
                systemImage="globe"
                disabled={followLoading}
                action={() => void followWithVisibility("public")}
              />
            ) : (
              <Button
                title="设为私密关注"
                systemImage="lock"
                disabled={followLoading}
                action={() => void followWithVisibility("private")}
              />
            )
          ) : (
            <Button
              title="私密关注"
              systemImage="lock"
              disabled={followLoading}
              action={() => void followWithVisibility("private")}
            />
          )}
        </Group>
      ),
    }
  }, [userID, followed, followRestrict, followLoading])

  const currentItem = novel || cached

  const items: DockActionItem[] = [
    {
      key: "follow",
      label: followed ? "已关注" : "关注",
      icon: followed ? "person.crop.circle.badge.checkmark" : "person.crop.circle.badge.plus",
      color: followed ? "#EE2F49" : "#3172EB",
      disabled: !userID || followLoading,
      action: toggleFollow,
      contextMenu: followContextMenu,
    },
    {
      key: "bookmark",
      label: bookmarked ? "已收藏" : "收藏",
      icon: bookmarked ? "heart.fill" : "heart",
      color: bookmarked ? "#EE2F49" : "#3172EB",
      disabled: bookmarkLoading || bookmarkLongPressLocked,
      action: toggleBookmark,
      simultaneousGesture: LongPressGesture({ minDuration: 500 }).onEnded(() => {
        setBookmarkLongPressLocked(true)
        handleBookmarkLongPress()
        setTimeout(() => setBookmarkLongPressLocked(false), 1500)
      }),
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

export function PixivisionDetailDockBar(props: { articleID: number }) {
  const { articleID } = props
  const [bookmarked, setBookmarked] = useState<boolean>(() =>
    isPixivisionBookmarked(articleID)
  )
  const [detail, setDetail] = useState<PixivisionDetail | null>(null)

  useEffect(() => {
    setBookmarked(isPixivisionBookmarked(articleID))
    return onPixivisionBookmarksChanged(() => {
      setBookmarked(isPixivisionBookmarked(articleID))
    })
  }, [articleID])

  useEffect(() => {
    session
      .call((token) => pixivisionDetail(articleID, token))
      .then((res) => {
        if (res) setDetail(res)
      })
      .catch(() => {})
  }, [articleID])

  const toggleBookmark = () => {
    try {
      void Haptics.transient()
    } catch {}
    const title = detail?.title || `特辑 #${articleID}`
    const next = togglePixivisionBookmark({
      id: articleID,
      title,
      thumbnailURL: detail?.thumbnailURL || detail?.artworks?.[0]?.imageURL,
      category: detail?.category,
      categoryLabel: detail?.category,
      publishedAt: detail?.date,
      tags: detail?.tags ? detail.tags.map((t) => t.name) : undefined,
      bookmarkedAt: Date.now(),
    })
    setBookmarked(next)
  }

  const handleShare = () => {
    try {
      void Haptics.transient()
    } catch {}
    const shareUrl = `https://www.pixivision.net/zh/a/${articleID}`
    const shareText = detail?.title ? `${detail.title}\n${shareUrl}` : shareUrl
    void ShareSheet.present([shareText])
  }

  const items: DockActionItem[] = [
    {
      key: "bookmark",
      label: bookmarked ? "已收藏" : "收藏",
      icon: bookmarked ? "heart.fill" : "heart",
      color: bookmarked ? "#EE2F49" : "#3172EB",
      action: toggleBookmark,
    },
    {
      key: "share",
      label: "分享",
      icon: "square.and.arrow.up",
      color: "#3172EB",
      action: handleShare,
    },
  ]

  return <DockActionBar items={items} />
}

export function SeriesDetailDockBar(props: {
  seriesID: number
  kind: "manga" | "novel"
}) {
  const { seriesID, kind } = props
  const [isWatched, setIsWatched] = useSeriesWatchlist(seriesID, kind, false)
  const [watchLoading, setWatchLoading] = useState(false)
  const [isAscending, setIsAscending] = useState(
    () => loadSettings().watchlistSortOrder === "asc"
  )
  const [seriesDownloading, setSeriesDownloading] = useState(false)
  const [seriesTitle, setSeriesTitle] = useState<string>(() => {
    const nav = getCachedSeriesNav(seriesID, kind)
    return nav?.title || (kind === "manga" ? "漫画系列" : "小说系列")
  })

  useEffect(() => {
    return onSettingsChanged(() => {
      setIsAscending(loadSettings().watchlistSortOrder === "asc")
    })
  }, [])

  useEffect(() => {
    const nav = getCachedSeriesNav(seriesID, kind)
    if (nav?.title) setSeriesTitle(nav.title)
    if (kind === "manga") {
      session
        .call((token) => illustrationSeries(seriesID, token))
        .then((res) => {
          if (res?.illust_series_detail?.title) {
            setSeriesTitle(res.illust_series_detail.title)
          }
          if (res?.illust_series_detail) {
            const watched = Boolean(
              res.illust_series_detail.watchlist_added ??
                (res.illust_series_detail as any).is_watched
            )
            setIsWatched(watched)
          }
        })
        .catch(() => {})
    } else {
      session
        .call((token) => novelSeries(seriesID, token))
        .then((res) => {
          if (res?.novel_series_detail?.title) {
            setSeriesTitle(res.novel_series_detail.title)
          }
          if (res?.novel_series_detail) {
            const watched = Boolean(
              res.novel_series_detail.watchlist_added ??
                (res.novel_series_detail as any).is_watched
            )
            setIsWatched(watched)
          }
        })
        .catch(() => {})
    }
  }, [seriesID, kind])

  async function toggleWatchlist() {
    if (watchLoading) return
    try {
      void Haptics.transient()
    } catch {}
    setWatchLoading(true)
    const nextState = !isWatched
    try {
      if (nextState) {
        await session.call((token) => addWatchlistSeries(seriesID, kind, token))
        setIsWatched(true)
      } else {
        await session.call((token) => deleteWatchlistSeries(seriesID, kind, token))
        setIsWatched(false)
      }
    } catch {
    } finally {
      setWatchLoading(false)
    }
  }

  function toggleSortOrder() {
    try {
      void Haptics.transient()
    } catch {}
    const nextAsc = !isAscending
    setIsAscending(nextAsc)
    updateSettings({ watchlistSortOrder: nextAsc ? "asc" : "desc" })
  }

  async function handleDownloadSeries() {
    if (seriesDownloading) return
    try {
      void Haptics.transient()
    } catch {}

    if (kind === "novel") {
      const confirmed = await Dialog.confirm({
        title: "下载整本小说",
        message: `确认下载《${seriesTitle}》整本 EPUB 小说？`,
        confirmLabel: "开始下载",
        cancelLabel: "取消",
      })
      if (!confirmed) return

      setSeriesDownloading(true)
      try {
        const filePath = await downloadEntireNovelSeries(seriesID, seriesTitle)
        if (filePath) {
          try {
            void Haptics.transient()
          } catch {}
          await ShareSheet.present([filePath])
        }
      } finally {
        setSeriesDownloading(false)
      }
    } else {
      const choice = await Dialog.actionSheet({
        title: `下载整套漫画《${seriesTitle}》`,
        actions: [{ label: "CBZ 漫画包" }, { label: "EPUB 电子书" }],
      })
      if (choice !== 0 && choice !== 1) return

      const format: "cbz" | "epub" = choice === 0 ? "cbz" : "epub"
      setSeriesDownloading(true)
      try {
        const filePath = await downloadEntireMangaSeries(
          seriesID,
          seriesTitle,
          format
        )
        if (filePath) {
          try {
            void Haptics.transient()
          } catch {}
          await ShareSheet.present([filePath])
        }
      } finally {
        setSeriesDownloading(false)
      }
    }
  }

  const items: DockActionItem[] = [
    {
      key: "watchlist",
      label: isWatched ? "已追更" : "追更",
      icon: isWatched ? "bookmark.fill" : "bookmark",
      color: isWatched ? "#EE2F49" : "#3172EB",
      disabled: watchLoading,
      action: toggleWatchlist,
    },
    {
      key: "sort",
      label: isAscending ? "正序" : "倒序",
      icon: isAscending ? "arrow.up" : "arrow.down",
      color: "#3172EB",
      action: toggleSortOrder,
    },
    {
      key: "download",
      label: seriesDownloading ? "下载中…" : "下载",
      icon: seriesDownloading ? "arrow.down.circle.fill" : "square.and.arrow.down",
      color: seriesDownloading ? "secondaryLabel" : "#3172EB",
      disabled: seriesDownloading,
      action: handleDownloadSeries,
    },
  ]

  return <DockActionBar items={items} />
}

export function renderRouteInfoBar(top: string) {
  if (!top) return null

  // 1. 标签系列
  if (
    top.startsWith("tag:") ||
    top.startsWith("novelTag:") ||
    top.startsWith("pixivisionTag:") ||
    top.startsWith("pixivision-tag:")
  ) {
    const colonIdx = top.indexOf(":")
    const rawTag = colonIdx >= 0 ? top.slice(colonIdx + 1) : ""
    let decoded = rawTag
    try {
      decoded = decodeURIComponent(rawTag)
    } catch {}
    if (decoded.includes("?name=")) {
      const namePart = decoded.split("?name=")[1]
      try {
        decoded = decodeURIComponent(namePart)
      } catch {}
    } else if (decoded.includes("?")) {
      decoded = decoded.split("?")[0]
    }
    decoded = decoded.replace(/^#+/, "").trim()
    return <DockInfoBar icon="number" title={decoded || "标签"} />
  }

  // 2. 相关作品
  if (top.startsWith("relatedIllust:")) {
    return <DockInfoBar icon="sparkles" title="相关作品推荐" />
  }

  // 3. 用户关系
  if (top.startsWith("userConnections:")) {
    const parts = top.split(":")
    const kind = parts[1]
    const title =
      kind === "mypixiv"
        ? "好友列表"
        : kind === "follower"
        ? "粉丝列表"
        : "关注列表"
    const icon =
      kind === "mypixiv"
        ? "person.2.badge.gearshape"
        : kind === "follower"
        ? "person.2.badge.plus"
        : "person.2"
    return <DockInfoBar icon={icon} title={title} />
  }
  if (top === "connections:following")
    return <DockInfoBar icon="person.2.fill" title="我的关注" />
  if (top === "connections:follower")
    return <DockInfoBar icon="person.2.badge.plus" title="我的粉丝" />
  if (top === "friends")
    return <DockInfoBar icon="person.2.badge.gearshape" title="我的好友" />

  // 4. 作品与用户主页
  if (top === "myWorks")
    return <DockInfoBar icon="photo.stack.fill" title="我的作品" />
  if (top.startsWith("userWorks:"))
    return <DockInfoBar icon="photo.stack" title="作品列表" />
  if (top.startsWith("user:"))
    return <DockInfoBar icon="person.crop.circle" title="用户主页" />

  // 5. 消息中心
  if (top === "notifications")
    return <DockInfoBar icon="bell.fill" title="我的通知" />
  if (top.startsWith("notificationsMore:"))
    return <DockInfoBar icon="bell" title="通知详情" />

  // 6. 下载与文件管理
  if (top === "downloadManager")
    return <DockInfoBar icon="arrow.down.circle.fill" title="下载与文件管理" />
  if (top === "downloadTasks")
    return <DockInfoBar icon="hourglass" title="下载任务" />
  if (top === "downloadCreators" || top.startsWith("downloadCreator:")) {
    return <DockInfoBar icon="person.2.fill" title="创作者归档" />
  }
  if (top.startsWith("downloadDetail:")) {
    const cat = top.slice("downloadDetail:".length)
    const catTitle =
      cat === "illustrations"
        ? "插画下载"
        : cat === "ugoira"
        ? "动图下载"
        : cat === "manga"
        ? "漫画下载"
        : cat === "novels"
        ? "小说下载"
        : "全部下载文件"
    const catIcon =
      cat === "illustrations"
        ? "photo.fill"
        : cat === "ugoira"
        ? "play.circle.fill"
        : cat === "manga"
        ? "photo.on.rectangle.fill"
        : cat === "novels"
        ? "book.fill"
        : "folder.fill"
    return <DockInfoBar icon={catIcon} title={catTitle} />
  }

  // 7. 设置与关于
  if (top === "settings")
    return <DockInfoBar icon="gearshape.fill" title="应用设置" />
  if (top === "blockedSettings")
    return <DockInfoBar icon="shield.fill" title="屏蔽设置" />
  if (top === "customAISettings")
    return <DockInfoBar icon="sparkles" title="自定义AI模型" />
  if (top.startsWith("rankingCustomPicker:")) {
    const kind = top.slice("rankingCustomPicker:".length)
    const title =
      kind === "illust"
        ? "自定义插画榜单"
        : kind === "manga"
        ? "自定义漫画榜单"
        : kind === "novel"
        ? "自定义小说榜单"
        : "自定义榜单"
    return <DockInfoBar icon="slider.horizontal.3" title={title} />
  }
  if (top === "about")
    return <DockInfoBar icon="info.circle.fill" title="关于 Pix-Scripting" />

  // 8. 收藏与历史
  if (top === "library")
    return <DockInfoBar icon="heart.fill" title="我的收藏" />
  if (top === "history")
    return <DockInfoBar icon="clock.fill" title="浏览记录" />
  if (top === "pixivisionBookmarks")
    return <DockInfoBar icon="heart.fill" title="特辑收藏" />
  if (top === "novelBookmarks")
    return <DockInfoBar icon="book.pages.fill" title="小说书签" />
  if (top.startsWith("userBookmarks:"))
    return <DockInfoBar icon="heart" title="收藏作品" />

  return null
}

function renderDefaultRootTabAccessory(activeTab: string) {
  const settings = loadSettings()
  const hideNovels = settings.hideNovels

  if (activeTab === "discovery") {
    const items = [
      { tag: "illustration", label: "插画" },
      { tag: "manga", label: "漫画" },
    ]
    if (!hideNovels) {
      items.push({ tag: "novel", label: "小说" })
    }
    return (
      <DockSegmentedBar
        items={items}
        value="illustration"
        onChanged={() => {}}
      />
    )
  }

  if (activeTab === "ranking") {
    const modes = (settings.customRankingIllustModes || []).slice(0, 3)
    const labelMap: Record<string, string> = {
      day: "日榜",
      week: "周榜",
      month: "月榜",
      day_male: "男性向",
      day_female: "女性向",
      week_original: "原创",
      week_rookie: "新人",
      day_ai: "AI 日榜",
    }
    const items = modes.map((m) => ({
      tag: m,
      label: labelMap[m] || m,
    }))
    const defaultItems =
      items.length > 0
        ? items
        : [
            { tag: "day", label: "日榜" },
            { tag: "week", label: "周榜" },
            { tag: "month", label: "月榜" },
          ]
    return (
      <DockSegmentedBar
        items={defaultItems}
        value={defaultItems[0].tag}
        onChanged={() => {}}
      />
    )
  }

  if (activeTab === "following") {
    const items = [{ tag: "illust", label: "插画·漫画" }]
    if (!hideNovels) {
      items.push({ tag: "novel", label: "小说" })
    }
    return (
      <DockSegmentedBar items={items} value="illust" onChanged={() => {}} />
    )
  }

  if (activeTab === "search") {
    const items = [
      { tag: "illust", label: "插画·漫画" },
      ...(hideNovels ? [] : [{ tag: "novel", label: "小说" }]),
      { tag: "user", label: "用户" },
    ]
    return (
      <DockSegmentedBar items={items} value="illust" onChanged={() => {}} />
    )
  }

  if (activeTab === "more") {
    return (
      <DockActionBar
        items={[
          {
            key: "reverseSearch",
            label: "以图搜图",
            icon: "photo.badge.magnifyingglass",
            action: () => {
              try {
                void Haptics.transient()
              } catch {}
              requestPixivRoute("reverseImageSearch", "more")
            },
          },
          {
            key: "downloadManager",
            label: "下载与文件管理",
            icon: "arrow.down.circle",
            action: () => {
              try {
                void Haptics.transient()
              } catch {}
              requestPixivRoute("downloadManager", "more")
            },
          },
        ]}
      />
    )
  }

  return null
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
      return <IllustDetailDockBar key={top} illustID={id} />
    }
  }

  // 2. 若当前栈顶为小说详情，第 0 毫秒立即原地呈现小说底栏操作台！
  if (top && (top.startsWith("novel:") || top.startsWith("novelDetail:"))) {
    const parts = top.split(":")
    const id = Number(parts[parts.length - 1])
    if (Number.isFinite(id) && id > 0) {
      return <NovelDetailDockBar key={top} novelID={id} />
    }
  }

  // 3. 若当前栈顶为特辑详情，第 0 毫秒立即原地呈现特辑正文底栏操作台！
  if (top && top.startsWith("pixivision:")) {
    const parts = top.split(":")
    const id = Number(parts[parts.length - 1])
    if (Number.isFinite(id) && id > 0) {
      return <PixivisionDetailDockBar key={top} articleID={id} />
    }
  }

  // 4. 若当前栈顶为漫画系列详情，第 0 毫秒立即原地呈现系列底栏操作台！
  if (top && top.startsWith("mangaSeries:")) {
    const parts = top.split(":")
    const id = Number(parts[parts.length - 1])
    if (Number.isFinite(id) && id > 0) {
      return <SeriesDetailDockBar key={top} seriesID={id} kind="manga" />
    }
  }

  // 5. 若当前栈顶为小说系列详情，第 0 毫秒立即原地呈现系列底栏操作台！
  if (top && top.startsWith("novelSeries:")) {
    const parts = top.split(":")
    const id = Number(parts[parts.length - 1])
    if (Number.isFinite(id) && id > 0) {
      return <SeriesDetailDockBar key={top} seriesID={id} kind="novel" />
    }
  }

  // 6. 原生注册中心匹配（探索、排行、追更、我的、收藏库、历史记录、用户主页等）
  const node = getActiveAccessory(activeTab, activePath)
  if (node) {
    return node
  }

  // 7. 若在二级页面但未注册自定义配件，呈现对应的信息胶囊，绝不显示空白底栏！
  if (top) {
    return renderRouteInfoBar(top)
  }

  // 8. 根 Tab 初始状态直接同构呈现该 Tab 的真实分段栏/操作台，杜绝先出现文字兜底再跳变的闪烁现象！
  return renderDefaultRootTabAccessory(activeTab)
}
