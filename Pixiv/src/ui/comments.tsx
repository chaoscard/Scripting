import {
  Button,
  HStack,
  NavigationLink,
  NavigationStack,
  ScrollView,
  Text,
  TextField,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting"
import { comments, nextComments, postComment } from "../api/pixiv"
import { session } from "../api/session"
import { destinationElement } from "./routes"
import { dedupeByID, mergeUniqueByID } from "./hooks"
import type { PixivComment } from "../types"
import {
  AvatarImage,
  EmptyView,
  ErrorView,
  formatDate,
  LoadingView,
  LoadMoreTrigger,
} from "./components"

export function CommentsSheet(props: { illustID: number }) {
  const { illustID } = props
  const [items, setItems] = useState<PixivComment[]>([])
  const [nextURL, setNextURL] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [postError, setPostError] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [posting, setPosting] = useState(false)

  // 竞态防护 + loadMore in-flight 守卫
  const seqRef = useRef(0)
  const loadingMoreRef = useRef(false)

  async function load() {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const page = await session.call((token) => comments(illustID, token))
      if (seq !== seqRef.current) return
      setItems(dedupeByID(page.items))
      setNextURL(page.nextURL)
    } catch (err: any) {
      if (seq === seqRef.current) setError(err?.message ?? "加载失败")
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [illustID])

  async function send() {
    const content = text.trim()
    if (!content || posting) return
    setPosting(true)
    setPostError(null)
    try {
      await session.call((token) => postComment(illustID, content, null, token))
      setText("")
      await load()
    } catch (err: any) {
      setPostError(err?.message ?? "发表失败，请稍后重试")
    } finally {
      setPosting(false)
    }
  }

  async function loadMore() {
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
  }

  return (
    <NavigationStack>
      <VStack
        alignment="leading"
        spacing={10}
        padding={{ top: 16 }}
        frame={{ maxWidth: "infinity" }}
        navigationDestination={destinationElement}
      >
        <Text
          font="headline"
          fontWeight="bold"
          frame={{ maxWidth: "infinity" }}
          padding={{ horizontal: 14 }}
        >
          评论
        </Text>

        {postError ? (
          <Text
            font="footnote"
            foregroundStyle="systemRed"
            padding={{ horizontal: 14 }}
          >
            {postError}
          </Text>
        ) : null}

        {loading ? (
          <LoadingView text="正在加载评论…" />
        ) : error && items.length === 0 ? (
          <ErrorView message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyView text="还没有评论" systemImage="bubble.left" />
        ) : (
          <ScrollView frame={{ maxWidth: "infinity", maxHeight: 420 }}>
            <VStack
              alignment="leading"
              spacing={10}
              padding={{ horizontal: 14 }}
              frame={{ maxWidth: "infinity" }}
            >
              {items.map((comment) => (
                <CommentRow key={comment.id} comment={comment} />
              ))}
              <LoadMoreTrigger
                anchor={items[items.length - 1].id}
                onLoadMore={loadMore}
                hasMore={nextURL != null}
                isLoading={loadingMore}
              />
            </VStack>
          </ScrollView>
        )}

        <HStack
          spacing={8}
          alignment="center"
          padding={{ horizontal: 14, top: 6, bottom: 20 }}
          frame={{ maxWidth: "infinity" }}
        >
          <TextField
            title="评论"
            value={text}
            onChanged={setText}
            onSubmit={send}
            prompt="写下你的评论…"
            submitLabel="send"
            frame={{ maxWidth: "infinity" }}
          />
          <Button
            title="发送"
            buttonStyle="glassProminent"
            tint="#0096FA"
            controlSize="small"
            disabled={posting || !text.trim()}
            action={send}
          />
        </HStack>
      </VStack>
    </NavigationStack>
  )
}

function CommentRow(props: { comment: PixivComment }) {
  const { comment } = props
  const avatarUrl = comment.user.profile_image_urls?.medium ?? null
  return (
    <VStack
      alignment="leading"
      spacing={3}
      padding={8}
      glassEffect={{ type: "rect", cornerRadius: 12 }}
      glassEffectTransition="materialize"
      frame={{ maxWidth: "infinity" }}
    >
      <HStack
        spacing={10}
        alignment="top"
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <NavigationLink value={`user:${comment.user.id}`}>
          <AvatarImage url={avatarUrl} size={24} />
        </NavigationLink>
        <VStack
          alignment="leading"
          spacing={3}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <HStack
            spacing={8}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            <Text font="caption" fontWeight="semibold">
              {comment.user.name}
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {formatDate(comment.date)}
            </Text>
          </HStack>
          <Text
            font="footnote"
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {comment.comment}
          </Text>
        </VStack>
      </HStack>
    </VStack>
  )
}
