import {
  Button,
  FlowLayout,
  HStack,
  Image,
  LongPressGesture,
  NavigationLink,
  ProgressView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "scripting"
import { CachedImage } from "./CachedImage"
import { BookmarkButton, BookmarkDetailSheet } from "./BookmarkDetailSheet"
import { CORNER_ICON_SIZE, formatNumber } from "./formatUtils"
import { IllustCardAction } from "./IllustCard"
import { useLatest, useNovelBookmark, useNovelMarker } from "../hooks"
import { recordNovelMarker } from "../../store/bookmarkSync"
import { loadSettings } from "../../store/settings"
import { getSeriesByWorkID, recordWorkSeriesAssociation } from "../../store/seriesCache"
import { addNovelBookmark, bookmarkDetail, bookmarkTags, followUser, novelBookmarkDetail, novelBookmarkTags, removeNovelBookmark } from "../../api/pixiv"
import { session } from "../../api/session"
import { novelThumbUrlOf } from "../../image/imageLoader"
import type { PixivNovel } from "../../types"
export function NovelCard(props: {
  novel: PixivNovel
  onAppear?: () => void
  priority?: number
  footerText?: string
  markerPage?: number
  showEpisodeNumber?: boolean
  topTrailingAction?: IllustCardAction
  contextMenu?: any
}) {
  const {
    novel,
    onAppear,
    priority,
    footerText,
    markerPage,
    showEpisodeNumber = true,
    topTrailingAction,
    contextMenu,
  } = props

  if (markerPage != null && markerPage > 0) {
    recordNovelMarker(novel.id, markerPage)
  }

  const episodeNumber =
    novel.episode_number ??
    getSeriesByWorkID(novel.id, "novel")?.episodeNumber ??
    null

  const [bookmarked, setBookmarked] = useNovelBookmark(novel.id, novel.is_bookmarked)
  const [activeMarker] = useNovelMarker(novel.id, markerPage ?? null)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)

  async function toggleNovelBookmark() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeNovelBookmark(novel.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) => addNovelBookmark(novel.id, "public", token))
        setBookmarked(true)
      }
    } catch {
      // 收藏失败时保持原状态
    } finally {
      setBookmarkBusy(false)
    }
  }

  function handleNovelBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    void Haptics.transient()
    if (action === "follow") {
      void bookmarkAndFollowNovel()
    } else {
      setShowBookmarkDetail(true)
    }
  }

  async function bookmarkAndFollowNovel() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addNovelBookmark(novel.id, "public", token))
        setBookmarked(true)
      }
      await session.call((token) => followUser(novel.user.id, "public", token))
    } catch {
      // 保持卡片可继续操作
    } finally {
      setBookmarkBusy(false)
    }
  }

  const coverURL =
    novel.image_urls?.medium ??
    novel.image_urls?.large ??
    novel.image_urls?.square_medium ??
    novel.cover?.urls?.["240mw"] ??
    novel.cover?.urls?.["480mw"] ??
    null

  return (
    <ZStack
      alignment="topTrailing"
      frame={{ maxWidth: "infinity" }}
      contextMenu={contextMenu}
    >
      <ZStack alignment="bottomTrailing" frame={{ maxWidth: "infinity" }}>
        <NavigationLink value={`novel:${novel.id}`}>
          <HStack
            spacing={10}
            padding={10}
            onAppear={onAppear}
            alignment="top"
            glassEffect={{ type: "rect", cornerRadius: 14 }}
            shadow={{ color: "#0000000F", radius: 18, y: 8 }}
            frame={{ maxWidth: "infinity" }}
          >
            <ZStack
              frame={{ width: 68, height: 96 }}
              clipShape={{ type: "rect", cornerRadius: 8 }}
            >
              <CachedImage
                url={coverURL}
                aspectRatioValue={0.71}
                centerCropAspect={0.71}
                cornerRadius={0}
                contentMode="fill"
                priority={priority}
                frame={{ width: 68, height: 96 }}
              />
            </ZStack>
            <VStack
              alignment="leading"
              spacing={4}
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            >
              <Text
                font="subheadline"
                fontWeight="semibold"
                multilineTextAlignment="leading"
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                padding={{ trailing: topTrailingAction ? 24 : 0 }}
              >
                {novel.title}
              </Text>
              <FlowLayout horizontalSpacing={4} verticalSpacing={2}>
                {novel.tags.map((tag) => (
                  <Text
                    key={tag.name}
                    font="caption2"
                    foregroundStyle="secondaryLabel"
                    lineLimit={1}
                  >
                    #{tag.name}
                  </Text>
                ))}
              </FlowLayout>
              <Spacer />
              <HStack frame={{ maxWidth: "infinity" }}>
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {novel.user.name}
                </Text>
                <Spacer />
              </HStack>
              <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
                <HStack spacing={4}>
                  <Image systemName="eye" font="caption2" foregroundStyle="secondaryLabel" />
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {formatNumber(novel.total_view)}
                  </Text>
                </HStack>
                <HStack spacing={4}>
                  <Image systemName="heart" font="caption2" foregroundStyle="secondaryLabel" />
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {formatNumber(novel.total_bookmarks)}
                  </Text>
                </HStack>
                {novel.text_length != null ? (
                  <HStack spacing={4}>
                    <Image systemName="character.cursor.ibeam" font="caption2" foregroundStyle="secondaryLabel" />
                    <Text font="caption2" foregroundStyle="secondaryLabel">
                      {novel.text_length}
                    </Text>
                  </HStack>
                ) : null}
                {showEpisodeNumber && episodeNumber != null ? (
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {`第${episodeNumber}话`}
                  </Text>
                ) : null}
                {activeMarker != null ? (
                  <HStack spacing={3}>
                    <Image systemName="book.pages" font="caption2" foregroundStyle="#007AFF" />
                    <Text font="caption2" foregroundStyle="#007AFF" lineLimit={1}>
                      第 {activeMarker} 页
                    </Text>
                  </HStack>
                ) : null}
                {footerText ? (
                  <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                    {footerText}
                  </Text>
                ) : null}
                <Spacer />
              </HStack>
            </VStack>
          </HStack>
        </NavigationLink>
        <BookmarkButton
          bookmarked={bookmarked}
          disabled={bookmarkBusy}
          onTap={() => void toggleNovelBookmark()}
          onLongPress={handleNovelBookmarkLongPress}
          sheetContent={
            <BookmarkDetailSheet
              item={novel}
              bookmarked={bookmarked}
              loadDetail={(token) => novelBookmarkDetail(novel.id, token)}
              loadTags={(restrict, token) => novelBookmarkTags(restrict, token)}
              save={(restrict, tags, token) => addNovelBookmark(novel.id, restrict, token, tags)}
              onSaved={() => setBookmarked(true)}
              onClose={() => setShowBookmarkDetail(false)}
            />
          }
          sheetPresented={showBookmarkDetail}
          onSheetChanged={setShowBookmarkDetail}
        />
      </ZStack>
      {topTrailingAction ? (
        <Button
          buttonStyle="plain"
          action={topTrailingAction.action}
          frame={{ width: CORNER_ICON_SIZE, height: CORNER_ICON_SIZE }}
          glassEffect="circle"
          contentShape="circle"
          zIndex={1}
          offset={{ x: -4, y: 4 }}
        >
          <Image
            systemName={topTrailingAction.systemImage}
            font="body"
            tint={topTrailingAction.tint}
            foregroundStyle={topTrailingAction.foregroundStyle}
          />
        </Button>
      ) : null}
    </ZStack>
  )
}

