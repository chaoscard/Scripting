import {
  Button,
  FlowLayout,
  Group,
  HStack,
  Image,
  LazyVStack,
  LongPressGesture,
  NavigationLink,
  NavigationStack,
  ProgressView,
  ScrollView,
  ScrollViewReader,
  Script,
  Spacer,
  Text,
  TextField,
  Toggle,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
  type ScrollViewProxy,
  type StyledText,
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
import { loadSettings } from "../store/settings"
import { blockTag } from "../store/blocklist"
import { cacheIllust, cacheIllusts } from "../store/illustCache"
import { useIllustBookmark, useLatest, useNovelBookmark } from "./hooks"
import { requestPixivRoute } from "./routeNavigation"
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
const FLOW_HORIZONTAL_PADDING = 12
const FLOW_COLUMN_SPACING = 12
const FLOW_ROW_SPACING = 4
const FLOW_CARD_WIDTH = Math.floor(
  (Device.screen.width - FLOW_HORIZONTAL_PADDING * 2 - FLOW_COLUMN_SPACING) / 2
)
// 流式布局允许最长 1:4 的竖图保留原始比例；更极端的图片仍受此下限保护。
const MIN_FLOW_IMAGE_RATIO = 1 / 4
const MAX_FLOW_IMAGE_RATIO = 2.5

// 主页面共享工具栏工厂：挂载到各 Tab 的实际导航容器，详情页保留系统返回按钮。
export function appToolbar(dismiss: () => void, title?: string, trailing?: any) {
  return {
    topBarLeading: [
      <Button
        title="关闭"
        systemImage="xmark"
        action={() => {
          if (loadSettings().closeButtonAction === "exit") {
            Script.exit()
          } else {
            Script.minimize()
          }
        }}
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
  background?: any
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
            background={props.background}
          >
            <VStack
              key={REFRESH_TOP_KEY}
              alignment="leading"
              frame={{ maxWidth: "infinity" }}
              background={props.background}
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
function imageFadeDurationSec(): number {
  const ms = loadSettings().imageFadeInDuration ?? 150
  return Math.max(0.001, Math.min(0.5, ms / 1000))
}

function blurCrossFadeDurationSec(): number {
  const ms = loadSettings().blurCrossFadeDuration ?? 150
  return Math.max(0, Math.min(0.25, ms / 1000))
}

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
  const targetPath = cachedPath ?? (
    loaded.url === url && loaded.revision === cacheRevision ? loaded.path : null
  )
  // 当 url 切换（如详情页画质从 large 升级至 original）且新 url 正在加载时，
  // 保留此前已成功加载的图片 path 作为展示回退，避免卸载旧图导致的闪退/闪白/闪回模糊。
  const fallbackPath = !targetPath && loaded.path && loaded.revision === cacheRevision ? loaded.path : null
  const path = targetPath ?? fallbackPath
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
      if (loaded.url !== url || loaded.path !== cachedPath) {
        setLoaded({ url, path: cachedPath, revision: cacheRevision })
      }
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
              }, 500)
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
              }, 500)
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

  return { path, isTargetLoaded: Boolean(targetPath), failed, cacheRevision }
}

// 异步图片（对标 Hanairo RemoteImageView 设计与 Telegram 渐进式模糊预览）：
// 容器宽高比由元数据严格固定，加载过程与展示过程保持零布局重排（Zero Layout Shift）。
// 底层常驻纯净骨架占位色块；瀑布流普通卡片支持平滑淡入（由设置控制），详情大图支持 previewUrl 模糊垫底并即时平滑消融。
export function CachedImage(props: {
  url: string | null
  previewUrl?: string | null
  blurPreviewRadius?: number
  aspectRatioValue?: number // 宽/高
  cornerRadius?: number
  contentMode?: "fit" | "fill"
  centerCropSquare?: boolean
  centerCropAspect?: number
  useIntrinsicAspectRatio?: boolean
  disableFadeIn?: boolean
  frame?: any // 覆盖默认整宽 frame（如固定尺寸缩略图）
  onLoaded?: (success: boolean) => void
  priority?: number
}) {
  const {
    url,
    previewUrl,
    blurPreviewRadius = 8,
    aspectRatioValue = 1,
    cornerRadius = 10,
    contentMode = "fill",
    centerCropSquare = false,
    centerCropAspect,
    useIntrinsicAspectRatio = false,
    disableFadeIn = false,
    frame,
    onLoaded,
    priority,
  } = props
  const { path, isTargetLoaded, failed, cacheRevision } = useCachedImage(url, onLoaded, priority)
  const initialHitRef = useRef(Boolean(path))

  // 缩略图主动就绪与模糊占位机制：
  // 1. 若大图首帧未命中且提供了 previewUrl，本地未缓存时立即在组件内主动请求 previewUrl（体积极小，毫秒级就绪）；
  // 2. 缩略图下载完成后即刻构建预模糊位图（previewBlurredImage）作为底图占位；
  // 3. 高清大图下载完成后平滑消融呈现（Blur Cross-Fade）；首帧已命中大图时则直接硬切秒开并跳过缩略图请求。
  const previewCached = useMemo(() => (previewUrl ? cachedFilePath(previewUrl) : null), [previewUrl, cacheRevision])
  const [previewLoadedPath, setPreviewLoadedPath] = useState<string | null>(() => previewCached)

  useEffect(() => {
    if (initialHitRef.current || !previewUrl) return
    if (previewCached) {
      if (previewLoadedPath !== previewCached) {
        setPreviewLoadedPath(previewCached)
      }
      return
    }
    let active = true
    loadImage(previewUrl, priority)
      .then((p) => {
        if (active && p) {
          setPreviewLoadedPath(p)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [previewUrl, previewCached, priority])

  const previewPath = previewCached ?? previewLoadedPath

  const showBlurPreview = Boolean(
    !initialHitRef.current && previewPath && previewPath !== path
  )

  const croppedImage = useMemo(() => {
    if (!path) return null
    if (centerCropSquare) {
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
    }
    if (centerCropAspect != null && centerCropAspect > 0) {
      try {
        const image = UIImage.fromFile(path)
        if (!image || image.width <= 0 || image.height <= 0) return null
        const currentAspect = image.width / image.height
        // 若图片纵横比与目标纵横比差异大于 1%，则进行居中裁切
        if (Math.abs(currentAspect - centerCropAspect) > 0.01) {
          if (currentAspect > centerCropAspect) {
            // 图片更宽（例如超宽横图封面），截取横向正中间部分
            const targetWidth = image.height * centerCropAspect
            return image.croppedTo({
              x: (image.width - targetWidth) / 2,
              y: 0,
              width: targetWidth,
              height: image.height,
            })
          } else {
            // 图片更高，截取纵向正中间部分
            const targetHeight = image.width / centerCropAspect
            return image.croppedTo({
              x: 0,
              y: (image.height - targetHeight) / 2,
              width: image.width,
              height: targetHeight,
            })
          }
        }
      } catch {
        return null
      }
    }
    return null
  }, [path, centerCropSquare, centerCropAspect])

  const previewBlurredImage = useMemo(() => {
    if (!showBlurPreview || !previewPath) return null
    try {
      const image = UIImage.fromFile(previewPath)
      if (!image || image.width <= 0 || image.height <= 0) return null
      let targetImg = image
      if (centerCropSquare) {
        const side = Math.min(image.width, image.height)
        const cropped = image.croppedTo({
          x: (image.width - side) / 2,
          y: (image.height - side) / 2,
          width: side,
          height: side,
        })
        if (cropped) targetImg = cropped
      } else if (centerCropAspect != null && centerCropAspect > 0) {
        const currentAspect = image.width / image.height
        if (Math.abs(currentAspect - centerCropAspect) > 0.01) {
          if (currentAspect > centerCropAspect) {
            const targetWidth = image.height * centerCropAspect
            const cropped = image.croppedTo({
              x: (image.width - targetWidth) / 2,
              y: 0,
              width: targetWidth,
              height: image.height,
            })
            if (cropped) targetImg = cropped
          } else {
            const targetHeight = image.width / centerCropAspect
            const cropped = image.croppedTo({
              x: 0,
              y: (image.height - targetHeight) / 2,
              width: image.width,
              height: targetHeight,
            })
            if (cropped) targetImg = cropped
          }
        }
      }
      return targetImg.blurred(blurPreviewRadius) ?? targetImg
    } catch {
      return null
    }
  }, [showBlurPreview, previewPath, centerCropSquare, centerCropAspect, blurPreviewRadius])

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

  // 当传入了有效且明确的 aspectRatioValue 且与图片真实比例差异极小（< 2% 浮点/整数缩放舍入误差）时，
  // 保持 aspectRatioValue，防止大图解码完成瞬间由于微小亚像素差异触发外层容器二次重新排版（Layout Shift）；
  // 仅在未指定比例或真实比例与占位比例存在显著差异（如多页漫画不同横竖跨页）时采用真实比例。
  const stableAspect = useMemo(() => {
    if (intrinsicAspect == null) return aspectRatioValue
    if (aspectRatioValue > 0 && Math.abs(intrinsicAspect - aspectRatioValue) / aspectRatioValue < 0.02) {
      return aspectRatioValue
    }
    return intrinsicAspect
  }, [intrinsicAspect, aspectRatioValue])

  const effectiveRatio = croppedImage
    ? (centerCropAspect ?? 1)
    : (stableAspect ?? aspectRatioValue)
  const containerFrame = frame ?? { maxWidth: "infinity" }
  const fadeDuration = imageFadeDurationSec()
  const crossFadeDuration = blurCrossFadeDurationSec()

  // 首帧已命中缓存时直接硬切呈现（0ms 动画），秒开无延时无白闪；
  // 异步加载完成后：
  // 1. 有本地模糊预览图垫底时，采用配置的模糊消融（0-250ms，默认 150ms），平滑过渡；
  // 2. 无本地预览图垫底时（如多页漫画后续页/冷启动），使用标准设置淡入，避免在灰色底色上误触发消融产生灰白闪屏。
  const imageTransition = disableFadeIn || initialHitRef.current
    ? undefined
    : showBlurPreview
      ? (crossFadeDuration > 0 ? Transition.fade(crossFadeDuration) : undefined)
      : (fadeDuration > 0 ? Transition.fade(fadeDuration) : undefined)

  return (
    <ZStack
      aspectRatio={{ value: effectiveRatio, contentMode: "fit" }}
      clipShape={{ type: "rect", cornerRadius }}
      clipped={true}
      frame={containerFrame}
    >
      {/* 1. 底层骨架占位色块（中性灰/深灰半透明，官方客户端质感） */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background="tertiarySystemFill"
      >
        {!url || failed ? (
          // 仅在明确加载失败或无 URL 时展示浅灰占位图标
          <Image
            systemName="photo"
            font="title2"
            foregroundStyle="systemGray4"
          />
        ) : null}
      </VStack>

      {/* 2. 模糊缩略图垫底层（预模糊位图直出，彻底杜绝 Metal 滤镜 1 帧清晰跳变与交替白闪） */}
      {showBlurPreview && previewBlurredImage ? (
        <Image
          image={previewBlurredImage}
          resizable={true}
          aspectRatio={{ value: effectiveRatio, contentMode: "fill" }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        />
      ) : null}

      {/* 3. 高清图片层：叠在模糊缩略图之上，平滑消融呈现 */}
      {path ? (
        croppedImage ? (
          <Image
            key={path}
            image={croppedImage}
            resizable={true}
            aspectRatio={{ value: effectiveRatio, contentMode: "fill" }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            transition={imageTransition}
          />
        ) : (
          <Image
            key={path}
            filePath={path}
            resizable={true}
            aspectRatio={{ value: effectiveRatio, contentMode }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            transition={imageTransition}
          />
        )
      ) : null}
    </ZStack>
  )
}

function formatWatchlistDate(dateStr?: string | null): string {
  if (!dateStr) return ""
  try {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear()
      const month = d.getMonth() + 1
      const day = d.getDate()
      return `${year}年${month}月${day}日`
    }
  } catch {
    // ignore
  }
  const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) {
    const [, y, m, day] = match
    return `${Number(y)}年${Number(m)}月${Number(day)}日`
  }
  return dateStr.slice(0, 10)
}

// 追更列表标准卡片：漫画与小说统一采用液态玻璃规范
export function WatchlistSeriesCard(props: {
  item: PixivWatchlistSeries
  kind?: "manga" | "novel"
  priority?: number
  onAppear?: () => void
}) {
  const { item, kind = "manga", priority, onAppear } = props
  const isNovel = kind === "novel"
  const seriesRoute = isNovel ? `novelSeries:${item.id}` : `mangaSeries:${item.id}`
  const targetRoute = item.latest_content_id != null
    ? (isNovel ? `novel:${item.latest_content_id}` : `illust:${item.latest_content_id}`)
    : seriesRoute
  const formattedDate = formatWatchlistDate(item.last_published_content_datetime)

  if (item.mask_text) {
    return (
      <VStack
        alignment="leading"
        spacing={4}
        padding={14}
        glassEffect={{ type: "rect", cornerRadius: 14 }}
        shadow={{ color: "#0000000F", radius: 18, y: 8 }}
        frame={{ maxWidth: "infinity" }}
      >
        <Text foregroundStyle="secondaryLabel">{item.mask_text}</Text>
      </VStack>
    )
  }

  return (
    <ZStack alignment="bottomTrailing" frame={{ maxWidth: "infinity" }}>
      <NavigationLink value={seriesRoute}>
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
          >
            <CachedImage
              url={item.url ?? null}
              aspectRatioValue={0.71}
              centerCropAspect={0.71}
              cornerRadius={0}
              contentMode="fill"
              frame={{ width: 68, height: 96 }}
              priority={priority}
            />
          </ZStack>
          <VStack
            alignment="leading"
            spacing={4}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          >
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {isNovel ? "小说系列" : "系列作品"}
            </Text>
            <Text
              font="subheadline"
              fontWeight="semibold"
              multilineTextAlignment="leading"
              lineLimit={2}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
              padding={{ trailing: 36 }}
            >
              {item.title || "未命名系列"}
            </Text>
            <Spacer />
            {item.user?.name ? (
              <HStack frame={{ maxWidth: "infinity" }}>
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {item.user.name}
                </Text>
                <Spacer />
              </HStack>
            ) : null}
            <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
              <Text font="caption2" foregroundStyle="secondaryLabel">
                {`共 ${item.published_content_count} 话`}
              </Text>
              {formattedDate ? (
                <Text font="caption2" foregroundStyle="secondaryLabel">
                  {formattedDate}
                </Text>
              ) : null}
              <Spacer />
            </HStack>
          </VStack>
        </HStack>
      </NavigationLink>
      <NavigationLink value={targetRoute} buttonStyle="plain">
        <ZStack
          alignment="center"
          frame={{ width: 34, height: 34 }}
          glassEffect="circle"
          contentShape="circle"
          offset={{ x: -8, y: -8 }}
          zIndex={2}
          shadow={{ color: "#0000000F", radius: 6, y: 2 }}
        >
          <Image
            systemName={isNovel ? "book" : "photo.on.rectangle"}
            font="subheadline"
            foregroundStyle="label"
          />
        </ZStack>
      </NavigationLink>
    </ZStack>
  )
}

// 小说标准卡片：推荐页与收藏页共用，保持封面、标签和统计信息一致。
export function NovelCard(props: {
  novel: PixivNovel
  onAppear?: () => void
  priority?: number
  footerText?: string
  markerPage?: number
  topTrailingAction?: IllustCardAction
}) {
  const {
    novel,
    onAppear,
    priority,
    footerText,
    markerPage,
    topTrailingAction,
  } = props
  const [bookmarked, setBookmarked] = useNovelBookmark(novel.id, novel.is_bookmarked)
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
    <ZStack alignment="topTrailing" frame={{ maxWidth: "infinity" }}>
      <ZStack alignment="bottomTrailing" frame={{ maxWidth: "infinity" }}>
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
            >
              <CachedImage
                url={coverURL}
                aspectRatioValue={0.71}
                centerCropAspect={0.71}
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
                padding={{ trailing: topTrailingAction ? 24 : 0 }}
              >
                {novel.title}
              </Text>
              <FlowLayout horizontalSpacing={4} verticalSpacing={2}>
                {novel.tags.map((tag) => (
                  <Text
                    key={tag.name}
                    font="caption2"
                    foregroundStyle="secondaryLabel"
                    lineLimit={1}
                  >
                    #{tag.name}
                  </Text>
                ))}
              </FlowLayout>
              <Spacer />
              <HStack frame={{ maxWidth: "infinity" }}>
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {novel.user.name}
                </Text>
                <Spacer />
              </HStack>
              <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
                <HStack spacing={4}>
                  <Image systemName="eye" font="caption2" foregroundStyle="secondaryLabel" />
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {formatNumber(novel.total_view)}
                  </Text>
                </HStack>
                <HStack spacing={4}>
                  <Image systemName="heart" font="caption2" foregroundStyle="secondaryLabel" />
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {formatNumber(novel.total_bookmarks)}
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
                {novel.episode_number != null ? (
                  <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                    {`第 ${novel.episode_number} 话`}
                  </Text>
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

// 作者头像（下载完成后立刻硬切呈现，纯净中性骨架占位）
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
      <VStack
        frame={{ width: size, height: size }}
        background="tertiarySystemFill"
      >
        {!path ? (
          <Image
            systemName="person.fill"
            font="caption"
            foregroundStyle="systemGray4"
          />
        ) : null}
      </VStack>
      {path ? (
        <Image
          key={`avatar-${path}`}
          filePath={path}
          resizable={true}
          scaleToFill={true}
          frame={{ width: size, height: size }}
        />
      ) : null}
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
  cacheIllust(illust)
  const [bookmarked, setBookmarked] = useIllustBookmark(illust.id, illust.is_bookmarked)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  // 流式卡片只在进入原生可见区后请求图片；骨架尺寸仍由作品元数据提前固定。
  const [imageVisible, setImageVisible] = useState(!flow)
  const rawRatio = illust.width > 0 && illust.height > 0 ? illust.width / illust.height : 0.75
  const imageRatio = Math.min(Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO), MAX_FLOW_IMAGE_RATIO)
  const flowImageFrame = flow
    ? { width: FLOW_CARD_WIDTH, height: FLOW_CARD_WIDTH / imageRatio }
    : undefined
  const flowCardFrame = flow
    ? { width: FLOW_CARD_WIDTH }
    : { maxWidth: "infinity" }

  function handleAppear() {
    if (!imageVisible) setImageVisible(true)
    onAppear?.()
  }

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
      frame={flowCardFrame}
    >
      <VStack
        alignment="leading"
        spacing={2}
        frame={flowCardFrame}
        onAppear={handleAppear}
        padding={4}
        glassEffect={{ type: "rect", cornerRadius: 14 }}
        shadow={{ color: "#0000000F", radius: 18, y: 8 }}
      >
        <ZStack alignment="bottomTrailing" frame={flowCardFrame}>
          <NavigationLink
            value={`illust:${illust.id}`}
            frame={flowCardFrame}
          >
            <ZStack alignment="topLeading" frame={flowCardFrame}>
              <ZStack
                alignment="bottomLeading"
                aspectRatio={flow ? undefined : { value: 1, contentMode: "fill" }}
                frame={flowImageFrame ?? { maxWidth: "infinity" }}
                clipShape={{ type: "rect", cornerRadius: 10 }}
                clipped={true}
              >
                <CachedImage
                  url={imageVisible ? cardThumbUrlOf(illust) : null}
                  aspectRatioValue={flow ? imageRatio : 1}
                  contentMode={flow ? "fit" : "fill"}
                  centerCropSquare={!flow}
                  cornerRadius={10}
                  frame={flowImageFrame}
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
            <HStack spacing={2} fixedSize={{ horizontal: true, vertical: false }}>
              <Image
                systemName="heart"
                font="caption2"
                foregroundStyle="secondaryLabel"
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


// Two explicit-width columns keep image geometry stable before decoding.
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
      frame={{ height: 44, maxWidth: "infinity" }}
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
  cacheIllusts(props.items)
  const [leading, trailing] = useMemo(
    () => distributeFlowItems(props.items),
    [props.items]
  )
  const lastItem = props.items[props.items.length - 1]
  const lastId = lastItem ? lastItem.id : null
  const triggerAnchor = lastId != null ? String(lastId) : ""

  const columnViews = useMemo(
    () => {
      const renderItem = ({ illust, index }: IllustFlowItem) => (
        <IllustCard
          key={illust.id}
          illust={illust}
          flow={true}
          priority={index}
          cornerBadge={props.cornerBadgeOf?.(illust, index)}
          footerText={props.footerTextOf?.(illust, index)}
          topTrailingAction={props.topTrailingActionOf?.(illust, index)}
        />
      )
      const triggerView = props.hasMore && triggerAnchor ? (
        <VStack
          key={`trigger:${triggerAnchor}`}
          frame={{ width: FLOW_CARD_WIDTH, height: 1 }}
          onAppear={() => props.onLoadMore(triggerAnchor)}
        />
      ) : null
      return [
        <LazyVStack
          key="leading"
          alignment="leading"
          spacing={FLOW_ROW_SPACING}
          frame={{ width: FLOW_CARD_WIDTH }}
        >
          {leading.map(renderItem)}
          {triggerView}
        </LazyVStack>,
        <LazyVStack
          key="trailing"
          alignment="leading"
          spacing={FLOW_ROW_SPACING}
          frame={{ width: FLOW_CARD_WIDTH }}
        >
          {trailing.map(renderItem)}
          {triggerView}
        </LazyVStack>,
      ]
    },
    [
      leading,
      trailing,
      triggerAnchor,
      props.hasMore,
      props.onLoadMore,
      props.cornerBadgeOf,
      props.footerTextOf,
      props.topTrailingActionOf,
    ]
  )

  return (
    <VStack spacing={10} frame={{ maxWidth: "infinity" }}>
      <HStack
        alignment="top"
        spacing={FLOW_COLUMN_SPACING}
        padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
        frame={{ width: Device.screen.width }}
      >
        {columnViews}
      </HStack>
      {props.hasMore ? (
        <VStack
          key="flow-footer"
          spacing={0}
          frame={{ height: 44, maxWidth: "infinity" }}
        >
          {props.isLoading ? (
            <HStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
              <Spacer />
              <ProgressView progressViewStyle="circular" />
              <Spacer />
            </HStack>
          ) : null}
        </VStack>
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
    const rawRatio = illust.width > 0 && illust.height > 0
      ? illust.width / illust.height
      : 0.75
    const ratio = Math.min(Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO), MAX_FLOW_IMAGE_RATIO)
    const imageHeight = FLOW_CARD_WIDTH / ratio
    const textHeight = 62
    const footerHeight = 10
    const column = heights[0] <= heights[1] ? 0 : 1
    columns[column].push({ illust, index })
    heights[column] += imageHeight + textHeight + footerHeight
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
  const [showCustomTagInput, setShowCustomTagInput] = useState(false)
  const [inputSeq, setInputSeq] = useState(0)
  const [restrict, setRestrict] = useState<"public" | "private">("public")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [interactive, setInteractive] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setInteractive(true)
    }, 400)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadDetail() {
      setCustomTag("")
      setShowCustomTagInput(false)
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
    if (!interactive) return
    setSelectedTags((current) =>
      current.includes(name)
        ? current.filter((tag) => tag !== name)
        : current.length >= 10
          ? current
          : [...current, name]
    )
  }

  function openCustomTagInput() {
    if (!interactive) return
    withAnimation(() => {
      setShowCustomTagInput(true)
      setInputSeq(Date.now())
    })
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
    withAnimation(() => {
      setShowCustomTagInput(false)
    })
  }

  function close() {
    setCustomTag("")
    setShowCustomTagInput(false)
    props.onClose()
  }

  async function save() {
    if (saving) return
    void Haptics.transient()
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
    <NavigationStack
      presentationDetents={[0.65, "large"]}
      presentationDragIndicator="visible"
    >
      <VStack
        alignment="leading"
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        toolbar={{
          topBarLeading: (
            <Button
              action={close}
            >
              <Image systemName="xmark" />
            </Button>
          ),
          topBarTrailing: (
            <Button
              disabled={saving || loading}
              action={() => void save()}
            >
              <Image
                systemName={props.bookmarked ? "heart.fill" : "heart"}
                foregroundStyle={props.bookmarked && !saving ? "#FF375F" : undefined}
              />
            </Button>
          ),
        }}
      >
        {error ? (
          <Text
            font="footnote"
            foregroundStyle="systemRed"
            padding={{ horizontal: 16, top: 4, bottom: 6 }}
          >
            {error}
          </Text>
        ) : null}

        {/* 中间主体内容区 */}
        {loading ? (
          <LoadingView />
        ) : (
          <ScrollView
            frame={{ maxWidth: "infinity" }}
            presentationContentInteraction="scrolls"
          >
            <VStack
              alignment="leading"
              spacing={14}
              padding={{ horizontal: 16, vertical: 8 }}
              frame={{ maxWidth: "infinity" }}
            >
              {/* 私密收藏设置卡片 */}
              <HStack
                spacing={10}
                alignment="center"
                padding={{ horizontal: 12, vertical: 10 }}
                glassEffect={{ type: "rect", cornerRadius: 14 }}
                frame={{ maxWidth: "infinity" }}
              >
                <Image
                  systemName={restrict === "private" ? "lock.fill" : "lock.open"}
                  font="body"
                  foregroundStyle={restrict === "private" ? "#FF9500" : "secondaryLabel"}
                />
                <VStack alignment="leading" spacing={2}>
                  <Text font="subheadline" fontWeight="medium">
                    私密收藏
                  </Text>
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {restrict === "private" ? "仅自己可见，不公开展示" : "公开展示在个人主页收藏列表"}
                  </Text>
                </VStack>
                <Spacer />
                <Toggle
                  title=""
                  value={restrict === "private"}
                  onChanged={(value) => setRestrict(value ? "private" : "public")}
                />
              </HStack>

              {/* 标签选择区 */}
              <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
                <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Text font="subheadline" fontWeight="semibold">
                    选择标签
                  </Text>
                  <Spacer />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {selectedTags.length} / 10
                  </Text>
                </HStack>

                <FlowLayout spacing={8}>
                  {availableTags.map((tag) => {
                    const selected = selectedTags.includes(tag.name)
                    return (
                      <Button
                        key={tag.name}
                        title={`${selected ? "✓ " : ""}#${tag.name}`}
                        buttonStyle={selected ? "glassProminent" : "glass"}
                        tint={selected ? "#0096FA" : undefined}
                        controlSize="small"
                        action={() => toggleTag(tag.name)}
                      />
                    )
                  })}
                  <Button
                    title="自定义标签"
                    systemImage="plus"
                    buttonStyle="glass"
                    tint="#0096FA"
                    controlSize="small"
                    disabled={selectedTags.length >= 10}
                    action={openCustomTagInput}
                  />
                </FlowLayout>
              </VStack>
            </VStack>
          </ScrollView>
        )}

        {/* 底部自定义标签输入条（点击自定义标签后弹出） */}
        {showCustomTagInput ? (
          <HStack
            spacing={8}
            alignment="center"
            padding={{ horizontal: 16, top: 8, bottom: 20 }}
            glassEffectTransition="materialize"
            transition={Transition.move("bottom").combined(Transition.opacity())}
            frame={{ maxWidth: "infinity" }}
          >
            <TextField
              key={`custom-tag-${inputSeq}`}
              title="自定义标签"
              prompt="输入自定义标签名称…"
              value={customTag}
              onChanged={setCustomTag}
              onSubmit={addCustomTag}
              submitLabel="done"
              autofocus={true}
              frame={{ maxWidth: "infinity" }}
            />
            <Button
              buttonStyle="glassProminent"
              tint="#0096FA"
              disabled={!customTag.trim() || selectedTags.length >= 10}
              action={addCustomTag}
            >
              <Image systemName="plus" font="body" />
            </Button>
          </HStack>
        ) : null}
      </VStack>
    </NavigationStack>
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
        action={() => {
          void Haptics.transient()
          props.onTap()
        }}
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
const VISION_IMAGE_WIDTH = Device.screen.width - 28

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
            frame={{ width: VISION_IMAGE_WIDTH, height: VISION_IMAGE_WIDTH / VISION_IMAGE_RATIO }}
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
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  hearts: "♥",
}

export function decodeHtmlEntities(text: string): string {
  if (!text || !text.includes("&")) return text || ""
  return text
    // 1. 十六进制数字实体 &#x2C; / &#X2c;
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (match, hex) => {
      const code = parseInt(hex, 16)
      if (!isNaN(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return match
    })
    // 2. 十进制数字实体 &#44; / &#39; / &#12304; 等
    .replace(/&#(\d+);/g, (match, num) => {
      const code = parseInt(num, 10)
      if (!isNaN(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return match
    })
    // 3. 命名实体 &amp; / &quot; 等
    .replace(/&([a-zA-Z]+);/g, (match, name) => {
      return HTML_ENTITIES[name.toLowerCase()] ?? match
    })
}

// HTML 转纯文本：Pixiv 的简介/用户简介字段是 HTML（<br>、<a> 等），
// 清洗后以纯文本展示（与 Hanairo 的 TextSanitizer 行为一致）。
// 顺序：先剥离标签，后完整解码 HTML 实体（含十进制 &#44; 与十六进制实体）
export function htmlToPlainText(html: string | undefined | null): string {
  return htmlFragmentToPlainText(html).trim()
}

function htmlFragmentToPlainText(html: string | undefined | null): string {
  if (!html) return ""
  const stripped = html
    .replace(/\r\n|\r/g, "\n")
    .replace(/<(?:\s*\/?\s*)br(?:\s*\/?\s*|\s+[^>]*)>(?:\r?\n)?/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // 清理换行后遗留的孤立残存斜杠（如由 <br /> 误残存的 \n/ Mail ）
    .replace(
      /\n\s*\/\s*(?=[A-Za-z0-9\u4e00-\u9fa5\uac00-\ud7af\u3040-\u30ff])/g,
      "\n"
    )
  return decodeHtmlEntities(stripped)
}

export function LinkedDescription(props: {
  html: string
  routeDestination?: (route: string) => any
  nativePlainText?: boolean
  foregroundStyle?: any
  lineLimit?: number
  font?: any
}) {
  const segments = useMemo(() => descriptionSegments(props.html), [props.html])

  const styledText = useMemo<StyledText>(() => {
    const items: (string | StyledText)[] = []

    for (const segment of segments) {
      const target =
        routeForDescriptionLink(segment.href) ??
        routeForDescriptionLink(segment.label)

      if (target) {
        if (target.startsWith("http")) {
          items.push({
            content: segment.label,
            foregroundColor: "#007AFF",
            underlineStyle: "single",
            onTapGesture: () => {
              void presentExternalURL(target)
            },
          })
        } else {
          items.push({
            content: segment.label,
            foregroundColor: "#007AFF",
            underlineStyle: "single",
            onTapGesture: () => {
              requestPixivRoute(target)
            },
          })
        }
      } else {
        items.push(segment.label)
      }
    }

    return {
      font: props.font ?? "footnote",
      foregroundColor: props.foregroundStyle,
      paragraphStyle: {
        lineBreakMode: "byCharWrapping",
        lineSpacing: 4,
      },
      content: items,
    }
  }, [segments, props.routeDestination, props.foregroundStyle, props.font])

  return (
    <Text
      styledText={styledText}
      textSelection={true}
      lineLimit={props.lineLimit}
      multilineTextAlignment="leading"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    />
  )
}

export function presentExternalURL(url: string): Promise<void> {
  return Safari.present(url, false)
}

type DescriptionSegment = { label: string; href: string }

function descriptionSegments(html: string): DescriptionSegment[] {
  const prepared = html
    .replace(/\r\n|\r/g, "\n")
    .replace(/<(?:\s*\/?\s*)br(?:\s*\/?\s*|\s+[^>]*)>(?:\r?\n)?/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
    .replace(
      /\n\s*\/\s*(?=[A-Za-z0-9\u4e00-\u9fa5\uac00-\ud7af\u3040-\u30ff])/g,
      "\n"
    )
  const segments: DescriptionSegment[] = []
  const anchorPatten = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = anchorPatten.exec(prepared)) != null) {
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
    if (!line) continue
    appendInlineDescriptionSegments(segments, line)
  }
}

function appendInlineDescriptionSegments(
  segments: DescriptionSegment[],
  text: string
) {
  const urlChar = "[a-zA-Z0-9\\-._~:/?#\\[\\]@!$&'()*+,;%=]"
  const patten = new RegExp(
    "(?:https?:\\/\\/|www\\.)" + urlChar + "+|" +
    "(?:https?:\\/\\/)?(?:www\\.)?pixiv\\.net\\/(?:users?|user|artworks|novels?|novel|manga|illusts?|illust)" + urlChar + "*|" +
    "\\/?(?:users?|user|artworks|novels?|novel|manga|illusts?|illust)\\/" + urlChar + "+|" +
    "(?:pixiv\\.net\\/|\\/)?novel\\/show\\.php\\?id=\\d+|" +
    "\\b(?:uid|pid|nid)\\s*[:：#=]?\\s*\\d+\\b|" +
    "pixiv:\\/\\/" + urlChar + "+",
    "gi"
  )
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = patten.exec(text)) != null) {
    appendPlainDescriptionSegment(segments, text.slice(cursor, match.index))
    const raw = match[0]
    const link = raw.replace(/[),.，。！!？?;；]+$/, "")
    if (link) segments.push({ label: link, href: link })
    if (raw.length > link.length) {
      appendPlainDescriptionSegment(segments, raw.slice(link.length))
    }
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

  // 1. pixiv:// custom scheme
  const embeddedSeries = decoded.match(
    /^pixiv:\/\/(?:novel\/series|novels\/series|manga\/series|illust\/series|illusts\/series)\/(\d+)$/i
  )
  if (embeddedSeries) {
    if (/novel/i.test(embeddedSeries[0])) return `novelSeries:${embeddedSeries[1]}`
    return `mangaSeries:${embeddedSeries[1]}`
  }

  const embeddedItem = decoded.match(/^pixiv:\/\/(users?|user|artworks|novels?|novel|illusts?|illust)\/(\d+)$/i)
  if (embeddedItem) {
    if (/^user/i.test(embeddedItem[1])) return `user:${embeddedItem[2]}`
    if (/^novel/i.test(embeddedItem[1])) return `novel:${embeddedItem[2]}`
    return `illust:${embeddedItem[2]}`
  }

  const hasURLScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(decoded)
  const isPixivURL = /^(?:https?:\/\/)?(?:www\.)?pixiv\.net(?:\/|$)/i.test(decoded)

  // 2. novel series / manga series: pixiv.net/novel/series/123 or pixiv.net/user/123/series/456 or pixiv.net/manga/series/123
  const novelSeriesMatch = decoded.match(
    /(?:https?:\/\/(?:www\.)?pixiv\.net)?\/(?:en\/)?novel\/series\/(\d+)(?:[/?#].*)?$/i
  )
  if (novelSeriesMatch && (!hasURLScheme || isPixivURL)) {
    const id = Number(novelSeriesMatch[1])
    if (Number.isFinite(id) && id > 0) return `novelSeries:${id}`
  }

  const mangaSeriesMatch = decoded.match(
    /(?:https?:\/\/(?:www\.)?pixiv\.net)?\/(?:en\/)?(?:users?|user)\/\d+\/series\/(\d+)(?:[/?#].*)?$/i
  ) ?? decoded.match(
    /(?:https?:\/\/(?:www\.)?pixiv\.net)?\/(?:en\/)?(?:manga|illust|illusts)\/series\/(\d+)(?:[/?#].*)?$/i
  )
  if (mangaSeriesMatch && (!hasURLScheme || isPixivURL)) {
    const id = Number(mangaSeriesMatch[1])
    if (Number.isFinite(id) && id > 0) return `mangaSeries:${id}`
  }

  // 3. user / novel / illust: pixiv.net/users/123, pixiv.net/artworks/123, pixiv.net/novel/123
  const pathMatch = decoded.match(
    /(?:https?:\/\/(?:www\.)?pixiv\.net)?\/(?:en\/)?(users?|user|artworks|novels?|novel|illusts?|illust)\/(\d+)(?:[/?#].*)?$/i
  )
  if (pathMatch && (!hasURLScheme || isPixivURL)) {
    const id = Number(pathMatch[2])
    if (Number.isFinite(id) && id > 0) {
      if (/^user/i.test(pathMatch[1])) return `user:${id}`
      if (/^novel/i.test(pathMatch[1])) return `novel:${id}`
      return `illust:${id}`
    }
  }

  // 4. legacy novel show: pixiv.net/novel/show.php?id=123
  const novelShow = decoded.match(
    /^(?:https?:\/\/)?(?:www\.)?pixiv\.net\/(?:en\/)?novel\/show\.php\?[^#]*\bid=(\d+)/i
  ) ?? decoded.match(
    /^\/?(?:en\/)?novel\/show\.php\?[^#]*\bid=(\d+)/i
  )
  if (novelShow) {
    const id = Number(novelShow[1])
    if (Number.isFinite(id) && id > 0) return `novel:${id}`
  }

  // 5. uid: 123, pid: 123, nid: 123
  const idReference = decoded.match(/^(?:uid|pid|nid)\s*[:：#=]?\s*(\d+)$/i)
  if (idReference) {
    const kind = idReference[1].toLowerCase()
    const id = idReference[2]
    if (kind === "uid") return `user:${id}`
    if (kind === "nid") return `novel:${id}`
    return `illust:${id}`
  }

  // 6. Extenal http / www links
  if (/^www\./i.test(decoded)) return `https://${decoded}`
  if (/^https?:\/\//i.test(decoded)) return decoded

  return null
}

function decodeDescriptionLink(value: string): string {
  return decodeHtmlEntities(value)
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

// 作品标签徽章（详情页可用紧凑尺寸降低高密度标签区的视觉重量）
export function TagChip(props: {
  name: string
  tagName?: string
  translatedName?: string
  value: string
  compact?: boolean
}) {
  const { name, tagName = name, translatedName, value, compact = false } = props
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
      <HStack spacing={3} alignment="center">
        <Text
          font={compact ? "caption2" : "caption"}
          foregroundStyle="#0096FA"
          fontWeight="semibold"
        >
          #
        </Text>
        <Text font={compact ? "caption" : "body"} lineLimit={1}>
          {name}
        </Text>
        {translatedName ? (
          <Text
            font={compact ? "caption2" : "caption"}
            foregroundStyle="secondaryLabel"
            lineLimit={1}
          >
            {translatedName}
          </Text>
        ) : null}
      </HStack>
    </NavigationLink>
  )
}

// 全局加载视图：居中圆形指示器，只留下加载转圈动画。
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

// 沉浸式顶部封面横幅（支持自然等比/自适应占位，提供底边悬浮锚定）
export function ImmersiveHeaderBanner(props: {
  url?: string | null
  previewUrl?: string | null
  aspectRatioValue?: number
  placeholderHeight?: number
  children?: any
}) {
  const { url, previewUrl, aspectRatioValue = 2.4, placeholderHeight = 160, children } = props
  return (
    <ZStack alignment="bottom" frame={{ maxWidth: "infinity" }}>
      {url || previewUrl ? (
        <CachedImage
          url={url ?? null}
          previewUrl={previewUrl ?? null}
          useIntrinsicAspectRatio={true}
          aspectRatioValue={aspectRatioValue}
          contentMode="fill"
          cornerRadius={0}
          priority={0}
          frame={{ maxWidth: "infinity" }}
        />
      ) : (
        <VStack
          frame={{ maxWidth: "infinity", height: placeholderHeight }}
          background={{
            colors: ["rgba(0, 150, 250, 0.18)", "rgba(0, 150, 250, 0.04)"],
            startPoint: "topLeading",
            endPoint: "bottomTrailing",
          }}
        />
      )}
      {children}
    </ZStack>
  )
}

// 可折叠展开的富文本简介卡片（多行超过 5 行或 220 字时显示展开/收起）
export function ExpandableIntroduction(props: {
  commentHtml?: string
  rawComment?: string
  caption?: string
  title?: string
  routeDestination: (route: string) => any
}) {
  const { commentHtml, rawComment, caption, title, routeDestination } = props
  const rawHtmlOrText = caption ?? commentHtml ?? rawComment ?? ""
  const [expanded, setExpanded] = useState(false)
  const plainText = useMemo(
    () => htmlToPlainText(rawComment || caption || commentHtml || "").trim(),
    [rawComment, caption, commentHtml]
  )

  const lines = useMemo(() => plainText.split(/\r?\n/), [plainText])
  const exceedsFiveLines = lines.length > 5 || plainText.length > 220

  if (!plainText) return null

  return (
    <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
      {title ? (
        <Text
          font="subheadline"
          fontWeight="semibold"
          foregroundStyle="secondaryLabel"
        >
          {title}
        </Text>
      ) : null}
      <VStack
        alignment="leading"
        spacing={8}
        padding={{ top: 12, horizontal: 12, bottom: exceedsFiveLines ? 10 : 12 }}
        glassEffect={{ type: "rect", cornerRadius: 14 }}
        frame={{ maxWidth: "infinity" }}
        contentShape="rect"
        onTapGesture={
          exceedsFiveLines
            ? () => {
                setExpanded((prev) => !prev)
              }
            : undefined
        }
      >
        <LinkedDescription
          html={rawHtmlOrText}
          routeDestination={routeDestination}
          lineLimit={!expanded && exceedsFiveLines ? 5 : undefined}
        />

        {exceedsFiveLines ? (
          <HStack
            alignment="center"
            spacing={4}
            frame={{ maxWidth: "infinity", alignment: "center" }}
            padding={{ top: 4, bottom: 2 }}
          >
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {expanded ? "点击收起" : "点击展开全文"}
            </Text>
            <Image
              systemName={expanded ? "chevron.up" : "chevron.down"}
              font="caption2"
              foregroundStyle="secondaryLabel"
            />
          </HStack>
        ) : null}
      </VStack>
    </VStack>
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
