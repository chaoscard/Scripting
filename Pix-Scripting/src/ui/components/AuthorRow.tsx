import { HStack, Image, Text, VStack, ZStack } from "scripting"
import { AvatarImage } from "./CachedImage"
import type { PixivUser } from "../../types"

export function AuthorRow(props: {
  user: PixivUser
  size?: number
  onTap?: () => void
}) {
  const { user, size = 22, onTap } = props
  const avatarUrl = user.profile_image_urls?.medium ?? null
  return (
    <VStack alignment="leading" spacing={2} onTapGesture={onTap}>
      <ZStack alignment="leading">
        <AvatarImage url={avatarUrl} size={size} />
        <Text
          font="footnote"
          fontWeight="medium"
          lineLimit={1}
          padding={{ leading: size + 10 }}
        >
          {user.name}
        </Text>
      </ZStack>
    </VStack>
  )
}
