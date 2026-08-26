import {
  Button,
  HStack,
  Image,
  Menu,
  Navigation,
  NavigationStack,
  ProgressView,
  TabView,
  Text,
  TapGesture,
  MagnifyGesture,
  DragGesture,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"
import {
  cachedFilePath,
  imageUrlOf,
  loadImage,
  pageThumbUrlOf,
  prefetch,
} from "../image/imageLoader"
import {
  downloadIllustToAlbum,
  fetchImageBinaryWithRetry,
  saveImageToPixivAlbum,
} from "../downloader"
import {
  getDetailImageQuality,
  getDownloadImageQuality,
} from "../store/settings"
import type { PixivIllustration } from "../types"

interface IllustGalleryPageProps {
  illust: PixivIllustration
  pageIndex: number
  isActive: boolean
  isSinglePage: boolean
  onToggleControls: () => void
  onDismiss: () => void
  onZoomChange?: (isZoomed: boolean) => void
  onDismissDrag?: (offsetY: number, scale: number, opacity: number) => void
  onDismissDragEnd?: (shouldDismiss: boolean) => void
}

function IllustGalleryPage(props: IllustGalleryPageProps) {
  const {
    illust,
    pageIndex,
    isActive,
    isSinglePage,
    onToggleControls,
    onZoomChange,
    onDismissDrag,
    onDismissDragEnd,
  } = props

  const isDefaultOriginal = useMemo(() => {
    return getDetailImageQuality() === "original"
  }, [])

  const largeUrl = useMemo(() => imageUrlOf(illust, pageIndex, "large"), [illust, pageIndex])
  const originalUrl = useMemo(() => imageUrlOf(illust, pageIndex, "original"), [illust, pageIndex])
  const thumbUrl = useMemo(() => pageThumbUrlOf(illust, pageIndex), [illust, pageIndex])

  const initialOriginalPath = useMemo(() => (originalUrl ? cachedFilePath(originalUrl) : null), [originalUrl])
  const initialLargePath = useMemo(() => (largeUrl ? cachedFilePath(largeUrl) : null), [largeUrl])
  const initialThumbPath = useMemo(() => (thumbUrl ? cachedFilePath(thumbUrl) : null), [thumbUrl])

  const [requestedOriginal, setRequestedOriginal] = useState(isDefaultOriginal)
  const [largePath, setLargePath] = useState<string | null>(initialLargePath)
  const [originalPath, setOriginalPath] = useState<string | null>(initialOriginalPath)
  const [thumbPath, setThumbPath] = useState<string | null>(initialThumbPath)

  const [scale, setScale] = useState(1.0)
  const [baseScale, setBaseScale] = useState(1.0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [baseOffset, setBaseOffset] = useState({ x: 0, y: 0 })
  const [isZoomed, setIsZoomed] = useState(false)

  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const baseScaleRef = useRef(baseScale)
  baseScaleRef.current = baseScale
  const offsetRef = useRef(offset)
  offsetRef.current = offset
  const baseOffsetRef = useRef(baseOffset)
  baseOffsetRef.current = baseOffset

  // 1. 缩略图加载（优先级极高，毫秒级就绪）
  useEffect(() => {
    if (thumbPath || !thumbUrl) return
    let active = true
    loadImage(thumbUrl, -6000)
      .then((p) => {
        if (active && p) setThumbPath(p)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [thumbUrl, thumbPath])

  // 2. 高清大图加载（后台稳定下载，不随切页中断）
  useEffect(() => {
    if (largePath || !largeUrl) return
    let active = true
    loadImage(largeUrl, -5000)
      .then((p) => {
        if (active && p) setLargePath(p)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [largeUrl, largePath])

  // 3. 原图加载（用户放大或默认设置原图时触发）
  useEffect(() => {
    if (!requestedOriginal || originalPath || !originalUrl) return
    let active = true
    loadImage(originalUrl, -6000)
      .then((p) => {
        if (active && p) setOriginalPath(p)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [requestedOriginal, originalUrl, originalPath])

  // 当切换到其他页面时，仅在当前页处于缩放状态时复位缩放与位移
  useEffect(() => {
    if (!isActive) {
      if (scaleRef.current !== 1.0 || offsetRef.current.x !== 0 || offsetRef.current.y !== 0 || isZoomed) {
        setScale(1.0)
        setBaseScale(1.0)
        setOffset({ x: 0, y: 0 })
        setBaseOffset({ x: 0, y: 0 })
        scaleRef.current = 1.0
        baseScaleRef.current = 1.0
        offsetRef.current = { x: 0, y: 0 }
        baseOffsetRef.current = { x: 0, y: 0 }
        setIsZoomed(false)
        onZoomChange?.(false)
      }
    }
  }, [isActive, isZoomed, onZoomChange])

  // 双击手势：1.0x 与 2.5x 互切
  const handleDoubleTap = useCallback(() => {
    if (scaleRef.current > 1.05 || isZoomed) {
      setScale(1.0)
      setBaseScale(1.0)
      setOffset({ x: 0, y: 0 })
      setBaseOffset({ x: 0, y: 0 })
      scaleRef.current = 1.0
      baseScaleRef.current = 1.0
      offsetRef.current = { x: 0, y: 0 }
      baseOffsetRef.current = { x: 0, y: 0 }
      setIsZoomed(false)
      onZoomChange?.(false)
    } else {
      setScale(2.5)
      setBaseScale(2.5)
      setOffset({ x: 0, y: 0 })
      setBaseOffset({ x: 0, y: 0 })
      scaleRef.current = 2.5
      baseScaleRef.current = 2.5
      offsetRef.current = { x: 0, y: 0 }
      baseOffsetRef.current = { x: 0, y: 0 }
      setIsZoomed(true)
      onZoomChange?.(true)
      setRequestedOriginal(true)
    }
  }, [isZoomed, onZoomChange])

  // 双指捏合缩放：在捏合过程中仅做纯粹视觉变换，状态提交延后至松手结束，避免中途重建手势引发卡顿
  const magnifyGesture = useMemo(() => {
    return MagnifyGesture(0.01)
      .onChanged((v) => {
        const nextScale = Math.max(0.75, Math.min(6.0, baseScaleRef.current * v.magnification))
        scaleRef.current = nextScale
        setScale(nextScale)
      })
      .onEnded(() => {
        const current = scaleRef.current
        if (current <= 1.05) {
          setScale(1.0)
          setBaseScale(1.0)
          setOffset({ x: 0, y: 0 })
          setBaseOffset({ x: 0, y: 0 })
          scaleRef.current = 1.0
          baseScaleRef.current = 1.0
          offsetRef.current = { x: 0, y: 0 }
          baseOffsetRef.current = { x: 0, y: 0 }
          setIsZoomed(false)
          onZoomChange?.(false)
        } else if (current > 5.0) {
          setScale(5.0)
          setBaseScale(5.0)
          scaleRef.current = 5.0
          baseScaleRef.current = 5.0
          setIsZoomed(true)
          onZoomChange?.(true)
          setRequestedOriginal(true)
        } else {
          setBaseScale(current)
          baseScaleRef.current = current
          setIsZoomed(true)
          onZoomChange?.(true)
          setRequestedOriginal(true)
        }
      })
  }, [onZoomChange])

  // 单页拖拽手势：统一由单一手势处理放大时的漫游平移与未放大时的下拉收起，手势挂载恒定不变
  const singlePageDragGesture = useMemo(() => {
    return DragGesture({ minDistance: 4 })
      .onChanged((d) => {
        if (scaleRef.current > 1.05) {
          const nx = baseOffsetRef.current.x + d.translation.width
          const ny = baseOffsetRef.current.y + d.translation.height
          const newPos = { x: nx, y: ny }
          offsetRef.current = newPos
          setOffset(newPos)
        } else if (d.translation.height > 0 && onDismissDrag) {
          const dy = d.translation.height
          const sc = Math.max(0.75, 1 - dy / 1200)
          const op = Math.max(0.15, 1 - dy / 350)
          onDismissDrag(dy, sc, op)
        }
      })
      .onEnded((d) => {
        if (scaleRef.current > 1.05) {
          baseOffsetRef.current = offsetRef.current
          setBaseOffset(offsetRef.current)
        } else if (onDismissDragEnd) {
          if (d.translation.height > 100 || d.velocity.height > 300) {
            onDismissDragEnd(true)
          } else {
            onDismissDragEnd(false)
          }
        }
      })
  }, [onDismissDrag, onDismissDragEnd])

  // 多页放大平移漫游手势
  const multiPagePanGesture = useMemo(() => {
    return DragGesture({ minDistance: 4 })
      .onChanged((d) => {
        if (scaleRef.current > 1.05) {
          const nx = baseOffsetRef.current.x + d.translation.width
          const ny = baseOffsetRef.current.y + d.translation.height
          const newPos = { x: nx, y: ny }
          offsetRef.current = newPos
          setOffset(newPos)
        }
      })
      .onEnded(() => {
        if (scaleRef.current > 1.05) {
          baseOffsetRef.current = offsetRef.current
          setBaseOffset(offsetRef.current)
        }
      })
  }, [])

  const activeGesture = isSinglePage ? singlePageDragGesture : isZoomed ? multiPagePanGesture : undefined

  // 物理纵横比（支持多页中不同页面不同尺寸）
  const detectedAspect = useMemo(() => {
    if (pageIndex === 0 && illust.width && illust.height && illust.width > 0 && illust.height > 0) {
      return illust.width / illust.height
    }
    const checkPath = originalPath ?? largePath ?? thumbPath
    if (checkPath) {
      try {
        const img = UIImage.fromFile(checkPath)
        if (img && img.width > 0 && img.height > 0) {
          return img.width / img.height
        }
      } catch {}
    }
    if (illust.width && illust.height && illust.width > 0 && illust.height > 0) {
      return illust.width / illust.height
    }
    return 0.75
  }, [pageIndex, illust.width, illust.height, originalPath, largePath, thumbPath])

  // 基础底图（大图优先，缩略图次之）
  const baseImagePath = largePath ?? thumbPath

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      {/* 1. 独立图片展示层：纯粹响应 scaleEffect 和 offset，无任何动态手势修饰符，彻底绝缘视图重建闪屏 */}
      <ZStack
        scaleEffect={scale}
        offset={offset}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        {/* 未命中任何图片缓存时的居中轻量加载指示器 */}
        {!baseImagePath && !originalPath && (
          <ProgressView
            controlSize="regular"
            tint="white"
          />
        )}

        {/* 底层垫底图（常驻在场，绝不卸载，杜绝任何 1 帧黑闪/白闪） */}
        {baseImagePath ? (
          <Image
            filePath={baseImagePath}
            resizable={true}
            aspectRatio={{ value: detectedAspect, contentMode: "fit" }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        ) : null}

        {/* 顶层原图（就绪后平滑覆盖于大图之上，锐利纯净） */}
        {originalPath && originalPath !== baseImagePath ? (
          <Image
            filePath={originalPath}
            resizable={true}
            aspectRatio={{ value: detectedAspect, contentMode: "fit" }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        ) : null}
      </ZStack>

      {/* 2. 独立手势交互层：透明全屏覆盖，手势状态切换仅影响自身，彻底隔绝图片层 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background="clear"
        contentShape="rect"
        gesture={activeGesture}
        simultaneousGesture={magnifyGesture}
        highPriorityGesture={
          TapGesture(2).onEnded(handleDoubleTap)
        }
        onTapGesture={{
          count: 1,
          perform: onToggleControls,
        }}
      />
    </ZStack>
  )
}

export function IllustGalleryView(props: {
  illust: PixivIllustration
  initialPageIndex?: number
}) {
  const { illust, initialPageIndex = 0 } = props
  const dismiss = Navigation.useDismiss()

  const pageCount = Math.max(1, illust.page_count || illust.meta_pages?.length || 1)
  const isSingle = pageCount <= 1
  const pageIndices = useMemo(() => Array.from({ length: pageCount }, (_, i) => i), [pageCount])

  const [currentPageIndex, setCurrentPageIndex] = useState(initialPageIndex)
  const [showControls, setShowControls] = useState(true)
  const [backgroundOpacity, setBackgroundOpacity] = useState(1.0)
  const [dismissOffsetY, setDismissOffsetY] = useState(0)
  const [dismissScale, setDismissScale] = useState(1.0)
  const [downloading, setDownloading] = useState(false)

  const toggleControls = useCallback(() => {
    setShowControls((prev) => !prev)
  }, [])

  const handleDismiss = useCallback(() => {
    dismiss()
  }, [dismiss])

  const handleDismissDrag = useCallback((offsetY: number, scale: number, opacity: number) => {
    setDismissOffsetY(offsetY)
    setDismissScale(scale)
    setBackgroundOpacity(opacity)
  }, [])

  const handleDismissDragEnd = useCallback(
    (shouldDismiss: boolean) => {
      if (shouldDismiss) {
        handleDismiss()
      } else {
        withAnimation(Animation.spring({ duration: 0.35, bounce: 0.2 }), () => {
          setDismissOffsetY(0)
          setDismissScale(1.0)
          setBackgroundOpacity(1.0)
        })
      }
    },
    [handleDismiss]
  )

  // 深度预热：预热当前页面前后所有相邻页面的缩略图与高清大图
  useEffect(() => {
    const quality = getDetailImageQuality()
    const urlsToPrefetch: (string | null | undefined)[] = []
    
    for (let offset = 1; offset <= 2; offset++) {
      const prevIdx = currentPageIndex - offset
      const nextIdx = currentPageIndex + offset
      if (prevIdx >= 0) {
        urlsToPrefetch.push(pageThumbUrlOf(illust, prevIdx))
        urlsToPrefetch.push(imageUrlOf(illust, prevIdx, quality))
      }
      if (nextIdx < pageCount) {
        urlsToPrefetch.push(pageThumbUrlOf(illust, nextIdx))
        urlsToPrefetch.push(imageUrlOf(illust, nextIdx, quality))
      }
    }
    if (urlsToPrefetch.length > 0) {
      prefetch(urlsToPrefetch)
    }
  }, [illust, currentPageIndex, pageCount])

  async function handleDownloadSingle(pageIdx: number) {
    if (downloading) return
    setDownloading(true)
    try {
      const quality = getDownloadImageQuality()
      const url = imageUrlOf(illust, pageIdx, quality)
      if (!url) return
      const fileName = `pixiv_${illust.id}_p${pageIdx + 1}`
      const cached = cachedFilePath(url)
      if (cached) {
        await saveImageToPixivAlbum(cached, fileName)
      } else {
        const data = await fetchImageBinaryWithRetry(url)
        if (data) {
          await saveImageToPixivAlbum(data, fileName)
        }
      }
    } catch (err: any) {
      console.log("handleDownloadSingle error:", err?.message ?? err)
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadAll() {
    if (downloading) return
    setDownloading(true)
    try {
      await downloadIllustToAlbum(illust, getDownloadImageQuality())
    } catch (err: any) {
      console.log("handleDownloadAll error:", err?.message ?? err)
    } finally {
      setDownloading(false)
    }
  }

  async function handleShare() {
    await ShareSheet.present([`https://www.pixiv.net/artworks/${illust.id}`])
  }

  return (
    <NavigationStack>
      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        statusBarHidden={!showControls}
        ignoresSafeArea={{ edges: "all" }}
        navigationBarVisibility={showControls ? "visible" : "hidden"}
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility={{
          visibility: "hidden",
          bars: ["navigationBar"],
        }}
        toolbar={{
          topBarLeading: [
            <Button action={handleDismiss}>
              <Image systemName="xmark" />
            </Button>,
          ],
          topBarTrailing: [
            !isSingle ? (
              <Menu label={<Image systemName="square.and.arrow.down" />}>
                <Button
                  title={`保存当前页（第 ${currentPageIndex + 1} 页）`}
                  systemImage="photo"
                  disabled={downloading}
                  action={() => void handleDownloadSingle(currentPageIndex)}
                />
                <Button
                  title={`保存全部（共 ${pageCount} 页）`}
                  systemImage="photo.on.rectangle.angled"
                  disabled={downloading}
                  action={() => void handleDownloadAll()}
                />
              </Menu>
            ) : (
              <Button
                disabled={downloading}
                action={() => void handleDownloadSingle(0)}
              >
                <Image systemName="square.and.arrow.down" />
              </Button>
            ),
            <Button action={handleShare}>
              <Image systemName="square.and.arrow.up" />
            </Button>,
          ],
        }}
      >
        {/* 沉浸式纯黑背景 */}
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          background="black"
          opacity={backgroundOpacity}
          ignoresSafeArea={{ edges: "all" }}
        />

        {/* 中间大图展示区：使用 iOS 原生 TabView page 模式实现可预测物理交互翻页动画 */}
        <ZStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          offset={{ x: 0, y: dismissOffsetY }}
          scaleEffect={dismissScale}
        >
          {!isSingle ? (
            <TabView
              tabIndex={currentPageIndex}
              onTabIndexChanged={(newIdx) => {
                if (typeof newIdx === "number" && newIdx >= 0 && newIdx < pageCount) {
                  setCurrentPageIndex(newIdx)
                }
              }}
              tabViewStyle="pageNeverDisplayIndex"
            >
              {pageIndices.map((idx) => (
                <VStack
                  key={idx}
                  tag={idx}
                  frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                >
                  <IllustGalleryPage
                    illust={illust}
                    pageIndex={idx}
                    isActive={currentPageIndex === idx}
                    isSinglePage={false}
                    onToggleControls={toggleControls}
                    onDismiss={handleDismiss}
                  />
                </VStack>
              ))}
            </TabView>
          ) : (
            <IllustGalleryPage
              illust={illust}
              pageIndex={0}
              isActive={true}
              isSinglePage={true}
              onToggleControls={toggleControls}
              onDismiss={handleDismiss}
              onDismissDrag={handleDismissDrag}
              onDismissDragEnd={handleDismissDragEnd}
            />
          )}
        </ZStack>

        {/* 底部悬浮页数指示器（仅多页显示） */}
        {showControls && !isSingle && (
          <VStack
            alignment="center"
            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottom" }}
            padding={{ bottom: 36 }}
          >
            <HStack
              padding={{ horizontal: 14, vertical: 6 }}
              background="#00000088"
              clipShape="capsule"
            >
              <Text font="subheadline" fontWeight="bold" foregroundStyle="#FFFFFF">
                {`${currentPageIndex + 1} / ${pageCount}`}
              </Text>
            </HStack>
          </VStack>
        )}
      </ZStack>
    </NavigationStack>
  )
}
