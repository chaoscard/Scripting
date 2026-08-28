import {
  Button,
  Group,
  HStack,
  NavigationLink,
  Text,
} from "scripting"
import { blockTag } from "../../store/blocklist"
import { TagPreview } from "./TagPreview"

export function renderTagContextMenu(tagName: string, translatedName?: string) {
  return {
    preview: <TagPreview tagName={tagName} translatedName={translatedName} />,
    menuItems: (
      <Group>
        <Button
          title="查看 Pixiv 百科"
          systemImage="book.pages"
          action={() => {
            const url = `https://dic.pixiv.net/a/${encodeURIComponent(tagName)}`
            void Safari.present(url, false)
          }}
        />
        <Button
          title="复制标签名"
          systemImage="doc.on.doc"
          action={() => {
            void Pasteboard.setString(tagName)
          }}
        />
        <Button
          title="屏蔽该标签"
          systemImage="nosign"
          role="destructive"
          action={() => blockTag(tagName)}
        />
      </Group>
    ),
  }
}

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
      contextMenu={renderTagContextMenu(tagName, translatedName)}
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
