import {
  Button,
  Image,
  List,
  Menu,
  NavigationStack,
  Picker,
  Section,
  Text,
  TextField,
  useEffect,
  useState,
} from "scripting"
import {
  loadSettings,
  updateSettings,
  resetNetworkSettings,
  onSettingsChanged,
  type AppSettings,
} from "../store/settings"

export function LoginNetworkSheet(props: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  function update(patch: Partial<AppSettings>) {
    const next = updateSettings(patch)
    setSettings(next)
  }

  function handleReset() {
    try {
      void Haptics.transient()
    } catch {}
    const next = resetNetworkSettings()
    setSettings(next)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="网络连接"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: [
            <Button
              key="close"
              action={props.onClose}
            >
              <Image systemName="xmark" />
            </Button>,
          ],
          topBarTrailing: [
            <Menu
              key="reset-menu"
              label={<Image systemName="arrow.counterclockwise" />}
            >
              <Button
                title="确认重置网络连接设置吗？"
                systemImage="arrow.counterclockwise"
                role="destructive"
                action={handleReset}
              />
            </Menu>,
            <Button
              key="done"
              action={props.onClose}
            >
              <Image systemName="checkmark" />
            </Button>,
          ],
        }}
      >
        <Section
          header={<Text>图片源</Text>}
          footer={
            <Text>
              图片镜像采用开源 CDN 缓存，完全匿名且不携带任何账号凭据，如需要节省代理流量，请在您的代理客户端添加以下规则 : DOMAIN,i.pixiv.re,DIRECT。
            </Text>
          }
        >
          <Picker
            title="图片源"
            value={settings.imageSourceMode || "official"}
            onChanged={(value: string) =>
              update({ imageSourceMode: value as "official" | "pixiv_re" | "custom" })
            }
          >
            <Text tag="official">官方</Text>
            <Text tag="pixiv_re">Pixiv.re 镜像</Text>
            <Text tag="custom">自定义</Text>
          </Picker>
          {settings.imageSourceMode === "custom" ? (
            <TextField
              title="自定义图片源"
              prompt="https://i.pximg.net"
              value={settings.customImageBaseUrl || ""}
              onChanged={(v) => update({ customImageBaseUrl: v.trim() })}
            />
          ) : null}
        </Section>

        <Section
          header={<Text>API 网关</Text>}
          footer={
            <Text>
              供自定义反代节点使用。留空自动静默回退官方地址。若因配置错误导致无法登录，可随时点击右上角“重置”一键恢复。
            </Text>
          }
        >
          <Picker
            title="API 网关"
            value={settings.apiGatewayMode || "official"}
            onChanged={(value: string) =>
              update({ apiGatewayMode: value as "official" | "custom" })
            }
          >
            <Text tag="official">官方</Text>
            <Text tag="custom">自定义</Text>
          </Picker>
          {settings.apiGatewayMode === "custom" ? (
            <>
              <TextField
                title="API 网关"
                prompt="https://app-api.pixiv.net"
                value={settings.customApiBaseUrl || ""}
                onChanged={(v) => update({ customApiBaseUrl: v.trim() })}
              />
              <TextField
                title="OAuth 认证网关"
                prompt="https://oauth.secure.pixiv.net"
                value={settings.customOauthBaseUrl || ""}
                onChanged={(v) => update({ customOauthBaseUrl: v.trim() })}
              />
              <TextField
                title="账号服务网关"
                prompt="https://accounts.pixiv.net"
                value={settings.customAccountBaseUrl || ""}
                onChanged={(v) => update({ customAccountBaseUrl: v.trim() })}
              />
              <TextField
                title="网页服务网关"
                prompt="https://www.pixiv.net"
                value={settings.customWebBaseUrl || ""}
                onChanged={(v) => update({ customWebBaseUrl: v.trim() })}
              />
            </>
          ) : null}
        </Section>
      </List>
    </NavigationStack>
  )
}
