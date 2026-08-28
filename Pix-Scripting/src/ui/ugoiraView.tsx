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
  const [videoReady, setVideoReady] = useState(false)
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
  const initialHitRef = useRef(Boolean(previewPath))
  const [transitionCompleted, setTransitionCompleted] = useState(() => initialHitRef.current)

  useEffect(() => {
    if (initialHitRef.current) {
      setTransitionCompleted(true)
      return
    }
    setTransitionCompleted(false)
  }, [previewUrl])

  useEffect(() => {
    setVideoReady(false)
  }, [illustID])

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

  const doBuild = useCallback(() => {
    const seq = ++seqRef.current
    hasNotifiedRef.current = false
    setError(null)
    setVideoReady(false)
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
  }, [illustID, notifyLoaded])

  useEffect(() => {
    doBuild()
    return () => {
      // 卸载/换 id：使在途合成结果失效
      seqRef.current++
    }
  }, [doBuild])

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

        {/* 2. 预模糊位图垫底层（位图直出，消融完成后自动卸载释放；与播放器严格统一使用 fit 比例模式） */}
        {!transitionCompleted && previewBlurredImage ? (
          <Image
            image={previewBlurredImage}
            resizable={true}
            aspectRatio={{ value: stableAspect, contentMode: "fit" }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        ) : null}

        {/* 3. 动图播放器层：合成完成后即在底层挂载初始化并静默起播，黑屏初始化完全被顶层海报遮挡 */}
        {result ? (
          <UgoiraVideo
            key={result.mp4Path}
            mp4Path={result.mp4Path}
            aspectRatioValue={stableAspect}
            onPlayingReady={() => setVideoReady(true)}
          />
        ) : null}

        {/* 4. 高清静态海报层：置于播放器之上，在视频出帧就绪前（!videoReady）持续常驻；移除时使用 identity 零动画直切，杜绝 fade 离场残影与黑闪 */}
        {previewPath && (!result || !videoReady) ? (
          <Image
            key={`sharp-poster-${illustID}`}
            filePath={previewPath}
            resizable={true}
            aspectRatio={{ value: stableAspect, contentMode: "fit" }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            transition={
              initialHitRef.current
                ? undefined
                : Transition.asymmetric(
                    crossFadeDuration > 0 ? Transition.fade(crossFadeDuration) : Transition.identity(),
                    Transition.identity()
                  )
            }
          />
        ) : null}

        {/* 5. 加载中状态（覆盖在海报层之上，与海报层在视频真正就绪时原子同步消失，消除分阶段突变） */}
        {(loading || (result && !videoReady)) && !error ? (
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
              action={doBuild}
            />
          </VStack>
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
  onPlayingReady?: () => void
}) {
  const { mp4Path, aspectRatioValue, onPlayingReady } = props
  const [loadError, setLoadError] = useState(false)
  const [retrySeq, setRetrySeq] = useState(0)
  const onPlayingReadyRef = useLatest(onPlayingReady)
  const hasNotifiedReadyRef = useRef(false)

  const player = useMemo(() => {
    try {
      hasNotifiedReadyRef.current = false
      const p = new AVPlayer()
      const notifyReady = () => {
        if (!hasNotifiedReadyRef.current) {
          hasNotifiedReadyRef.current = true
          // 延迟 80ms，确保 AVPlayerViewController 原生渲染层已完成首帧上屏绘制
          setTimeout(() => {
            onPlayingReadyRef.current?.()
          }, 80)
        }
      }
      p.onTimeControlStatusChanged = (status) => {
        // status 2 为 playing 状态（已就绪并开始循环渲染视频帧）
        if (status === 2 || (typeof status === "string" && status === "playing")) {
          notifyReady()
        }
      }
      p.onReadyToPlay = () => {
        p.play()
        notifyReady()
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
  }, [mp4Path, retrySeq, onPlayingReadyRef])

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
            setRetrySeq((v) => v + 1)
          }}
        />
      </VStack>
    )
  }

  return (
    <VideoPlayer
      player={player}
      aspectRatio={{ value: aspectRatioValue, contentMode: "fit" }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    />
  )
}
