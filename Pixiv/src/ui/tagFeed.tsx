import {
  Button,
  HStack,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting"
import {
  followTag,
  nextIllustrations,
  searchIllustrations,
  unfollowTag,
} from "../api/pixiv"
import { session } from "../api/session"
import { cardThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  isIllustContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { useLatest, usePagedList } from "./hooks"
import type { PixivIllustration } from "../types"
import {
  EmptyView,
  ErrorView,
  LoadingView,
  IllustFlowFeed,
  RefreshableScrollView,
} from "./components"

export function TagFeedView(props: { tag: string }) {
  const { tag } = props
  const [following, setFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [followError, setFollowError] = useState<string | null>(null)

  const paged = usePagedList<PixivIllustration>({
    first: (token) =>
      searchIllustrations(
        {
          word: tag,
          target: "exact_match_for_tags",
          sort: "date_desc",
          aiFilter: loadSettings().showAI ? 0 : 1,
        },
        token
      ),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterTagItems,
    deps: [tag],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel
  })

  // 设置变更（R18/AI 开关）后立即重新加载过滤（与其他列表页一致）
  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  async function toggleFollow() {
    if (followBusy) return
    setFollowBusy(true)
    setFollowError(null)
    try {
      if (following) {
        await session.call((token) => unfollowTag(tag, token))
        setFollowing(false)
      } else {
        await session.call((token) => followTag(tag, "public", token))
        setFollowing(true)
      }
    } catch (err: any) {
      setFollowError(err?.message ?? "操作失败，请稍后重试")
    } finally {
      setFollowBusy(false)
    }
  }

  return (
    <RefreshableScrollView
      navigationTitle={`#${tag}`}
      navigationBarTitleDisplayMode="inline"
      refreshable={paged.refresh}
    >
      <VStack alignment="leading" spacing={10} padding={{ top: 4 }}>
        <HStack spacing={8} padding={{ horizontal: 14 }}>
          <Button
            title={following ? "已关注标签" : "关注标签"}
            systemImage={following ? "star.fill" : "star"}
            buttonStyle={following ? "glass" : "glassProminent"}
            tint={following ? undefined : "#0096FA"}
            controlSize="small"
            disabled={followBusy}
            action={toggleFollow}
          />
        </HStack>
        {followError ? (
          <Text
            font="footnote"
            foregroundStyle="systemRed"
            padding={{ horizontal: 14 }}
          >
            {followError}
          </Text>
        ) : null}

        {paged.initialLoading ? (
          <LoadingView />
        ) : paged.error && paged.items.length === 0 ? (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        ) : paged.items.length === 0 ? (
          <EmptyView text="该标签下暂无作品" />
        ) : (
          <IllustFlowFeed
            items={paged.items}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

// 标签流过滤：屏蔽标签、R18/R18G 与 AI 设置均在翻页时生效。
function filterTagItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}
