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
  Spacer,
  Text,
  useCallback,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  addNovelBookmark,
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
  usePagedList,
  waitForNovelLoadingFeedback,
} from "./hooks"
import { novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  recordNovelHistory,
  updateNovelHistoryBookmark,
} from "../store/history"
import { onUserFollowChanged, recordUserFollowed } from "../store/userFollow"
import type { PixivNovel, PixivNovelDetail, TextEmbeddedImage } from "../types"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
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
  TagChip,
} from "./components"
import { NovelReaderView, NovelReaderWebView } from "./novelReader"
import { CommentsSheet } from "./comments"
import { renderDestination } from "./routes"
import { requestPixivRoute } from "./routeNavigation"

const BLOCKED_CONTENT_MESSAGE = "该小说已被屏蔽（标签或作者在黑名单中）"

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

  const guard = useAsyncGuard()
  const novelRef = useLatest(novel)
  const errorRef = useLatest(error)
  const recordedIDRef = useRef<number | null>(null)

  async function load() {
    const g = guard()
    setLoading(true)
    setReaderReady(false)
    setError(null)
    try {
      const detail = await session.call((token) => novelDetail(novelID, token))
      if (!g.isCurrent()) return
      if (detail.user?.id) {
        recordUserFollowed(detail.user.id, detail.user.is_followed ?? false)
      }
      const settings = loadSettings()
      if (!isNovelContentVisible(detail, settings)) {
        setNovel(null)
        setText("")
        setError(BLOCKED_CONTENT_MESSAGE)
        return
      }

      const viewer = await session.call((token) => novelViewerData(novelID, token))
      if (!g.isCurrent()) return
      setNovel(detail)
      setBookmarked(detail.is_bookmarked)
      setFollowed(detail.user?.is_followed ?? false)
      if (recordedIDRef.current !== detail.id) {
        recordedIDRef.current = detail.id
        recordNovelHistory(historyNovelFromDetail(detail))
      }
      setText(viewer.text)
      setTextEmbeddedImages(viewer.textEmbeddedImages)
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
        if (!isNovelContentVisible(current, settings)) {
          guard()
          setNovel(null)
          setText("")
          setTextEmbeddedImages(undefined)
          setError(BLOCKED_CONTENT_MESSAGE)
          setLoading(false)
        }
      } else if (
        !current &&
        errorRef.current === BLOCKED_CONTENT_MESSAGE
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

  return (
    <ScrollView
      navigationTitle={current.title}
      navigationBarTitleDisplayMode="inline"
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
            {Boolean(current.series?.id) && (
              <Button
                title="系列"
                systemImage="books.vertical"
                action={() => requestPixivRoute(`novelSeries:${current.series!.id}`)}
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
              {Boolean(current.series?.id) && (
                <Button
                  title={`系列：${current.series?.title || "未命名系列"}`}
                  action={() => Pasteboard.setString(current.series?.title ?? "")}
                />
              )}
              {Boolean(current.series?.id) && (
                <Button
                  title={`SID：${current.series?.id}`}
                  action={() => Pasteboard.setString(String(current.series?.id))}
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
      <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity" }}>
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
          {Boolean(current.series?.id) || Boolean(current.series_prev?.id) || Boolean(current.series_next?.id) ? (
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
                {Boolean(current.series?.id) && current.series ? (
                  <NavigationLink
                    value={`novelSeries:${current.series.id}`}
                    frame={{ maxWidth: "infinity" }}
                  >
                    <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
                      <Text
                        font="subheadline"
                        fontWeight="semibold"
                        foregroundStyle="#007AFF"
                        lineLimit={2}
                      >
                        {current.series.title || "系列详情"}
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
                Boolean(current.series?.id) ? (
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
              textEmbeddedImages={textEmbeddedImages}
              onReady={() => setReaderReady(true)}
            />
          ) : (
            <VStack padding={{ horizontal: 14 }}>
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {textError ?? "（正文为空）"}
              </Text>
            </VStack>
          )}
        </VStack>

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
}

function RelatedNovelsSection(props: {
  novelID: number
  ready?: boolean
}) {
  const { novelID, ready = true } = props

  // 1. 网络层：进入后立即后台请求相关作品，减少后续等待时间
  const paged = usePagedList<PixivNovel>({
    first: (token) => relatedNovels(novelID, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => filterRelatedNovels(items, novelID),
    deps: [novelID],
    enabled: true,
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
          <VStack alignment="center" spacing={8}>
            <ProgressView progressViewStyle="circular" />
            <Text font="caption" foregroundStyle="secondaryLabel">
              正在加载相关作品...
            </Text>
          </VStack>
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
