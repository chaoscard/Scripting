import {
  Button,
  Circle,
  Group,
  HStack,
  Image,
  Label,
  List,
  Menu,
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
import { loadSettings, onSettingsChanged } from "../store/settings"
import { AvatarImage, EmptyView } from "./components"
import { DockSegmentedBar, useRegisterBottomAccessory } from "./bottomAccessory"
import { triggerHaptic } from "../utils/haptics"

type BlockedScope = "tag" | "user"

export function BlockedSettingsView() {
  const [scope, setScope] = useState<BlockedScope>("tag")
  const [blocklist, setBlocklist] = useState(loadBlocklist())
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"

  useEffect(() => onBlocklistChanged(() => setBlocklist(loadBlocklist())), [])
  useEffect(() => {
    return onSettingsChanged(() => {
      setPageLayout(loadSettings().pageLayout)
    })
  }, [])

  const segmentedItems = [
    { tag: "tag" as const, label: "屏蔽标签" },
    { tag: "user" as const, label: "屏蔽用户" },
  ]

  useRegisterBottomAccessory(
    "blockedSettings",
    <DockSegmentedBar
      items={segmentedItems}
      value={scope}
      onChanged={(val) => setScope(val as BlockedScope)}
    />,
    isAppleMusic
  )

  function clearCurrent() {
    const next =
      scope === "tag"
        ? clearBlockedTags()
        : clearBlockedUsers()
    setBlocklist(next)
  }

  async function handleClearConfirm() {
    if (currentCount === 0) return
    try {
      triggerHaptic("light")
    } catch {}
    const scopeLabel = scope === "tag" ? "标签" : "用户"
    let confirmed = false
    if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
      confirmed = await Dialog.confirm({
        title: `清空已屏蔽${scopeLabel}`,
        message: `确定要清空全部已屏蔽${scopeLabel}吗？`,
        confirmLabel: "清空",
        cancelLabel: "取消",
      })
    } else {
      confirmed = true
    }
    if (confirmed) {
      try {
        triggerHaptic("warning")
      } catch {}
      clearCurrent()
    }
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
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        principal: (
          <Text font="title2" fontWeight="bold">
            {!isAppleMusic ? `屏蔽设置 · ${scope === "tag" ? "标签" : "用户"}` : "屏蔽设置"}
          </Text>
        ),
        topBarTrailing: [
          isAppleMusic ? (
            <Button
              key="clear-button"
              disabled={currentCount === 0}
              action={handleClearConfirm}
            >
              <Image
                systemName="trash"
                foregroundStyle={currentCount === 0 ? "secondaryLabel" : "systemRed"}
              />
            </Button>
          ) : (
            <Menu key="more-menu" label={<Image systemName="ellipsis.circle" />}>
              <Picker
                title="屏蔽类型"
                value={scope}
                onChanged={(value: string) => {
                  setScope(value as BlockedScope)
                }}
              >
                <Label tag="tag" title="屏蔽标签" systemImage="tag" />
                <Label tag="user" title="屏蔽用户" systemImage="person.crop.circle.badge.xmark" />
              </Picker>
              <Button
                title={`清空已屏蔽${scope === "tag" ? "标签" : "用户"}`}
                systemImage="trash"
                role="destructive"
                disabled={currentCount === 0}
                action={handleClearConfirm}
              />
            </Menu>
          ),
        ],
      }}
    >
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
