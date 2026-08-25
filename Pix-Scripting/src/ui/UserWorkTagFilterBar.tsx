import {
  Button,
  FlowLayout,
  HStack,
  Text,
  VStack,
} from "scripting"
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
              buttonStyle="plain"
            >
              <HStack
                spacing={3}
                padding={{ horizontal: 10, vertical: 5 }}
                background={isSelected ? "tintColor" : "secondarySystemFill"}
                clipShape="capsule"
                alignment="center"
              >
                <Text
                  font="caption"
                  foregroundStyle={isSelected ? "white" : "#0096FA"}
                  fontWeight="semibold"
                >
                  #
                </Text>
                <Text
                  font="caption"
                  fontWeight={isSelected ? "semibold" : "regular"}
                  foregroundStyle={isSelected ? "white" : "label"}
                  lineLimit={1}
                >
                  {item.tag}
                </Text>
                {item.tag_translation && item.tag_translation !== item.tag ? (
                  <Text
                    font="caption"
                    foregroundStyle={isSelected ? "white" : "secondaryLabel"}
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
