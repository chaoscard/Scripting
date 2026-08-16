import {
  Button,
  HStack,
  LazyVStack,
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
  novelDetail,
  novelViewerData,
  removeNovelBookmark,
} from "../api/pixiv"
import { session } from "../api/session"
import { useAsyncGuard, useLatest } from "./hooks"
import { recordNovelHistory, updateNovelHistoryBookmark } from "../store/history"
import type { PixivNovel, PixivNovelDetail } from "../types"
import {
  isR18ContentVisible,
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import {
  AvatarImage,
  ErrorView,
  estimateChipWidth,
  formatDate,
  formatNumber,
  InfoCard,
  LoadingView,
  wrapTags,
} from "./components"

const TAG_ROW_WIDTH = 320
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
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
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
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeNovelBookmark(novelID, token))
        setBookmarked(false)
        updateNovelHistoryBookmark(novelID, false)
      } else {
        await session.call((token) => addNovelBookmark(novelID, "public", token))
        setBookmarked(true)
        updateNovelHistoryBookmark(novelID, true)
      }
    } catch {
      // 收藏失败时保留当前状态。
    } finally {
      setBookmarkBusy(false)
    }
  }

  if (loading) {
    return (
      <ScrollView navigationTitle="小说" navigationBarTitleDisplayMode="inline">
        <LoadingView />
      </ScrollView>
    )
  }
  if (error || !novel) {
    return (
      <ScrollView navigationTitle="小说" navigationBarTitleDisplayMode="inline">
        <ErrorView message={error ?? "小说不存在"} onRetry={load} />
      </ScrollView>
    )
  }

  const current = novel
  const avatarUrl = current.user.profile_image_urls?.medium ?? null

  return (
    <ScrollView navigationTitle={current.title} navigationBarTitleDisplayMode="inline">
      <VStack alignment="leading" spacing={12} padding={{ horizontal: 16, top: 12 }}>
        <Text font="title3" fontWeight="bold">
          {current.title}
        </Text>

        <HStack spacing={10} alignment="center">
          <AvatarImage url={avatarUrl} size={24} />
          <NavigationLink value={`user:${current.user.id}`}>
            <Text font="subheadline" fontWeight="medium">
              {current.user.name}
            </Text>
          </NavigationLink>
        </HStack>

        <Text font="caption" foregroundStyle="secondaryLabel">
          {formatDate(current.create_date)} · 浏览 {formatNumber(current.total_view)} · 收藏{" "}
          {formatNumber(current.total_bookmarks)} · 评论 {formatNumber(current.total_comments)}
        </Text>

        <HStack spacing={10}>
          <Button
            title={bookmarked ? "已收藏" : "收藏"}
            systemImage="heart.fill"
            buttonStyle="glass"
            tint={bookmarked ? "#FF375F" : "#ADADAD"}
            disabled={bookmarkBusy}
            action={toggleBookmark}
          />
        </HStack>

        {current.series_prev ? (
          <NavigationLink value={`novel:${current.series_prev.id}`}>
            <Text font="footnote" foregroundStyle="#0096FA">
              ← 上一话：{current.series_prev.title ?? "上一话"}
            </Text>
          </NavigationLink>
        ) : null}
        {current.series_next ? (
          <NavigationLink value={`novel:${current.series_next.id}`}>
            <Text font="footnote" foregroundStyle="#0096FA">
              下一话：{current.series_next.title ?? "下一话"} →
            </Text>
          </NavigationLink>
        ) : null}

        <InfoCard
          fields={[
            { label: "作者", value: current.user.name },
            { label: "作者 ID", value: current.user.id },
            { label: "标题", value: current.title },
            { label: "小说 ID", value: current.id },
          ]}
        />

        {current.tags.length > 0 ? (
          <VStack alignment="leading" spacing={6}>
            {wrapTags(
              current.tags,
              TAG_ROW_WIDTH,
              (tag) => estimateChipWidth(`#${tag.name}`)
            ).map((row, ri) => (
              <HStack key={ri} spacing={6}>
                {row.map((tag) => (
                  <Text key={tag.name} font="caption2" foregroundStyle="#0096FA">
                    #{tag.name}
                  </Text>
                ))}
              </HStack>
            ))}
          </VStack>
        ) : null}

        <VStack alignment="leading" spacing={0} padding={{ top: 8, bottom: 24 }}>
          {text ? (
            <LazyVStack alignment="leading" spacing={10}>
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
    </ScrollView>
  )
}
