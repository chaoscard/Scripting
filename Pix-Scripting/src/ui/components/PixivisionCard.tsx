import {
  Device,
  HStack,
  NavigationLink,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"
import { CachedImage } from "./CachedImage"
import { TagChip } from "./TagChip"
import type { PixivisionArticle } from "../../types"

const FLOW_HORIZONTAL_PADDING = 12
const HERO_CARD_WIDTH = Math.floor(
  Device.screen.width - FLOW_HORIZONTAL_PADDING * 2
)
const DEFAULT_ARTICLE_RATIO = 1200 / 630

export function PixivisionCard(props: {
  article: PixivisionArticle
  onAppear?: () => void
  priority?: number
}) {
  const { article, onAppear, priority } = props
  // 遵循 Pixivision 官方标准卡片设计规范：所有特辑封面统一采用官方标准横幅比例（1200/630），
  // 非标封面自动居中裁切填充（object-fit: cover），确保信息流卡片高度规整一致且零排版跳变
  const imageRatio = DEFAULT_ARTICLE_RATIO
  const cardFrame = { width: HERO_CARD_WIDTH }
  const imageFrame = {
    width: HERO_CARD_WIDTH,
    height: Math.round(HERO_CARD_WIDTH / imageRatio),
  }

  return (
    <ZStack alignment="topTrailing" frame={cardFrame}>
      <VStack
        alignment="leading"
        spacing={4}
        frame={cardFrame}
        onAppear={onAppear}
        padding={6}
        glassEffect={{ type: "rect", cornerRadius: 16 }}
        shadow={{ color: "#0000000F", radius: 20, y: 10 }}
      >
        {/* 1. 封面图片区（完全遵循先画框后绘图规范，支持自适应比例与零布局跳动） */}
        <ZStack alignment="bottomTrailing" frame={cardFrame}>
          <NavigationLink value={`pixivision:${article.id}`} frame={cardFrame}>
            <ZStack alignment="topLeading" frame={cardFrame}>
              <ZStack
                alignment="topLeading"
                frame={imageFrame}
                clipShape={{ type: "rect", cornerRadius: 12 }}
                clipped={true}
              >
                <CachedImage
                  url={article.imageURL}
                  previewUrl={article.thumbURL}
                  aspectRatioValue={imageRatio}
                  centerCropAspect={imageRatio}
                  cropAnchor="top"
                  contentMode="fill"
                  cornerRadius={12}
                  frame={imageFrame}
                  priority={priority}
                />
              </ZStack>
            </ZStack>
          </NavigationLink>
        </ZStack>

        {/* 2. 分类与发布日期 */}
        <HStack
          spacing={8}
          padding={{ horizontal: 6, top: 4 }}
          frame={{ maxWidth: "infinity" }}
        >
          <Text
            font="caption"
            fontWeight="semibold"
            foregroundStyle="#0096FA"
          >
            {article.category || "特辑"}
          </Text>
          <Spacer />
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {formatPixivisionDate(article.date)}
          </Text>
        </HStack>

        {/* 3. 特辑标题 */}
        <NavigationLink value={`pixivision:${article.id}`}>
          <Text
            font="headline"
            fontWeight="bold"
            lineLimit={2}
            multilineTextAlignment="leading"
            padding={{ horizontal: 6, bottom: article.tags?.length ? 2 : 6 }}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {article.title}
          </Text>
        </NavigationLink>

        {/* 4. 特辑标签 */}
        {article.tags && article.tags.length > 0 ? (
          <ScrollView
            axes="horizontal"
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            <HStack spacing={6} padding={{ horizontal: 6, bottom: 4 }}>
              {article.tags.map((tag) => {
                const tagName = typeof tag === "string" ? tag : tag.name
                const tagId = typeof tag === "string" ? undefined : tag.id
                const route = tagId
                  ? `pixivision-tag:${tagId}?name=${encodeURIComponent(tagName)}`
                  : `pixivision-tag:${encodeURIComponent(tagName)}`
                return (
                  <TagChip
                    key={`${tagId ?? tagName}`}
                    name={tagName}
                    tagName={tagName}
                    value={route}
                    compact={true}
                  />
                )
              })}
            </HStack>
          </ScrollView>
        ) : null}
      </VStack>
    </ZStack>
  )
}

function formatPixivisionDate(value: string): string {
  const parts = value.split("-")
  if (parts.length !== 3) return value
  return `${parts[0]}.${parts[1]}.${parts[2]}`
}
