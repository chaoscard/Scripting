import {
  Button,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  ZStack,
  useEffect,
  useRef,
  useState,
} from "scripting"
import { SCRIPT_VERSION } from "../config"
import { loadSettings, onSettingsChanged, updateSettings } from "../store/settings"
import { AvatarImage, presentExternalURL } from "./components"

const GITHUB_AVATAR_URL = "https://avatars.githubusercontent.com/u/16934707?v=4"
const HANA_IRO_AVATAR_URL = "https://github.com/youshen2.png?size=128"
const NPM_ICON_URL = "https://static-production.npmjs.com/b0f1a8318363185cc2ea6a40ac23eeb2.png"
const SCRIPTING_APP_ICON_URL = "https://www.scripting.fun/assets/imgs/Icon-App.png"
const MINI_BILI_ICON_URL = "https://raw.githubusercontent.com/ResistanceTo/MiniBili-WEB/main/public/MiniBili.png"

export function AboutView() {
  const [settings, setSettings] = useState(loadSettings)

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  return (
    <List navigationTitle="关于" navigationBarTitleDisplayMode="inline">
      <Section header={<Text>关于</Text>}>
        <InfoRow title="作者" value="chaoscard" />
        <HomeLinkRow />
        <VersionRow
          version={SCRIPT_VERSION}
          unlocked={settings.advancedSettingsUnlocked}
          onUnlock={() => {
            updateSettings({ advancedSettingsUnlocked: true })
          }}
        />
      </Section>

      <Section header={<Text>项目参考</Text>}>
        <ExternalLinkRow
          title="Notsfsssf/pixez-flutter"
          url="https://github.com/Notsfsssf/pixez-flutter"
          avatarURL={GITHUB_AVATAR_URL}
          avatarCornerRadius={6}
        />
        <ExternalLinkRow
          title="youshen2/Hanairo"
          url="https://github.com/youshen2/Hanairo"
          avatarURL={HANA_IRO_AVATAR_URL}
          avatarCornerRadius={6}
        />
        <ExternalLinkRow
          title="npmjs/pixiv-api-client"
          url="https://www.npmjs.com/package/pixiv-api-client"
          avatarURL={NPM_ICON_URL}
          avatarCornerRadius={6}
        />
      </Section>

      <Section header={<Text>特别鸣谢</Text>}>
        <Text font="body">感谢各位群友的答疑解惑</Text>
        <ExternalLinkRow
          title="Scripting App Chat"
          url="https://t.me/scriptingappchat"
          avatarURL={SCRIPTING_APP_ICON_URL}
          avatarCornerRadius={6}
        />
        <ExternalLinkRow
          title="MiniBili Group"
          url="https://t.me/MiniBiliGroup"
          avatarURL={MINI_BILI_ICON_URL}
          avatarCornerRadius={6}
        />
      </Section>
    </List>
  )
}

function VersionRow(props: {
  version: string
  unlocked: boolean
  onUnlock: () => void
}) {
  const clickCountRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [])

  const handleClick = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
    }
    clickCountRef.current++
    if (clickCountRef.current >= 5) {
      clickCountRef.current = 0
      props.onUnlock()
      void Haptics.transient(1.0, 1.0)
    } else {
      void Haptics.transient(0.4, 0.4)
      timerRef.current = setTimeout(() => {
        clickCountRef.current = 0
      }, 2000)
    }
  }

  return (
    <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
      <Text font="body">版本</Text>
      <Spacer />
      <Button buttonStyle="plain" action={handleClick}>
        <HStack spacing={4}>
          <Text font="body" foregroundStyle="secondaryLabel">
            {props.version}
          </Text>
          {props.unlocked ? (
            <Image
              systemName="lock.open.fill"
              font="caption2"
              foregroundStyle="systemGreen"
            />
          ) : null}
        </HStack>
      </Button>
    </HStack>
  )
}

function InfoRow(props: { title: string; value: string }) {
  return (
    <HStack spacing={8}>
      <Text font="body">{props.title}</Text>
      <Spacer />
      <Text font="body" foregroundStyle="secondaryLabel">{props.value}</Text>
    </HStack>
  )
}

function HomeLinkRow() {
  return (
    <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
      <Text font="body">主页</Text>
      <Spacer />
      <Button
        buttonStyle="plain"
        action={() => void presentExternalURL("https://github.com/chaoscard/Scripting")}
      >
        <HStack spacing={4}>
          <Text font="body" foregroundStyle="#007AFF">chaoscard/Scripting</Text>
          <Image systemName="arrow.up.right" font="footnote" foregroundStyle="tertiaryLabel" />
        </HStack>
      </Button>
    </HStack>
  )
}

function ExternalLinkRow(props: {
  title: string
  url: string
  avatarURL?: string
  avatarCornerRadius?: number
}) {
  return (
    <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
      <ZStack alignment="leading">
        <Text font="caption" frame={{ width: 0, height: 0 }} foregroundStyle="clear">
          {" "}
        </Text>
        {props.avatarURL ? (
          <AvatarImage
            url={props.avatarURL}
            size={28}
            cornerRadius={props.avatarCornerRadius ?? 6}
          />
        ) : null}
      </ZStack>
      <Spacer />
      <Button buttonStyle="plain" action={() => void presentExternalURL(props.url)}>
        <HStack spacing={4}>
          <Text font="body" foregroundStyle="#007AFF">{props.title}</Text>
          <Image systemName="arrow.up.right" font="footnote" foregroundStyle="tertiaryLabel" />
        </HStack>
      </Button>
    </HStack>
  )
}
