import {
  Button,
  Group,
  HStack,
  Image,
  List,
  NavigationLink,
  Rectangle,
  Section,
  Spacer,
  Text,
  VirtualNode,
  VStack,
  useEffect,
  useState,
  ZStack,
} from "scripting"
import { session } from "../api/session"
import { loadSettings, onSettingsChanged } from "../store/settings"
import { appToolbar, AvatarImage } from "./components"
import { destinationElement } from "./routes"
import { setActiveTabKind } from "./routeNavigation"
import { useExperimentalAmbientPalette } from "./hooks"
import { ReverseImageSearchSheet } from "./reverseImageSearchSheet"
import { AccountSwitcherSheet } from "./accountSwitcherSheet"

declare const Haptics: any

function isVirtualNode(v: unknown): v is VirtualNode {
  return !!v && typeof v === "object" && ("render" in v || "isInternal" in v || "props" in v)
}

export function MoreView(props: { onClose: () => void }) {
  useEffect(() => {
    setActiveTabKind("more")
  }, [])

  const user = session.user
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [activeSheet, setActiveSheet] = useState<"none" | "reverseSearch" | "accountSwitcher">("none")
  const avatarURL = user?.profile_image_urls?.px_170x170 ?? null
  const { ambientBackground } = useExperimentalAmbientPalette(avatarURL)

  useEffect(() => {
    return onSettingsChanged(() => {
      setHideNovels(loadSettings().hideNovels)
    })
  }, [])

  if (!user) {
    return (
      <List
        navigationBarTitleDisplayMode="inline"
        navigationDestination={destinationElement}
        toolbar={appToolbar(props.onClose, "我的")}
      >
        <Section header={<Text>账号</Text>}>
          <Text font="body" foregroundStyle="secondaryLabel">
            未登录
          </Text>
        </Section>
      </List>
    )
  }

  return (
    <ZStack navigationDestination={destinationElement}>
      {isVirtualNode(ambientBackground) ? (
        ambientBackground
      ) : (
        <Rectangle fill={ambientBackground ?? "clear"} ignoresSafeArea={true} />
      )}
      <List
        navigationBarTitleDisplayMode="inline"
        navigationDestination={destinationElement}
        scrollContentBackground={ambientBackground ? "hidden" : undefined}
        sheet={{
          isPresented: activeSheet !== "none",
          onChanged: (val: boolean) => {
            if (!val) setActiveSheet("none")
          },
          content:
            activeSheet === "reverseSearch" ? (
              <ReverseImageSearchSheet onClose={() => setActiveSheet("none")} />
            ) : activeSheet === "accountSwitcher" ? (
              <AccountSwitcherSheet onClose={() => setActiveSheet("none")} />
            ) : (
              <VStack />
            ),
        }}
        toolbar={appToolbar(
        props.onClose,
        "我的",
        [
          <Button
            key="reverse-search"
            action={() => {
              try {
                void Haptics.transient()
              } catch {}
              setActiveSheet("reverseSearch")
            }}
          >
            <Image systemName="photo.badge.magnifyingglass" />
          </Button>,
          <NavigationLink
            key="downloads"
            value="downloadManager"
          >
            <Image systemName="arrow.down.circle" />
          </NavigationLink>,
          <NavigationLink
            key="profile"
            value={`user:${user.id}`}
          >
            <AvatarImage url={avatarURL} size={28} />
          </NavigationLink>,
        ]
      )}
    >
      <Section header={<Text>浏览</Text>}>
        <NavigationLink value="library">
          <MoreRow icon="heart.fill" iconColor="#FF375F" title="我的收藏" />
        </NavigationLink>
        <NavigationLink value="history">
          <MoreRow icon="clock.fill" iconColor="#FF9F0A" title="浏览记录" />
        </NavigationLink>
        {hideNovels ? null : (
          <NavigationLink value="novelBookmarks">
            <MoreRow icon="book.pages.fill" iconColor="#AF52DE" title="小说书签" />
          </NavigationLink>
        )}
      </Section>

      <Section header={<Text>关联</Text>}>
        <NavigationLink value="connections:following">
          <MoreRow icon="person.2.fill" iconColor="#007AFF" title="我的关注" />
        </NavigationLink>
        <NavigationLink value="connections:follower">
          <MoreRow icon="person.2.badge.plus" iconColor="#34C759" title="我的粉丝" />
        </NavigationLink>
        <NavigationLink value="friends">
          <MoreRow icon="person.2.badge.gearshape" iconColor="#AF52DE" title="我的好友" />
        </NavigationLink>
        <NavigationLink value="myWorks">
          <MoreRow icon="photo.stack.fill" iconColor="#FF9500" title="我的作品" />
        </NavigationLink>
        <NavigationLink value="notifications">
          <MoreRow icon="bell.fill" iconColor="#FF375F" title="我的通知" />
        </NavigationLink>
      </Section>

      <Section header={<Text>其他</Text>}>
        <NavigationLink value="settings">
          <MoreRow icon="gearshape.fill" iconColor="secondaryLabel" title="设置" />
        </NavigationLink>
        <NavigationLink value="about">
          <MoreRow icon="info.circle.fill" iconColor="#007AFF" title="关于" />
        </NavigationLink>
        <Button
          buttonStyle="plain"
          action={() => {
            try {
              void Haptics.transient()
            } catch {}
            setActiveSheet("accountSwitcher")
          }}
        >
          <MoreRow
            icon="person.2.circle.fill"
            iconColor="#007AFF"
            title="账号管理"
            showChevron
          />
        </Button>
      </Section>
      </List>
    </ZStack>
  )
}

function MoreRow(props: {
  icon: string
  iconColor?: any
  title: string
  subtitle?: string
  showChevron?: boolean
}) {
  return (
    <HStack spacing={12} alignment="center">
      <Image
        systemName={props.icon}
        foregroundStyle={props.iconColor}
        frame={{ width: 24 }}
      />
      <VStack alignment="leading" spacing={2}>
        <Text font="body">{props.title}</Text>
        {props.subtitle ? (
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
            {props.subtitle}
          </Text>
        ) : null}
      </VStack>
      {props.showChevron ? (
        <>
          <Spacer />
          <Image
            systemName="chevron.right"
            font="subheadline"
            fontWeight="semibold"
            foregroundStyle="tertiaryLabel"
          />
        </>
      ) : props.subtitle ? (
        <Spacer />
      ) : null}
    </HStack>
  )
}
