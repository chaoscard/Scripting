import {
  Button,
  GeometryReader,
  Image,
  LazyVStack,
  NavigationStack,
  ScrollView,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { userRelated } from "../../api/pixiv"
import { session } from "../../api/session"
import { loadSettings, onSettingsChanged } from "../../store/settings"
import { destinationElement } from "../routes"
import {
  CONNECTION_CARD_HORIZONTAL_PADDING,
  CONNECTION_LIST_HORIZONTAL_PADDING,
  CONNECTION_PREVIEW_GAP,
  ConnectionRow,
} from "./ConnectionRow"
import { EmptyView, ErrorView, LoadingView } from "./StatusViews"
import type { PixivUserPreview } from "../../types"

export function RelatedUsersSheet(props: {
  seedUserID: number
  seedUserName?: string
  onClose: () => void
}) {
  const { seedUserID, seedUserName, onClose } = props
  const [users, setUsers] = useState<PixivUserPreview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)

  useEffect(() => {
    return onSettingsChanged(() => {
      setHideNovels(loadSettings().hideNovels)
    })
  }, [])

  const loadRelated = async () => {
    if (!seedUserID) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const page = await session.call((token) => userRelated(seedUserID, token))
      const myID = session.userID
      const filtered = (page.items ?? []).filter(
        (u) => u.user.id !== seedUserID && u.user.id !== myID
      )
      setUsers(filtered)
    } catch (err: any) {
      setError(err?.message ?? "加载相似创作者失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRelated()
  }, [seedUserID])

  return (
    <NavigationStack
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
    >
      <VStack
        navigationTitle={seedUserName ? `相似于 ${seedUserName}` : "相似创作者"}
        navigationBarTitleDisplayMode="inline"
        navigationDestination={destinationElement}
        toolbar={{
          topBarLeading: (
            <Button action={onClose}>
              <Image systemName="xmark" />
            </Button>
          ),
          topBarTrailing: (
            <Button action={onClose}>
              <Image systemName="checkmark" />
            </Button>
          ),
        }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        {loading ? (
          <LoadingView />
        ) : error && users.length === 0 ? (
          <ErrorView message={error} onRetry={loadRelated} />
        ) : users.length === 0 ? (
          <EmptyView text="暂无更多相似创作者推荐" />
        ) : (
          <GeometryReader>
            {(proxy) => {
              const previewSide = Math.max(
                0,
                (proxy.size.width -
                  (CONNECTION_LIST_HORIZONTAL_PADDING + CONNECTION_CARD_HORIZONTAL_PADDING) * 2 -
                  CONNECTION_PREVIEW_GAP * 2) /
                  3
              )
              return (
                <ScrollView
                  frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                  presentationContentInteraction="scrolls"
                >
                  <LazyVStack
                    spacing={10}
                    padding={{ horizontal: CONNECTION_LIST_HORIZONTAL_PADDING, top: 12, bottom: 24 }}
                    frame={{ maxWidth: "infinity" }}
                  >
                    {users.map((item) => (
                      <ConnectionRow
                        key={`related-${item.user.id}`}
                        preview={item}
                        showFollowControl={item.user.id !== session.userID}
                        previewSide={previewSide}
                        hideNovels={hideNovels}
                      />
                    ))}
                  </LazyVStack>
                </ScrollView>
              )
            }}
          </GeometryReader>
        )}
      </VStack>
    </NavigationStack>
  )
}
