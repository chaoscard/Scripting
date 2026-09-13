import {
  FlowLayout,
  HStack,
  Image,
  Text,
  VStack,
} from "scripting"
import type { PixivIllustration } from "../../types"
import {
  ExpandableIntroduction,
  formatDate,
  formatNumber,
  SeriesEpisodePager,
  TagChip,
} from "../components"
import { renderDestination } from "../routes"

export interface IllustMetaSectionProps {
  illust: PixivIllustration
  pageCount: number
  resolvedSeriesID: number | null
  resolvedSeriesTitle: string | null
  resolvedEpisodeNumber: number | null
}

export function IllustMetaSection(props: IllustMetaSectionProps) {
  const {
    illust,
    pageCount,
    resolvedSeriesID,
    resolvedSeriesTitle,
    resolvedEpisodeNumber,
  } = props

  return (
    <>
      <VStack
        alignment="leading"
        spacing={8}
        padding={{ horizontal: 14 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        {/* 作品标题 */}
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
          {illust.title}
        </Text>

        {/* 统计指标 */}
        <HStack spacing={10}>
          <HStack spacing={3}>
            <Image systemName="eye" font="footnote" />
            <Text font="footnote">
              {formatNumber(illust.total_view)}
            </Text>
          </HStack>
          <HStack spacing={3}>
            <Image systemName="heart" font="footnote" />
            <Text font="footnote">
              {formatNumber(illust.total_bookmarks)}
            </Text>
          </HStack>
          <HStack spacing={3}>
            <Image systemName="bubble.left" font="footnote" />
            <Text font="footnote">
              {formatNumber(illust.total_comments)}
            </Text>
          </HStack>
          {pageCount > 1 && (
            <HStack spacing={3}>
              <Image systemName="rectangle.stack" font="footnote" />
              <Text font="footnote">
                {pageCount}P
              </Text>
            </HStack>
          )}
          <Text font="footnote">
            {formatDate(illust.create_date)}
          </Text>
        </HStack>

        {/* 简介 */}
        <ExpandableIntroduction
          title="简介"
          caption={illust.caption}
          routeDestination={renderDestination}
        />

        {/* 标签：原生流式换行展示所有标签 */}
        {Array.isArray(illust.tags) && illust.tags.length > 0 ? (
          <VStack alignment="leading" spacing={6}>
            <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
              标签
            </Text>
            <FlowLayout spacing={6}>
              {illust.tags.map((tag) => (
                <TagChip
                  key={tag.name}
                  name={tag.name}
                  tagName={tag.name}
                  translatedName={tag.translated_name ?? undefined}
                  value={`tag:${encodeURIComponent(tag.name)}`}
                  compact
                />
              ))}
            </FlowLayout>
          </VStack>
        ) : null}
      </VStack>

      {/* 话数翻页器 */}
      <SeriesEpisodePager
        workID={illust.id}
        seriesID={resolvedSeriesID}
        seriesTitle={resolvedSeriesTitle}
        kind="manga"
        episodeNumber={resolvedEpisodeNumber}
      />
    </>
  )
}
