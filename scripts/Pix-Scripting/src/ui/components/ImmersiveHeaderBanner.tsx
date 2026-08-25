import { Image, ProgressView, VStack, ZStack } from "scripting"
import { cachedFilePath, loadImage } from "../../image/imageLoader"
import { loadSettings } from "../../store/settings"
import { CachedImage } from "./CachedImage"
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

// 估算多行文本在移动端竖屏下的视觉行数（综合考虑硬换行、标点占宽与段落自动折行）
