import {
  Button,
  HStack,
  Image,
  NavigationStack,
  ScrollView,
  Text,
  VStack,
  useCallback,
  useState,
} from "scripting"
import {
  blockUser,
  isTagBlocked,
  isUserBlocked,
  loadBlocklist,
  updateBlocklist,
} from "../../store/blocklist"
import type { PixivTag, PixivUser } from "../../types"

export function BlockWorkSheet(props: {
  user?:
    | PixivUser
    | {
        id: number
        name: string
        account?: string
        avatarURL?: string
        profile_image_urls?: { medium?: string }
      }
    | null
  tags?: PixivTag[]
  onClose: () => void
}) {
  const { user, tags = [], onClose } = props

  const blocklist = loadBlocklist()
  const initialUserBlocked = user
    ? isUserBlocked(user.id, blocklist.blockedUsers)
    : false
  const [blockUserSelected, setBlockUserSelected] = useState(initialUserBlocked)

  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => {
    const set = new Set<string>()
    for (const t of tags) {
      if (t.name && isTagBlocked(t.name.trim(), blocklist.blockedTags)) {
        set.add(t.name.trim())
      }
    }
    return set
  })

  const toggleTag = useCallback((rawName: string) => {
    const name = rawName.trim()
    if (!name) return
    void Haptics.transient()
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }, [])

  const toggleUser = useCallback(() => {
    void Haptics.transient()
    setBlockUserSelected((prev) => !prev)
  }, [])

  // 必须点击确认按钮才确认屏蔽
  const handleConfirm = useCallback(() => {
    const current = loadBlocklist()
    let changed = false

    // 1. 处理用户屏蔽
    if (user) {
      const isAlreadyBlocked = isUserBlocked(user.id, current.blockedUsers)
      if (blockUserSelected && !isAlreadyBlocked) {
        blockUser(user)
        changed = true
      }
    }

    // 2. 处理标签屏蔽
    const currentTagSet = new Set(current.blockedTags)
    const mergedTags = [...current.blockedTags]
    for (const tag of selectedTags) {
      if (!currentTagSet.has(tag)) {
        mergedTags.push(tag)
        currentTagSet.add(tag)
        changed = true
      }
    }

    if (changed) {
      updateBlocklist({ blockedTags: mergedTags })
      void Haptics.transient()
    }

    onClose()
  }, [user, blockUserSelected, selectedTags, onClose])

  const validTags = tags.filter((t) => t && t.name && t.name.trim())

  return (
    <NavigationStack
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
    >
      <VStack
        alignment="leading"
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        navigationTitle="屏蔽设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button action={onClose}>
              <Image systemName="xmark" font="headline" />
            </Button>
          ),
          topBarTrailing: (
            <Button action={handleConfirm}>
              <Image
                systemName="checkmark"
                font="headline"
                foregroundStyle="systemRed"
              />
            </Button>
          ),
        }}
      >
        <ScrollView frame={{ maxWidth: "infinity" }}>
          <VStack
            alignment="leading"
            spacing={16}
            padding={{ horizontal: 16, top: 12, bottom: 24 }}
            frame={{ maxWidth: "infinity" }}
          >
            {/* 用户屏蔽分区 */}
            {user ? (
              <VStack
                alignment="leading"
                spacing={8}
                frame={{ maxWidth: "infinity" }}
              >
                <Text
                  font="caption"
                  fontWeight="semibold"
                  foregroundStyle="secondaryLabel"
                  padding={{ horizontal: 4 }}
                >
                  屏蔽用户
                </Text>
                <Button
                  action={toggleUser}
                  buttonStyle="plain"
                  frame={{ maxWidth: "infinity" }}
                  contentShape="rect"
                >
                  <HStack
                    alignment="center"
                    spacing={12}
                    padding={{ horizontal: 14, vertical: 12 }}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                    contentShape="rect"
                    glassEffect={{ type: "rect", cornerRadius: 12 }}
                    border={
                      blockUserSelected
                        ? { style: "systemRed", width: 1.5 }
                        : undefined
                    }
                  >
                    <Image
                      systemName={
                        blockUserSelected ? "checkmark.circle.fill" : "circle"
                      }
                      foregroundStyle={
                        blockUserSelected ? "systemRed" : "secondaryLabel"
                      }
                      font="title3"
                    />
                    <VStack
                      alignment="leading"
                      spacing={2}
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      <Text
                        font="body"
                        fontWeight={blockUserSelected ? "semibold" : "regular"}
                        foregroundStyle="label"
                      >
                        {user.name}
                      </Text>
                      <Text font="caption" foregroundStyle="secondaryLabel">
                        {`UID: ${user.id}${user.account ? ` · @${user.account}` : ""}`}
                      </Text>
                    </VStack>
                  </HStack>
                </Button>
              </VStack>
            ) : null}

            {/* 标签屏蔽分区 */}
            {validTags.length > 0 ? (
              <VStack
                alignment="leading"
                spacing={8}
                frame={{ maxWidth: "infinity" }}
              >
                <Text
                  font="caption"
                  fontWeight="semibold"
                  foregroundStyle="secondaryLabel"
                  padding={{ horizontal: 4 }}
                >
                  屏蔽标签（支持多选）
                </Text>
                <VStack
                  alignment="leading"
                  spacing={8}
                  frame={{ maxWidth: "infinity" }}
                >
                  {validTags.map((tag) => {
                    const tagName = tag.name.trim()
                    const isSelected = selectedTags.has(tagName)
                    return (
                      <Button
                        key={tagName}
                        action={() => toggleTag(tagName)}
                        buttonStyle="plain"
                        frame={{ maxWidth: "infinity" }}
                        contentShape="rect"
                      >
                        <HStack
                          alignment="center"
                          spacing={12}
                          padding={{ horizontal: 14, vertical: 10 }}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                          contentShape="rect"
                          glassEffect={{ type: "rect", cornerRadius: 12 }}
                          border={
                            isSelected
                              ? { style: "systemRed", width: 1.5 }
                              : undefined
                          }
                        >
                          <Image
                            systemName={
                              isSelected
                                ? "checkmark.circle.fill"
                                : "circle"
                            }
                            foregroundStyle={
                              isSelected ? "systemRed" : "secondaryLabel"
                            }
                            font="title3"
                          />
                          <VStack
                            alignment="leading"
                            spacing={2}
                            frame={{
                              maxWidth: "infinity",
                              alignment: "leading",
                            }}
                          >
                            <Text
                              font="body"
                              fontWeight={
                                isSelected ? "semibold" : "regular"
                              }
                              foregroundStyle="label"
                            >
                              {tagName}
                            </Text>
                            {tag.translated_name ? (
                              <Text
                                font="caption"
                                foregroundStyle="secondaryLabel"
                              >
                                {tag.translated_name}
                              </Text>
                            ) : null}
                          </VStack>
                        </HStack>
                      </Button>
                    )
                  })}
                </VStack>
              </VStack>
            ) : null}
          </VStack>
        </ScrollView>
      </VStack>
    </NavigationStack>
  )
}
