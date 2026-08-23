import {
  Button,
  Divider,
  FlowLayout,
  Group,
  HStack,
  Image,
  LazyVStack,
  LongPressGesture,
  Menu,
  NavigationLink,
  ProgressView,
  ScrollView,
  ScrollViewReader,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useRef,
  useState,
  VStack,
  type ScrollViewProxy,
} from "scripting"
import {
  addNovelBookmark,
  addNovelMarker,
  deleteNovelMarker,
  followUser,
  nextNovels,
  novelBookmarkDetail,
  novelBookmarkTags,
  novelDetail,
  novelViewerData,
  relatedNovels,
  removeNovelBookmark,
  unfollowUser,
} from "../api/pixiv"
import { session } from "../api/session"
import {
  currentBatchSize,
  useAsyncGuard,
  useLatest,
  useNovelBookmark,
  useNovelMarker,
  usePagedList,
  waitForNovelLoadingFeedback,
} from "./hooks"
import { novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  recordNovelHistory,
  updateNovelHistoryBookmark,
} from "../store/history"
import { getSeriesByWorkID, recordWorkSeriesAssociation } from "../store/seriesCache"
import {
  isUserFollowed,
  onUserFollowChanged,
  recordUserFollowed,
} from "../store/userFollow"
import { getCachedNovelBookmark } from "../store/bookmarkSync"
import type { PixivNovel, PixivNovelDetail, TextEmbeddedImage } from "../types"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  getNovelContentBlockReason,
  isNovelContentVisible,
} from "../store/contentFilter"
import {
  AvatarImage,
  BookmarkDetailSheet,
  ErrorView,
  ExpandableIntroduction,
  formatDate,
  formatNumber,
  LoadingView,
  LoadMoreTrigger,
  NovelCard,
  SeriesEpisodePager,
  TagChip,
} from "./components"
import { NovelReaderView, NovelReaderWebView } from "./novelReader"
import { CommentsSheet } from "./comments"
import { renderDestination } from "./routes"
import { requestPixivRoute } from "./routeNavigation"

const BLOCKED_BY_BLOCKLIST_MESSAGE = "该小说已被屏蔽（标签或作者在黑名单中）"
const BLOCKED_BY_RESTRICTION_MESSAGE = "该小说被内容显示设置过滤，暂时无法显示"

function historyNovelFromDetail(detail: PixivNovelDetail): PixivNovel {
  return { ...detail, is_muted: false, visible: true }
}

export function NovelDetailView(props: { novelID: number }) {
  const { novelID } = props
  const [novel, setNovel] = useState<PixivNovelDetail | null>(null)
  const [text, setText] = useState("")
  const [textEmbeddedImages, setTextEmbeddedImages] = useState<Record<string, TextEmbeddedImage> | undefined>(undefined)
  const [textError, setTextError] = useState<string | null>(null)
  const [readerReady, setReaderReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bookmarked, setBookmarked] = useNovelBookmark(novelID, false)
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [bookmarkLongPressLocked, setBookmarkLongPressLocked] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  const [followed, setFollowed] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [markerPage, setMarkerPage] = useNovelMarker(novelID, null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [markerBusy, setMarkerBusy] = useState(false)

  const guard = useAsyncGuard()
  const novelRef = useLatest(novel)
  const errorRef = useLatest(error)
  const currentPageRef = useLatest(currentPage)
  const markerPageRef = useLatest(markerPage)
  const proxyRef = useRef<ScrollViewProxy | null>(null)
  const hasAutoJumpedRef = useRef(false)
  const recordedIDRef = useRef<number | null>(null)

  async function load() {
    const g = guard()
    setLoading(true)
    setReaderReady(false)
    setError(null)
    try {
      const [detail, viewer] = await Promise.all([
        session.call((token) => novelDetail(novelID, token)),
        session.call((token) => novelViewerData(novelID, token)),
      ])
      if (!g.isCurrent()) return
      if (detail.user?.id) {
        recordUserFollowed(detail.user.id, detail.user.is_followed ?? false)
      }
      const settings = loadSettings()
      const isExempt =
        settings.exemptFilterForPersonal &&
        (detail.user?.is_followed === true ||
          (detail.user?.id != null && isUserFollowed(detail.user.id) === true) ||
          detail.is_bookmarked === true ||
          getCachedNovelBookmark(detail.id) === true ||
          followed ||
          bookmarked)
      const blockReason = getNovelContentBlockReason(detail, settings, undefined, {
        exemptRestrictions: isExempt,
      })
      if (blockReason !== null) {
        setNovel(null)
        setText("")
        setError(
          blockReason === "blocklist"
            ? BLOCKED_BY_BLOCKLIST_MESSAGE
            : BLOCKED_BY_RESTRICTION_MESSAGE
        )
        return
      }

      setNovel(detail)
      setBookmarked(detail.is_bookmarked)
      setFollowed(detail.user?.is_followed ?? false)
      const initialMarker = (detail as any)?.novel_marker?.page ?? (detail as any)?.marker?.page ?? null
      if (initialMarker !== null) {
        setMarkerPage(initialMarker)
        if (!hasAutoJumpedRef.current && initialMarker > 1 && readerReady) {
          hasAutoJumpedRef.current = true
          setTimeout(() => {
            jumpToPage(initialMarker)
          }, 160)
        }
      }
      if (recordedIDRef.current !== detail.id) {
        recordedIDRef.current = detail.id
        recordNovelHistory(historyNovelFromDetail(detail))
      }
      const resolvedEmbeddedImages =
        viewer.textEmbeddedImages ??
        (detail as any)?.textEmbeddedImages ??
        (detail as any)?.text_embedded_images ??
        undefined
      setText(viewer.text)
      setTextEmbeddedImages(resolvedEmbeddedImages)
      setTextError(null)
      if (!viewer.text) {
        setReaderReady(true)
      }
    } catch (err: any) {
      if (g.isCurrent()) {
        setError(err?.message ?? "加载失败")
        setReaderReady(true)
      }
    } finally {
      if (g.isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelID])

  useEffect(() => {
    return onUserFollowChanged((changedUserID, nextFollowed) => {
      if (changedUserID === novelRef.current?.user?.id) {
        setFollowed(nextFollowed)
      }
    })
  }, [])

  // 屏蔽黑名单变化时撤下或恢复已打开的内容。
  useEffect(() => {
    return onSettingsChanged(() => {
      const settings = loadSettings()
      const current = novelRef.current
      if (current) {
        const isExempt =
          settings.exemptFilterForPersonal &&
          (current.user?.is_followed === true ||
            (current.user?.id != null && isUserFollowed(current.user.id) === true) ||
            current.is_bookmarked === true ||
            getCachedNovelBookmark(current.id) === true ||
            followed ||
            bookmarked)
        const blockReason = getNovelContentBlockReason(current, settings, undefined, {
          exemptRestrictions: isExempt,
        })
        if (blockReason !== null) {
          guard()
          setNovel(null)
          setText("")
          setTextEmbeddedImages(undefined)
          setError(
            blockReason === "blocklist"
              ? BLOCKED_BY_BLOCKLIST_MESSAGE
              : BLOCKED_BY_RESTRICTION_MESSAGE
          )
          setLoading(false)
        }
      } else if (
        !current &&
        (errorRef.current === BLOCKED_BY_BLOCKLIST_MESSAGE ||
          errorRef.current === BLOCKED_BY_RESTRICTION_MESSAGE)
      ) {
        load()
      }
    })
  }, [bookmarked, followed])

  async function toggleBookmark() {
    if (!novel || bookmarkLoading) return
    void Haptics.transient()
    setBookmarkLoading(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeNovelBookmark(novel.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) =>
          addNovelBookmark(novel.id, "public", token)
        )
        setBookmarked(true)
      }
      updateNovelHistoryBookmark(novel.id, !bookmarked)
    } catch {
      // ignore
    } finally {
      setBookmarkLoading(false)
    }
  }

  async function bookmarkAndFollow() {
    if (!novel || bookmarkLoading) return
    setBookmarkLoading(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addNovelBookmark(novel.id, "public", token))
        setBookmarked(true)
        updateNovelHistoryBookmark(novel.id, true)
      }
      await session.call((token) => followUser(novel.user.id, "public", token))
      setFollowed(true)
    } catch {
      // ignore
    } finally {
      setBookmarkLoading(false)
    }
  }

  function handleBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    void Haptics.transient()
    if (action === "follow") {
      void bookmarkAndFollow()
    } else {
      setShowBookmarkDetail(true)
    }
  }

  async function followWithVisibility(restrict: "public" | "private") {
    if (!novel || followLoading) return
    void Haptics.transient()
    setFollowLoading(true)
    try {
      await session.call((token) => followUser(novel.user.id, restrict, token))
      setFollowed(true)
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  async function toggleFollow() {
    if (!novel || followLoading) return
    if (!followed) {
      await followWithVisibility("public")
      return
    }
    void Haptics.transient()
    setFollowLoading(true)
    try {
      await session.call((token) => unfollowUser(novel.user.id, token))
      setFollowed(false)
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  const jumpToPage = useCallback((targetPage: number) => {
    const proxy = proxyRef.current
    if (!proxy) return
    const targetKey = `novel-page-${targetPage}`
    try {
      proxy.scrollTo(targetKey, "top")
    } catch {
      // ignore
    }
  }, [])

  const handleReaderReady = useCallback(
    (parsedTotalPages: number) => {
      setTotalPages(parsedTotalPages)
      setReaderReady(true)
      if (!hasAutoJumpedRef.current) {
        hasAutoJumpedRef.current = true
        const targetMarker = markerPageRef.current
        if (targetMarker != null && targetMarker > 1) {
          setTimeout(() => {
            jumpToPage(targetMarker)
          }, 160)
        }
      }
    },
    [jumpToPage]
  )

  async function handleToggleMarker() {
    if (!novel || markerBusy) return
    void Haptics.transient()
    setMarkerBusy(true)
    const target = currentPageRef.current || 1
    try {
      if (markerPage === target) {
        await session.call((token) => deleteNovelMarker(novel.id, token))
        setMarkerPage(null)
      } else {
        await session.call((token) => addNovelMarker(novel.id, target, token))
        setMarkerPage(target)
      }
    } catch {
      // ignore
    } finally {
      setMarkerBusy(false)
    }
  }

  async function shareNovel() {
    if (!novel) return
    void Haptics.transient()
    await ShareSheet.present([`https://www.pixiv.net/novel/show.php?id=${novel.id}`])
  }

  if (loading) {
    return (
      <ScrollView
        navigationTitle="小说"
        navigationBarTitleDisplayMode="inline"
      >
        <LoadingView />
      </ScrollView>
    )
  }
  if (error || !novel) {
    return (
      <ScrollView
        navigationTitle="小说"
        navigationBarTitleDisplayMode="inline"
      >
        <ErrorView message={error ?? "小说不存在"} onRetry={load} />
      </ScrollView>
    )
  }

  const current = novel
  const rawSeries = current.series ?? (current as any).novel_series
  const rawSeriesObj = Array.isArray(rawSeries) ? rawSeries[0] : rawSeries
  const associatedRef = getSeriesByWorkID(current.id, "novel")
  const resolvedSeriesID = rawSeriesObj?.id ?? associatedRef?.seriesID ?? null
  const resolvedSeriesTitle = rawSeriesObj?.title ?? associatedRef?.seriesTitle ?? null
  const resolvedEpisodeNumber = current.episode_number ?? associatedRef?.episodeNumber ?? null

  if (resolvedSeriesID) {
    recordWorkSeriesAssociation(current.id, "novel", resolvedSeriesID, resolvedSeriesTitle, resolvedEpisodeNumber)
  }

  return (
    <ScrollViewReader>
      {(proxy) => {
        proxyRef.current = proxy
        return (
          <ScrollView
            navigationTitle={current.title}
            navigationBarTitleDisplayMode="inline"
            onScrollTargetVisibilityChange={{
              idType: "string",
              threshold: 0.1,
              onChanged: (visibleIds) => {
                const pageNumbers = (visibleIds as string[])
                  .map((id) => {
                    const m = /^novel-page-(\d+)$/.exec(id)
                    return m ? Number(m[1]) : null
                  })
                  .filter((p): p is number => p !== null)
                if (pageNumbers.length > 0) {
                  const minPage = Math.min(...pageNumbers)
                  setCurrentPage(minPage)
                }
              },
            }}
            toolbar={{
              topBarTrailing: [
                <Button
                  disabled={bookmarkLoading || bookmarkLongPressLocked}
                  action={toggleBookmark}
                  simultaneousGesture={
                    LongPressGesture({ minDuration: 500 }).onEnded(() => {
                      setBookmarkLongPressLocked(true)
                      handleBookmarkLongPress()
                      setTimeout(() => setBookmarkLongPressLocked(false), 1500)
                    })
                  }
                >
                  <Image
                    systemName={bookmarked ? "heart.fill" : "heart"}
                    foregroundStyle={bookmarked ? "#FF375F" : undefined}
                  />
                </Button>,
                <Button
                  disabled={followLoading}
                  action={toggleFollow}
                  contextMenu={{
                    menuItems: (
                      <Group>
                        <Button
                          title={followed ? "设为私密关注" : "私密关注"}
                          systemImage="lock"
                          disabled={followLoading}
                          action={() => void followWithVisibility("private")}
                        />
                      </Group>
                    ),
                  }}
                >
                  <Image
                    systemName={followed ? "person.fill.checkmark" : "person.badge.plus"}
                  />
                </Button>,
                <Menu label={<Image systemName="ellipsis.circle" />}>
                  <Button
                    title="评论"
                    systemImage="bubble.left"
                    action={() => setShowComments(true)}
                  />
                  <Button
                    title="书签"
                    systemImage={markerPage !== null ? "book.pages.fill" : "book.pages"}
                    disabled={markerBusy}
                    action={handleToggleMarker}
                  />
            {Boolean(resolvedSeriesID) && (
              <Button
                title="系列"
                systemImage="books.vertical"
                action={() => requestPixivRoute(`novelSeries:${resolvedSeriesID}`)}
              />
            )}
            <Button
              title="分享"
              systemImage="square.and.arrow.up"
              action={shareNovel}
            />
            <Divider />
            <Menu title="信息" systemImage="info.circle">
              <Button
                title={`作者：${current.user.name}`}
                action={() => Pasteboard.setString(current.user.name)}
              />
              <Button
                title={`UID：${current.user.id}`}
                action={() => Pasteboard.setString(String(current.user.id))}
              />
              <Button
                title={`标题：${current.title}`}
                action={() => Pasteboard.setString(current.title)}
              />
              <Button
                title={`NID：${current.id}`}
                action={() => Pasteboard.setString(String(current.id))}
              />
              {Boolean(resolvedSeriesID) && (
                <Button
                  title={`系列：${resolvedSeriesTitle || "未命名系列"}`}
                  action={() => Pasteboard.setString(resolvedSeriesTitle ?? "")}
                />
              )}
              {Boolean(resolvedSeriesID) && (
                <Button
                  title={`SID：${resolvedSeriesID}`}
                  action={() => Pasteboard.setString(String(resolvedSeriesID))}
                />
              )}
              {Boolean(current.page_count && current.page_count > 1) && (
                <Button
                  title={`页数：${current.page_count}页`}
                  action={() => Pasteboard.setString(`页数：${current.page_count}页`)}
                />
              )}
              {Boolean(current.text_length || text.length) && (
                <Button
                  title={`字数：${current.text_length || text.length}字`}
                  action={() => Pasteboard.setString(`字数：${current.text_length || text.length}字`)}
                />
              )}
            </Menu>
          </Menu>,
          <NavigationLink value={`user:${current.user.id}`}>
            <AvatarImage
              url={current.user.profile_image_urls?.medium ?? null}
              size={28}
            />
          </NavigationLink>,
        ],
      }}
    >
      <VStack
        scrollTargetLayout
        alignment="leading"
        spacing={12}
        frame={{ maxWidth: "infinity" }}
      >
        <VStack alignment="leading" spacing={8} padding={{ horizontal: 14, top: 12 }}>
          {/* 统计指标 */}
          <HStack spacing={10}>
            <HStack spacing={3}>
              <Image systemName="eye" font="footnote" />
              <Text font="footnote">
                {formatNumber(current.total_view)}
              </Text>
            </HStack>
            <HStack spacing={3}>
              <Image systemName="heart" font="footnote" />
              <Text font="footnote">
                {formatNumber(current.total_bookmarks)}
              </Text>
            </HStack>
            <HStack spacing={3}>
              <Image systemName="bubble.left" font="footnote" />
              <Text font="footnote">
                {formatNumber(current.total_comments)}
              </Text>
            </HStack>
            {Boolean(current.text_length || text.length) && (
              <HStack spacing={3}>
                <Image systemName="character.cursor.ibeam" font="footnote" />
                <Text font="footnote">
                  {current.text_length ?? text.length}
                </Text>
              </HStack>
            )}
            <Text font="footnote">
              {formatDate(current.create_date)}
            </Text>
          </HStack>

          {/* 系列 */}
          {Boolean(resolvedSeriesID) || Boolean(current.series_prev?.id) || Boolean(current.series_next?.id) ? (
            <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
              <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
                系列
              </Text>
              <VStack
                alignment="leading"
                spacing={10}
                padding={{ top: 12, horizontal: 12, bottom: 12 }}
                glassEffect={{ type: "rect", cornerRadius: 14 }}
                frame={{ maxWidth: "infinity" }}
                contentShape="rect"
              >
                {Boolean(resolvedSeriesID) ? (
                  <NavigationLink
                    value={`novelSeries:${resolvedSeriesID}`}
                    frame={{ maxWidth: "infinity" }}
                  >
                    <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
                      <Text
                        font="subheadline"
                        fontWeight="semibold"
                        foregroundStyle="#007AFF"
                        lineLimit={2}
                      >
                        {resolvedSeriesTitle || "系列详情"}
                      </Text>
                      <Spacer />
                      <Image
                        systemName="chevron.right"
                        font="footnote"
                        fontWeight="semibold"
                        foregroundStyle="secondaryLabel"
                      />
                    </HStack>
                  </NavigationLink>
                ) : null}

                {(Boolean(current.series_prev?.id) || Boolean(current.series_next?.id)) &&
                Boolean(resolvedSeriesID) ? (
                  <Divider />
                ) : null}

                {Boolean(current.series_prev?.id) && current.series_prev ? (
                  <NavigationLink value={`novel:${current.series_prev.id}`}>
                    <Text font="subheadline" foregroundStyle="#007AFF" lineLimit={1}>
                      ← 上一话：{current.series_prev.title || "上一话"}
                    </Text>
                  </NavigationLink>
                ) : null}

                {Boolean(current.series_next?.id) && current.series_next ? (
                  <NavigationLink value={`novel:${current.series_next.id}`}>
                    <Text font="subheadline" foregroundStyle="#007AFF" lineLimit={1}>
                      下一话：{current.series_next.title || "下一话"} →
                    </Text>
                  </NavigationLink>
                ) : null}
              </VStack>
            </VStack>
          ) : null}

          {/* 简介 */}
          <ExpandableIntroduction
            title="简介"
            caption={current.caption}
            routeDestination={renderDestination}
          />

          {/* 标签 */}
          {current.tags.length > 0 ? (
            <VStack alignment="leading" spacing={6}>
              <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
                标签
              </Text>
              <FlowLayout spacing={6}>
                {current.tags.map((tag) => (
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

        {/* 正文 */}
        <VStack alignment="leading" spacing={0} padding={{ top: 4, bottom: 0 }} frame={{ maxWidth: "infinity" }}>
          {text ? (
            <NovelReaderView
              text={text}
              title={current.title}
              markerPage={markerPage}
              textEmbeddedImages={textEmbeddedImages}
              onPageVisible={(page) => setCurrentPage(page)}
              onJumpToPage={jumpToPage}
              onReady={handleReaderReady}
            />
          ) : (
            <VStack padding={{ horizontal: 14 }}>
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {textError ?? "（正文为空）"}
              </Text>
            </VStack>
          )}
        </VStack>

        {/* 话数翻页器 */}
        <SeriesEpisodePager
          workID={current.id}
          seriesID={resolvedSeriesID}
          seriesTitle={resolvedSeriesTitle}
          kind="novel"
          seriesPrev={current.series_prev}
          seriesNext={current.series_next}
          episodeNumber={resolvedEpisodeNumber}
        />

        {/* 相关作品 */}
        <RelatedNovelsSection
          key={current.id}
          novelID={current.id}
          ready={!loading && readerReady}
        />
      </VStack>

      <VStack
        sheet={{
          content: <CommentsSheet novelID={current.id} />,
          isPresented: showComments,
          onChanged: setShowComments,
        }}
      />
      <VStack
        sheet={{
          content: (
            <BookmarkDetailSheet
              item={current}
              bookmarked={bookmarked}
              loadDetail={(token) => novelBookmarkDetail(current.id, token)}
              loadTags={(restrict, token) =>
                novelBookmarkTags(restrict, token)
              }
              save={(restrict, tags, token) =>
                addNovelBookmark(current.id, restrict, token, tags)
              }
              onSaved={() => {
                setBookmarked(true)
                updateNovelHistoryBookmark(current.id, true)
              }}
              onClose={() => setShowBookmarkDetail(false)}
            />
          ),
          isPresented: showBookmarkDetail,
          onChanged: setShowBookmarkDetail,
        }}
      />
    </ScrollView>
        )
      }}
    </ScrollViewReader>
  )
}

function RelatedNovelsSection(props: {
  novelID: number
  ready?: boolean
}) {
  const { novelID, ready = true } = props

  // 1. 网络层：主正文就绪后后台请求相关作品，避免与正文抢占网络带宽和调度队列
  const paged = usePagedList<PixivNovel>({
    first: (token) => relatedNovels(novelID, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => filterRelatedNovels(items, novelID),
    deps: [novelID],
    enabled: ready,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })
  const pagedRef = useLatest(paged)

  // 2. UI交互层：正文末尾触底后播放加载动画，人为提供缓冲防止手势滚过
  const [revealed, setRevealed] = useState(false)
  const [animating, setAnimating] = useState(false)
  const animatingTaskRef = useRef<number>(0)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  const handleBottomAppear = useCallback(() => {
    if (revealed || animating) return
    const taskId = ++animatingTaskRef.current
    setAnimating(true)
    void waitForNovelLoadingFeedback().then(() => {
      if (animatingTaskRef.current === taskId) {
        setAnimating(false)
        setRevealed(true)
      }
    })
  }, [revealed, animating])

  if (!ready) {
    return null
  }

  // 尚未触底：正文末尾放置 LazyVStack 触底哨兵，不提前渲染卡片列表，防止用户惯性滚过
  if (!revealed && !animating) {
    return (
      <LazyVStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
        <VStack
          key={`novel-related-trigger:${novelID}`}
          spacing={0}
          frame={{ height: 44, maxWidth: "infinity" }}
          onAppear={handleBottomAppear}
        />
      </LazyVStack>
    )
  }

  // 触底动画播放中（展示设置中的 novelLoadingDuration，默认 2000ms）或数据仍在后台加载中
  const showLoading = animating || paged.initialLoading

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ top: 4, bottom: 32 }}
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
      {showLoading ? (
        <HStack spacing={0} frame={{ maxWidth: "infinity", height: 100 }}>
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
            action={() => {
              handleBottomAppear()
              paged.refresh()
            }}
          />
        </VStack>
      ) : paged.items.length > 0 ? (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 10 }}>
          {paged.items.map((novel, index) => (
            <NovelCard key={novel.id} novel={novel} priority={index} />
          ))}
          <LoadMoreTrigger
            anchor={paged.items[paged.items.length - 1].id}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
          />
        </LazyVStack>
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

function filterRelatedNovels(
  items: PixivNovel[],
  currentNovelID?: number
): PixivNovel[] {
  const settings = loadSettings()
  return items.filter(
    (item) =>
      item.id !== currentNovelID &&
      isNovelContentVisible(item, settings)
  )
}
