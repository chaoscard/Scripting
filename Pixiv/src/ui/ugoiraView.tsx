import {
  Button,
  HStack,
  ProgressView,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
  VideoPlayer,
} from "scripting"
import { buildUgoira, cachedUgoira } from "../ugoira/ugoira"
import type { UgoiraResult } from "../ugoira/ugoira"

export function UgoiraPlayerView(props: {
  illustID: number
  aspectRatioValue: number
  onLoaded?: (success: boolean) => void
}) {
  const { illustID, aspectRatioValue, onLoaded } = props
  const [result, setResult] = useState<UgoiraResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 竞态防护：illustID 切换（或组件卸载）后，旧作品的合成结果直接丢弃
  const seqRef = useRef(0)

  useEffect(() => {
    const seq = ++seqRef.current
    setResult(null)
    setError(null)
    const cached = cachedUgoira(illustID)
    if (cached) {
      setResult(cached)
      setLoading(false)
      onLoaded?.(true)
      return
    }
    setLoading(true)
    buildUgoira(illustID)
      .then((r) => {
        if (seq === seqRef.current) {
          setResult(r)
          onLoaded?.(true)
        }
      })
      .catch((err: any) => {
        if (seq === seqRef.current) {
          setError(err?.message ?? "动图合成失败")
          onLoaded?.(false)
        }
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
    return () => {
      // 卸载/换 id：使在途合成结果失效
      seqRef.current++
    }
  }, [illustID])

  if (result) {
    return (
      <VStack alignment="center" spacing={6}>
        <UgoiraVideo mp4Path={result.mp4Path} aspectRatioValue={aspectRatioValue} />
        <Text font="caption2" foregroundStyle="secondaryLabel">
          动图 · {result.duration.toFixed(1)} 秒
        </Text>
      </VStack>
    )
  }

  return (
    <VStack
      alignment="center"
      spacing={0}
      aspectRatio={{ value: aspectRatioValue, contentMode: "fit" }}
      frame={{ maxWidth: "infinity" }}
      padding={40}
    >
      {loading ? <ProgressView /> : error ? (
        <>
          <Text font="footnote" foregroundStyle="systemRed">
            {error}
          </Text>
          <Button title="重试" buttonStyle="glass" action={() => {
            // 重新构建（seq 自增使旧的失败状态/在途结果失效）
            const seq = ++seqRef.current
            setError(null)
            setLoading(true)
            buildUgoira(illustID)
              .then((r) => {
                if (seq === seqRef.current) setResult(r)
              })
              .catch((err: any) => {
                if (seq === seqRef.current) {
                  setError(err?.message ?? "动图合成失败")
                }
              })
              .finally(() => {
                if (seq === seqRef.current) setLoading(false)
              })
          }} />
        </>
      ) : null}
    </VStack>
  )
}

function UgoiraVideo(props: {
  mp4Path: string
  aspectRatioValue: number
}) {
  const { mp4Path, aspectRatioValue } = props
  const [player, setPlayer] = useState<AVPlayer | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let disposed = false
    const p = new AVPlayer()
    const ok = p.setSource(mp4Path)
    if (ok) {
      p.numberOfLoops = -1
      p.play()
      if (!disposed) setPlayer(p)
    } else {
      if (!disposed) setFailed(true)
      p.dispose()
    }
    return () => {
      disposed = true
      p.dispose()
    }
  }, [mp4Path, retry])

  if (!player) {
    return (
      <VStack spacing={8} padding={20}>
        {failed ? (
          <>
            <Text font="footnote" foregroundStyle="systemRed">
              动图播放器加载失败
            </Text>
            <Button
              title="重试"
              buttonStyle="glass"
              action={() => {
                setFailed(false)
                setRetry((v) => v + 1)
              }}
            />
          </>
        ) : (
          <ProgressView />
        )}
      </VStack>
    )
  }

  return (
    <VideoPlayer
      player={player}
      aspectRatio={{ value: aspectRatioValue, contentMode: "fit" }}
      frame={{ maxWidth: "infinity" }}
    />
  )
}
