import {
  Button,
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
import { session } from "../api/session"
import { appToolbar } from "./components"

export function LoginView(props: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    const webView = new WebViewController()
    let authCode: string | null = null
    let authError: string | null = null

    webView.shouldAllowRequest = async (request) => {
      const code = extractAuthCode(request.url)
      if (code) {
        authCode = code
        webView.dismiss()
        return false
      }
      return true
    }

    try {
      await webView.loadURL(buildAuthorizationURL(challenge))
      await webView.present({
        navigationTitle: "Pixiv 登录",
        fullscreen: true,
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
        session.applyResponse(response)
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
      toolbar={appToolbar(props.onClose)}
    >
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
            title={isLoading ? "正在登录…" : "使用 Pixiv 账号登录"}
            buttonStyle="glassProminent"
            tint="#0096FA"
            controlSize="large"
            disabled={isLoading}
            action={startLogin}
          />
        </VStack>

        {error ? (
          <Text
            font="footnote"
            foregroundStyle="systemRed"
            multilineTextAlignment="center"
            padding={{ top: 8 }}
          >
            {error}
          </Text>
        ) : null}
      </VStack>
    </ZStack>
  )
}
