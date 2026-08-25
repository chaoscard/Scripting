import {
  Divider,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  VStack,
} from "scripting"
import { useTagInfo } from "../../store/tagInfoCache"
import { CachedImage } from "./CachedImage"

export function TagPreview(props: {
  tagName: string
  translatedName?: string
}) {
  const { tagName, translatedName } = props
  const { data, loading } = useTagInfo(tagName)

  const abstract = data?.abstract
  const thumbnailUrl = data?.thumbnailUrl

  return (
    <VStack alignment="leading" spacing={10} padding={12} frame={{ width: 290 }}>
      {/* 头部标题与翻译 */}
      <VStack alignment="leading" spacing={3}>
        <HStack spacing={6} alignment="center">
          <Text font="headline" foregroundStyle="#0096FA" fontWeight="bold">
            #
          </Text>
          <Text font="headline" fontWeight="bold" lineLimit={1}>
            {tagName}
          </Text>
        </HStack>

        {translatedName ? (
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            {translatedName}
          </Text>
        ) : null}
      </VStack>

      <Divider />

      {/* 百科摘要主体 */}
      {loading ? (
        <HStack spacing={8} alignment="center" padding={{ vertical: 8 }}>
          <ProgressView controlSize="small" />
          <Text font="footnote" foregroundStyle="secondaryLabel">
            正在读取百科释义…
          </Text>
        </HStack>
      ) : data?.hasEncyclopedia && (abstract || thumbnailUrl) ? (
        <HStack spacing={10} alignment="top">
          {thumbnailUrl ? (
            <CachedImage
              url={thumbnailUrl}
              frame={{ width: 68, height: 68 }}
              cornerRadius={8}
              contentMode="fill"
            />
          ) : null}
          <VStack alignment="leading" spacing={4} frame={{ minHeight: thumbnailUrl ? 68 : undefined }}>
            <Text
              font="footnote"
              foregroundStyle="label"
              lineLimit={thumbnailUrl ? 4 : 5}
            >
              {abstract ?? "暂无文本摘要"}
            </Text>
          </VStack>
        </HStack>
      ) : (
        <HStack spacing={6} alignment="center" padding={{ vertical: 4 }}>
          <Image systemName="sparkles" font="footnote" foregroundStyle="secondaryLabel" />
          <Text font="footnote" foregroundStyle="secondaryLabel">
            Pixiv 标签 · 暂无百科词条
          </Text>
        </HStack>
      )}
    </VStack>
  )
}

export default TagPreview
