import {
  Button,
  HStack,
  ProgressView,
  Spacer,
  Text,
  useEffect,
  VStack,
} from "scripting"
import { nextIllustrations, relatedIllustrations } from "../../api/pixiv"
import { cardThumbUrlOf, prefetch } from "../../image/imageLoader"
import { isIllustContentVisible } from "../../store/contentFilter"
import { loadSettings, onSettingsChanged } from "../../store/settings"
import type { PixivIllustration } from "../../types"
import { IllustFlowFeed } from "../components"
import { currentBatchSize, useLatest, usePagedList } from "../hooks"

function filterRelatedIllustrations(
  items: PixivIllustration[],
  currentIllustID?: number
): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter(
    (item) =>
      item.id !== currentIllustID &&
      isIllustContentVisible(item, settings)
  )
}

export interface IllustRelatedSectionProps {
  illustID: number
  enabled?: boolean
}

export function IllustRelatedSection(props: IllustRelatedSectionProps) {
  const { enabled = true, illustID } = props
  const paged = usePagedList<PixivIllustration>({
    first: (token) => relatedIllustrations(illustID, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => filterRelatedIllustrations(items, illustID),
    deps: [illustID],
    enabled,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })
  const pagedRef = useLatest(paged)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  if (paged.initialLoading && !enabled) {
    return null
  }

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ top: 4 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <Text
        font="subheadline"
        fontWeight="semibold"
        foregroundStyle="secondaryLabel"
        padding={{ horizontal: 14 }}
      >
        相关作品
      </Text>
      {paged.initialLoading ? (
        <HStack spacing={0} frame={{ maxWidth: "infinity", height: 80 }}>
          <Spacer />
          <ProgressView progressViewStyle="circular" />
          <Spacer />
        </HStack>
      ) : paged.error && paged.items.length === 0 ? (
        <VStack alignment="center" spacing={8} padding={16} frame={{ maxWidth: "infinity" }}>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            相关作品加载失败
          </Text>
          <Button
            title="重试"
            buttonStyle="glass"
            action={() => paged.refresh()}
          />
        </VStack>
      ) : paged.items.length > 0 ? (
        <IllustFlowFeed
          items={paged.items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
        />
      ) : (
        <HStack spacing={0} padding={{ horizontal: 14, vertical: 8 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            暂无相关作品
          </Text>
        </HStack>
      )}
    </VStack>
  )
}
