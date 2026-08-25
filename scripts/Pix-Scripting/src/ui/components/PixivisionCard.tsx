import {
  Device,
  HStack,
  Image,
  NavigationLink,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"
import { CachedImage } from "./CachedImage"
import type { PixivisionArticle } from "../../types"
const PIXIVISION_IMAGE_RATIO = 1200 / 630
const PIXIVISION_IMAGE_WIDTH = Device.screen.width - 28

export function PixivisionCard(props: {
  article: PixivisionArticle
  onAppear?: () => void
  priority?: number
}) {
  const { article, onAppear, priority } = props
  return (
    <VStack
      alignment="leading"
      spacing={0}
      padding={{ horizontal: 14 }}
      frame={{ maxWidth: "infinity" }}
      onAppear={onAppear}
    >
      <NavigationLink value={`pixivision:${article.id}`}>
        <VStack
          alignment="leading"
          spacing={0}
          frame={{ maxWidth: "infinity" }}
          glassEffect={{ type: "rect", cornerRadius: 14 }}
          shadow={{ color: "#0000000F", radius: 18, y: 8 }}
        >
          <CachedImage
            url={article.imageURL}
            aspectRatioValue={PIXIVISION_IMAGE_RATIO}
            useIntrinsicAspectRatio={false}
            cornerRadius={12}
            contentMode="fill"
            frame={{ width: PIXIVISION_IMAGE_WIDTH, height: PIXIVISION_IMAGE_WIDTH / PIXIVISION_IMAGE_RATIO }}
            priority={priority}
          />
          <VStack
            alignment="leading"
            spacing={6}
            padding={{ horizontal: 12, vertical: 12 }}
          >
            <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
              <Text
                font="caption"
                fontWeight="semibold"
                foregroundStyle="#0096FA"
              >
                {article.category}
              </Text>
              <Spacer />
              <Text font="caption2" foregroundStyle="secondaryLabel">
                {formatPixivisionDate(article.date)}
              </Text>
            </HStack>
            <Text
              font="headline"
              fontWeight="semibold"
              lineLimit={3}
              multilineTextAlignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {article.title}
            </Text>
          </VStack>
        </VStack>
      </NavigationLink>
    </VStack>
  )
}

function formatPixivisionDate(value: string): string {
  const parts = value.split("-")
  if (parts.length !== 3) return value
  return `${parts[0]}.${parts[1]}.${parts[2]}`
}
