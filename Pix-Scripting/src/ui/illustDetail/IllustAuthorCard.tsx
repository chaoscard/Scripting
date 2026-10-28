import {
  useEffect,
  useState,
  Text,
  VStack,
} from "scripting"
import { ConnectionRow } from "../components/ConnectionRow"
import { session } from "../../api/session"
import { userWorks } from "../../api/pixiv"
import { cardThumbUrlOf, prefetch } from "../../image/imageLoader"
import type { PixivIllustration, PixivUser, PixivUserPreview } from "../../types"

export interface IllustAuthorCardProps {
  user: PixivUser
  illustType?: "illust" | "manga" | "ugoira"
  priority?: number
  isSprint?: boolean
  onFollowSuccess?: (restrict: "public" | "private") => void
}

/**
 * 插画详情页作者展示卡片
 * 复用 ConnectionRow 视觉规范（毛玻璃底板、头像、昵称、@账号、圆形关注切换），
 * 首帧先画出 3 个纯净占位灰框避免布局跳动，后台异步拉取该创作者最新的真实代表作并平滑淡入。
 * 绝不人为过滤隐藏当前作品，确保作品数恒 >= 1，彻底避免单篇作品时的卡片高度坍塌跳变。
 */
export function IllustAuthorCard(props: IllustAuthorCardProps) {
  const {
    user,
    illustType = "illust",
    priority,
    isSprint,
    onFollowSuccess,
  } = props

  const [illusts, setIllusts] = useState<PixivIllustration[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ok = true
    setLoading(true)
    const type = illustType === "manga" ? "manga" : "illust"
    void session.call((t: string) => userWorks(user.id, type, t)).then(async (r) => {
      if (!ok) return
      let list = r.items ?? []
      if (!list.length && type === "illust") {
        const mr = await session.call((t: string) => userWorks(user.id, "manga", t)).catch(() => null)
        if (mr) list = mr.items ?? []
      }
      if (!ok) return
      setIllusts(list)
      setLoading(false)
      if (list.length) prefetch(list.slice(0, 3).map(cardThumbUrlOf))
    }).catch(() => {
      if (ok) setLoading(false)
    })
    return () => { ok = false }
  }, [user.id, illustType])

  const preview: PixivUserPreview = { user, illusts, is_muted: false }

  return (
    <VStack
      alignment="leading"
      spacing={6}
      padding={{ horizontal: 8 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
        创作者
      </Text>
      <ConnectionRow
        preview={preview}
        loading={loading}
        priority={priority}
        isSprint={isSprint}
        onFollowSuccess={onFollowSuccess}
      />
    </VStack>
  )
}
