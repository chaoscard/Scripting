import {
  useEffect,
} from "scripting"
import { nextIllustrations, relatedIllustrations } from "../../api/pixiv"
import { cardThumbUrlOf, prefetch } from "../../image/imageLoader"
import { isIllustContentVisible } from "../../store/contentFilter"
import { loadSettings, onSettingsChanged } from "../../store/settings"
import type { PixivIllustration } from "../../types"
import { IllustFlowFeed, RelatedSection } from "../components"
import { currentBatchSize, useLatest, usePagedList } from "../Hooks"

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
    <RelatedSection
      initialLoading={paged.initialLoading}
      error={paged.error}
      items={paged.items}
      onRetry={() => paged.refresh()}
      renderContent={(items) => (
        <IllustFlowFeed
          items={items}
          onLoadMore={paged.loadMore}
          hasMore={paged.hasMore}
          isLoading={paged.loadingMore}
          loadMoreError={paged.loadMoreError}
          onRetryLoadMore={paged.retryLoadMore}
          bottomInset={0}
        />
      )}
    />
  )
}
