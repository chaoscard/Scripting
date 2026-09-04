import {
  Button,
  Circle,
  Group,
  HStack,
  Image,
  List,
  NavigationLink,
  Picker,
  Section,
  Text,
  useEffect,
  useState,
  VStack,
  ZStack,
} from "scripting"
import {
  clearBlockedTags,
  clearBlockedUsers,
  loadBlocklist,
  onBlocklistChanged,
  unblockTag,
  unblockUser,
  type BlockedUser,
} from "../store/blocklist"
import { AvatarImage, EmptyView } from "./components"

type BlockedScope = "tag" | "user"

export function BlockedSettingsView() {
  const [scope, setScope] = useState<BlockedScope>("tag")
  const [blocklist, setBlocklist] = useState(loadBlocklist())

  useEffect(() => onBlocklistChanged(() => setBlocklist(loadBlocklist())), [])

  function clearCurrent() {
    const next =
      scope === "tag"
        ? clearBlockedTags()
        : clearBlockedUsers()
    setBlocklist(next)
  }

  const empty =
    scope === "tag"
      ? { text: "暂无已屏蔽标签", systemImage: "tag" }
      : { text: "暂无已屏蔽用户", systemImage: "person.crop.circle.badge.xmark" }

  const currentCount =
    scope === "tag" ? blocklist.blockedTags.length : blocklist.blockedUsers.length

  return (
    <VStack
      spacing={0}
      navigationTitle={scope === "tag" ? "屏蔽标签" : "屏蔽用户"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarTrailing: [
          <Button
            action={() => {}}
            disabled={currentCount === 0}
            contextMenu={{
              menuItems: (
                <Group>
                  <Button
                    title={`清空已屏蔽${scope === "tag" ? "标签" : "用户"}`}
                    systemImage="trash"
                    role="destructive"
                    action={clearCurrent}
                  />
                </Group>
              ),
            }}
          >
            <Image systemName="trash" />
          </Button>,
        ],
      }}
    >
      <Picker
        title="屏蔽类型"
        value={scope}
        onChanged={(value: string) => {
          setScope(value as BlockedScope)
        }}
        pickerStyle="segmented"
        padding={{ horizontal: 16, top: 6, bottom: 8 }}
      >
        <Text tag="tag">标签</Text>
        <Text tag="user">用户</Text>
      </Picker>

      <List frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        {scope === "tag" ? (
          blocklist.blockedTags.length === 0 ? (
            <Section>
              <EmptyView text={empty.text} systemImage={empty.systemImage} />
            </Section>
          ) : (
            <Section header={<Text>已屏蔽标签（{blocklist.blockedTags.length}）</Text>}>
              {blocklist.blockedTags.map((tag) => (
                <BlockedTagRow
                  key={tag}
                  tag={tag}
                  onRemove={() => setBlocklist(unblockTag(tag))}
                />
              ))}
            </Section>
          )
        ) : blocklist.blockedUsers.length === 0 ? (
          <Section>
            <EmptyView text={empty.text} systemImage={empty.systemImage} />
          </Section>
        ) : (
          <Section header={<Text>已屏蔽用户（{blocklist.blockedUsers.length}）</Text>}>
            {blocklist.blockedUsers.map((user) => (
              <BlockedUserRow
                key={user.id}
                user={user}
                onRemove={() => setBlocklist(unblockUser(user.id))}
              />
            ))}
          </Section>
        )}
      </List>
    </VStack>
  )
}

function BlockedTagRow(props: { tag: string; onRemove: () => void }) {
  const { tag, onRemove } = props
  return (
    <HStack
      alignment="center"
      spacing={10}
      padding={{ vertical: 1 }}
      trailingSwipeActions={{
        allowsFullSwipe: true,
        actions: [
          <Button
            key="delete"
            title=""
            systemImage="trash"
            role="destructive"
            action={onRemove}
          />,
        ],
      }}
    >
      <Image systemName="tag.fill" font="subheadline" foregroundStyle="#007AFF" />
      <Text font="body" frame={{ maxWidth: "infinity", alignment: "leading" }} lineLimit={1}>
        {tag}
      </Text>
    </HStack>
  )
}

function BlockedUserRow(props: { user: BlockedUser; onRemove: () => void }) {
  const { user, onRemove } = props
  return (
    <HStack
      alignment="center"
      spacing={8}
      padding={{ vertical: 1 }}
      trailingSwipeActions={{
        allowsFullSwipe: true,
        actions: [
          <Button
            key="delete"
            title=""
            systemImage="trash"
            role="destructive"
            action={onRemove}
          />,
        ],
      }}
    >
      <NavigationLink value={`user:${user.id}`} frame={{ maxWidth: "infinity" }}>
        <HStack spacing={8} alignment="center">
          <AvatarImage url={user.avatarURL ?? null} size={24} />
          <VStack alignment="leading" spacing={1}>
            <Text font="subheadline" fontWeight="medium" lineLimit={1}>
              {user.name}
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {user.account ? `@${user.account}` : `UID: ${user.id}`}
            </Text>
          </VStack>
        </HStack>
      </NavigationLink>
    </HStack>
  )
}
