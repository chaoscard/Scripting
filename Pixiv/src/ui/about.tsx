import { Button, HStack, Image, List, Section, Spacer, Text } from "scripting"
import { SCRIPT_VERSION } from "../config"
import { AvatarImage } from "./components"

const GITHUB_AVATAR_URL = "https://avatars.githubusercontent.com/u/16934707?v=4"
const HANA_IRO_AVATAR_URL = "https://github.com/youshen2.png?size=128"
const NPM_ICON_URL = "https://static-production.npmjs.com/b0f1a8318363185cc2ea6a40ac23eeb2.png"
const SCRIPTING_APP_CHAT_AVATAR_URL = "https://cdn5.telesco.pe/file/ElsERgk-N3nJ6rA-QoBaZefimbCb-IP1-Oenvu6nDNGopMo5iOahqtjuwoOITGtB6BlBQgkXuTq266GUszVyb-d9SDqbgAZR0STgteNeJwL8xjJniuwaGWJrBI4jZEVLxt2YAq7AbxyDqryBxgeaYvHDBZTnxfNMR4Nvwy79jE9nFvCQlPbjUmZVOsI3gDN1TyEtxpoVpovxmmFWxwHp3UFoyRmldGDaUH6jvF30MY5ticucfgKGbCM6eDertIkobdUFO8XbaRhYZtqGTqwy4QyhgP2T8VTbxuhluJQmD39zM-RVXzGvky_cDoiSDJ3EFrK1CUWPCfjiuDjJDKhsIg.jpg"
const MINI_BILI_GROUP_AVATAR_URL = "https://cdn5.telesco.pe/file/q2bF57-_FcJxveeZHNNXJ5_Z-OWbm3AfSqHRDjmIbvSX6h4fbg8dK5BLxDHRRVZH9cewLol6WMvnt5BL-cmIkcrjwLtm4fz7Q29Zjr8rz5z6qMMIzsCJROnDsOaCD3-nTs72ONhHkEuND1FCMAI2bb7ifXJasMxVcHnBLhrr-Wd2KIysBN0iCq8_aK7WaUQQQ8KTJMuQ3lG-7Nv35NJW_SPzMDC-tj_UQlCHR81dr7u8krfCEu9gsSH1n6ubN4_r9r39pjI0BgZSlBKK4Amls0PD_ETsdWp6QsvB9TgCYzhVtA3c7d6RkAdtbvBY5Cg5G-eCegGo6cqtiBgRPAvOuA.jpg"

export function AboutView() {
  return (
    <List navigationTitle="关于" navigationBarTitleDisplayMode="inline">
      <Section header={<Text>关于</Text>}>
        <InfoRow title="作者" value="chaoscard" />
        <ExternalLinkRow title="主页" url="https://github.com/chaoscard/Scripting" />
        <InfoRow title="版本" value={SCRIPT_VERSION} />
      </Section>

      <Section header={<Text>项目参考</Text>}>
        <ExternalLinkRow
          title="Notsfsssf/pixez-flutter"
          url="https://github.com/Notsfsssf/pixez-flutter"
          avatarURL={GITHUB_AVATAR_URL}
        />
        <ExternalLinkRow
          title="youshen2/Hanairo"
          url="https://github.com/youshen2/Hanairo"
          avatarURL={HANA_IRO_AVATAR_URL}
        />
        <ExternalLinkRow
          title="npmjs/pixiv-api-client"
          url="https://www.npmjs.com/package/pixiv-api-client"
          avatarURL={NPM_ICON_URL}
          avatarCornerRadius={7}
        />
      </Section>

      <Section header={<Text>特别鸣谢</Text>}>
        <Text font="body">感谢各位群友的答疑解惑</Text>
        <ExternalLinkRow
          title="Scripting App Chat"
          url="https://t.me/scriptingappchat"
          avatarURL={SCRIPTING_APP_CHAT_AVATAR_URL}
        />
        <ExternalLinkRow
          title="MiniBili Group"
          url="https://t.me/MiniBiliGroup"
          avatarURL={MINI_BILI_GROUP_AVATAR_URL}
        />
      </Section>
    </List>
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

function ExternalLinkRow(props: {
  title: string
  url: string
  avatarURL?: string
  avatarCornerRadius?: number
}) {
  return (
    <Button
      buttonStyle="plain"
      action={() => {
        void Safari.openURL(props.url)
      }}
    >
      <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
        {props.avatarURL ? (
          <AvatarImage
            url={props.avatarURL}
            size={28}
            cornerRadius={props.avatarCornerRadius}
          />
        ) : null}
        <Text font="body" foregroundStyle="#007AFF">{props.title}</Text>
        <Spacer />
        <Image systemName="arrow.up.right" font="footnote" foregroundStyle="tertiaryLabel" />
      </HStack>
    </Button>
  )
}
