import {
  Button,
  HStack,
  Image,
  List,
  NavigationLink,
  Section,
  Text,
} from "scripting"
import { session } from "../api/session"
import { appToolbar, AvatarImage } from "./components"
import { destinationElement } from "./routes"

export function MoreView(props: { onClose: () => void }) {
  const user = session.user
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
          <HStack spacing={8}>
            <Image systemName="heart.fill" foregroundStyle="#FF375F" />
            <Text font="body">我的收藏</Text>
          </HStack>
        </NavigationLink>
        <NavigationLink value="history">
          <HStack spacing={8}>
            <Image systemName="clock.fill" foregroundStyle="#FF9F0A" />
            <Text font="body">浏览记录</Text>
          </HStack>
        </NavigationLink>
        <NavigationLink value="novelBookmarks">
          <HStack spacing={8}>
            <Image systemName="bookmark.fill" foregroundStyle="#AF52DE" />
            <Text font="body">阅读书签</Text>
          </HStack>
        </NavigationLink>
      </Section>

      <Section header={<Text>关联</Text>}>
        <NavigationLink value="connections:following">
          <HStack spacing={8}>
            <Image systemName="person.2.fill" foregroundStyle="#007AFF" />
            <Text font="body">我的关注</Text>
          </HStack>
        </NavigationLink>
        <NavigationLink value="connections:follower">
          <HStack spacing={8}>
            <Image systemName="person.2.badge.plus" foregroundStyle="#34C759" />
            <Text font="body">我的粉丝</Text>
          </HStack>
        </NavigationLink>
        <NavigationLink value="friends">
          <HStack spacing={8}>
            <Image systemName="person.2.badge.gearshape" foregroundStyle="#AF52DE" />
            <Text font="body">我的好友</Text>
          </HStack>
        </NavigationLink>
        <NavigationLink value="notifications">
          <HStack spacing={8}>
            <Image systemName="bell.fill" foregroundStyle="#FF375F" />
            <Text font="body">我的通知</Text>
          </HStack>
        </NavigationLink>
      </Section>

      <Section header={<Text>其他</Text>}>
        <NavigationLink value="settings">
          <HStack spacing={8}>
            <Image systemName="gearshape.fill" foregroundStyle="secondaryLabel" />
            <Text font="body">设置</Text>
          </HStack>
        </NavigationLink>
        <NavigationLink value="about">
          <HStack spacing={8}>
            <Image systemName="info.circle.fill" foregroundStyle="#007AFF" />
            <Text font="body">关于</Text>
          </HStack>
        </NavigationLink>
        <Button
          title="注销"
          systemImage="rectangle.portrait.and.arrow.right"
          buttonStyle="plain"
          foregroundStyle="systemRed"
          action={() => {
            session.signOut()
          }}
        />
      </Section>
    </List>
  )
}
