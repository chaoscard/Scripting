import {
  Button,
  Group,
  HStack,
  Image,
  List,
  NavigationLink,
  Section,
  Spacer,
  Text,
  useEffect,
  useState,
} from "scripting"
import { session } from "../api/session"
import { loadSettings, onSettingsChanged } from "../store/settings"
import { appToolbar, AvatarImage } from "./components"
import { destinationElement } from "./routes"

export function MoreView(props: { onClose: () => void }) {
  const user = session.user
  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)

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

  const avatarURL = user.profile_image_urls?.px_170x170 ?? null
  return (
    <List
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      toolbar={appToolbar(
        props.onClose,
        "我的",
        <NavigationLink
          value={`user:${user.id}`}
          buttonStyle="glass"
          frame={{ width: 30, height: 30 }}
          clipShape={{ type: "rect", cornerRadius: 15 }}
          contentShape="rect"
        >
          <AvatarImage url={avatarURL} size={28} />
        </NavigationLink>
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
            <MoreRow icon="book.pages.fill" iconColor="#0096FA" title="小说书签" />
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
          foregroundStyle="systemRed"
          action={() => {}}
          contextMenu={{
            menuItems: (
              <Group>
                <Button
                  title="确认注销登录"
                  systemImage="rectangle.portrait.and.arrow.right"
                  role="destructive"
                  action={() => {
                    session.signOut()
                  }}
                />
              </Group>
            ),
          }}
        >
          <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
            <Image
              systemName="rectangle.portrait.and.arrow.right"
              frame={{ width: 24 }}
            />
            <Text font="body">注销</Text>
            <Spacer />
            <Image
              systemName="chevron.right"
              font="caption"
              fontWeight="semibold"
              foregroundStyle="systemRed"
            />
          </HStack>
        </Button>
      </Section>
    </List>
  )
}

function MoreRow(props: {
  icon: string
  iconColor?: any
  title: string
}) {
  return (
    <HStack spacing={12}>
      <Image
        systemName={props.icon}
        foregroundStyle={props.iconColor}
        frame={{ width: 24 }}
      />
      <Text font="body">{props.title}</Text>
    </HStack>
  )
}
