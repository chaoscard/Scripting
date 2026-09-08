import { Image, ProgressView, VStack, ZStack, useColorScheme } from "scripting"
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
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"

  return (
    <ZStack alignment="bottom" frame={{ maxWidth: "infinity" }}>
      {url || previewUrl ? (
        <ZStack
          alignment="bottom"
          frame={{ maxWidth: "infinity" }}
          clipShape={{
            type: "rect",
            cornerRadii: { topLeading: 0, topTrailing: 0, bottomLeading: 8, bottomTrailing: 8 },
          }}
        >
          <CachedImage
            url={url ?? null}
            previewUrl={previewUrl ?? null}
            useIntrinsicAspectRatio={true}
            aspectRatioValue={aspectRatioValue}
            contentMode="fill"
            cornerRadius={{ topLeading: 0, topTrailing: 0, bottomLeading: 8, bottomTrailing: 8 }}
            priority={0}
            frame={{ maxWidth: "infinity" }}
          />
          {/* 底部羽化过渡遮罩：让系列封面与下方环境底色自然交融 */}
          <VStack
            frame={{ maxWidth: "infinity", height: 70 }}
            background={{
              colors: [
                "rgba(0, 0, 0, 0)",
                isDark ? "rgba(0, 0, 0, 0.35)" : "rgba(255, 255, 255, 0.45)",
                isDark ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.90)",
              ],
              startPoint: "top",
              endPoint: "bottom",
            }}
          />
        </ZStack>
      ) : (
        <VStack
          frame={{ maxWidth: "infinity", height: placeholderHeight }}
          background="clear"
        />
      )}
      {children}
    </ZStack>
  )
}

// 估算多行文本在移动端竖屏下的视觉行数（综合考虑硬换行、标点占宽与段落自动折行）
