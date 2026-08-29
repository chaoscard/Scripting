import {
  Button,
  Image,
  ProgressView,
  Text,
  TimelineCanvas,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { cachedFilePath, loadImage } from "../image/imageLoader"
import { loadSettings } from "../store/settings"
import { useLatest } from "./hooks"
import { cachedUgoiraFrames, prepareUgoira } from "../ugoira/ugoira"
import type { UgoiraFramesResult } from "../ugoira/ugoira"

function blurCrossFadeDurationSec(): number {
  const ms = loadSettings().blurCrossFadeDuration ?? 150
  return Math.max(0, Math.min(0.25, ms / 1000))
}

export function UgoiraPlayerView(props: {
  illustID: number
  aspectRatioValue: number
  previewUrl?: string | null
  blurPreviewRadius?: number
  cornerRadius?: number
  frame?: any
  onLoaded?: (success: boolean) => void
}) {
  const {
    illustID,
    aspectRatioValue,
    previewUrl,
    blurPreviewRadius = 8,
    cornerRadius = 8,
    frame,
    onLoaded,
  } = props

  // 1. 同步尝试从缓存（内存/磁盘）中读取帧数据
  const initialFrames = useMemo(() => cachedUgoiraFrames(illustID), [illustID])
  const [framesData, setFramesData] = useState<UgoiraFramesResult | null>(initialFrames)
  const [loading, setLoading] = useState(() => !initialFrames)
  const [error, setError] = useState<string | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(() => (
    previewUrl ? cachedFilePath(previewUrl) : null
  ))

  const onLoadedRef = useLatest(onLoaded)
  const hasNotifiedRef = useRef(false)
  const notifyLoaded = useCallback((success: boolean) => {
    if (!hasNotifiedRef.current) {
      hasNotifiedRef.current = true
      onLoadedRef.current?.(success)
    }
  }, [onLoadedRef])

  // 竞态防护：illustID 切换后丢弃旧数据
  const seqRef = useRef(0)
  const initialHitRef = useRef(Boolean(previewPath))
  const [transitionCompleted, setTransitionCompleted] = useState(() => initialHitRef.current)

  useEffect(() => {
    if (initialHitRef.current) {
      setTransitionCompleted(true)
      return
    }
    setTransitionCompleted(false)
  }, [previewUrl])

  // 当 illustID 变更时，更新 framesData 状态
  useEffect(() => {
    const cached = cachedUgoiraFrames(illustID)
    if (cached) {
      setFramesData(cached)
      setLoading(false)
      notifyLoaded(true)
    } else {
      setFramesData(null)
      setLoading(true)
    }
  }, [illustID, notifyLoaded])

  // 加载海报预览图
  useEffect(() => {
    if (!previewUrl) {
      setPreviewPath(null)
      return
    }
    const cached = cachedFilePath(previewUrl)
    if (cached) {
      setPreviewPath((prev) => (prev === cached ? prev : cached))
      return
    }
    let cancelled = false
    loadImage(previewUrl, 0)
      .then((p) => {
        if (!cancelled && p) {
          setPreviewPath(p)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [previewUrl])

  const doLoadFrames = useCallback(() => {
    const seq = ++seqRef.current
    hasNotifiedRef.current = false
    setError(null)
    const cached = cachedUgoiraFrames(illustID)
    if (cached) {
      setFramesData(cached)
      setLoading(false)
      notifyLoaded(true)
      return
    }
    setFramesData(null)
    setLoading(true)
    prepareUgoira(illustID)
      .then((r) => {
        if (seq === seqRef.current) {
          setFramesData(r)
          notifyLoaded(true)
        }
      })
      .catch((err: any) => {
        if (seq === seqRef.current) {
          setError(err?.message ?? "动图资源加载失败")
          notifyLoaded(false)
        }
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
  }, [illustID, notifyLoaded])

  useEffect(() => {
    doLoadFrames()
    return () => {
      seqRef.current++
    }
  }, [doLoadFrames])

  const previewBlurredImage = useMemo(() => {
    if (!previewPath) return null
    try {
      const image = UIImage.fromFile(previewPath)
      if (!image || image.width <= 0 || image.height <= 0) return null
      return image.blurred(blurPreviewRadius) ?? image
    } catch {
      return null
    }
  }, [previewPath, blurPreviewRadius])

  const intrinsicAspect = useMemo(() => {
    if (framesData && framesData.width && framesData.height && framesData.width > 0 && framesData.height > 0) {
      return framesData.width / framesData.height
    }
    if (!previewPath) return null
    try {
      const image = UIImage.fromFile(previewPath)
      if (image && image.width > 0 && image.height > 0) {
        return image.width / image.height
      }
    } catch {
      return null
    }
    return null
  }, [framesData, previewPath])

  // 锁定宽高比，偏差 <2% 时沿用传入比例，防止尺寸微小偏差导致二次重排
  const stableAspect = useMemo(() => {
    if (intrinsicAspect == null) return aspectRatioValue
    if (aspectRatioValue > 0 && Math.abs(intrinsicAspect - aspectRatioValue) / aspectRatioValue < 0.02) {
      return aspectRatioValue
    }
    return intrinsicAspect
  }, [intrinsicAspect, aspectRatioValue])

  const containerFrame = frame ?? { maxWidth: "infinity" }
  const crossFadeDuration = blurCrossFadeDurationSec()

  useEffect(() => {
    if (transitionCompleted || !previewPath) return
    if (initialHitRef.current) {
      setTransitionCompleted(true)
      return
    }
    const timer = setTimeout(() => {
      setTransitionCompleted(true)
    }, Math.max(50, crossFadeDuration * 1000 + 50))
    return () => clearTimeout(timer)
  }, [previewPath, crossFadeDuration, transitionCompleted])

  const durationSec = framesData ? (framesData.totalDurationMs / 1000).toFixed(1) : null

  return (
    <VStack alignment="center" spacing={6} frame={{ maxWidth: "infinity" }}>
      <ZStack
        aspectRatio={{ value: stableAspect, contentMode: "fit" }}
        clipShape={{ type: "rect", cornerRadius }}
        clipped={true}
        frame={containerFrame}
      >
        {/* 1. 底层骨架占位色块 */}
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          background="tertiarySystemFill"
        />

        {/* 2. 预模糊位图垫底层（在未准备好动图时展示） */}
        {!framesData && !transitionCompleted && previewBlurredImage ? (
          <Image
            image={previewBlurredImage}
            resizable={true}
            aspectRatio={{ value: stableAspect, contentMode: "fit" }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        ) : null}

        {/* 3. 高清静态海报层（仅在动图帧数据未完成准备时展示） */}
        {!framesData && previewPath ? (
          <Image
            key={`sharp-poster-${illustID}`}
            filePath={previewPath}
            resizable={true}
            aspectRatio={{ value: stableAspect, contentMode: "fit" }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        ) : null}

        {/* 4. Canvas 逐帧动图播放器层（只要动图帧就绪，立即挂载播放，0 延迟起播） */}
        {framesData ? (
          <UgoiraCanvasPlayer
            key={`canvas-${illustID}`}
            framesData={framesData}
            aspectRatioValue={stableAspect}
          />
        ) : null}

        {/* 5. 加载中状态指示器（仅在真正处于网络下载/解压中且无帧数据时显示） */}
        {loading && !framesData && !error ? (
          <VStack
            alignment="center"
            spacing={8}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          >
            <ProgressView
              controlSize="large"
              progressViewStyle="circular"
            />
          </VStack>
        ) : null}

        {/* 6. 错误与重试 */}
        {error && !framesData ? (
          <VStack
            alignment="center"
            spacing={10}
            padding={20}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            background="rgba(0, 0, 0, 0.4)"
          >
            <Text font="footnote" foregroundStyle="white">
              {error}
            </Text>
            <Button
              title="重试"
              buttonStyle="glass"
              action={doLoadFrames}
            />
          </VStack>
        ) : null}
      </ZStack>

      {/* 底部信息栏 */}
      <Text
        font="caption2"
        foregroundStyle={framesData ? "secondaryLabel" : "clear"}
      >
        {framesData
          ? `动图 · ${framesData.frames.length} 帧 · ${durationSec} 秒`
          : "动图"}
      </Text>
    </VStack>
  )
}

/**
 * 基于 TimelineCanvas 的高精度逐帧 Canvas 动图播放器
 */
function UgoiraCanvasPlayer(props: {
  framesData: UgoiraFramesResult
  aspectRatioValue: number
}) {
  const { framesData } = props
  const { framesDir, frames, totalDurationMs } = framesData

  // 预先计算累积时间轴断点数组，单位秒
  const cumulativeTimeArray = useMemo(() => {
    const arr: number[] = []
    let acc = 0
    for (const f of frames) {
      acc += f.delay || 50
      arr.push(acc / 1000)
    }
    return arr
  }, [frames])

  const totalDurationSec = useMemo(() => {
    return Math.max(0.05, totalDurationMs / 1000)
  }, [totalDurationMs])

  return (
    <TimelineCanvas
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      draw={(ctx, size, time) => {
        if (!frames || frames.length === 0) return

        // 1. 计算当前循环周期内的相对时间秒
        const loopTime = time % totalDurationSec

        // 2. 匹配当前帧索引
        let frameIndex = 0
        for (let i = 0; i < cumulativeTimeArray.length; i++) {
          if (loopTime < cumulativeTimeArray[i]) {
            frameIndex = i
            break
          }
        }

        const targetFrame = frames[frameIndex] ?? frames[0]
        if (targetFrame) {
          const frameFilePath = `${framesDir}/${targetFrame.file}`
          ctx.drawImage({ filePath: frameFilePath }, 0, 0, size.width, size.height)
        }
      }}
    />
  )
}
