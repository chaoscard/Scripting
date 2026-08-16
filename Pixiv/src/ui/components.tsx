import {
  Button,
  FlowLayout,
  Group,
  HStack,
  Image,
  LazyVStack,
  LongPressGesture,
  NavigationLink,
  ProgressView,
  ScrollView,
  ScrollViewReader,
  Script,
  Spacer,
  Text,
  TextField,
  Toggle,
  WebView,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
  type GridItem,
  type ScrollViewProxy,
} from "scripting"

import {
  cachedFilePath,
  cardThumbUrlOf,
  imageCacheRevision,
  loadImage,
  onImageCacheChanged,
} from "../image/imageLoader"
import {
  addBookmark,
  addNovelBookmark,
  bookmarkDetail,
  bookmarkTags,
  followUser,
  novelBookmarkDetail,
  novelBookmarkTags,
  removeBookmark,
  removeNovelBookmark,
} from "../api/pixiv"
import { session } from "../api/session"
import { blockTag, loadSettings } from "../store/settings"
import { useLatest, useTimedFlag } from "./hooks"
import type {
  PixivIllustration,
  PixivBookmarkDetail,
  PixivBookmarkTag,
  PixivNovel,
  PixivPage,
  PixivUser,
  PixivVisionArticle,
  PixivWatchlistSeries,
} from "../types"

export const CORNER_ICON_SIZE = 26
export const GRID_COLUMNS: GridItem[] = [
  { size: { type: "flexible", min: 120, max: "infinity" } },
  { size: { type: "flexible", min: 120, max: "infinity" } },
]
// 流式布局允许最长 1:4 的竖图保留原始比例；更极端的图片仍受此下限保护。
const MIN_FLOW_IMAGE_RATIO = 1 / 4
const MAX_FLOW_IMAGE_RATIO = 2.5

// 主页面共享工具栏工厂：挂载到各 Tab 的实际导航容器，详情页保留系统返回按钮。
export function appToolbar(dismiss: () => void, title?: string, trailing?: any) {
  return {
    topBarLeading: [
      <Button
        title="收起"
        systemImage="xmark"
        action={() => Script.minimize()}
      />,
    ],
    topBarTrailing: trailing ? [trailing] : undefined,
    principal: title
      ? [
          <Text font="title2" fontWeight="bold">
            {title}
          </Text>,
        ]
      : undefined,
  }
}

// 框架在 refreshable 的 Promise resolve 后不会自动把滚动位置弹回顶部（列表会
// 停在用户下拉的位置）。本组件在刷新结束后主动把内容滚回顶部，恢复回弹体验。
// 所有带下拉刷新的页面统一使用本组件，不要直接用 <ScrollView refreshable>。
const REFRESH_TOP_KEY = "__refresh_top"

export function RefreshableScrollView(props: {
  refreshable: () => Promise<void>
  navigationTitle?: string
  navigationBarTitleDisplayMode?: "automatic" | "inline" | "large"
  navigationDestination?: any
  searchable?: {
    value: string
    onChanged: (value: string) => void
    placement?:
      | "automatic"
      | "navigationBarDrawer"
      | "sidebar"
      | "toolbar"
      | "navigationBarDrawerAlwaysDisplay"
      | "navigationBarDrawerAutomaticDisplay"
    prompt?: string
    presented?: {
      value: boolean
      onChanged: (value: boolean) => void
    }
  }
  searchSuggestions?: any
  onSubmit?: any
  submitLabel?: "join" | "continue" | "return" | "send" | "go" | "search" | "done" | "next" | "route"
  ignoresSafeArea?: any
  toolbarBackground?: any
  toolbarBackgroundVisibility?: any
  children?: any
}) {
  // toolbar 等通用 View 属性由 Scripting 自动应用到自定义组件根视图；
  // 不要再传给内部 ScrollView，否则导航栏会合并出重复按钮。
  const proxyRef = useRef<ScrollViewProxy | null>(null)
  const refreshRef = useLatest(props.refreshable)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    // 无论刷新成功还是失败，都要让刷新指示器收起并回弹
    try {
      await refreshRef.current()
    } catch {
      // 刷新失败同样需要收起指示器
    }
    // 等新列表渲染完成、系统开始收起刷新指示器后，再主动滚回顶部
    if (timerRef.current != null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const proxy = proxyRef.current
      if (proxy) {
        withAnimation(() => {
          proxy.scrollTo(REFRESH_TOP_KEY, "top")
        })
      }
    }, 120)
  }, [])

  return (
    <ScrollViewReader>
      {(proxy) => {
        proxyRef.current = proxy
        return (
          <ScrollView
            navigationTitle={props.navigationTitle}
            navigationBarTitleDisplayMode={props.navigationBarTitleDisplayMode}
            refreshable={handleRefresh}
            navigationDestination={props.navigationDestination}
            searchable={props.searchable}
            searchSuggestions={props.searchSuggestions}
            onSubmit={props.onSubmit}
            submitLabel={props.submitLabel}
            ignoresSafeArea={props.ignoresSafeArea}
            toolbarBackground={props.toolbarBackground}
            toolbarBackgroundVisibility={props.toolbarBackgroundVisibility}
          >
            <VStack
              key={REFRESH_TOP_KEY}
              alignment="leading"
              frame={{ maxWidth: "infinity" }}
            >
              {props.children}
            </VStack>
          </ScrollView>
        )
      }}
    </ScrollViewReader>
  )
}

// 异步图片加载状态（CachedImage / AvatarImage 共用）：
// cancelled 标志防止 url 切换后旧结果覆盖新状态；支持 priority 优先级调度
function useCachedImage(
  url: string | null,
  onLoaded?: (success: boolean) => void,
  priority?: number
) {
  const [cacheRevision, setCacheRevision] = useState(imageCacheRevision())
  const [loaded, setLoaded] = useState<{
    url: string | null
    path: string | null
    revision: number
  }>({
    url: null,
    path: null,
    revision: cacheRevision,
  })
  const [failed, setFailed] = useState(false)
  // 预取已写入磁盘的文件在首帧直接使用，避免 effect 调度前短暂显示加载圈。
  const cachedPath = useMemo(() => (url ? cachedFilePath(url) : null), [url, cacheRevision])
  const path = cachedPath ?? (
    loaded.url === url && loaded.revision === cacheRevision ? loaded.path : null
  )
  const onLoadedRef = useLatest(onLoaded)

  useEffect(() => onImageCacheChanged(() => setCacheRevision(imageCacheRevision())), [])

  useEffect(() => {
    if (cachedPath) {
      onLoadedRef.current?.(true)
    }
  }, [cachedPath, onLoadedRef])

  useEffect(() => {
    let cancelled = false
    let retryTimer: number | null = null
    setFailed(false)
    if (!url) {
      setLoaded({ url: null, path: null, revision: cacheRevision })
      onLoadedRef.current?.(false)
      return
    }
    if (cachedPath) {
      return () => {
        cancelled = true
      }
    }

    const doLoad = (isRetry = false) => {
      loadImage(url, priority)
        .then((p) => {
          if (!cancelled) {
            if (p) {
              setLoaded({ url, path: p, revision: cacheRevision })
              setFailed(false)
              onLoadedRef.current?.(true)
            } else if (!isRetry) {
              // 自动重试一次（对抗预取竞争、取消误杀或瞬时网络抖动）
              retryTimer = setTimeout(() => {
                if (!cancelled) doLoad(true)
              }, 400)
            } else {
              setLoaded({ url, path: null, revision: cacheRevision })
              setFailed(true)
              onLoadedRef.current?.(false)
            }
          }
        })
        .catch(() => {
          if (!cancelled) {
            if (!isRetry) {
              retryTimer = setTimeout(() => {
                if (!cancelled) doLoad(true)
              }, 400)
            } else {
              setLoaded({ url, path: null, revision: cacheRevision })
              setFailed(true)
              onLoadedRef.current?.(false)
            }
          }
        })
    }

    doLoad(false)

    return () => {
      cancelled = true
      if (retryTimer != null) clearTimeout(retryTimer)
    }
  }, [url, cacheRevision, cachedPath, onLoadedRef, priority])

  return { path, failed }
}

// 异步图片（对标 Hanairo RemoteImageView 设计）：
// 容器宽高比由元数据严格固定，加载过程与展示过程保持零布局重排（Zero Layout Shift）。
export function CachedImage(props: {
  url: string | null
  aspectRatioValue?: number // 宽/高
  cornerRadius?: number
  contentMode?: "fit" | "fill"
  centerCropSquare?: boolean
  useIntrinsicAspectRatio?: boolean
  frame?: any // 覆盖默认整宽 frame（如固定尺寸缩略图）
  onLoaded?: (success: boolean) => void
  priority?: number
}) {
  const {
    url,
    aspectRatioValue = 1,
    cornerRadius = 10,
    contentMode = "fill",
    centerCropSquare = false,
    useIntrinsicAspectRatio = false,
    frame,
    onLoaded,
    priority,
  } = props
  const { path, failed } = useCachedImage(url, onLoaded, priority)
  const centeredSquare = useMemo(() => {
    if (!path || !centerCropSquare) return null
    try {
      const image = UIImage.fromFile(path)
      if (!image || image.width <= 0 || image.height <= 0) return null
      const side = Math.min(image.width, image.height)
      return image.croppedTo({
        x: (image.width - side) / 2,
        y: (image.height - side) / 2,
        width: side,
        height: side,
      })
    } catch {
      return null
    }
  }, [path, centerCropSquare])

  const intrinsicAspect = useMemo(() => {
    if (!path || !useIntrinsicAspectRatio) return null
    try {
      const image = UIImage.fromFile(path)
      if (image && image.width > 0 && image.height > 0) {
        return image.width / image.height
      }
    } catch {
      return null
    }
    return null
  }, [path, useIntrinsicAspectRatio])

  const effectiveRatio = intrinsicAspect ?? aspectRatioValue

  if (path) {
    if (centeredSquare) {
      return (
        <Image
          image={centeredSquare}
          resizable={true}
          aspectRatio={{ value: 1, contentMode: "fill" }}
          clipShape={{ type: "rect", cornerRadius }}
          frame={frame ?? { maxWidth: "infinity" }}
        />
      )
    }
    return (
      <Image
        filePath={path}
        resizable={true}
        aspectRatio={{ value: effectiveRatio, contentMode }}
        clipShape={{ type: "rect", cornerRadius }}
        frame={frame ?? { maxWidth: "infinity" }}
      />
    )
  }

  return (
    <ZStack
      aspectRatio={{ value: aspectRatioValue, contentMode }}
      background="systemGray6"
      clipShape={{ type: "rect", cornerRadius }}
      frame={frame ?? { maxWidth: "infinity" }}
    >
      {!url || failed ? (
        // 无 URL / 加载失败：显示占位图标（避免空 URL 无限转圈）
        <Image
          systemName="photo"
          font="title2"
          foregroundStyle="systemGray3"
        />
      ) : (
        <ProgressView progressViewStyle="circular" />
      )}
    </ZStack>
  )
}

// 追更列表标准卡片：左侧使用原始比例封面，右侧显示系列信息与操作。
export function WatchlistSeriesCard(props: {
  item: PixivWatchlistSeries
  kind: "manga" | "novel"
  onAppear?: () => void
}) {
  const { item, kind, onAppear } = props
  const latestRoute = item.latest_content_id == null
    ? null
    : `${kind === "manga" ? "illust" : "novel"}:${item.latest_content_id}`
  const seriesRoute = `${kind === "manga" ? "mangaSeries" : "novelSeries"}:${item.id}`
  const date = item.last_published_content_datetime?.slice(0, 10) ?? ""

  if (item.mask_text) {
    return (
      <VStack alignment="leading" spacing={4} padding={14} frame={{ maxWidth: "infinity" }}>
        <Text foregroundStyle="secondaryLabel">{item.mask_text}</Text>
      </VStack>
    )
  }

  return (
    <HStack alignment="top" spacing={12} padding={10} onAppear={onAppear}
      glassEffect={{ type: "rect", cornerRadius: 14 }}
      shadow={{ color: "#0000000F", radius: 18, y: 8 }}
      frame={{ maxWidth: "infinity" }}
    >
      <CachedImage
        url={item.url ?? null}
        cornerRadius={8}
        contentMode="fit"
        useIntrinsicAspectRatio={true}
        frame={{ width: 118, maxHeight: 176 }}
      />
      <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
        <NavigationLink value={seriesRoute}>
          <Text
            font="headline"
            fontWeight="semibold"
            multilineTextAlignment="leading"
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {item.title || "未命名系列"}
          </Text>
        </NavigationLink>
        {item.user?.name ? (
          <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={1}>
            {item.user.name}
          </Text>
        ) : null}
        <HStack alignment="center" spacing={8}>
          <Text font="subheadline" foregroundStyle="secondaryLabel">
            {item.published_content_count} 话{date ? ` · ${date}` : ""}
          </Text>
          {latestRoute ? (
            <NavigationLink value={latestRoute}>
              <Text
                font="subheadline"
                fontWeight="semibold"
                foregroundStyle="white"
                padding={{ horizontal: 14, vertical: 8 }}
                background="#000000"
                clipShape={{ type: "rect", cornerRadius: 18 }}
              >
                阅读
              </Text>
            </NavigationLink>
          ) : null}
        </HStack>
      </VStack>
    </HStack>
  )
}

// 标签行按可用宽度预先分组。
const NOVEL_TAG_MAX_WIDTH = 260

// 小说标准卡片：推荐页与收藏页共用，保持封面、标签和统计信息一致。
export function NovelCard(props: {
  novel: PixivNovel
  onAppear?: () => void
  priority?: number
  footerText?: string
  markerPage?: number
}) {
  const { novel, onAppear, priority, footerText, markerPage } = props
  const [bookmarked, setBookmarked] = useState(novel.is_bookmarked)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)

  async function toggleNovelBookmark() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeNovelBookmark(novel.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) => addNovelBookmark(novel.id, "public", token))
        setBookmarked(true)
      }
    } catch {
      // 收藏失败时保持原状态
    } finally {
      setBookmarkBusy(false)
    }
  }

  function handleNovelBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    void Haptics.transient()
    if (action === "follow") {
      void bookmarkAndFollowNovel()
    } else {
      setShowBookmarkDetail(true)
    }
  }

  async function bookmarkAndFollowNovel() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addNovelBookmark(novel.id, "public", token))
        setBookmarked(true)
      }
      await session.call((token) => followUser(novel.user.id, "public", token))
    } catch {
      // 保持卡片可继续操作
    } finally {
      setBookmarkBusy(false)
    }
  }

  const coverURL =
    novel.image_urls?.medium ??
    novel.image_urls?.large ??
    novel.image_urls?.square_medium ??
    novel.cover?.urls?.["240mw"] ??
    novel.cover?.urls?.["480mw"] ??
    null

  return (
    <ZStack alignment="bottomTrailing">
      <NavigationLink value={`novel:${novel.id}`}>
        <HStack
          spacing={10}
          padding={10}
          onAppear={onAppear}
          alignment="top"
          glassEffect={{ type: "rect", cornerRadius: 14 }}
            shadow={{ color: "#0000000F", radius: 18, y: 8 }}
          frame={{ maxWidth: "infinity" }}
        >
          <ZStack
            frame={{ width: 68, height: 96 }}
            clipShape={{ type: "rect", cornerRadius: 8 }}
            background="systemGray6"
          >
            <CachedImage
              url={coverURL}
              aspectRatioValue={0.71}
              cornerRadius={0}
              contentMode="fill"
              priority={priority}
              frame={{ width: 68, height: 96 }}
            />
          </ZStack>
          <VStack
            alignment="leading"
            spacing={4}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          >
            <Text
              font="subheadline"
              fontWeight="semibold"
              multilineTextAlignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {novel.title}
            </Text>
            <VStack alignment="leading" spacing={2}>
              {wrapTags(
                novel.tags,
                NOVEL_TAG_MAX_WIDTH,
                (tag) => estimateTextWidth(`${tag.name} `),
                0
              ).map((row, ri) => (
                <HStack key={ri} spacing={0} frame={{ maxWidth: "infinity" }}>
                  {row.map((tag) => (
                    <Text
                      key={tag.name}
                      font="caption2"
                      foregroundStyle="secondaryLabel"
                      lineLimit={1}
                    >
                      {tag.name}{" "}
                    </Text>
                  ))}
                  <Spacer />
                </HStack>
              ))}
            </VStack>
            <Spacer />
            <HStack frame={{ maxWidth: "infinity" }}>
              <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                {novel.user.name}
              </Text>
              <Spacer />
            </HStack>
            <HStack frame={{ maxWidth: "infinity" }}>
              <Text font="caption2" foregroundStyle="secondaryLabel">
                ♥ {formatNumber(novel.total_bookmarks)}
              </Text>
              <HStack spacing={4}>
                <Image systemName="eye" font="caption2" foregroundStyle="secondaryLabel" />
                <Text font="caption2" foregroundStyle="secondaryLabel">
                  {formatNumber(novel.total_view)}
                </Text>
              </HStack>
              {novel.text_length != null ? (
                <HStack spacing={4}>
                  <Image systemName="character.cursor.ibeam" font="caption2" foregroundStyle="secondaryLabel" />
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {novel.text_length}
                  </Text>
                </HStack>
              ) : null}
              {markerPage != null ? (
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  第 {markerPage} 页
                </Text>
              ) : null}
              {footerText ? (
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {footerText}
                </Text>
              ) : null}
              <Spacer />
            </HStack>
          </VStack>
        </HStack>
      </NavigationLink>
      <BookmarkButton
        bookmarked={bookmarked}
        disabled={bookmarkBusy}
        onTap={() => void toggleNovelBookmark()}
        onLongPress={handleNovelBookmarkLongPress}
        sheetContent={
          <BookmarkDetailSheet
            item={novel}
            bookmarked={bookmarked}
            loadDetail={(token) => novelBookmarkDetail(novel.id, token)}
            loadTags={(restrict, token) => novelBookmarkTags(restrict, token)}
            save={(restrict, tags, token) => addNovelBookmark(novel.id, restrict, token, tags)}
            onSaved={() => setBookmarked(true)}
            onClose={() => setShowBookmarkDetail(false)}
          />
        }
        sheetPresented={showBookmarkDetail}
        onSheetChanged={setShowBookmarkDetail}
      />
    </ZStack>
  )
}

// 作者头像
export function AvatarImage(props: {
  url: string | null
  size?: number
  cornerRadius?: number
  priority?: number
}) {
  const { url, size = 36, cornerRadius = size / 2, priority } = props
  const { path } = useCachedImage(url, undefined, priority)

  return (
    <ZStack
      frame={{ width: size, height: size }}
      clipShape={{ type: "rect", cornerRadius }}
    >
      {path ? (
        <Image
          filePath={path}
          resizable={true}
          scaleToFill={true}
          frame={{ width: size, height: size }}
        />
      ) : (
        <Image
          systemName="person.fill"
          font="caption"
          foregroundStyle="systemGray3"
        />
      )}
    </ZStack>
  )
}

// 网格作品卡片（列表页共用）：玻璃卡片 + 缩略图 + 标题 + 作者/收藏数/浏览数
// 多页作品在图片左下角显示 rectangle.stack.fill + 纯数字页数。
// cornerBadge 为图片左上角非交互角标；footerText 用于补充信息。
// topTrailingAction 只传操作语义，按钮布局与命中区域由统一卡片模板负责。
// 注意：属性名不能叫 badge，那是 SwiftUI 保留修饰符名（只接受 string|number），
// 会导致 JSX 类型检查报错。
export function ImageNumberBadge(props: { number: number; foregroundStyle?: any }) {
  return (
    <Text
      font="body"
      fontWeight="bold"
      foregroundStyle={props.foregroundStyle ?? "primaryLabel"}
      offset={{ x: 4, y: 4 }}
    >
      #{props.number}
    </Text>
  )
}

export interface IllustCardAction {
  title: string
  systemImage: string
  tint?: any
  foregroundStyle?: any
  action: () => void
}

export function IllustCard(props: {
  illust: PixivIllustration
  onAppear?: () => void
  flow?: boolean
  priority?: number
  cornerBadge?: any
  footerText?: string
  topTrailingAction?: IllustCardAction
}) {
  const {
    illust,
    onAppear,
    flow = false,
    priority,
    cornerBadge,
    footerText,
    topTrailingAction,
  } = props
  const [bookmarked, setBookmarked] = useState(illust.is_bookmarked)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  const rawRatio = illust.width > 0 && illust.height > 0 ? illust.width / illust.height : 0.75
  const imageRatio = Math.min(Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO), MAX_FLOW_IMAGE_RATIO)

  async function toggleBookmark() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeBookmark(illust.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) => addBookmark(illust.id, "public", [], token))
        setBookmarked(true)
      }
    } catch {
      // 收藏失败时保持原状态
    } finally {
      setBookmarkBusy(false)
    }
  }

  async function bookmarkAndFollow() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addBookmark(illust.id, "public", [], token))
        setBookmarked(true)
      }
      await session.call((token) => followUser(illust.user.id, "public", token))
    } catch {
      // 保持卡片可继续操作
    } finally {
      setBookmarkBusy(false)
    }
  }

  function handleBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    void Haptics.transient()
    if (action === "follow") {
      void bookmarkAndFollow()
    } else {
      setShowBookmarkDetail(true)
    }
  }

  return (
    <ZStack
      alignment="topTrailing"
      frame={{ maxWidth: "infinity" }}
    >
      <VStack
        alignment="leading"
        spacing={2}
        frame={{ minWidth: 0, maxWidth: "infinity" }}
        onAppear={onAppear}
        padding={4}
        glassEffect={{ type: "rect", cornerRadius: 14 }}
        shadow={{ color: "#0000000F", radius: 18, y: 8 }}
      >
        <ZStack alignment="bottomTrailing" frame={{ maxWidth: "infinity" }}>
          <NavigationLink
            value={`illust:${illust.id}`}
            frame={{ maxWidth: "infinity" }}
          >
            <ZStack alignment="topLeading" frame={{ maxWidth: "infinity" }}>
              <ZStack
                alignment="bottomLeading"
                aspectRatio={{ value: flow ? imageRatio : 1, contentMode: flow ? "fit" : "fill" }}
                frame={{ maxWidth: "infinity" }}
                clipShape={{ type: "rect", cornerRadius: 10 }}
                clipped={true}
              >
                <CachedImage
                  url={cardThumbUrlOf(illust)}
                  aspectRatioValue={flow ? imageRatio : 1}
                  contentMode={flow ? "fit" : "fill"}
                  centerCropSquare={!flow}
                  cornerRadius={10}
                  priority={priority}
                />
                {illust.page_count > 1 ? (
                  <PageCountBadge count={illust.page_count} />
                ) : null}
              </ZStack>
              {cornerBadge ?? null}
            </ZStack>
          </NavigationLink>
          <BookmarkButton
            bookmarked={bookmarked}
            disabled={bookmarkBusy}
            onTap={toggleBookmark}
            onLongPress={handleBookmarkLongPress}
            sheetContent={
              <BookmarkDetailSheet
                item={illust}
                bookmarked={bookmarked}
                loadDetail={(token) => bookmarkDetail(illust.id, token)}
                loadTags={(restrict, token) => bookmarkTags(session.userID ?? 0, restrict, token)}
                save={(restrict, tags, token) =>
                  addBookmark(illust.id, restrict, tags, token)
                }
                onSaved={() => setBookmarked(true)}
                onClose={() => setShowBookmarkDetail(false)}
              />
            }
            sheetPresented={showBookmarkDetail}
            onSheetChanged={setShowBookmarkDetail}
          />
        </ZStack>
        <NavigationLink value={`illust:${illust.id}`}>
          <Text
            font="caption"
            fontWeight="medium"
            lineLimit={1}
            padding={{ horizontal: 4, top: 2 }}
          >
            {illust.title}
          </Text>
        </NavigationLink>
        <HStack
          spacing={5}
          padding={{ horizontal: 4, bottom: footerText ? 0 : 4 }}
          frame={{ maxWidth: "infinity" }}
        >
          <NavigationLink
            value={`illust:${illust.id}`}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            <Text
              font="caption2"
              foregroundStyle="secondaryLabel"
              lineLimit={1}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {illust.user.name}
            </Text>
          </NavigationLink>
          <HStack
            spacing={5}
            fixedSize={{ horizontal: true, vertical: false }}
            layoutPriority={1}
            frame={{ alignment: "trailing" }}
          >
            <HStack spacing={2} fixedSize={{ horizontal: true, vertical: false }}>
              <Image
                systemName="heart"
                font="caption2"
                foregroundStyle="label"
              />
              <Text
                font="caption2"
                foregroundStyle="secondaryLabel"
                lineLimit={1}
                fixedSize={{ horizontal: true, vertical: false }}
              >
                {formatNumber(illust.total_bookmarks)}
              </Text>
            </HStack>
            <HStack spacing={2} fixedSize={{ horizontal: true, vertical: false }}>
              <Image
                systemName="eye"
                font="caption2"
                foregroundStyle="secondaryLabel"
              />
              <Text
                font="caption2"
                foregroundStyle="secondaryLabel"
                lineLimit={1}
                fixedSize={{ horizontal: true, vertical: false }}
              >
                {formatNumber(illust.total_view)}
              </Text>
            </HStack>
          </HStack>
        </HStack>
        {footerText ? (
          <Text
            font="caption2"
            foregroundStyle="secondaryLabel"
            lineLimit={1}
            padding={{ horizontal: 4, bottom: 4 }}
          >
            {footerText}
          </Text>
        ) : null}
      </VStack>
      {topTrailingAction ? (
        <Button
          buttonStyle="glass"
          action={topTrailingAction.action}
          frame={{ width: CORNER_ICON_SIZE, height: CORNER_ICON_SIZE }}
          clipShape={{ type: "rect", cornerRadius: CORNER_ICON_SIZE / 2 }}
          contentShape="rect"
          zIndex={1}
          offset={{ x: -4, y: 4 }}
        >
          <Image
            systemName={topTrailingAction.systemImage}
            font="body"
            tint={topTrailingAction.tint}
            foregroundStyle={topTrailingAction.foregroundStyle}
          />
        </Button>
      ) : null}
    </ZStack>
  )
}


// 双列流式作品信息流：按作品比例估算高度，将作品持续分配到较短列。
// 卡片本身统一使用 IllustCard。
type IllustFlowItem = {
  illust: PixivIllustration
  index: number
}

export function LoadMoreTrigger(props: {
  anchor: number | string
  onLoadMore: (anchor: number | string) => void
  hasMore: boolean
  isLoading?: boolean
}) {
  if (!props.hasMore) return null
  return (
    <VStack
      key={`load-more:${props.anchor}`}
      spacing={0}
      frame={{ height: props.isLoading ? 44 : 1, maxWidth: "infinity" }}
      onAppear={() => props.onLoadMore(props.anchor)}
    >
      {props.isLoading ? (
        <HStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <Spacer />
          <ProgressView progressViewStyle="circular" />
          <Spacer />
        </HStack>
      ) : null}
    </VStack>
  )
}

export function IllustFlowFeed(props: {
  items: PixivIllustration[]
  onLoadMore: (anchor: number | string) => void
  hasMore?: boolean
  isLoading?: boolean
  cornerBadgeOf?: (illust: PixivIllustration, index: number) => any
  footerTextOf?: (illust: PixivIllustration, index: number) => string | undefined
  topTrailingActionOf?: (
    illust: PixivIllustration,
    index: number,
  ) => IllustCardAction | undefined
}) {
  const [leading, trailing] = distributeFlowItems(props.items)
  const lastItem = props.items[props.items.length - 1]
  const lastId = lastItem ? lastItem.id : null

  function renderItem({ illust, index }: IllustFlowItem) {
    const isLast = illust.id === lastId
    return (
      <IllustCard
        key={illust.id}
        illust={illust}
        flow={true}
        priority={index}
        onAppear={
          isLast && (props.hasMore ?? true)
            ? () => props.onLoadMore(illust.id)
            : undefined
        }
        cornerBadge={props.cornerBadgeOf?.(illust, index)}
        footerText={props.footerTextOf?.(illust, index)}
        topTrailingAction={props.topTrailingActionOf?.(illust, index)}
      />
    )
  }

  return (
    <VStack spacing={12} frame={{ maxWidth: "infinity" }}>
      <HStack
        alignment="top"
        spacing={10}
        padding={{ horizontal: 10 }}
        frame={{ maxWidth: "infinity" }}
      >
        <LazyVStack alignment="leading" spacing={10} frame={{ minWidth: 0, maxWidth: "infinity" }}>
          {leading.map(renderItem)}
        </LazyVStack>
        <LazyVStack alignment="leading" spacing={10} frame={{ minWidth: 0, maxWidth: "infinity" }}>
          {trailing.map(renderItem)}
        </LazyVStack>
      </HStack>
      {props.isLoading ? (
        <HStack spacing={0} frame={{ maxWidth: "infinity", height: 44 }}>
          <Spacer />
          <ProgressView progressViewStyle="circular" />
          <Spacer />
        </HStack>
      ) : null}
    </VStack>
  )
}

function distributeFlowItems(
  items: PixivIllustration[]
): [IllustFlowItem[], IllustFlowItem[]] {
  const columns: [IllustFlowItem[], IllustFlowItem[]] = [[], []]
  const heights = [0, 0]
  for (const [index, illust] of items.entries()) {
    const rawRatio = illust.width > 0 && illust.height > 0 ? illust.width / illust.height : 0.75
    const ratio = Math.min(Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO), MAX_FLOW_IMAGE_RATIO)
    const estimatedHeight = 1 / ratio + 0.34
    const column = heights[0] <= heights[1] ? 0 : 1
    columns[column].push({ illust, index })
    heights[column] += estimatedHeight
  }
  return columns
}

export function BookmarkDetailSheet(props: {
  item: { id: number; title: string }
  bookmarked: boolean
  loadDetail: (token: string) => Promise<PixivBookmarkDetail>
  loadTags: (restrict: "public" | "private", token: string) => Promise<PixivPage<PixivBookmarkTag>>
  save: (restrict: "public" | "private", tags: string[], token: string) => Promise<void>
  onSaved: () => void
  onClose: () => void
}) {
  const [availableTags, setAvailableTags] = useState<PixivBookmarkTag[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState("")
  const [restrict, setRestrict] = useState<"public" | "private">("public")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadDetail() {
      setCustomTag("")
      const userID = session.userID
      if (!userID) {
        setLoading(false)
        return
      }
      try {
        const [detail, publicTags, privateTags] = await Promise.all([
          session.call(props.loadDetail),
          session.call((token) => props.loadTags("public", token)),
          session.call((token) => props.loadTags("private", token)),
        ])
        if (cancelled) return
        setSelectedTags(
          detail.is_bookmarked
            ? (detail.tags ?? [])
                .filter((tag) => tag.is_registered)
                .map((tag) => tag.name)
            : []
        )
        setRestrict(detail.restrict === "private" ? "private" : "public")
        const merged = new Map<string, PixivBookmarkTag>()
        for (const tag of detail.tags ?? []) {
          merged.set(tag.name, { name: tag.name, count: 0 })
        }
        for (const tag of [...publicTags.items, ...privateTags.items]) {
          if (!merged.has(tag.name)) merged.set(tag.name, tag)
        }
        setAvailableTags(Array.from(merged.values()).slice(0, 40))
      } catch {
        if (!cancelled) setError("收藏信息加载失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [props.item.id])

  function toggleTag(name: string) {
    setSelectedTags((current) =>
      current.includes(name)
        ? current.filter((tag) => tag !== name)
        : current.length >= 10
          ? current
          : [...current, name]
    )
  }

  function addCustomTag() {
    const name = customTag.trim()
    if (!name || selectedTags.includes(name) || selectedTags.length >= 10) return
    setAvailableTags((current) =>
      current.some((tag) => tag.name === name)
        ? current
        : [{ name, count: 0 }, ...current]
    )
    setSelectedTags((current) => [...current, name])
    setCustomTag("")
  }

  function close() {
    setCustomTag("")
    props.onClose()
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await session.call((token) =>
        props.save(restrict, selectedTags, token)
      )
      props.onSaved()
      close()
    } catch {
      setError("收藏保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }

  return (
    <VStack
      alignment="leading"
      spacing={0}
      padding={{ horizontal: 14, top: 10, bottom: 40 }}
      safeAreaPadding={{ bottom: true }}
      presentationDetents={[0.48]}
      presentationDragIndicator="visible"
      frame={{ maxWidth: "infinity" }}
    >
      <HStack
        frame={{ maxWidth: "infinity" }}
        padding={{ horizontal: 4, top: 0, bottom: 8 }}
      >
        <Button
          action={close}
          buttonStyle="glass"
          frame={{ width: 32, height: 32 }}
          clipShape={{ type: "rect", cornerRadius: 16 }}
          contentShape="rect"
        >
          <Image systemName="xmark" font="title3" />
        </Button>
        <Spacer />
        <Button
          action={() => void save()}
          buttonStyle="glass"
          disabled={saving}
          frame={{ width: 32, height: 32 }}
          clipShape={{ type: "rect", cornerRadius: 16 }}
          contentShape="rect"
        >
          <Image
            systemName={props.bookmarked ? "heart.fill" : "heart"}
            font="title3"
            foregroundStyle={props.bookmarked && !saving ? "#FF375F" : undefined}
          />
        </Button>
      </HStack>
      <Text
        font="caption"
        foregroundStyle="secondaryLabel"
        lineLimit={1}
        padding={{ bottom: 10 }}
      >
        {props.item.title}
      </Text>
      <Text font="subheadline" fontWeight="semibold" padding={{ bottom: 8 }}>
        收藏的标签（{selectedTags.length} / 10）
      </Text>
      <ScrollView
        scrollDismissesKeyboard="never"
        frame={{ height: 96 }}
      >
        {loading ? (
          <ProgressView frame={{ maxWidth: "infinity" }} />
        ) : availableTags.length === 0 ? (
          <Text font="caption" foregroundStyle="secondaryLabel">
            暂无常用标签
          </Text>
        ) : (
          <VStack alignment="leading" spacing={8}>
            {wrapTags(
              availableTags,
              350,
              (tag) => estimateChipWidth(`#${tag.name}`),
              8
            ).map((row, rowIndex) => (
              <HStack key={rowIndex} spacing={8}>
                {row.map((tag) => {
                  const selected = selectedTags.includes(tag.name)
                  return (
                    <Button
                      key={tag.name}
                      title={`${selected ? "✓ " : ""}#${tag.name}`}
                      buttonStyle={selected ? "glassProminent" : "glass"}
                      controlSize="mini"
                      action={() => toggleTag(tag.name)}
                    />
                  )
                })}
              </HStack>
            ))}
          </VStack>
        )}
      </ScrollView>
      <HStack spacing={8} frame={{ maxWidth: "infinity" }} padding={{ top: 10 }}>
        <TextField
          title="自定义收藏标签"
          prompt="输入标签名称"
          value={customTag}
          onChanged={setCustomTag}
          onSubmit={addCustomTag}
          submitLabel="done"
          frame={{ width: 280, height: 44 }}
        />
        <Spacer />
        <Button
          action={addCustomTag}
          buttonStyle="glass"
          disabled={!customTag.trim() || selectedTags.length >= 10}
          frame={{ width: 28, height: 28 }}
           clipShape={{ type: "rect", cornerRadius: 14 }}
          contentShape="rect"
        >
          <Image systemName="plus" font="body" />
        </Button>
      </HStack>
      <Toggle
        title="私密收藏"
        value={restrict === "private"}
        onChanged={(value) => setRestrict(value ? "private" : "public")}
      />
      {error ? <Text foregroundStyle="systemRed">{error}</Text> : null}
    </VStack>
  )
}

export function BookmarkButton(props: {
  bookmarked: boolean
  disabled: boolean
  onTap: () => void
  onLongPress: () => void
  sheetContent?: any
  sheetPresented?: boolean
  onSheetChanged?: (presented: boolean) => void
}) {
  const [longPressLocked, setLongPressLocked] = useState(false)

  return (
    <ZStack
      frame={{ width: CORNER_ICON_SIZE, height: CORNER_ICON_SIZE }}
      contentShape="rect"
      zIndex={2}
      offset={{ x: -4, y: -4 }}
      allowsHitTesting={!props.disabled && !longPressLocked}
      presentationDetents={[0.48]}
      sheet={
        props.sheetContent && props.onSheetChanged
          ? {
              content: props.sheetContent,
              isPresented: props.sheetPresented ?? false,
              onChanged: props.onSheetChanged,
            }
          : undefined
      }
    >
      <Button
        action={props.onTap}
        buttonStyle="glass"
        frame={{ width: CORNER_ICON_SIZE, height: CORNER_ICON_SIZE }}
        clipShape={{ type: "rect", cornerRadius: CORNER_ICON_SIZE / 2 }}
        contentShape="rect"
        disabled={props.disabled || longPressLocked}
        simultaneousGesture={
          LongPressGesture({ minDuration: 500 }).onEnded(() => {
            setLongPressLocked(true)
            props.onLongPress()
            setTimeout(() => setLongPressLocked(false), 1500)
          })
        }
      >
        <Image
          systemName={props.bookmarked ? "heart.fill" : "heart"}
          font="body"
          foregroundStyle={props.bookmarked ? "#FF375F" : undefined}
        />
      </Button>
    </ZStack>
  )
}

function PageCountBadge(props: { count: number }) {
  return (
    <HStack
      spacing={2}
      offset={{ x: 4, y: -4 }}
      allowsHitTesting={false}
    >
      <Image
        systemName="rectangle.stack.fill"
        font="body"
        foregroundStyle="#FF9500"
      />
      <Text font="body" fontWeight="semibold" foregroundStyle="#FF9500">
        {props.count}
      </Text>
    </HStack>
  )
}



const VISION_IMAGE_RATIO = 1200 / 630

export function VisionCard(props: {
  article: PixivVisionArticle
  onAppear?: () => void
  priority?: number
}) {
  const { article, onAppear, priority } = props
  return (
    <VStack
      alignment="leading"
      spacing={0}
      padding={{ horizontal: 14 }}
      frame={{ maxWidth: "infinity" }}
      onAppear={onAppear}
    >
      <NavigationLink value={`vision:${article.id}`}>
        <VStack
          alignment="leading"
          spacing={0}
          frame={{ maxWidth: "infinity" }}
          glassEffect={{ type: "rect", cornerRadius: 14 }}
            shadow={{ color: "#0000000F", radius: 18, y: 8 }}
        >
          <CachedImage
            url={article.imageURL}
            aspectRatioValue={VISION_IMAGE_RATIO}
            useIntrinsicAspectRatio={false}
            cornerRadius={12}
            contentMode="fill"
            priority={priority}
          />
          <VStack
            alignment="leading"
            spacing={6}
            padding={{ horizontal: 12, vertical: 12 }}
          >
            <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
              <Text
                font="caption"
                fontWeight="semibold"
                foregroundStyle="#0096FA"
              >
                {article.category}
              </Text>
              <Spacer />
              <Text font="caption2" foregroundStyle="secondaryLabel">
                {formatVisionDate(article.date)}
              </Text>
            </HStack>
            <Text
              font="headline"
              fontWeight="semibold"
              lineLimit={3}
              multilineTextAlignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {article.title}
            </Text>
          </VStack>
        </VStack>
      </NavigationLink>
    </VStack>
  )
}

function formatVisionDate(value: string): string {
  const parts = value.split("-")
  if (parts.length !== 3) return value
  return `${parts[0]}.${parts[1]}.${parts[2]}`
}

export function formatNumber(n: number | null | undefined): string {
  const value = n ?? 0
  if (value >= 10000) {
    const wan = value / 10000
    return `${wan % 1 === 0 ? wan : wan.toFixed(1)}万`
  }
  if (value >= 1000) {
    const k = value / 1000
    return `${k % 1 === 0 ? k : k.toFixed(1)}k`
  }
  return String(value)
}

// HTML 实体映射（一次性解码，避免 &amp;lt; 被二次解码成 <）
const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
}

// HTML 转纯文本：Pixiv 的简介/用户简介字段是 HTML（<br>、<a> 等），
// 清洗后以纯文本展示（与 Hanairo 的 TextSanitizer 行为一致）。
// 顺序：先剥离标签，后解码实体（&lt;b&gt; 应显示为字面 <b> 文本）
export function htmlToPlainText(html: string | undefined | null): string {
  return htmlFragmentToPlainText(html).trim()
}

function htmlFragmentToPlainText(html: string | undefined | null): string {
  if (!html) return ""
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#39|amp|lt|gt|quot|nbsp);/g, (m, name: string) => HTML_ENTITIES[name] ?? m)
}

export function LinkedDescription(props: {
  html: string
  routeDestination: (route: string) => any
  nativePlainText?: boolean
}) {
  const segments = useMemo(() => descriptionSegments(props.html), [props.html])
  const lines = useMemo(() => descriptionLines(segments), [segments])
  const blocks = useMemo(() => descriptionBlocks(lines), [lines])
  return (
    <VStack
      alignment="leading"
      spacing={2}
      safeAreaPadding={{ trailing: true }}
      frame={{ maxWidth: "infinity" }}
    >
      {blocks.map((block, index) =>
        block.kind === "text" ? (
          props.nativePlainText ? (
            <Text
              key={`text-${index}`}
              font="footnote"
              multilineTextAlignment="leading"
              textSelection={true}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {block.text}
            </Text>
          ) : (
            <SelectableDescriptionText key={`text-${index}`} text={block.text} />
          )
        ) : (
          <DescriptionLine
            key={`line-${index}`}
            segments={block.segments}
            routeDestination={props.routeDestination}
          />
        )
      )}
    </VStack>
  )
}

export function presentExternalURL(url: string): Promise<void> {
  return Safari.present(url, false)
}

function DescriptionLine(props: {
  segments: DescriptionSegment[]
  routeDestination: (route: string) => any
}) {
  const views: any[] = []
  let inlineSegments: DescriptionSegment[] = []

  const flushInline = () => {
    if (inlineSegments.length === 0) return
    views.push(
      <FlowLayout
        key={`inline-${views.length}`}
        horizontalSpacing={0}
        verticalSpacing={0}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        {inlineSegments.map((segment, index) => (
          <DescriptionInlineItem
            key={index}
            segment={segment}
            routeDestination={props.routeDestination}
          />
        ))}
      </FlowLayout>
    )
    inlineSegments = []
  }

  for (const segment of props.segments) {
    const target =
      routeForDescriptionLink(segment.href) ??
      routeForDescriptionLink(segment.label)
    if (target?.startsWith("http")) {
      flushInline()
      views.push(
        <ExternalDescriptionLink
          key={`external-${views.length}`}
          label={segment.label || segment.href}
          url={target}
        />
      )
    } else {
      inlineSegments.push(segment)
    }
  }
  flushInline()

  return (
    <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
      {views}
    </VStack>
  )
}

function DescriptionInlineItem(props: {
  segment: DescriptionSegment
  routeDestination: (route: string) => any
}) {
  const target =
    routeForDescriptionLink(props.segment.href) ??
    routeForDescriptionLink(props.segment.label)
  const content = props.segment.label || props.segment.href
  if (!target) {
    return (
      <Text
        font="footnote"
        foregroundStyle="secondaryLabel"
        textSelection={true}
      >
        {content}
      </Text>
    )
  }
  const destination = props.routeDestination(target)
  return (
    <NavigationLink destination={destination}>
      <Text font="footnote" foregroundStyle="#007AFF" underline="#007AFF">
        {content}
      </Text>
    </NavigationLink>
  )
}

function ExternalDescriptionLink(props: { label: string; url: string }) {
  return (
    <Button
      buttonStyle="plain"
      action={() => void presentExternalURL(props.url)}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <Text
        font="footnote"
        foregroundStyle="#007AFF"
        underline="#007AFF"
        multilineTextAlignment="leading"
        fixedSize={{ horizontal: false, vertical: true }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        {props.label}
      </Text>
    </Button>
  )
}

type DescriptionBlock =
  | { kind: "text"; text: string }
  | { kind: "line"; segments: DescriptionSegment[] }

function descriptionBlocks(lines: DescriptionSegment[][]): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = []
  let textLines: string[] = []
  const flushText = () => {
    if (textLines.length > 0) {
      blocks.push({ kind: "text", text: textLines.join("\n") })
      textLines = []
    }
  }

  for (const line of lines) {
    const hasLink = line.some((segment) => {
      const target =
        routeForDescriptionLink(segment.href) ??
        routeForDescriptionLink(segment.label)
      return target != null
    })
    if (hasLink) {
      flushText()
      blocks.push({ kind: "line", segments: line })
    } else {
      textLines.push(line.map((segment) => segment.label).join(""))
    }
  }
  flushText()
  return blocks
}

function SelectableDescriptionText(props: { text: string }) {
  const controller = useMemo(() => new WebViewController({ ephemeral: true }), [])
  const [height, setHeight] = useState(24)

  useEffect(() => {
    let active = true
    void controller
      .loadHTML(selectableDescriptionHTML(props.text))
      .then(async () => {
        const contentHeight = await controller.evaluateJavaScript<number>(
          "return Math.ceil(document.documentElement.scrollHeight)"
        )
        if (active) setHeight(Math.max(24, contentHeight))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [controller, props.text])

  useEffect(() => {
    return () => controller.dispose()
  }, [controller])

  return (
    <WebView
      controller={controller}
      background="clear"
      frame={{ maxWidth: "infinity", height }}
    />
  )
}

function selectableDescriptionHTML(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: #8E8E93;
    font: -apple-system-footnote;
    line-height: 1.35;
    white-space: pre-wrap;
    overflow: hidden;
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }
</style>
</head>
<body>${escaped}</body>
</html>`
}

type DescriptionSegment = { label: string; href: string }

function descriptionLines(
  segments: DescriptionSegment[]
): DescriptionSegment[][] {
  const lines: DescriptionSegment[][] = [[]]
  for (const segment of segments) {
    const parts = segment.label.split("\n")
    for (let index = 0; index < parts.length; index++) {
      if (parts[index]) {
        lines[lines.length - 1].push({ ...segment, label: parts[index] })
      }
      if (index < parts.length - 1) lines.push([])
    }
  }
  return lines.filter((line) => line.length > 0)
}

function descriptionSegments(html: string): DescriptionSegment[] {
  const prepared = html
    .replace(/<br\s*\/?>(?:\r?\n)?/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
  const segments: DescriptionSegment[] = []
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = anchorPattern.exec(prepared)) != null) {
    appendDescriptionTextSegments(
      segments,
      htmlFragmentToPlainText(prepared.slice(cursor, match.index))
    )
    const href = decodeDescriptionLink(match[2])
    const label = htmlToPlainText(match[3]) || href
    segments.push({ label, href })
    cursor = match.index + match[0].length
  }
  appendDescriptionTextSegments(segments, htmlFragmentToPlainText(prepared.slice(cursor)))
  return segments.filter((segment) => segment.label.length > 0)
}

function appendDescriptionTextSegments(
  segments: DescriptionSegment[],
  text: string
) {
  const lines = text.split(/(\n+)/)
  for (const line of lines) {
    const target = routeForDescriptionLink(line)
    if (target && !target.startsWith("http")) {
      const label = line.trim()
      if (label) segments.push({ label, href: label })
      continue
    }
    appendInlineDescriptionSegments(segments, line)
  }
}

function appendInlineDescriptionSegments(
  segments: DescriptionSegment[],
  text: string
) {
  const pattern = /(?:https?:\/\/|www\.)[^\s<>]+|(?:https?:\/\/)?(?:www\.)?pixiv\.net\/(?:users?|user|artworks|novels)(?:\/[^\s<>]*)?|\/?(?:users?|user|artworks|novels)\/\d+(?:[/?#][^\s<>]*)?|(?:pixiv\.net\/|\/)?novel\/show\.php\?id=\d+|\b(?:uid|pid|nid)\s*[:：#=]?\s*\d+\b/gi
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) != null) {
    appendPlainDescriptionSegment(segments, text.slice(cursor, match.index))
    const raw = match[0]
    const link = raw.replace(/[),.，。！!？?;；]+$/, "")
    if (link) segments.push({ label: link, href: link })
    appendPlainDescriptionSegment(segments, raw.slice(link.length))
    cursor = match.index + raw.length
  }
  appendPlainDescriptionSegment(segments, text.slice(cursor))
}

function appendPlainDescriptionSegment(segments: DescriptionSegment[], text: string) {
  if (!text) return
  const previous = segments[segments.length - 1]
  if (previous && previous.href === "") {
    previous.label += text
  } else {
    segments.push({ label: text, href: "" })
  }
}

function routeForDescriptionLink(value: string): string | null {
  const decoded = decodeDescriptionLink(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/／/g, "/")
    .trim()
  if (!decoded) return null

  const embeddedRoute = decoded.match(/^pixiv:\/\/(users?|user|artworks|novels)\/(\d+)$/i)
  if (embeddedRoute) {
    if (/^user/i.test(embeddedRoute[1])) return `user:${embeddedRoute[2]}`
    if (/^novel/i.test(embeddedRoute[1])) return `novel:${embeddedRoute[2]}`
    return `illust:${embeddedRoute[2]}`
  }

  const hasURLScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(decoded)
  const isPixivURL = /^(?:https?:\/\/)?(?:www\.)?pixiv\.net(?:\/|$)/i.test(decoded)
  const pathMatch = decoded.match(
    /(?:^|\/)(users?|user|artworks|novels)\/(\d+)(?:[/?#].*)?$/i
  )
  if (pathMatch && (!hasURLScheme || isPixivURL)) {
    const id = Number(pathMatch[2])
    if (!Number.isFinite(id) || id <= 0) return null
    if (/^user/i.test(pathMatch[1])) return `user:${id}`
    if (/^novel/i.test(pathMatch[1])) return `novel:${id}`
    return `illust:${id}`
  }

  const novelShow = decoded.match(
    /^(?:https?:\/\/)?(?:www\.)?pixiv\.net\/(?:en\/)?novel\/show\.php\?[^#]*\bid=(\d+)/i
  ) ?? decoded.match(
    /^\/?(?:en\/)?novel\/show\.php\?[^#]*\bid=(\d+)/i
  )
  if (novelShow) return `novel:${novelShow[1]}`

  const idReference = decoded.match(/(?:^|\s)(uid|pid|nid)\s*[:：#=]?\s*(\d+)(?:\s|$)/i)
  if (idReference) {
    if (idReference[1].toLowerCase() === "uid") return `user:${idReference[2]}`
    if (idReference[1].toLowerCase() === "nid") return `novel:${idReference[2]}`
    return `illust:${idReference[2]}`
  }
  if (/^www\./i.test(decoded)) return `https://${decoded}`
  if (/^https?:\/\//i.test(decoded)) return decoded
  return null
}

function decodeDescriptionLink(value: string): string {
  return value.replace(
    /&(#39|amp|lt|gt|quot|nbsp);/g,
    (match, name: string) => HTML_ENTITIES[name] ?? match
  )
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))}分钟前`
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}天前`
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  } catch {
    return iso ?? ""
  }
}

// ---------- 流式标签布局（一行多个自动换行，单个标签文本不换行） ----------

// 估算文本渲染宽度（pt）：中文/全角字符按 12pt，ASCII 按 7pt（近似 mini 字号）
export function estimateTextWidth(text: string): number {
  let w = 0
  for (const ch of text) {
    w += ch.charCodeAt(0) > 255 ? 12 : 7
  }
  return w
}

// 标签芯片估算宽度：左右内边距 14pt + 文本宽度
export function estimateChipWidth(text: string): number {
  return 28 + estimateTextWidth(text)
}

// 流式分组：按估算宽度把条目排成多行，每行不超过 maxWidth（含 spacing 间隔）
export function wrapTags<T>(
  items: T[],
  maxWidth: number,
  widthOf: (item: T) => number,
  spacing = 6
): T[][] {
  const rows: T[][] = []
  let row: T[] = []
  let used = 0
  for (const item of items) {
    const w = widthOf(item)
    if (row.length > 0 && used + spacing + w > maxWidth) {
      rows.push(row)
      row = [item]
      used = w
    } else {
      row.push(item)
      used += (row.length > 1 ? spacing : 0) + w
    }
  }
  if (row.length > 0) rows.push(row)
  return rows
}

// 信息卡片（作品/小说详情页标签上方）：完全照标签样式 ——
// 每个字段是一个 glass 胶囊按钮，一个字段一行；点击复制该字段内容
export function InfoCard(props: {
  title?: string
  fields: { label: string; value: string | number }[]
}) {
  const { title = "信息", fields } = props
  const [copied, setCopiedOn] = useTimedFlag(2000)

  function copyField(f: { label: string; value: string | number }) {
    Pasteboard.setString(`${f.label}：${f.value}`)
    setCopiedOn()
  }

  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={8} alignment="center">
        <Text font="footnote" fontWeight="semibold" foregroundStyle="secondaryLabel">
          {title}
        </Text>
        {copied ? (
          <Text font="caption2" fontWeight="medium" foregroundStyle="#34C759">
            已复制 ✓
          </Text>
        ) : null}
      </HStack>
      <VStack alignment="leading" spacing={6}>
        {fields.map((f) => (
          <Button
            key={f.label}
            title={`${f.label}：${f.value}`}
            buttonStyle="glass"
            controlSize="mini"
            action={() => copyField(f)}
          />
        ))}
      </VStack>
    </VStack>
  )
}

// 作品标签徽章（详情页可用紧凑尺寸降低高密度标签区的视觉重量）
export function TagChip(props: {
  name: string
  tagName?: string
  value: string
  compact?: boolean
}) {
  const { name, tagName = name, value, compact = false } = props
  return (
    <NavigationLink
      value={value}
      buttonStyle="glass"
      controlSize={compact ? "mini" : "small"}
      fixedSize={{ horizontal: true, vertical: false }}
      contextMenu={{
        menuItems: (
          <Group>
            <Button
              title="屏蔽该标签"
              systemImage="nosign"
              role="destructive"
              action={() => blockTag(tagName)}
            />
          </Group>
        ),
      }}
    >
      <Text font={compact ? "caption" : "body"} lineLimit={1}>
        {name}
      </Text>
    </NavigationLink>
  )
}

// 全局加载视图：所有加载场景统一为居中的圆形指示器。
export function LoadingView() {
  return (
    <HStack
      spacing={0}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={40}
    >
      <Spacer />
      <ProgressView progressViewStyle="circular" />
      <Spacer />
    </HStack>
  )
}

// 错误视图
export function ErrorView(props: {
  message: string
  onRetry: () => void
}) {
  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={40}
    >
      <VStack alignment="center" spacing={14}>
        <Image
          systemName="wifi.exclamationmark"
          font="largeTitle"
          foregroundStyle="secondaryLabel"
        />
        <Text
          font="subheadline"
          foregroundStyle="secondaryLabel"
          multilineTextAlignment="center"
        >
          {props.message}
        </Text>
        <Button
          title="重试"
          buttonStyle="glass"
          action={props.onRetry}
        />
      </VStack>
    </ZStack>
  )
}

// 空视图
export function EmptyView(props: { text?: string; systemImage?: string }) {
  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={60}
    >
      <VStack alignment="center" spacing={14}>
        <Image
          systemName={props.systemImage ?? "sparkles"}
          font="largeTitle"
          foregroundStyle="secondaryLabel"
        />
        <Text font="subheadline" foregroundStyle="secondaryLabel">
          {props.text ?? "暂无内容"}
        </Text>
      </VStack>
    </ZStack>
  )
}

// 作品底部信息行（收藏数/浏览数）
export function IllustStats(props: { illust: PixivIllustration }) {
  const { illust } = props
  return (
    <Text font="caption" foregroundStyle="secondaryLabel">
      ♥ {formatNumber(illust.total_bookmarks)} · 👁 {formatNumber(illust.total_view)}
    </Text>
  )
}

// 作者行
export function AuthorRow(props: {
  user: PixivUser
  size?: number
  onTap?: () => void
}) {
  const { user, size = 22, onTap } = props
  const avatarUrl = user.profile_image_urls?.medium ?? null
  return (
    <VStack alignment="leading" spacing={2} onTapGesture={onTap}>
      <ZStack alignment="leading">
        <AvatarImage url={avatarUrl} size={size} />
        <Text
          font="footnote"
          fontWeight="medium"
          lineLimit={1}
          padding={{ leading: size + 10 }}
        >
          {user.name}
        </Text>
      </ZStack>
    </VStack>
  )
}
