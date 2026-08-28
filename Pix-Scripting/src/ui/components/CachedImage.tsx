import {
  HStack,
  Image,
  ProgressView,
  Text,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type StyledText,
} from "scripting"
import {
  cachedFilePath,
  imageCacheRevision,
  loadImage,
  onImageCacheChanged,
} from "../../image/imageLoader"
import { loadSettings } from "../../store/settings"
import { useLatest } from "../hooks"
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
  cornerRadius?: number | {
    topLeading?: number
    topTrailing?: number
    bottomLeading?: number
    bottomTrailing?: number
  }
  contentMode?: "fit" | "fill"
  centerCropSquare?: boolean
  centerCropAspect?: number
  useIntrinsicAspectRatio?: boolean
  disableFadeIn?: boolean
  frame?: any // 覆盖默认整宽 frame（如固定尺寸缩略图）
  onLoaded?: (success: boolean) => void
  priority?: number
  onTapGesture?: (() => void) | { count: number; perform: () => void }
}) {
  const {
    url,
    previewUrl,
    blurPreviewRadius = 8,
    aspectRatioValue,
    cornerRadius = 10,
    contentMode = "fill",
    centerCropSquare = false,
    centerCropAspect,
    useIntrinsicAspectRatio = false,
    disableFadeIn = false,
    frame,
    onLoaded,
    priority,
    onTapGesture,
  } = props
  const { path, isTargetLoaded, failed, cacheRevision } = useCachedImage(url, onLoaded, priority)
  const initialHitRef = useRef<boolean>(Boolean(url && cachedFilePath(url)))
  const lastUrlRef = useRef<string | null>(url)
  if (lastUrlRef.current !== url) {
    lastUrlRef.current = url
    initialHitRef.current = Boolean(url && cachedFilePath(url))
  }

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
    const thumbPriority = Math.min(-1000, (priority ?? 0) - 1000)
    loadImage(previewUrl, thumbPriority)
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

  // 追踪上一张已成功展示的图片路径（用于画质升级/切换时的平滑垫底直切消融）
  const previousLoadedPathRef = useRef<string | null>(null)
  useEffect(() => {
    if (isTargetLoaded && path) {
      previousLoadedPathRef.current = path
    }
  }, [isTargetLoaded, path])

  // 过渡动画状态管理：
  // 1. 首帧命中或显式禁用淡入时，直接标记为已完成，不挂载任何 Transition 修饰符；
  // 2. 异步大图下载并就绪时启动过渡，在消融/淡入动画结束（duration + 50ms 缓冲）后标记完成并剥离 Transition，
  //    彻底杜绝后续父组件状态变化（如 mediaReady、ambientPalette、收藏操作、滚动）二次触发 Transition 导致消融后闪屏。
  const [transitionCompleted, setTransitionCompleted] = useState(
    () => initialHitRef.current || disableFadeIn
  )

  useEffect(() => {
    if (initialHitRef.current || disableFadeIn) {
      setTransitionCompleted(true)
      return
    }
    setTransitionCompleted(false)
  }, [url, disableFadeIn])

  const fadeDuration = imageFadeDurationSec()
  const crossFadeDuration = blurCrossFadeDurationSec()

  const underlayPath = (
    !transitionCompleted &&
    previousLoadedPathRef.current &&
    previousLoadedPathRef.current !== path
  ) ? previousLoadedPathRef.current : null

  const showBlurPreview = Boolean(
    !underlayPath &&
    !transitionCompleted &&
    !initialHitRef.current &&
    previewPath &&
    previewPath !== path
  )

  useEffect(() => {
    if (transitionCompleted || !isTargetLoaded) return
    if (initialHitRef.current || disableFadeIn) {
      setTransitionCompleted(true)
      return
    }
    const durationMs = (showBlurPreview || underlayPath ? crossFadeDuration : fadeDuration) * 1000
    const timer = setTimeout(() => {
      setTransitionCompleted(true)
    }, Math.max(50, durationMs + 50))
    return () => clearTimeout(timer)
  }, [isTargetLoaded, showBlurPreview, underlayPath, crossFadeDuration, fadeDuration, transitionCompleted, disableFadeIn])

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

  const underlayCroppedImage = useMemo(() => {
    if (!underlayPath) return null
    if (centerCropSquare) {
      try {
        const image = UIImage.fromFile(underlayPath)
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
        const image = UIImage.fromFile(underlayPath)
        if (!image || image.width <= 0 || image.height <= 0) return null
        const currentAspect = image.width / image.height
        if (Math.abs(currentAspect - centerCropAspect) > 0.01) {
          if (currentAspect > centerCropAspect) {
            const targetWidth = image.height * centerCropAspect
            return image.croppedTo({
              x: (image.width - targetWidth) / 2,
              y: 0,
              width: targetWidth,
              height: image.height,
            })
          } else {
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
  }, [underlayPath, centerCropSquare, centerCropAspect])

  // 优先使用已就绪的图片文件（高清大图优先，缩略图即时兜底）提取真实物理宽高比，
  // 确保多页作品各页在缩略图就绪的瞬间即可提前校准为真实比例，彻底消除大图下载完成时的二次外框尺寸跳变（Zero Layout Shift）：
  const activeMeasurePath = path ?? previewPath
  const intrinsicAspect = useMemo(() => {
    if (!activeMeasurePath || !useIntrinsicAspectRatio) return null
    try {
      const image = UIImage.fromFile(activeMeasurePath)
      if (image && image.width > 0 && image.height > 0) {
        return image.width / image.height
      }
    } catch {
      return null
    }
    return null
  }, [activeMeasurePath, useIntrinsicAspectRatio])

  // 当传入了有效且明确的 aspectRatioValue 且与图片真实比例差异极小（< 2% 浮点/整数缩放舍入误差）时，
  // 保持 aspectRatioValue，防止大图解码完成瞬间由于微小亚像素差异触发外层容器二次重新排版（Layout Shift）；
  // 仅在未指定比例或真实比例与占位比例存在显著差异（如多页漫画不同横竖跨页）时采用真实比例。
  const stableAspect = useMemo(() => {
    if (intrinsicAspect == null) return aspectRatioValue ?? 1
    if (aspectRatioValue != null && aspectRatioValue > 0 && Math.abs(intrinsicAspect - aspectRatioValue) / aspectRatioValue < 0.02) {
      return aspectRatioValue
    }
    return intrinsicAspect
  }, [intrinsicAspect, aspectRatioValue])

  const effectiveRatio = croppedImage
    ? (centerCropAspect ?? 1)
    : (stableAspect ?? aspectRatioValue ?? 1)
  const containerFrame = frame ?? { maxWidth: "infinity" }

  const resolvedClipShape = useMemo(() => {
    if (typeof cornerRadius === "object" && cornerRadius != null) {
      return {
        type: "rect" as const,
        cornerRadii: cornerRadius,
      }
    }
    return {
      type: "rect" as const,
      cornerRadius: typeof cornerRadius === "number" ? cornerRadius : 10,
    }
  }, [cornerRadius])

  // 首帧已命中缓存或过渡已完成时直接硬切呈现（0ms 动画），秒开无延时无白闪；
  // 异步加载完成后：
  // 1. 有旧图垫底或本地模糊预览图垫底时，采用配置的模糊消融（0-250ms，默认 150ms），平滑过渡；
  // 2. 无本地预览图垫底时（如多页漫画后续页/冷启动），使用标准设置淡入，避免在灰色底色上误触发消融产生灰白闪屏。
  const imageTransition = disableFadeIn || initialHitRef.current || transitionCompleted
    ? undefined
    : (showBlurPreview || underlayPath)
      ? (crossFadeDuration > 0 ? Transition.fade(crossFadeDuration) : undefined)
      : (fadeDuration > 0 ? Transition.fade(fadeDuration) : undefined)

  return (
    <ZStack
      aspectRatio={{ value: effectiveRatio, contentMode: contentMode }}
      clipShape={resolvedClipShape}
      clipped={true}
      frame={containerFrame}
      onTapGesture={onTapGesture}
    >
      {/* 1. 底层骨架占位色块（仅在无图或加载失败时展示占位底色，图片就绪后透明，杜绝亚像素边缘露白） */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background={(!path && !previewPath && !underlayPath) || failed ? "tertiarySystemFill" : undefined}
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

      {/* 2. 底层垫底（旧图平滑垫底直切消融，或缩略图预模糊位图垫底） */}
      {underlayPath ? (
        underlayCroppedImage ? (
          <Image
            key={`underlay-${underlayPath}`}
            image={underlayCroppedImage}
            resizable={true}
            aspectRatio={{ value: effectiveRatio, contentMode: contentMode }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        ) : (
          <Image
            key={`underlay-${underlayPath}`}
            filePath={underlayPath}
            resizable={true}
            aspectRatio={{ value: effectiveRatio, contentMode: contentMode }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        )
      ) : showBlurPreview && previewBlurredImage ? (
        <Image
          image={previewBlurredImage}
          resizable={true}
          aspectRatio={{ value: effectiveRatio, contentMode: contentMode }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        />
      ) : null}

      {/* 3. 高清图片层：叠在垫底层之上，平滑消融呈现 */}
      {path ? (
        croppedImage ? (
          <Image
            key={path}
            image={croppedImage}
            resizable={true}
            aspectRatio={{ value: effectiveRatio, contentMode: contentMode }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            transition={imageTransition}
          />
        ) : (
          <Image
            key={path}
            filePath={path}
            resizable={true}
            aspectRatio={{ value: effectiveRatio, contentMode: contentMode }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            transition={imageTransition}
          />
        )
      ) : null}
    </ZStack>
  )
}


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
export function ImageNumberBadge(props: { number: number; foregroundStyle?: any; font?: any }) {
  return (
    <Text
      font={props.font ?? "body"}
      fontWeight="bold"
      foregroundStyle={props.foregroundStyle ?? "primaryLabel"}
      offset={{ x: 4, y: 4 }}
    >
      #{props.number}
    </Text>
  )
}


export function PageCountBadge(props: { count: number }) {
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


