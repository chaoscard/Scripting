import {
  Button,
  HStack,
  Image,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import {
  buildAuthorizationURL,
  exchangeCode,
  extractAuthCode,
  generateCodeChallenge,
  generateCodeVerifier,
} from "../api/auth"
import { isPixivCookieDomain } from "../api/pixiv"
import { session } from "../api/session"
import { appToolbar, LoadingView } from "./components"
import { LoginNetworkSheet } from "./loginNetworkSheet"

export function LoginView(props: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNetworkSheet, setShowNetworkSheet] = useState(false)
  // 组件卸载（用户关闭页面）后不再 setState
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function startLogin() {
    if (isLoading) return
    setIsLoading(true)
    setError(null)
    const verifier = generateCodeVerifier()
    const challenge = generateCodeChallenge(verifier)
    const webView = new WebViewController({ ephemeral: true })
    let authCode: string | null = null
    let authWebCookie: string | null = null
    let authError: string | null = null

    webView.shouldAllowRequest = async (request) => {
      const code = extractAuthCode(request.url)
      if (code) {
        authCode = code
        try {
          const allCookies = await webView.getAllCookies()
          const pixivCookies = allCookies.filter((c) => isPixivCookieDomain(c.domain))
          const rawTargetCookies =
            pixivCookies.length > 0
              ? pixivCookies
              : await webView.getCookies("https://www.pixiv.net")
          const targetCookies = rawTargetCookies.filter((c) => isPixivCookieDomain(c.domain))
          if (targetCookies && targetCookies.length > 0) {
            const cookieMap = new Map<string, string>()
            for (const c of targetCookies) {
              if (c.name && c.value) {
                cookieMap.set(c.name, c.value)
              }
            }
            authWebCookie = Array.from(cookieMap.entries())
              .map(([name, val]) => `${name}=${val}`)
              .join("; ")
          }
        } catch (e) {
          console.log("extract web cookies error:", e)
        }
        webView.dismiss()
        return false
      }
      return true
    }

    try {
      await webView.loadURL(buildAuthorizationURL(challenge))
      await webView.present({
        navigationTitle: "Pixiv 登录",
        fullscreen: false,
      })
    } catch (err: any) {
      authError = `无法打开登录页面：${err?.message ?? "未知错误"}`
    } finally {
      webView.dispose()
    }

    if (!mountedRef.current) return

    if (authCode) {
      try {
        const response = await exchangeCode(authCode, verifier)
        session.applyResponse(response, authWebCookie)
        setIsLoading(false)
        props.onSuccess()
        return
      } catch (err: any) {
        authError = `登录失败：${err?.message ?? "未知错误"}`
      }
    } else if (!authError) {
      authError = "登录已取消"
    }

    setIsLoading(false)
    setError(authError)
  }

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      toolbar={appToolbar(
        props.onClose,
        undefined,
        <Button
          key="network-settings"
          title="网络设置"
          systemImage="network"
          action={() => setShowNetworkSheet(true)}
        />
      )}
      sheet={{
        isPresented: showNetworkSheet,
        onChanged: (val: boolean) => setShowNetworkSheet(val),
        content: (
          <LoginNetworkSheet onClose={() => setShowNetworkSheet(false)} />
        ),
      }}
    >
      {isLoading ? (
        <LoadingView />
      ) : (
        <VStack
          alignment="center"
          spacing={16}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={32}
          offset={{ x: 0, y: -104 }}
        >
          <Image
            systemName="paintpalette.fill"
            font="largeTitle"
            foregroundStyle="#0096FA"
            padding={{ top: 80, bottom: 12 }}
          />
          <VStack spacing={8} padding={{ top: 24 }}>
            <Button
              title="使用 Pixiv 账号登录"
              buttonStyle="glassProminent"
              tint="#0096FA"
              controlSize="large"
              action={startLogin}
            />
          </VStack>

          {error ? (
            <VStack spacing={8} alignment="center" padding={{ top: 8 }}>
              <Text
                font="footnote"
                foregroundStyle="systemRed"
                multilineTextAlignment="center"
              >
                {error}
              </Text>
              <Button
                buttonStyle="plain"
                action={() => setShowNetworkSheet(true)}
              >
                <HStack spacing={4} alignment="center">
                  <Image systemName="network" font="caption" foregroundStyle="#0096FA" />
                  <Text font="caption" foregroundStyle="#0096FA">
                    检查或重置网络网关
                  </Text>
                </HStack>
              </Button>
            </VStack>
          ) : null}
        </VStack>
      )}
    </ZStack>
  )
}
