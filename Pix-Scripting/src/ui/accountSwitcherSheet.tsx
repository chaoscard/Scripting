import {
  Button,
  Divider,
  Group,
  HStack,
  Image,
  LazyVStack,
  NavigationStack,
  ScrollView,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { session } from "../api/session"
import type { StoredAccountProfile } from "../api/auth"
import { AvatarImage } from "./components/CachedImage"
import { LoginView } from "./login"

declare const Haptics: any

export function AccountSwitcherSheet(props: {
  onClose: () => void
}) {
  const { onClose } = props
  const [accounts, setAccounts] = useState<StoredAccountProfile[]>(() => session.getAllAccounts())
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [isAddingAccount, setIsAddingAccount] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeUserId = session.userID ? String(session.userID) : null

  useEffect(() => {
    return session.onAuthChanged(() => {
      setAccounts(session.getAllAccounts())
    })
  }, [])

  const handleSwitch = useCallback(
    async (targetId: string) => {
      if (targetId === activeUserId || switchingId) return
      setSwitchingId(targetId)
      setError(null)
      try {
        void Haptics.transient()
      } catch {}
      try {
        const ok = await session.switchAccount(targetId)
        if (ok) {
          try {
            void Haptics.transient(0.8, 0.8)
          } catch {}
          onClose()
        } else {
          setError("切换账号失败：该账号授权已失效或已过期，请点击添加账号重新登录")
        }
      } catch (err: any) {
        setError(err?.message ?? "切换账号失败")
      } finally {
        setSwitchingId(null)
      }
    },
    [activeUserId, switchingId, onClose]
  )

  const handleRemoveAccount = useCallback((targetId: string) => {
    try {
      void Haptics.transient()
    } catch {}
    session.removeAccount(targetId)
    setAccounts(session.getAllAccounts())
  }, [])

  const handleSignOutCurrent = useCallback(() => {
    try {
      void Haptics.transient()
    } catch {}
    session.signOut(false)
    onClose()
  }, [onClose])

  if (isAddingAccount) {
    return (
      <LoginView
        onClose={() => setIsAddingAccount(false)}
        onSuccess={() => {
          setIsAddingAccount(false)
          setAccounts(session.getAllAccounts())
          onClose()
        }}
      />
    )
  }

  return (
    <NavigationStack
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
    >
      <ScrollView
        navigationTitle="账号管理"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: <Button title="关闭" systemImage="xmark" action={onClose} />,
          topBarTrailing: (
            <Button
              title="完成"
              systemImage="checkmark"
              action={onClose}
            />
          ),
        }}
      >
        <VStack alignment="leading" spacing={16} padding={{ horizontal: 16, top: 12, bottom: 32 }}>
          {error ? (
            <HStack
              alignment="center"
              spacing={8}
              padding={10}
              background="rgba(255, 59, 48, 0.15)"
              clipShape={{ type: "rect", cornerRadius: 10 }}
              frame={{ maxWidth: "infinity" }}
            >
              <Image systemName="exclamationmark.triangle.fill" foregroundStyle="#FF3B30" font="subheadline" />
              <Text font="caption" foregroundStyle="#FF3B30">
                {error}
              </Text>
            </HStack>
          ) : null}

          {/* 1. 已登录账号列表 */}
          <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
            <Text font="caption" fontWeight="semibold" foregroundStyle="secondaryLabel">
              已登录账号 ({accounts.length})
            </Text>

            <VStack
              spacing={0}
              glassEffect={{ type: "rect", cornerRadius: 14 }}
              clipShape={{ type: "rect", cornerRadius: 14 }}
              frame={{ maxWidth: "infinity" }}
            >
              {accounts.map((acc, index) => {
                const isActive = acc.id === activeUserId
                const isSwitching = switchingId === acc.id

                return (
                  <VStack key={acc.id} spacing={0} frame={{ maxWidth: "infinity" }}>
                    {index > 0 ? <Divider /> : null}
                    <Button
                      buttonStyle="plain"
                      action={() => {
                        if (!isActive) {
                          void handleSwitch(acc.id)
                        }
                      }}
                      contentShape="rect"
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                      contextMenu={
                        !isActive
                          ? {
                              menuItems: (
                                <Group>
                                  <Button
                                    title="从本机移除此账号"
                                    systemImage="trash"
                                    role="destructive"
                                    action={() => handleRemoveAccount(acc.id)}
                                  />
                                </Group>
                              ),
                            }
                          : undefined
                      }
                    >
                      <HStack
                        alignment="center"
                        spacing={12}
                        padding={{ horizontal: 14, vertical: 12 }}
                        frame={{ maxWidth: "infinity", alignment: "leading" }}
                        contentShape="rect"
                      >
                        <ZStack
                          alignment="center"
                          frame={{ width: 44, height: 44 }}
                          clipShape="circle"
                        >
                          <AvatarImage url={acc.avatarUrl ?? null} size={44} />
                        </ZStack>

                        <VStack alignment="leading" spacing={3}>
                          <HStack alignment="center" spacing={6}>
                            <Text font="body" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
                              {acc.name}
                            </Text>
                            {acc.isPremium ? (
                              <HStack
                                spacing={2}
                                padding={{ horizontal: 5, vertical: 1 }}
                                background="#FF9500"
                                clipShape="capsule"
                              >
                                <Text font="caption2" fontWeight="bold" foregroundStyle="white">
                                  PREMIUM
                                </Text>
                              </HStack>
                            ) : null}
                          </HStack>
                          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                            @{acc.account}
                          </Text>
                          <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
                            UID: {acc.id}
                          </Text>
                        </VStack>

                        <Spacer />

                        {isActive ? (
                          <HStack
                            alignment="center"
                            spacing={4}
                            padding={{ horizontal: 8, vertical: 4 }}
                            glassEffect="capsule"
                            contentShape="capsule"
                          >
                            <Image systemName="checkmark.circle.fill" font="caption" foregroundStyle="#34C759" />
                            <Text font="caption2" fontWeight="bold" foregroundStyle="#34C759">
                              当前使用
                            </Text>
                          </HStack>
                        ) : isSwitching ? (
                          <Text font="caption" foregroundStyle="#007AFF">
                            切换中...
                          </Text>
                        ) : (
                          <Image systemName="arrow.triangle.2.circlepath" font="subheadline" foregroundStyle="secondaryLabel" />
                        )}
                      </HStack>
                    </Button>
                  </VStack>
                )
              })}
            </VStack>
          </VStack>

          {/* 2. 操作功能列表 */}
          <VStack
            spacing={0}
            glassEffect={{ type: "rect", cornerRadius: 14 }}
            clipShape={{ type: "rect", cornerRadius: 14 }}
            frame={{ maxWidth: "infinity" }}
          >
            {/* 添加新账号 */}
            <Button
              buttonStyle="plain"
              action={() => {
                try {
                  void Haptics.transient()
                } catch {}
                setIsAddingAccount(true)
              }}
              contentShape="rect"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              <HStack
                alignment="center"
                spacing={12}
                padding={{ horizontal: 14, vertical: 12 }}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                contentShape="rect"
              >
                <Image systemName="plus.circle.fill" font="body" foregroundStyle="#007AFF" />
                <Text font="body" fontWeight="medium" foregroundStyle="#007AFF">
                  登录并添加新账号
                </Text>
                <Spacer />
                <Image
                  systemName="chevron.right"
                  font="subheadline"
                  fontWeight="semibold"
                  foregroundStyle="#007AFF"
                />
              </HStack>
            </Button>

            <Divider />

            {/* 退出当前账号 */}
            <Button
              buttonStyle="plain"
              action={handleSignOutCurrent}
              contentShape="rect"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
              contextMenu={{
                menuItems: (
                  <Group>
                    <Button
                      title="确认退出当前账号"
                      systemImage="rectangle.portrait.and.arrow.right"
                      role="destructive"
                      action={handleSignOutCurrent}
                    />
                  </Group>
                ),
              }}
            >
              <HStack
                alignment="center"
                spacing={12}
                padding={{ horizontal: 14, vertical: 12 }}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                contentShape="rect"
              >
                <Image systemName="rectangle.portrait.and.arrow.right" font="body" foregroundStyle="#FF3B30" />
                <Text font="body" fontWeight="medium" foregroundStyle="#FF3B30">
                  退出当前账号
                </Text>
                <Spacer />
                <Image
                  systemName="chevron.right"
                  font="subheadline"
                  fontWeight="semibold"
                  foregroundStyle="#FF3B30"
                />
              </HStack>
            </Button>
          </VStack>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}
