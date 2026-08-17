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
  ScrollView,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  addNovelBookmark,
  followUser,
  novelBookmarkDetail,
  novelBookmarkTags,
  novelDetail,
  novelViewerData,
  removeNovelBookmark,
  unfollowUser,
} from "../api/pixiv"
import { session } from "../api/session"
import { useAsyncGuard, useLatest } from "./hooks"
import { recordNovelHistory, updateNovelHistoryBookmark } from "../store/history"
import { onUserFollowChanged } from "../store/userFollow"
import type { PixivNovel, PixivNovelDetail } from "../types"
import {
  isR18ContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  AvatarImage,
  BookmarkDetailSheet,
  ErrorView,
  formatDate,
  formatNumber,
  LinkedDescription,
  LoadingView,
  TagChip,
} from "./components"
import { CommentsSheet } from "./comments"
import { renderDestination } from "./routes"
import { requestPixivRoute } from "./routeNavigation"

const RESTRICTED_CONTENT_MESSAGE = "该小说已被内容分级设置隐藏"
const TEXT_CHUNK_SIZE = 2000

function chunkText(text: string, size = TEXT_CHUNK_SIZE): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }
  return chunks
}

function historyNovelFromDetail(detail: PixivNovelDetail): PixivNovel {
  return { ...detail, is_muted: false, visible: true }
}

export function NovelDetailView(props: { novelID: number }) {
  const { novelID } = props
  const [novel, setNovel] = useState<PixivNovelDetail | null>(null)
  const [text, setText] = useState("")
  const [textError, setTextError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [bookmarkLongPressLocked, setBookmarkLongPressLocked] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  const [followed, setFollowed] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [showComments, setShowComments] = useState(false)

  const guard = useAsyncGuard()
  const novelRef = useLatest(novel)
  const errorRef = useLatest(error)
  const restrictedLevelRef = useRef<number | null>(null)
  const recordedIDRef = useRef<number | null>(null)

  async function load() {
    const g = guard()
    setLoading(true)
    setError(null)
    try {
      const detail = await session.call((token) => novelDetail(novelID, token))
      if (!g.isCurrent()) return
      const settings = loadSettings()
      if (
        !isR18ContentVisible(
          detail.x_restrict,
          settings.showR18,
          settings.showR18G
        )
      ) {
        restrictedLevelRef.current = detail.x_restrict
        setNovel(null)
        setText("")
        setError(RESTRICTED_CONTENT_MESSAGE)
        return
      }

      const viewer = await session.call((token) => novelViewerData(novelID, token))
      if (!g.isCurrent()) return
      restrictedLevelRef.current = null
      setNovel(detail)
      setBookmarked(detail.is_bookmarked)
      setFollowed(detail.user?.is_followed ?? false)
      if (recordedIDRef.current !== detail.id) {
        recordedIDRef.current = detail.id
        recordNovelHistory(historyNovelFromDetail(detail))
      }
      setText(viewer.text)
      setTextError(null)
    } catch (err: any) {
      if (g.isCurrent()) setError(err?.message ?? "加载失败")
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

  useEffect(() => {
    return onSettingsChanged(() => {
      const settings = loadSettings()
      const current = novelRef.current
      if (
        current &&
        !isR18ContentVisible(
          current.x_restrict,
          settings.showR18,
          settings.showR18G
        )
      ) {
        restrictedLevelRef.current = current.x_restrict
        guard()
        setNovel(null)
        setText("")
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
                  title={`系列：${current.series?.title ?? "未知系列"}`}
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
          {/* 信息 */}
          <VStack alignment="leading" spacing={6}>
            <Text font="subheadline" fontWeight="semibold">
              信息
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
              {Boolean(current.text_length || text.length) && (
                <HStack spacing={3}>
                  <Image systemName="character.cursor.ibeam" font="footnote" foregroundStyle="secondaryLabel" />
                  <Text font="footnote" foregroundStyle="secondaryLabel">
                    {current.text_length ?? text.length}
                  </Text>
                </HStack>
              )}
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {formatDate(current.create_date)}
              </Text>
            </HStack>
          </VStack>

          {/* 系列 */}
          {current.series || current.series_prev || current.series_next ? (
            <VStack alignment="leading" spacing={4}>
              <Text font="subheadline" fontWeight="semibold">
                系列
              </Text>
              {current.series ? (
                <NavigationLink value={`novelSeries:${current.series.id}`}>
                  <Text font="footnote" foregroundStyle="#007AFF">
                    {current.series.title ?? "未知系列"}
                  </Text>
                </NavigationLink>
              ) : null}
              {current.series_prev ? (
                <NavigationLink value={`novel:${current.series_prev.id}`}>
                  <Text font="footnote" foregroundStyle="#007AFF">
                    ← 上一话：{current.series_prev.title ?? "上一话"}
                  </Text>
                </NavigationLink>
              ) : null}
              {current.series_next ? (
                <NavigationLink value={`novel:${current.series_next.id}`}>
                  <Text font="footnote" foregroundStyle="#007AFF">
                    下一话：{current.series_next.title ?? "下一话"} →
                  </Text>
                </NavigationLink>
              ) : null}
            </VStack>
          ) : null}

          {/* 简介 */}
          {current.caption ? (
            <VStack alignment="leading" spacing={4}>
              <Text font="subheadline" fontWeight="semibold">
                简介
              </Text>
              <LinkedDescription
                html={current.caption}
                routeDestination={renderDestination}
              />
            </VStack>
          ) : null}

          {/* 标签 */}
          {current.tags.length > 0 ? (
            <VStack alignment="leading" spacing={6}>
              <Text font="subheadline" fontWeight="semibold">
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
        <VStack alignment="leading" spacing={0} padding={{ horizontal: 14, top: 4, bottom: 32 }}>
          {text ? (
            <LazyVStack alignment="leading" spacing={12}>
              {chunkText(text).map((chunk, i) => (
                <Text key={i} font="body" lineSpacing={6}>
                  {chunk}
                </Text>
              ))}
            </LazyVStack>
          ) : (
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {textError ?? "（正文为空）"}
            </Text>
          )}
        </VStack>
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
