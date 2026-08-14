import {
  Button,
  Divider,
  HStack,
  LongPressGesture,
  Image,
  LazyVStack,
  Menu,
  NavigationLink,
  ScrollView,
  Text,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  WebView,
} from "scripting"
import {
  addBookmark,
  bookmarkDetail,
  bookmarkTags,
  followDetail,
  followUser,
  illustrationDetail,
  nextIllustrations,
  relatedIllustrations,
  removeBookmark,
  unfollowUser,
} from "../api/pixiv"
import { session } from "../api/session"
import { cardThumbUrlOf, imageUrlOf, loadImage, prefetch } from "../image/imageLoader"
import {
  isIllustContentVisible,
  isR18ContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { recordHistory, updateHistoryBookmark } from "../store/history"
import { useAsyncGuard, useLatest, usePagedList } from "./hooks"
import type { PixivIllustration } from "../types"
import {
  AvatarImage,
  BookmarkDetailSheet,
  CachedImage,
  ErrorView,
  MasonryIllustFeed,
  formatDate,
  formatNumber,
  htmlToPlainText,
  LoadingView,
  TagChip,
} from "./components"
import { CommentsSheet } from "./comments"
import { UgoiraPlayerView } from "./ugoiraView"
import { buildUgoira } from "../ugoira/ugoira"

const RESTRICTED_CONTENT_MESSAGE = "该作品已被内容分级设置隐藏"

export function IllustDetailView(props: { illustID: number }) {
  const { illustID } = props
  const [illust, setIllust] = useState<PixivIllustration | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [bookmarkLongPressLocked, setBookmarkLongPressLocked] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  const [followed, setFollowed] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [quality, setQuality] = useState(loadSettings().detailImageQuality)
  const guard = useAsyncGuard()
  const illustRef = useLatest(illust)
  const errorRef = useLatest(error)
  const restrictedLevelRef = useRef<number | null>(null)
  // 同一实例只记录一次浏览（下拉刷新/重试不重复刷新 viewedAt）；换作品时重置
  const recordedIDRef = useRef<number | null>(null)

  async function load() {
    const g = guard()
    setLoading(true)
    setError(null)
    try {
      const detail = await session.call((token) =>
        illustrationDetail(illustID, token)
      )
      if (!g.isCurrent()) return
      const settings = loadSettings()
      if (
        !isIllustContentVisible(detail, settings)
      ) {
        restrictedLevelRef.current = detail.x_restrict
        setIllust(null)
        setError(RESTRICTED_CONTENT_MESSAGE)
        return
      }
      restrictedLevelRef.current = null
      setIllust(detail)
      setBookmarked(detail.is_bookmarked)
      setFollowed(detail.user.is_followed ?? false)
      // 本地浏览记录：同一实例只记一次（与 Hanairo 的 didRecordHistory 一致）
      if (recordedIDRef.current !== detail.id) {
        recordedIDRef.current = detail.id
        recordHistory(detail)
      }
      // 预取前几页大图（meta_pages 缺失时走 URL 推导兜底）
      const prefetchURLs: (string | null | undefined)[] = []
      if (detail.meta_pages.length > 0) {
        prefetchURLs.push(
          ...detail.meta_pages
            .slice(0, 4)
            .map((p) => p.image_urls?.large ?? p.image_urls?.medium)
        )
      } else {
        const total = Math.min(4, detail.page_count || 1)
        for (let k = 0; k < total; k++) {
          prefetchURLs.push(imageUrlOf(detail, k, loadSettings().detailImageQuality))
        }
      }
      prefetch(prefetchURLs)
      // 并行加载收藏状态与关注状态（与主请求共用序号：页面切换后全部作废）
      session
        .call((token) => bookmarkDetail(illustID, token))
        .then((d) => {
          if (g.isCurrent()) setBookmarked(d.is_bookmarked)
        })
        .catch(() => {})
      if (detail.user.is_followed == null) {
        session
          .call((token) => followDetail(detail.user.id, token))
          .then((d) => {
            if (g.isCurrent()) setFollowed(d.is_followed)
          })
          .catch(() => {})
      }
    } catch (err: any) {
      if (g.isCurrent()) setError(err?.message ?? "加载失败")
    } finally {
      if (g.isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [illustID])

  // 设置变化时更新图片质量；关闭 R18 后立即撤下已打开的受限内容。
  useEffect(() => {
    return onSettingsChanged(() => {
      const settings = loadSettings()
      setQuality(settings.detailImageQuality)
      const current = illustRef.current
      if (
        current &&
        !isIllustContentVisible(current, settings)
      ) {
        restrictedLevelRef.current = current.x_restrict
        guard()
        setIllust(null)
        setError(RESTRICTED_CONTENT_MESSAGE)
        setLoading(false)
      } else if (
        !current &&
        errorRef.current === RESTRICTED_CONTENT_MESSAGE &&
        restrictedLevelRef.current != null &&
        isR18ContentVisible(
          restrictedLevelRef.current,
          settings.showR18,
          settings.showR18G
        )
      ) {
        load()
      }
    })
  }, [])

  if (loading) {
    return (
      <ScrollView navigationTitle="作品详情" navigationBarTitleDisplayMode="inline">
        <LoadingView />
      </ScrollView>
    )
  }
  if (error || !illust) {
    return (
      <ScrollView navigationTitle="作品详情" navigationBarTitleDisplayMode="inline">
        <ErrorView message={error ?? "作品不存在"} onRetry={load} />
      </ScrollView>
    )
  }

  const current = illust
  const pageCount = Math.max(1, current.page_count || current.meta_pages.length || 1)
  // 无限滚动：一次性生成所有页的图片 URL（meta_pages 缺失时由 imageUrlOf 推导）
  const pageURLs: (string | null)[] = []
  for (let k = 0; k < pageCount; k++) {
    pageURLs.push(imageUrlOf(current, k, quality))
  }
  const pageAspect =
    current.width && current.height ? current.width / current.height : 0.75

  async function toggleBookmark() {
    if (bookmarkLoading) return
    setBookmarkLoading(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeBookmark(current.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) =>
          addBookmark(current.id, "public", [], token)
        )
        setBookmarked(true)
      }
      // 同步本地浏览记录中的收藏状态（若该作品在历史中）
      updateHistoryBookmark(current.id, !bookmarked)
    } catch {
      // ignore
    } finally {
      setBookmarkLoading(false)
    }
  }

  async function bookmarkAndFollow() {
    if (bookmarkLoading) return
    setBookmarkLoading(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addBookmark(current.id, "public", [], token))
        setBookmarked(true)
        updateHistoryBookmark(current.id, true)
      }
      await session.call((token) => followUser(current.user.id, "public", token))
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

  async function savePages() {
    // 动图：保存合成后的 mp4
    if (current.type === "ugoira") {
      try {
        const result = await buildUgoira(current.id)
        await Photos.saveVideo(result.mp4Path, {
          fileName: `pixiv_${current.id}`,
        })
      } catch {
        // ignore
      }
      return
    }
    // 图片：按下载质量保存单页或全部页（单页失败不中断整批）
    const downloadQuality = loadSettings().downloadImageQuality
    for (let i = 0; i < pageCount; i++) {
      const url = imageUrlOf(current, i, downloadQuality) ?? pageURLs[i]
      if (!url) continue
      try {
        const path = await loadImage(url)
        if (path) {
          await Photos.savePhoto(path, {
            fileName: `pixiv_${current.id}_p${i + 1}`,
          })
        }
      } catch {
        // 该页失败继续下一页
      }
    }
  }

  async function toggleFollow() {
    if (followLoading) return
    setFollowLoading(true)
    try {
      if (followed) {
        await session.call((token) => unfollowUser(current.user.id, token))
        setFollowed(false)
      } else {
        await session.call((token) => followUser(current.user.id, "public", token))
        setFollowed(true)
      }
    } catch {
      // ignore
    } finally {
      setFollowLoading(false)
    }
  }

  async function shareIllust() {
    await ShareSheet.present([`https://www.pixiv.net/artworks/${current.id}`])
  }

  return (
    <ScrollView
      navigationTitle={current.title}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarTrailing: [
          <Button
            buttonStyle="glass"
            frame={{ width: 30, height: 30 }}
            clipShape={{ type: "rect", cornerRadius: 15 }}
            contentShape="rect"
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
          <Menu
            label={<Image systemName="ellipsis.circle" />}
            buttonStyle="glass"
            frame={{ width: 30, height: 30 }}
            clipShape={{ type: "rect", cornerRadius: 15 }}
            contentShape="rect"
          >
            <Button
              title="评论"
              systemImage="bubble.left"
              action={() => setShowComments(true)}
            />
            <Button
              title={followed ? "取消关注" : "关注"}
              systemImage={followed ? "person.fill.checkmark" : "person.badge.plus"}
              disabled={followLoading}
              action={toggleFollow}
            />
            <Button
              title="下载"
              systemImage="square.and.arrow.down"
              action={savePages}
            />
            <Button
              title="分享"
              systemImage="square.and.arrow.up"
              action={shareIllust}
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
                title={`PID：${current.id}`}
                action={() => Pasteboard.setString(String(current.id))}
              />
            </Menu>
          </Menu>,
          <NavigationLink
            value={`user:${current.user.id}`}
            buttonStyle="glass"
            frame={{ width: 30, height: 30 }}
            clipShape={{ type: "rect", cornerRadius: 15 }}
            contentShape="rect"
          >
            <AvatarImage
              url={current.user.profile_image_urls?.medium ?? null}
              size={28}
            />
          </NavigationLink>,
        ],
      }}
     
    >
      <VStack alignment="leading" spacing={12}>
        {/* 大图区：动图走播放器；图片无限向下滚动展示全部页 */}
        <VStack
          alignment="center"
          spacing={8}
          frame={{ maxWidth: "infinity" }}
          background="systemGray6"
          padding={{ vertical: 10 }}
        >
          {current.type === "ugoira" ? (
            <UgoiraPlayerView
              illustID={current.id}
              aspectRatioValue={pageAspect}
            />
          ) : pageCount > 1 ? (
            <LazyVStack spacing={10} alignment="center">
              {pageURLs.map((url, idx) => (
                <CachedImage
                  key={idx}
                  url={url}
                  aspectRatioValue={pageAspect}
                  cornerRadius={8}
                  contentMode="fit"
                />
              ))}
            </LazyVStack>
          ) : (
            <CachedImage
              url={pageURLs[0] ?? null}
              aspectRatioValue={pageAspect}
              cornerRadius={12}
              contentMode="fit"
            />
          )}
        </VStack>

        <VStack alignment="leading" spacing={8} padding={{ horizontal: 14 }}>
          {/* 数据 */}
          <VStack alignment="leading" spacing={6}>
            <Text font="subheadline" fontWeight="semibold">
              数据
            </Text>
            <HStack spacing={10}>
              <HStack spacing={3}>
                <Image systemName="eye" font="footnote" foregroundStyle="secondaryLabel" />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  {formatNumber(current.total_view)}
                </Text>
              </HStack>
              <HStack spacing={3}>
                <Image systemName="heart" font="footnote" foregroundStyle="secondaryLabel" />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  {formatNumber(current.total_bookmarks)}
                </Text>
              </HStack>
              <HStack spacing={3}>
                <Image systemName="bubble.left" font="footnote" foregroundStyle="secondaryLabel" />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  {formatNumber(current.total_comments)}
                </Text>
              </HStack>
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {formatDate(current.create_date)}
              </Text>
            </HStack>
          </VStack>

          {/* 系列 */}
          {current.series ? (
            <Text font="footnote" foregroundStyle="secondaryLabel">
              系列：{current.series.title ?? "未知系列"}
            </Text>
          ) : null}

          {/* 简介（Pixiv caption 为 HTML，转纯文本显示） */}
          {current.caption ? (
            <VStack alignment="leading" spacing={4}>
              <Text font="subheadline" fontWeight="semibold">
                简介
              </Text>
              <SelectableCaption text={htmlToPlainText(current.caption)} />
            </VStack>
          ) : null}

          {/* 标签：横向拖动查看完整标签，避免长文本撑破页面 */}
          {current.tags.length > 0 ? (
            <VStack alignment="leading" spacing={6}>
              <Text font="subheadline" fontWeight="semibold">
                标签
              </Text>
              <ScrollView axes="horizontal">
                <HStack spacing={6}>
                  {current.tags.map((tag) => (
                    <TagChip
                      key={tag.name}
                      tagName={tag.name}
                      value={`tag:${encodeURIComponent(tag.name)}`}
                      name={
                        tag.translated_name
                          ? `${tag.name}（${tag.translated_name}）`
                          : tag.name
                      }
                      compact
                    />
                  ))}
                </HStack>
              </ScrollView>
            </VStack>
          ) : null}
        </VStack>

        <RelatedIllustrationsSection illustID={current.id} />
      </VStack>

      <VStack
        sheet={{
          content: <CommentsSheet illustID={current.id} />,
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
              loadDetail={(token) => bookmarkDetail(current.id, token)}
              loadTags={(restrict, token) =>
                bookmarkTags(session.userID ?? 0, restrict, token)
              }
              save={(restrict, tags, token) =>
                addBookmark(current.id, restrict, tags, token)
              }
              onSaved={() => {
                setBookmarked(true)
                updateHistoryBookmark(current.id, true)
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

function SelectableCaption(props: { text: string }) {
  const controller = useMemo(() => new WebViewController({ ephemeral: true }), [])
  const [height, setHeight] = useState(24)

  useEffect(() => {
    let active = true
    const html = selectableCaptionHTML(props.text)
    void controller
      .loadHTML(html)
      .then(async () => {
        const contentHeight = await controller.evaluateJavaScript<number>(
          "return Math.ceil(document.documentElement.scrollHeight)"
        )
        if (active) setHeight(Math.max(24, contentHeight))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [controller, props.text])

  useEffect(() => {
    return () => controller.dispose()
  }, [controller])

  return (
    <WebView
      controller={controller}
      frame={{ maxWidth: "infinity", height }}
      padding={{ bottom: 4 }}
    />
  )
}

function selectableCaptionHTML(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: #8E8E93;
    font: -apple-system-footnote;
    line-height: 1.35;
    white-space: pre-wrap;
    overflow: hidden;
    -webkit-user-select: text;
    user-select: text;
  }
</style>
</head>
<body>${escaped}</body>
</html>`
}

function RelatedIllustrationsSection(props: { illustID: number }) {
  const paged = usePagedList<PixivIllustration>({
    first: (token) => relatedIllustrations(props.illustID, token),
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: filterRelatedIllustrations,
    deps: [props.illustID],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, 10).map(cardThumbUrlOf)).cancel,
  })
  const pagedRef = useLatest(paged)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
      pagedRef.current.refresh()
    })
  }, [])

  if (paged.initialLoading || (paged.error && paged.items.length === 0)) {
    return null
  }
  if (paged.items.length === 0) return null

  return (
    <VStack alignment="leading" spacing={8} padding={{ top: 4 }}>
      <Text font="subheadline" fontWeight="semibold" padding={{ horizontal: 14 }}>
        相关作品
      </Text>
      <MasonryIllustFeed
        items={paged.items}
        onLoadMore={paged.loadMore}
        hasMore={paged.hasMore}
        isLoading={paged.loadingMore}
      />
    </VStack>
  )
}

function filterRelatedIllustrations(
  items: PixivIllustration[]
): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter(
    (item) =>
      isIllustContentVisible(item, settings)
  )
}
