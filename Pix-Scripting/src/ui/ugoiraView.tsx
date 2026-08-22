import {
  Button,
  Image,
  ProgressView,
  Text,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  VideoPlayer,
  ZStack,
} from "scripting"
import { cachedFilePath, loadImage } from "../image/imageLoader"
import { loadSettings } from "../store/settings"
import { useLatest } from "./hooks"
import { buildUgoira, cachedUgoira } from "../ugoira/ugoira"
import type { UgoiraResult } from "../ugoira/ugoira"

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
  const [result, setResult] = useState<UgoiraResult | null>(null)
  const [loading, setLoading] = useState(false)
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

  // 竞态防护：illustID 切换（或组件卸载）后，旧作品的合成结果直接丢弃
  const seqRef = useRef(0)
  const initialHitRef = useRef(Boolean(cachedUgoira(illustID)))

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

  useEffect(() => {
    const seq = ++seqRef.current
    hasNotifiedRef.current = false
    setError(null)
    const cached = cachedUgoira(illustID)
    if (cached) {
      setResult(cached)
      setLoading(false)
      notifyLoaded(true)
      return
    }
    setResult(null)
    setLoading(true)
    buildUgoira(illustID)
      .then((r) => {
        if (seq === seqRef.current) {
          setResult(r)
          notifyLoaded(true)
        }
      })
      .catch((err: any) => {
        if (seq === seqRef.current) {
          setError(err?.message ?? "动图合成失败")
          notifyLoaded(false)
        }
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
    return () => {
      // 卸载/换 id：使在途合成结果失效
      seqRef.current++
    }
  }, [illustID, notifyLoaded])

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
  }, [previewPath])

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

        {/* 2. 预模糊位图垫底层（位图直出，常驻底层，提供瞬间模糊底色；与播放器严格统一使用 fit 比例模式） */}
        {previewBlurredImage ? (
          <Image
            image={previewBlurredImage}
            resizable={true}
            aspectRatio={{ value: stableAspect, contentMode: "fit" }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        ) : null}

        {/* 3. 高清静态海报层（由模糊预览消融至高清首帧静图，负责呈现完美的模糊消融过渡并为视频播放提供 100% 同像素静图承托） */}
        {previewPath ? (
          <Image
            key={`sharp-poster-${illustID}`}
            filePath={previewPath}
            resizable={true}
            aspectRatio={{ value: stableAspect, contentMode: "fit" }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            transition={initialHitRef.current ? undefined : (crossFadeDuration > 0 ? Transition.fade(crossFadeDuration) : undefined)}
          />
        ) : null}

        {/* 4. 加载中状态（覆盖在海报层之上） */}
        {loading && !result ? (
          <VStack
            alignment="center"
            spacing={8}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          >
            <ProgressView progressViewStyle="circular" />
          </VStack>
        ) : null}

        {/* 5. 错误与重试 */}
        {error && !result ? (
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
              action={() => {
                const seq = ++seqRef.current
                hasNotifiedRef.current = false
                setError(null)
                setLoading(true)
                buildUgoira(illustID)
                  .then((r) => {
                    if (seq === seqRef.current) {
                      setResult(r)
                      notifyLoaded(true)
                    }
                  })
                  .catch((err: any) => {
                    if (seq === seqRef.current) {
                      setError(err?.message ?? "动图合成失败")
                      notifyLoaded(false)
                    }
                  })
                  .finally(() => {
                    if (seq === seqRef.current) setLoading(false)
                  })
              }}
            />
          </VStack>
        ) : null}

        {/* 6. 动图播放器：视频真正就绪后直接硬切接管第 3 层的同像素静态海报，彻底避免 AVPlayerViewController 原生黑色底色在透明度渐变期间引起的黑闪 */}
        {result ? (
          <UgoiraVideo
            key={result.mp4Path}
            mp4Path={result.mp4Path}
            aspectRatioValue={stableAspect}
          />
        ) : null}
      </ZStack>

      {/* 预留固定行高并以透明度过渡，避免文本出现时容器高度突变引起页面跳动闪屏 */}
      <Text
        font="caption2"
        foregroundStyle={result ? "secondaryLabel" : "clear"}
      >
        {result ? `动图 · ${result.duration.toFixed(1)} 秒` : "动图"}
      </Text>
    </VStack>
  )
}

function UgoiraVideo(props: {
  mp4Path: string
  aspectRatioValue: number
}) {
  const { mp4Path, aspectRatioValue } = props
  const [isPlaying, setIsPlaying] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retrySeq, setRetrySeq] = useState(0)

  const player = useMemo(() => {
    try {
      const p = new AVPlayer()
      p.onTimeControlStatusChanged = (status) => {
        // status 2 为 playing 状态（已就绪并开始循环渲染视频帧）
        if (status === 2 || (typeof status === "string" && status === "playing")) {
          setIsPlaying(true)
        }
      }
      p.onReadyToPlay = () => {
        p.play()
        setIsPlaying(true)
      }
      const ok = p.setSource(mp4Path)
      if (ok) {
        p.numberOfLoops = -1
        p.play()
        return p
      } else {
        setLoadError(true)
        p.dispose()
        return null
      }
    } catch {
      setLoadError(true)
      return null
    }
  }, [mp4Path, retrySeq])

  useEffect(() => {
    return () => {
      player?.dispose()
    }
  }, [player])

  if (loadError || !player) {
    return (
      <VStack
        alignment="center"
        spacing={8}
        padding={20}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background="rgba(0, 0, 0, 0.4)"
      >
        <Text font="footnote" foregroundStyle="white">
          动图播放器加载失败
        </Text>
        <Button
          title="重试"
          buttonStyle="glass"
          action={() => {
            setLoadError(false)
            setIsPlaying(false)
            setRetrySeq((v) => v + 1)
          }}
        />
      </VStack>
    )
  }

  // 核心防闪：在播放器实际解码出视频帧进入 playing 状态前不渲染 VideoPlayer（此时屏幕上完美显示第 3 层同像素的高清静态帧）。
  // 当 playing 为 true 时直接呈现 VideoPlayer，不加 Transition.fade，
  // 彻底避免原生 AVPlayerViewController 的纯黑背景在透明度插值期间叠加造成的黑闪与画面抽搐。
  if (!isPlaying) {
    return null
  }

  return (
    <VideoPlayer
      player={player}
      aspectRatio={{ value: aspectRatioValue, contentMode: "fit" }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    />
  )
}
