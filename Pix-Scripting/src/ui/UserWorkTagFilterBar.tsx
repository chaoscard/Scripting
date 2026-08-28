import {
  Button,
  FlowLayout,
  HStack,
  Text,
  VStack,
} from "scripting"
import { renderTagContextMenu } from "./components/TagChip"
import type { PixivWebUserTag } from "../types"

export function UserWorkTagFilterBar(props: {
  tags: PixivWebUserTag[]
  selectedTag: string | null
  onSelectTag: (tag: string | null) => void
}) {
  const { tags, selectedTag, onSelectTag } = props

  // 如果没有标签，不占用垂直空间
  if (!tags || tags.length === 0) return null

  return (
    <VStack
      alignment="leading"
      spacing={6}
      padding={{ horizontal: 14 }}
      frame={{ maxWidth: "infinity" }}
    >
      <Text
        font="subheadline"
        fontWeight="semibold"
        foregroundStyle="secondaryLabel"
      >
        标签
      </Text>
      <FlowLayout spacing={6}>
        {tags.map((item) => {
          const isSelected = selectedTag === item.tag
          return (
            <Button
              key={item.tag}
              action={() => {
                onSelectTag(isSelected ? null : item.tag)
              }}
              buttonStyle={isSelected ? "borderedProminent" : "glass"}
              controlSize="small"
              fixedSize={{ horizontal: true, vertical: false }}
              contextMenu={renderTagContextMenu(
                item.tag,
                item.tag_translation && item.tag_translation !== item.tag
                  ? item.tag_translation
                  : undefined
              )}
            >
              <HStack spacing={3} alignment="center">
                <Text
                  font="caption"
                  foregroundStyle={isSelected ? undefined : "#0096FA"}
                  fontWeight="semibold"
                >
                  #
                </Text>
                <Text
                  font="caption"
                  fontWeight={isSelected ? "semibold" : "regular"}
                  lineLimit={1}
                >
                  {item.tag}
                </Text>
                {item.tag_translation && item.tag_translation !== item.tag ? (
                  <Text
                    font="caption"
                    foregroundStyle={isSelected ? undefined : "secondaryLabel"}
                    lineLimit={1}
                  >
                    {item.tag_translation}
                  </Text>
                ) : null}
              </HStack>
            </Button>
          )
        })}
      </FlowLayout>
    </VStack>
  )
}
