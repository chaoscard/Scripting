import {
  Button,
  Group,
  HStack,
  Image,
  NavigationLink,
  Picker,
  ScrollView,
  Text,
  TextField,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { userDetail } from "../api/pixiv"
import { session } from "../api/session"
import {
  blockTag,
  blockUser,
  loadSettings,
  onSettingsChanged,
  unblockTag,
  unblockUser,
  updateSettings,
  type BlockedUser,
} from "../store/settings"
import { AuthorRow, EmptyView } from "./components"

type BlockedScope = "tag" | "user"

export function BlockedSettingsView() {
  const [scope, setScope] = useState<BlockedScope>("tag")
  const [settings, setSettings] = useState(loadSettings())
  const [showInput, setShowInput] = useState(false)
  const [input, setInput] = useState("")
  const [adding, setAdding] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)

  useEffect(() => onSettingsChanged(() => setSettings(loadSettings())), [])

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
      setSettings(next)
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
      setSettings(blockUser(detail.user))
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
        ? updateSettings({ blockedTags: [] })
        : updateSettings({ blockedUsers: [] })
    setSettings(next)
  }

  const empty =
    scope === "tag"
      ? { text: "暂无已屏蔽标签", systemImage: "tag" }
      : { text: "暂无已屏蔽用户", systemImage: "person.crop.circle.badge.xmark" }

  return (
    <ScrollView
      navigationTitle="屏蔽标签"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarTrailing: [
          <Button
            buttonStyle="glass"
            frame={{ width: 30, height: 30 }}
            clipShape={{ type: "rect", cornerRadius: 15 }}
            contentShape="rect"
            action={openInput}
          >
            <Image systemName="plus" />
          </Button>,
          <Button
            buttonStyle="glass"
            frame={{ width: 30, height: 30 }}
            clipShape={{ type: "rect", cornerRadius: 15 }}
            contentShape="rect"
            action={() => {}}
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
      <VStack alignment="leading" spacing={8} padding={{ horizontal: 10, bottom: 12 }}>
        <Picker
          title="屏蔽类型"
          value={scope}
          onChanged={(value: string) => {
            setScope(value as BlockedScope)
            closeInput()
          }}
          pickerStyle="segmented"
          padding={{ horizontal: 4 }}
        >
          <Text tag="tag">标签</Text>
          <Text tag="user">用户</Text>
        </Picker>

          {scope === "tag" ? (
            settings.blockedTags.length === 0 ? (
              <EmptyView text={empty.text} systemImage={empty.systemImage} />
            ) : (
              <VStack alignment="leading" spacing={8}>
                {settings.blockedTags.map((tag) => (
                  <HStack
                    key={tag}
                    spacing={10}
                    padding={10}
                    glassEffect={{ type: "rect", cornerRadius: 8 }}
                    glassEffectTransition="materialize"
                    frame={{ maxWidth: "infinity" }}
                  >
                    <Image systemName="tag" foregroundStyle="secondaryLabel" />
                    <Text font="body" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      {tag}
                    </Text>
                    <Button
                      buttonStyle="glass"
                      frame={{ width: 28, height: 28 }}
                      clipShape={{ type: "rect", cornerRadius: 14 }}
                      contentShape="rect"
                      action={() => setSettings(unblockTag(tag))}
                    >
                      <Image systemName="xmark" foregroundStyle="systemRed" />
                    </Button>
                  </HStack>
                ))}
              </VStack>
            )
          ) : settings.blockedUsers.length === 0 ? (
            <EmptyView text={empty.text} systemImage={empty.systemImage} />
          ) : (
            <VStack alignment="leading" spacing={8}>
              {settings.blockedUsers.map((user) => (
                <BlockedUserRow
                  key={user.id}
                  user={user}
                  onRemove={() => setSettings(unblockUser(user.id))}
                />
              ))}
            </VStack>
          )}
      </VStack>
    </ScrollView>
  )
}

function BlockedUserRow(props: { user: BlockedUser; onRemove: () => void }) {
  const { user } = props
  return (
    <HStack
      spacing={10}
      padding={10}
      glassEffect={{ type: "rect", cornerRadius: 8 }}
      glassEffectTransition="materialize"
      frame={{ maxWidth: "infinity" }}
    >
      <NavigationLink value={`user:${user.id}`} frame={{ maxWidth: "infinity" }}>
        <AuthorRow
          user={{
            id: user.id,
            name: user.name,
            account: user.account,
            profile_image_urls: { medium: user.avatarURL },
          }}
          size={28}
        />
      </NavigationLink>
      <Button
        buttonStyle="glass"
        frame={{ width: 28, height: 28 }}
        clipShape={{ type: "rect", cornerRadius: 14 }}
        contentShape="rect"
        action={props.onRemove}
      >
        <Image systemName="xmark" foregroundStyle="systemRed" />
      </Button>
    </HStack>
  )
}
