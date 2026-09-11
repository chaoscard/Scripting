import {
  LazyVStack,
  useEffect,
  VStack,
} from "scripting"
import type { PixivIllustration } from "../../types"
import { cachedFilePath, imageUrlOf, loadImage, pageThumbUrlOf } from "../../image/imageLoader"
import { CachedImage } from "../components/CachedImage"
import { UgoiraPlayerView } from "../UgoiraView"

export interface IllustMediaViewportProps {
  illust: PixivIllustration
  quality: "medium" | "large" | "original"
  pageCount: number
  pageURLs: (string | null)[]
  pageAspect: number
  onMediaReady: () => void
  onMainImageLoaded: () => void
  onOpenGallery: (pageIndex?: number) => void
}

export function IllustMediaViewport(props: IllustMediaViewportProps) {
  const {
    illust,
    pageCount,
    pageURLs,
    pageAspect,
    onMediaReady,
    onMainImageLoaded,
    onOpenGallery,
  } = props

  // 当为多页作品时，在详情页挂载的第一时间高优先级并发预热所有页面的中等缩略图（每张仅约 15KB），
  // 确保用户滚动到后续各页之前所有缩略图已写入本地磁盘，首帧 0 延迟命中真实物理比例与模糊底图
  useEffect(() => {
    if (!illust || pageCount <= 1) return
    for (let idx = 0; idx < pageCount; idx++) {
      const thumb = pageThumbUrlOf(illust, idx)
      if (thumb && !cachedFilePath(thumb)) {
        void loadImage(thumb, idx === 0 ? -6000 : -1000 + idx)
      }
    }
  }, [illust, pageCount])

  return (
    <VStack
      alignment="center"
      spacing={4}
      frame={{ maxWidth: "infinity" }}
      padding={{ top: 0, bottom: 6 }}
    >
      {illust.type === "ugoira" ? (
        <UgoiraPlayerView
          illustID={illust.id}
          previewUrl={pageThumbUrlOf(illust, 0)}
          aspectRatioValue={pageAspect}
          cornerRadius={8}
          onLoaded={onMediaReady}
        />
      ) : pageCount > 1 ? (
        <LazyVStack spacing={0} alignment="center">
          {pageURLs.map((url, idx) => {
            const preview = pageThumbUrlOf(illust, idx)
            const isFirst = idx === 0
            const isLast = idx === pageCount - 1
            const cornerRadii = isFirst
              ? { topLeading: 8, topTrailing: 8, bottomLeading: 0, bottomTrailing: 0 }
              : isLast
                ? { topLeading: 0, topTrailing: 0, bottomLeading: 8, bottomTrailing: 8 }
                : 0
            return (
              <CachedImage
                key={`illust-page-${illust.id}-${idx}`}
                url={url}
                previewUrl={(idx === 0 ? illust.extra_preview_url : null) || preview}
                aspectRatioValue={pageAspect}
                useIntrinsicAspectRatio={true}
                cornerRadius={cornerRadii}
                contentMode="fit"
                frame={{ maxWidth: "infinity" }}
                priority={idx === 0 ? -5000 : idx}
                onLoaded={idx === 0 ? onMainImageLoaded : undefined}
                onTapGesture={() => onOpenGallery(idx)}
              />
            )
          })}
        </LazyVStack>
      ) : (
        <CachedImage
          key={`illust-single-${illust.id}`}
          url={pageURLs[0] ?? null}
          previewUrl={illust.extra_preview_url || pageThumbUrlOf(illust, 0)}
          aspectRatioValue={pageAspect}
          useIntrinsicAspectRatio={true}
          cornerRadius={8}
          contentMode="fit"
          frame={{ maxWidth: "infinity" }}
          priority={-5000}
          onLoaded={onMainImageLoaded}
          onTapGesture={() => onOpenGallery(0)}
        />
      )}
    </VStack>
  )
}
