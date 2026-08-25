import {
  Button,
  Group,
  HStack,
  Image,
  Menu,
  NavigationLink,
  Text,
} from "scripting"
import { blockTag } from "../../store/blocklist"
export function TagChip(props: {
  name: string
  tagName?: string
  translatedName?: string
  value: string
  compact?: boolean
}) {
  const { name, tagName = name, translatedName, value, compact = false } = props
  return (
    <NavigationLink
      value={value}
      buttonStyle="glass"
      controlSize={compact ? "mini" : "small"}
      fixedSize={{ horizontal: true, vertical: false }}
      contextMenu={{
        menuItems: (
          <Group>
            <Button
              title="屏蔽该标签"
              systemImage="nosign"
              role="destructive"
              action={() => blockTag(tagName)}
            />
          </Group>
        ),
      }}
    >
      <HStack spacing={3} alignment="center">
        <Text
          font={compact ? "caption2" : "caption"}
          foregroundStyle="#0096FA"
          fontWeight="semibold"
        >
          #
        </Text>
        <Text font={compact ? "caption" : "body"} lineLimit={1}>
          {name}
        </Text>
        {translatedName ? (
          <Text
            font={compact ? "caption2" : "caption"}
            foregroundStyle="secondaryLabel"
            lineLimit={1}
          >
            {translatedName}
          </Text>
        ) : null}
      </HStack>
    </NavigationLink>
  )
}

