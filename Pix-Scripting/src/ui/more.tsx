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
  useMemo,
  useState,
  ZStack,
} from "scripting"
import { AppNavigationLink, useDualRoute } from "./DualRouteContext"
import { session } from "../api/session"
import { loadSettings, onSettingsChanged } from "../store/settings"
import { appToolbar, AvatarImage } from "./components"
import { useLayoutMetrics } from "./hooks"
import { destinationElement } from "./routes"
import { requestPixivRoute, setActiveTabKind, useIsCurrentTab } from "./routeNavigation"
import { DockActionBar, useRegisterBottomAccessory, type DockActionItem } from "./bottomAccessory"
import { useExperimentalAmbientPalette } from "./ambient"
import { ReverseImageSearchSheet } from "./reverseImageSearchSheet"
import { AccountSwitcherSheet } from "./accountSwitcherSheet"
import { triggerHaptic } from "../platform/haptics"

function isVirtualNode(v: unknown): v is VirtualNode {
  return !!v && typeof v === "object" && ("render" in v || "isInternal" in v || "props" in v)
}

export function MoreView(props: { onClose: () => void }) {
  useEffect(() => {
    setActiveTabKind("more")
  }, [])

  const { isCompact } = useLayoutMetrics()
  const user = session.user
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"
  const [activeSheet, setActiveSheet] = useState<"none" | "reverseSearch" | "accountSwitcher">("none")
  const avatarURL = user?.profile_image_urls?.px_170x170 ?? null
  const isTabActive = useIsCurrentTab("more")
  const { ambientBackground } = useExperimentalAmbientPalette(avatarURL, isTabActive)

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      setHideNovels(nextSettings.hideNovels)
      setPageLayout(nextSettings.pageLayout)
    })
  }, [])

  const moreDockItems = useMemo<DockActionItem[]>(() => {
    return [
      {
        key: "reverseSearch",
        label: "以图搜图",
        icon: "photo.badge.magnifyingglass",
        action: () => {
          try {
            triggerHaptic("selection")
          } catch {}
          setActiveSheet("reverseSearch")
        },
      },
      {
        key: "downloadManager",
        label: "下载与文件管理",
        icon: "arrow.down.circle",
        action: () => {
          try {
            triggerHaptic("selection")
          } catch {}
          requestPixivRoute("downloadManager", "more")
        },
      },
    ]
  }, [])

  useRegisterBottomAccessory(
    "more",
    <DockActionBar items={moreDockItems} />,
    isAppleMusic
  )

  if (!user) {
    return (
      <List
        navigationBarTitleDisplayMode="inline"
        navigationDestination={destinationElement}
        toolbar={appToolbar(props.onClose, undefined, undefined, undefined, { isCompact })}
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
    <ZStack
      navigationBarTitleDisplayMode="inline"
      toolbarBackground="clear"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      navigationDestination={destinationElement}
      toolbar={appToolbar(
        props.onClose,
        undefined,
        [
          <Button
            key="reverse-search"
            action={() => {
              try {
                triggerHaptic("selection")
              } catch {}
              setActiveSheet("reverseSearch")
            }}
          >
            <Image systemName="photo.badge.magnifyingglass" />
          </Button>,
          <AppNavigationLink
            key="downloads"
            value="downloadManager"
          >
            <Image systemName="arrow.down.circle" />
          </AppNavigationLink>,
          <AppNavigationLink
            key="profile"
            value={`user:${user.id}`}
          >
            <AvatarImage url={avatarURL} size={28} />
          </AppNavigationLink>,
        ],
        undefined,
        { isCompact }
      )}
    >
      {isVirtualNode(ambientBackground) ? (
        ambientBackground
      ) : (
        <Rectangle fill={ambientBackground ?? "clear"} ignoresSafeArea={true} />
      )}
      <List
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
      >
      <Section header={<Text>浏览</Text>}>
        <AppNavigationLink value="library">
          <MoreRow icon="heart.fill" iconColor="#FF375F" title="我的收藏" />
        </AppNavigationLink>
        <AppNavigationLink value="history">
          <MoreRow icon="clock.fill" iconColor="#FF9F0A" title="浏览记录" />
        </AppNavigationLink>
        {hideNovels ? null : (
          <AppNavigationLink value="novelBookmarks">
            <MoreRow icon="book.pages.fill" iconColor="#AF52DE" title="小说书签" />
          </AppNavigationLink>
        )}
      </Section>

      <Section header={<Text>关联</Text>}>
        <AppNavigationLink value="connections:following">
          <MoreRow icon="person.2.fill" iconColor="#007AFF" title="我的关注" />
        </AppNavigationLink>
        <AppNavigationLink value="connections:follower">
          <MoreRow icon="person.2.badge.plus" iconColor="#34C759" title="我的粉丝" />
        </AppNavigationLink>
        <AppNavigationLink value="friends">
          <MoreRow icon="person.2.badge.gearshape" iconColor="#AF52DE" title="我的好友" />
        </AppNavigationLink>
        <AppNavigationLink value="myWorks">
          <MoreRow icon="photo.stack.fill" iconColor="#FF9500" title="我的作品" />
        </AppNavigationLink>
        <AppNavigationLink value="notifications">
          <MoreRow icon="bell.fill" iconColor="#FF375F" title="我的通知" />
        </AppNavigationLink>
      </Section>

      <Section header={<Text>其他</Text>}>
        <AppNavigationLink value="settings">
          <MoreRow icon="gearshape.fill" iconColor="secondaryLabel" title="应用设置" />
        </AppNavigationLink>
        <AppNavigationLink value="about">
          <MoreRow icon="info.circle.fill" iconColor="#007AFF" title="关于应用" />
        </AppNavigationLink>
        <Button
          buttonStyle="plain"
          action={() => {
            try {
              triggerHaptic("selection")
            } catch {}
            setActiveSheet("accountSwitcher")
          }}
          contentShape="rect"
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <MoreRow
            icon="person.2.circle.fill"
            iconColor="systemYellow"
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
    <HStack
      spacing={12}
      alignment="center"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      contentShape="rect"
    >
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
