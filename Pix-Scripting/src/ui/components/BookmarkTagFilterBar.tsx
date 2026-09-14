import {
  Button,
  FlowLayout,
  HStack,
  Text,
  VStack,
} from "scripting"
import { renderTagContextMenu } from "./TagChip"
import type { PixivBookmarkTag } from "../../types"

export function BookmarkTagFilterBar(props: {
  tags: PixivBookmarkTag[]
  selectedTag: string | null
  onSelectTag: (tag: string | null) => void
}) {
  const { tags, selectedTag, onSelectTag } = props

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
          const isSelected = selectedTag === item.name
          return (
            <Button
              key={item.name}
              action={() => {
                onSelectTag(isSelected ? null : item.name)
              }}
              buttonStyle={isSelected ? "borderedProminent" : "glass"}
              controlSize="small"
              fixedSize={{ horizontal: true, vertical: false }}
              contextMenu={renderTagContextMenu(item.name)}
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
                  {item.name}
                </Text>
                {item.count !== undefined && item.count !== null ? (
                  <Text
                    font="caption"
                    foregroundStyle={isSelected ? undefined : "secondaryLabel"}
                    lineLimit={1}
                  >
                    ({item.count})
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
