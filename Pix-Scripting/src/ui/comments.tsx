import {
  Button,
  HStack,
  Image,
  LazyVGrid,
  LazyVStack,
  Menu,
  NavigationLink,
  NavigationStack,
  Picker,
  ScrollView,
  Spacer,
  Text,
  TextField,
  useCallback,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  comments,
  nextComments,
  postComment,
  novelComments,
  postNovelComment,
  commentReplies,
  novelCommentReplies,
} from "../api/pixiv"
import { session } from "../api/session"
import { destinationElement } from "./routes"
import { dedupeByID, mergeUniqueByID } from "./hooks"
import type { PixivComment } from "../types"
import {
  AvatarImage,
  CachedImage,
  EmptyView,
  ErrorView,
  formatDate,
  LoadingView,
  LoadMoreTrigger,
} from "./components"
import {
  PIXIV_EMOJIS,
  PIXIV_STAMP_CATEGORIES,
  ALL_PIXIV_STAMPS,
  tokenizeCommentText,
  PixivStampItem,
} from "./pixivEmotes"

interface ReplyState {
  items: PixivComment[]
  nextURL: string | null
  loading: boolean
  loadingMore: boolean
  error: string | null
  expanded: boolean
}

export function CommentsSheet(props: { illustID?: number; novelID?: number; onClose?: () => void }) {
  const { illustID, novelID } = props
  const [items, setItems] = useState<PixivComment[]>([])
  const [nextURL, setNextURL] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [postError, setPostError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)

  // 回复目标（记录实际被回复的 ID 与所属顶层根评论 rootID）
  const [replyTarget, setReplyTarget] = useState<{
    id: number
    name: string
    seq: number
    rootID: number
  } | null>(null)

  // 子回复状态管理 (commentID -> ReplyState)
  const [replyStates, setReplyStates] = useState<Record<number, ReplyState>>({})

  // 竞态防护 + loadMore in-flight 守卫
  const seqRef = useRef(0)
  const loadingMoreRef = useRef(false)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const page = await session.call((token) =>
        novelID != null ? novelComments(novelID, token) : comments(illustID ?? 0, token)
      )
      if (seq !== seqRef.current) return
      setItems(dedupeByID(page.items))
      setNextURL(page.nextURL)
    } catch (err: any) {
      if (seq === seqRef.current) setError(err?.message ?? "加载失败")
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [illustID, novelID])

  useEffect(() => {
    load()
  }, [load])

  const refreshRepliesFor = useCallback(async (commentID: number) => {
    try {
      const page = await session.call((token) =>
        novelID != null
          ? novelCommentReplies(commentID, token)
          : commentReplies(commentID, token)
      )
      setReplyStates((prev) => ({
        ...prev,
        [commentID]: {
          items: dedupeByID(page.items),
          nextURL: page.nextURL,
          loading: false,
          loadingMore: false,
          error: null,
          expanded: true,
        },
      }))
    } catch {
      // 静默
    }
  }, [novelID])

  const sendText = useCallback(async (content: string): Promise<boolean> => {
    if (!content.trim() || posting) return false
    setPosting(true)
    setPostError(null)
    const parentID = replyTarget?.id ?? null
    const targetRootID = replyTarget?.rootID ?? parentID
    try {
      if (novelID != null) {
        await session.call((token) => postNovelComment(novelID, content, parentID, token))
      } else {
        await session.call((token) => postComment(illustID ?? 0, content, parentID, token))
      }
      setReplyTarget(null)
      if (targetRootID != null) {
        await refreshRepliesFor(targetRootID)
      }
      await load()
      return true
    } catch (err: any) {
      setPostError(err?.message ?? "发表失败，请稍后重试")
      return false
    } finally {
      setPosting(false)
    }
  }, [illustID, novelID, posting, refreshRepliesFor, replyTarget, load])

  const sendStamp = useCallback(async (stampID: number): Promise<boolean> => {
    if (posting) return false
    setPosting(true)
    setPostError(null)
    const parentID = replyTarget?.id ?? null
    const targetRootID = replyTarget?.rootID ?? parentID
    try {
      if (novelID != null) {
        await session.call((token) => postNovelComment(novelID, "", parentID, token, stampID))
      } else {
        await session.call((token) => postComment(illustID ?? 0, "", parentID, token, stampID))
      }
      setReplyTarget(null)
      if (targetRootID != null) {
        await refreshRepliesFor(targetRootID)
      }
      await load()
      return true
    } catch (err: any) {
      setPostError(err?.message ?? "发送贴图失败，请稍后重试")
      return false
    } finally {
      setPosting(false)
    }
  }, [illustID, novelID, posting, refreshRepliesFor, replyTarget, load])

  const loadMore = useCallback(async () => {
    const url = nextURL
    if (!url || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const seq = seqRef.current
    try {
      const page = await session.call((token) => nextComments(url, token))
      if (seq !== seqRef.current) return
      setItems((prev) => mergeUniqueByID(prev, page.items))
      setNextURL(page.nextURL)
    } catch {
      // 加载更多失败静默，允许再次触发
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [nextURL])

  const toggleReplies = useCallback(async (commentID: number) => {
    const current = replyStates[commentID]
    if (current?.expanded) {
      setReplyStates((prev) => ({
        ...prev,
        [commentID]: { ...prev[commentID], expanded: false },
      }))
      return
    }

    if (current?.items && current.items.length > 0) {
      setReplyStates((prev) => ({
        ...prev,
        [commentID]: { ...prev[commentID], expanded: true },
      }))
      return
    }

    // 首次加载子回复
    setReplyStates((prev) => ({
      ...prev,
      [commentID]: {
        items: [],
        nextURL: null,
        loading: true,
        loadingMore: false,
        error: null,
        expanded: true,
      },
    }))

    try {
      const page = await session.call((token) =>
        novelID != null
          ? novelCommentReplies(commentID, token)
          : commentReplies(commentID, token)
      )
      setReplyStates((prev) => ({
        ...prev,
        [commentID]: {
          items: dedupeByID(page.items),
          nextURL: page.nextURL,
          loading: false,
          loadingMore: false,
          error: null,
          expanded: true,
        },
      }))
    } catch (err: any) {
      setReplyStates((prev) => ({
        ...prev,
        [commentID]: {
          items: [],
          nextURL: null,
          loading: false,
          loadingMore: false,
          error: err?.message ?? "加载回复失败",
          expanded: true,
        },
      }))
    }
  }, [novelID, replyStates])

  const retryReplies = useCallback(async (commentID: number) => {
    setReplyStates((prev) => ({
      ...prev,
      [commentID]: {
        items: prev[commentID]?.items ?? [],
        nextURL: null,
        loading: true,
        loadingMore: false,
        error: null,
        expanded: true,
      },
    }))

    try {
      const page = await session.call((token) =>
        novelID != null
          ? novelCommentReplies(commentID, token)
          : commentReplies(commentID, token)
      )
      setReplyStates((prev) => ({
        ...prev,
        [commentID]: {
          items: dedupeByID(page.items),
          nextURL: page.nextURL,
          loading: false,
          loadingMore: false,
          error: null,
          expanded: true,
        },
      }))
    } catch (err: any) {
      setReplyStates((prev) => ({
        ...prev,
        [commentID]: {
          items: prev[commentID]?.items ?? [],
          nextURL: null,
          loading: false,
          loadingMore: false,
          error: err?.message ?? "加载回复失败",
          expanded: true,
        },
      }))
    }
  }, [novelID])

  const loadMoreReplies = useCallback(async (commentID: number) => {
    const state = replyStates[commentID]
    if (!state || !state.nextURL || state.loadingMore) return

    setReplyStates((prev) => ({
      ...prev,
      [commentID]: { ...prev[commentID], loadingMore: true },
    }))

    try {
      const page = await session.call((token) => nextComments(state.nextURL!, token))
      setReplyStates((prev) => ({
        ...prev,
        [commentID]: {
          ...prev[commentID],
          items: mergeUniqueByID(prev[commentID].items, page.items),
          nextURL: page.nextURL,
          loadingMore: false,
        },
      }))
    } catch {
      setReplyStates((prev) => ({
        ...prev,
        [commentID]: { ...prev[commentID], loadingMore: false },
      }))
    }
  }, [replyStates])

  const handleReply = useCallback((comment: PixivComment, rootID?: number) => {
    setReplyTarget({
      id: comment.id,
      name: comment.user.name,
      seq: Date.now(),
      rootID: rootID ?? comment.id,
    })
  }, [])

  return (
    <NavigationStack
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
    >
      <VStack
        alignment="leading"
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        navigationTitle={`评论${items.length > 0 ? ` (${items.length})` : ""}`}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: props.onClose ? (
            <Button action={props.onClose}>
              <Image systemName="xmark" />
            </Button>
          ) : undefined,
          principal: (
            <Text font="headline" fontWeight="bold">
              评论 {items.length > 0 ? `(${items.length})` : ""}
            </Text>
          ),
        }}
        navigationDestination={destinationElement}
      >

        {postError ? (
          <Text
            font="footnote"
            foregroundStyle="systemRed"
            padding={{ horizontal: 16, bottom: 6 }}
          >
            {postError}
          </Text>
        ) : null}

        {/* 评论列表区：通过 safeAreaInset 将输入底栏精准吸底并贴合键盘 */}
        <ScrollView
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          refreshable={load}
          presentationContentInteraction="scrolls"
          safeAreaInset={{
            bottom: {
              content: (
                <CommentInputBar
                  replyTarget={replyTarget}
                  onCancelReply={() => setReplyTarget(null)}
                  onSendText={sendText}
                  onSendStamp={sendStamp}
                  posting={posting}
                />
              ),
            },
          }}
        >
          {loading ? (
            <LoadingView />
          ) : error && items.length === 0 ? (
            <ErrorView message={error} onRetry={load} />
          ) : items.length === 0 ? (
            <EmptyView text="还没有评论，快来抢沙发吧" systemImage="bubble.left" />
          ) : (
            <LazyVStack
              alignment="leading"
              spacing={10}
              padding={{ horizontal: 14, vertical: 8 }}
              frame={{ maxWidth: "infinity" }}
            >
              {items.map((comment) => (
                <CommentCard
                  key={comment.id}
                  comment={comment}
                  onReply={handleReply}
                  replyState={replyStates[comment.id]}
                  onToggleReplies={() => toggleReplies(comment.id)}
                  onRetryReplies={() => retryReplies(comment.id)}
                  onLoadMoreReplies={() => loadMoreReplies(comment.id)}
                />
              ))}
              <LoadMoreTrigger
                anchor={items[items.length - 1].id}
                onLoadMore={loadMore}
                hasMore={nextURL != null}
                isLoading={loadingMore}
              />
            </LazyVStack>
          )}
        </ScrollView>
      </VStack>
    </NavigationStack>
  )
}

function CommentInputBar(props: {
  replyTarget: { id: number; name: string; seq: number; rootID: number } | null
  onCancelReply: () => void
  onSendText: (content: string) => Promise<boolean>
  onSendStamp: (stampID: number) => Promise<boolean>
  posting: boolean
}) {
  const { replyTarget, onCancelReply, onSendText, onSendStamp, posting } = props
  const [text, setText] = useState("")
  const [showEmotePanel, setShowEmotePanel] = useState(false)
  const [emoteTab, setEmoteTab] = useState<string>("emoji")
  const [stampCategoryKey, setStampCategoryKey] = useState<string>("all")

  // 当外部回复目标切换时，收起表情面板
  useEffect(() => {
    if (replyTarget) {
      setShowEmotePanel(false)
    }
  }, [replyTarget])

  const handleSendText = async () => {
    const content = text.trim()
    if (!content || posting) return
    const success = await onSendText(content)
    if (success) {
      setText("")
      withAnimation(() => {
        setShowEmotePanel(false)
      })
    }
  }

  const handleSendStamp = async (stampID: number) => {
    if (posting) return
    const success = await onSendStamp(stampID)
    if (success) {
      withAnimation(() => {
        setShowEmotePanel(false)
      })
    }
  }

  return (
    <VStack
      spacing={6}
      padding={{ horizontal: 12, top: 6, bottom: 8 }}
      frame={{ maxWidth: "infinity" }}
    >
      {/* 回复对象指示条 */}
      {replyTarget ? (
        <HStack
          spacing={6}
          alignment="center"
          padding={{ horizontal: 12, vertical: 6 }}
          glassEffect="capsule"
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <Image
            systemName="arrowshape.turn.up.left.fill"
            font="caption"
            foregroundStyle="#0096FA"
          />
          <Text
            font="caption"
            foregroundStyle="secondaryLabel"
            frame={{ alignment: "leading" }}
          >
            回复 @{replyTarget.name}
          </Text>
          <Spacer />
          <Button
            title="取消回复"
            systemImage="xmark.circle.fill"
            tint="secondaryLabel"
            action={onCancelReply}
          />
        </HStack>
      ) : null}

      {/* 文本输入与表情切换底栏 */}
      <HStack
        spacing={8}
        alignment="center"
        frame={{ maxWidth: "infinity" }}
      >
        <Button
          title={showEmotePanel ? "键盘" : "表情"}
          systemImage={showEmotePanel ? "keyboard" : "face.smiling"}
          tint="#0096FA"
          buttonStyle="glass"
          action={() => {
            withAnimation(() => {
              setShowEmotePanel((prev) => !prev)
            })
          }}
        />
        <HStack
          alignment="center"
          padding={{ horizontal: 12, vertical: 6 }}
          glassEffect="capsule"
          frame={{ maxWidth: "infinity" }}
        >
          <TextField
            key={replyTarget ? `reply-${replyTarget.seq}` : "comment-default"}
            title="评论"
            value={text}
            onChanged={setText}
            onSubmit={handleSendText}
            prompt={replyTarget ? `回复 @${replyTarget.name}…` : "写下你的评论…"}
            submitLabel="send"
            textFieldStyle="plain"
            autofocus={replyTarget != null}
            frame={{ maxWidth: "infinity" }}
          />
        </HStack>
        <Button
          title="发送"
          buttonStyle="glassProminent"
          tint="#0096FA"
          disabled={posting || !text.trim()}
          action={handleSendText}
        />
      </HStack>

      {/* 官方 Emoji 和 Stamp 面板（支持菜单切换） */}
      {showEmotePanel ? (
        <EmotePickerPanel
          tab={emoteTab}
          onTabChanged={setEmoteTab}
          categoryKey={stampCategoryKey}
          onCategoryChanged={setStampCategoryKey}
          onSelectEmoji={(emojiCode) => setText((prev) => prev + emojiCode)}
          onSelectStamp={handleSendStamp}
          disabled={posting}
        />
      ) : null}
    </VStack>
  )
}

function CommentCard(props: {
  comment: PixivComment
  onReply: (c: PixivComment, rootID?: number) => void
  replyState?: ReplyState
  onToggleReplies: () => void
  onRetryReplies: () => void
  onLoadMoreReplies: () => void
}) {
  const { comment, onReply, replyState, onToggleReplies, onRetryReplies, onLoadMoreReplies } = props
  const avatarUrl = comment.user.profile_image_urls?.medium ?? null
  const hasReplies = comment.has_replies || (comment.reply_count ?? 0) > 0

  return (
    <VStack
      alignment="leading"
      spacing={6}
      padding={10}
      glassEffect={{ type: "rect", cornerRadius: 12 }}
      frame={{ maxWidth: "infinity" }}
    >
      <HStack
        spacing={10}
        alignment="top"
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <NavigationLink value={`user:${comment.user.id}`}>
          <AvatarImage url={avatarUrl} size={30} />
        </NavigationLink>
        <VStack
          alignment="leading"
          spacing={4}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {/* 用户名与发布时间 */}
          <HStack
            spacing={8}
            alignment="center"
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            <Text font="caption" fontWeight="semibold">
              {comment.user.name}
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {formatDate(comment.date)}
            </Text>
            <Spacer />
            <Button
              title="回复"
              systemImage="arrowshape.turn.up.left"
              font="caption2"
              tint="#0096FA"
              action={() => onReply(comment)}
            />
          </HStack>

          {/* 回复谁 */}
          {comment.parent_comment?.user ? (
            <Text
              font="caption2"
              foregroundStyle="secondaryLabel"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              回复 @{comment.parent_comment.user.name}
            </Text>
          ) : null}

          {/* 评论内容（富文本 Emoji 或 Stamp） */}
          <CommentBody comment={comment} />

          {/* 子回复展开按钮及列表 */}
          {hasReplies ? (
            <VStack
              alignment="leading"
              spacing={6}
              padding={{ top: 4 }}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              <Button action={onToggleReplies}>
                <HStack spacing={4} alignment="center">
                  <Text font="caption2" foregroundStyle="#0096FA">
                    {replyState?.expanded ? "收起回复" : "查看回复"}
                    {comment.reply_count ? ` (${comment.reply_count})` : ""}
                  </Text>
                  <Image
                    systemName={replyState?.expanded ? "chevron.up" : "chevron.down"}
                    font="caption2"
                    foregroundStyle="#0096FA"
                  />
                </HStack>
              </Button>

              {replyState?.expanded ? (
                <VStack
                  alignment="leading"
                  spacing={8}
                  padding={{ leading: 10, top: 4 }}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  {replyState.loading ? (
                    <LoadingView />
                  ) : replyState.error ? (
                    <ErrorView
                      message={replyState.error}
                      onRetry={onRetryReplies}
                    />
                  ) : (
                    replyState.items.map((sub) => (
                      <SubCommentRow
                        key={sub.id}
                        comment={sub}
                        onReply={(c) => onReply(c, comment.id)}
                      />
                    ))
                  )}

                  {replyState.nextURL ? (
                    <Button
                      title={replyState.loadingMore ? "加载中…" : "加载更多回复"}
                      font="caption2"
                      tint="#0096FA"
                      disabled={replyState.loadingMore}
                      action={onLoadMoreReplies}
                    />
                  ) : null}
                </VStack>
              ) : null}
            </VStack>
          ) : null}
        </VStack>
      </HStack>
    </VStack>
  )
}

function SubCommentRow(props: {
  comment: PixivComment
  onReply: (c: PixivComment) => void
}) {
  const { comment, onReply } = props
  const avatarUrl = comment.user.profile_image_urls?.medium ?? null

  return (
    <VStack
      alignment="leading"
      spacing={4}
      padding={8}
      glassEffect={{ type: "rect", cornerRadius: 8 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack
        spacing={8}
        alignment="top"
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <NavigationLink value={`user:${comment.user.id}`}>
          <AvatarImage url={avatarUrl} size={22} />
        </NavigationLink>
        <VStack
          alignment="leading"
          spacing={3}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <HStack
            spacing={6}
            alignment="center"
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            <Text font="caption2" fontWeight="semibold">
              {comment.user.name}
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {formatDate(comment.date)}
            </Text>
            <Spacer />
            <Button
              title="回复"
              systemImage="arrowshape.turn.up.left"
              font="caption2"
              tint="#0096FA"
              action={() => onReply(comment)}
            />
          </HStack>

          {comment.parent_comment?.user ? (
            <Text
              font="caption2"
              foregroundStyle="secondaryLabel"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              回复 @{comment.parent_comment.user.name}
            </Text>
          ) : null}

          <CommentBody comment={comment} />
        </VStack>
      </HStack>
    </VStack>
  )
}

function CommentBody(props: { comment: PixivComment }) {
  const { comment } = props

  if (comment.stamp?.stamp_url) {
    return (
      <CachedImage
        url={comment.stamp.stamp_url}
        frame={{ width: 88, height: 88 }}
        cornerRadius={8}
        aspectRatioValue={1}
        contentMode="fit"
      />
    )
  }

  const tokens = tokenizeCommentText(comment.comment ?? "")
  const hasEmoji = tokens.some((t) => t.type === "emoji")

  if (!hasEmoji) {
    return (
      <Text
        font="footnote"
        multilineTextAlignment="leading"
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        {comment.comment}
      </Text>
    )
  }

  return (
    <HStack
      spacing={3}
      alignment="center"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      {tokens.map((tok, idx) => {
        if (tok.type === "text") {
          return (
            <Text key={idx} font="footnote" multilineTextAlignment="leading">
              {tok.text}
            </Text>
          )
        }
        return (
          <CachedImage
            key={idx}
            url={tok.url}
            frame={{ width: 20, height: 20 }}
            cornerRadius={0}
            aspectRatioValue={1}
            contentMode="fit"
          />
        )
      })}
    </HStack>
  )
}

function EmotePickerPanel(props: {
  tab: string
  onTabChanged: (tab: string) => void
  categoryKey: string
  onCategoryChanged: (cat: string) => void
  onSelectEmoji: (code: string) => void
  onSelectStamp: (stampID: number) => void
  disabled?: boolean
}) {
  const {
    tab,
    onTabChanged,
    categoryKey,
    onCategoryChanged,
    onSelectEmoji,
    onSelectStamp,
    disabled,
  } = props

  let currentStamps: PixivStampItem[] = ALL_PIXIV_STAMPS
  if (categoryKey !== "all") {
    const group = PIXIV_STAMP_CATEGORIES.find((c) => c.key === categoryKey)
    if (group) currentStamps = group.stamps
  }

  const currentCategoryTitle =
    categoryKey === "all"
      ? "全部"
      : PIXIV_STAMP_CATEGORIES.find((c) => c.key === categoryKey)?.title ?? "分类"

  return (
    <VStack
      spacing={8}
      padding={8}
      glassEffect={{ type: "rect", cornerRadius: 14 }}
      glassEffectTransition="materialize"
      transition={Transition.move("bottom").combined(Transition.opacity())}
      frame={{ maxWidth: "infinity", height: 220 }}
    >
      {/* 顶部菜单切换栏 */}
      <HStack
        spacing={8}
        alignment="center"
        frame={{ maxWidth: "infinity" }}
      >
        <Picker
          title="类型"
          value={tab}
          onChanged={(val: string | number) => onTabChanged(String(val))}
          pickerStyle="segmented"
          frame={{ width: 180 }}
        >
          <Text tag="emoji">Emoji 表情</Text>
          <Text tag="stamp">Stamp 贴图</Text>
        </Picker>

        <Spacer />

        {tab === "stamp" ? (
          <Menu
            label={
              <HStack spacing={4} alignment="center">
                <Text font="caption" foregroundStyle="#0096FA">
                  {currentCategoryTitle}
                </Text>
                <Image
                  systemName="line.3.horizontal.decrease.circle"
                  font="caption"
                  foregroundStyle="#0096FA"
                />
              </HStack>
            }
          >
            <Button
              title="全部"
              action={() => onCategoryChanged("all")}
            />
            {PIXIV_STAMP_CATEGORIES.map((cat) => (
              <Button
                key={cat.key}
                title={cat.title}
                action={() => onCategoryChanged(cat.key)}
              />
            ))}
          </Menu>
        ) : null}
      </HStack>

      {/* 内容区域：Emoji 列表 或 Stamp 列表 */}
      {tab === "emoji" ? (
        <ScrollView frame={{ maxWidth: "infinity", maxHeight: 170 }}>
          <LazyVGrid
            columns={[{ size: { type: "adaptive", min: 38, max: 48 } }]}
            spacing={8}
          >
            {PIXIV_EMOJIS.map((item) => (
              <Button
                key={item.code}
                action={() => onSelectEmoji(item.code)}
              >
                <CachedImage
                  url={`https://s.pximg.net/common/images/emoji/${item.id}.png`}
                  frame={{ width: 28, height: 28 }}
                  aspectRatioValue={1}
                  cornerRadius={0}
                  contentMode="fit"
                />
              </Button>
            ))}
          </LazyVGrid>
        </ScrollView>
      ) : (
        <ScrollView frame={{ maxWidth: "infinity", maxHeight: 170 }}>
          <LazyVGrid
            columns={[{ size: { type: "adaptive", min: 60, max: 76 } }]}
            spacing={8}
          >
            {currentStamps.map((stamp) => (
              <Button
                key={stamp.id}
                disabled={disabled}
                action={() => onSelectStamp(stamp.id)}
              >
                <CachedImage
                  url={stamp.url}
                  frame={{ width: 56, height: 56 }}
                  aspectRatioValue={1}
                  cornerRadius={6}
                  contentMode="fit"
                />
              </Button>
            ))}
          </LazyVGrid>
        </ScrollView>
      )}
    </VStack>
  )
}
