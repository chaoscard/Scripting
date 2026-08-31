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
  TextField,
  useEffect,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { userDetail } from "../api/pixiv"
import { session } from "../api/session"
import {
  blockTag,
  blockUser,
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
  const [showInput, setShowInput] = useState(false)
  const [input, setInput] = useState("")
  const [adding, setAdding] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)

  useEffect(() => onBlocklistChanged(() => setBlocklist(loadBlocklist())), [])

  function openInput() {
    setInput("")
    setInputError(null)
    setShowInput(true)
  }

  function closeInput() {
    setShowInput(false)
    setInput("")
    setInputError(null)
  }

  async function addCurrent() {
    const value = input.trim()
    if (!value || adding) return
    setInputError(null)

    if (scope === "tag") {
      const next = blockTag(value)
      setBlocklist(next)
      closeInput()
      return
    }

    const userID = Number(value)
    if (!Number.isSafeInteger(userID) || userID <= 0) {
      setInputError("请输入有效的用户 UID")
      return
    }

    setAdding(true)
    try {
      const detail = await session.call((token) => userDetail(userID, token))
      setBlocklist(blockUser(detail.user))
      closeInput()
    } catch (error: any) {
      setInputError(error?.message ?? "未找到该用户")
    } finally {
      setAdding(false)
    }
  }

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
          <Button action={openInput}>
            <Image systemName="plus" />
          </Button>,
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
      safeAreaInset={
        showInput
          ? {
              bottom: {
                spacing: 0,
                content: (
                  <VStack
                    alignment="leading"
                    spacing={6}
                    padding={{ horizontal: 14, top: 10, bottom: 8 }}
                  >
                    <HStack
                      spacing={8}
                      padding={{ horizontal: 12, vertical: 8 }}
                      frame={{ maxWidth: "infinity", height: 48 }}
                      glassEffect={{ glass: UIGlass.regular(), shape: "capsule" }}
                      clipShape="capsule"
                    >
                      <TextField
                        label={
                          <Text>
                            {scope === "tag" ? "屏蔽标签" : "屏蔽用户 UID"}
                          </Text>
                        }
                        prompt={scope === "tag" ? "输入标签名称" : "输入用户 UID"}
                        value={input}
                        onChanged={setInput}
                        autofocus={true}
                        axis="horizontal"
                        textFieldStyle="plain"
                        frame={{ maxWidth: "infinity" }}
                      />
                      <Button
                        buttonStyle="glass"
                        disabled={!input.trim() || adding}
                        frame={{ width: 32, height: 32 }}
                        clipShape={{ type: "rect", cornerRadius: 16 }}
                        contentShape="rect"
                        action={() => void addCurrent()}
                      >
                        <Image systemName="plus" />
                      </Button>
                    </HStack>
                    {inputError ? (
                      <Text font="caption" foregroundStyle="systemRed">
                        {inputError}
                      </Text>
                    ) : null}
                  </VStack>
                ),
              },
            }
          : undefined
      }
    >
      <Picker
        title="屏蔽类型"
        value={scope}
        onChanged={(value: string) => {
          setScope(value as BlockedScope)
          closeInput()
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
      spacing={12}
      padding={{ vertical: 4 }}
      trailingSwipeActions={{
        allowsFullSwipe: true,
        actions: [
          <Button
            key="delete"
            title="删除"
            systemImage="trash"
            role="destructive"
            action={onRemove}
          />,
        ],
      }}
    >
      <ZStack
        frame={{ width: 28, height: 28 }}
        glassEffect={{ type: "rect", cornerRadius: 6 }}
      >
        <Image systemName="tag.fill" font="subheadline" foregroundStyle="systemBlue" />
      </ZStack>
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
      spacing={10}
      padding={{ vertical: 4 }}
      trailingSwipeActions={{
        allowsFullSwipe: true,
        actions: [
          <Button
            key="delete"
            title="删除"
            systemImage="trash"
            role="destructive"
            action={onRemove}
          />,
        ],
      }}
    >
      <NavigationLink value={`user:${user.id}`} frame={{ maxWidth: "infinity" }}>
        <HStack spacing={10} alignment="center">
          <ZStack frame={{ width: 38, height: 38 }}>
            <Circle
              fill="rgba(255, 255, 255, 0.16)"
              glassEffect={true}
              frame={{ width: 38, height: 38 }}
            />
            <AvatarImage url={user.avatarURL ?? null} size={32} />
          </ZStack>
          <VStack alignment="leading" spacing={2}>
            <Text font="body" fontWeight="semibold" lineLimit={1}>
              {user.name}
            </Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
              {user.account ? `@${user.account}` : `UID: ${user.id}`}
            </Text>
          </VStack>
        </HStack>
      </NavigationLink>
    </HStack>
  )
}
