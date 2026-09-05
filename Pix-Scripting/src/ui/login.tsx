import {
  Button,
  Image,
  ProgressView,
  Rectangle,
  Text,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { REQUEST_TIMEOUT_SECONDS } from "../config"
import {
  buildAuthorizationURL,
  exchangeCode,
  extractAuthCode,
  generateCodeChallenge,
  generateCodeVerifier,
} from "../api/auth"
import { isPixivCookieDomain } from "../api/pixiv"
import { session } from "../api/session"
import { appToolbar } from "./components"
import { LoginNetworkSheet } from "./loginNetworkSheet"
import { DreamyFluidBackground } from "./components/DreamyBackground"

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
      const authUrl = buildAuthorizationURL(challenge)
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("连接登录端点超时"))
        }, REQUEST_TIMEOUT_SECONDS * 1000)
      })
      try {
        await Promise.race([webView.loadURL(authUrl), timeoutPromise])
      } finally {
        if (timer) clearTimeout(timer)
      }
      await webView.present({
        navigationTitle: "Pixiv 登录",
        fullscreen: false,
      })
    } catch (err: any) {
      const rawMsg = String(err?.message ?? "")
      if (
        rawMsg.includes("超时") ||
        rawMsg.includes("timeout") ||
        rawMsg.includes("timed out")
      ) {
        authError = "连接登录服务超时\n若处于受限网络环境，请点击右上角网络图标配置网络连接"
      } else {
        authError = `无法打开登录页面：${rawMsg || "未知错误"}\n若处于受限网络环境，请点击右上角网络图标配置网络连接`
      }
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
        const rawMsg = String(err?.message ?? "")
        if (
          rawMsg.includes("超时") ||
          rawMsg.includes("timeout") ||
          rawMsg.includes("timed out")
        ) {
          authError = "连接登录服务超时\n若处于受限网络环境，请点击右上角网络图标配置网络连接"
        } else {
          authError = `登录验证失败：${rawMsg || "未知错误"}\n若处于受限网络环境，请点击右上角网络图标配置网络连接`
        }
      }
    } else if (!authError) {
      authError = "登录已取消"
    }

    setIsLoading(false)
    setError(authError)
  }

  return (
    <ZStack
      alignment="center"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
      toolbarBackground="clear"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
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
      {/* 梦幻流体光晕背景 (纯代码渲染，零侵权风险) */}
      <DreamyFluidBackground />

      {isLoading ? (
        <VStack
          alignment="center"
          spacing={24}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}
          padding={32}
        >
          <Text
            font={38}
            fontWeight="heavy"
            foregroundStyle="white"
            shadow={{ color: "rgba(0, 0, 0, 0.32)", radius: 10, y: 3 }}
          >
            Pix-Scripting
          </Text>
          <VStack spacing={14} alignment="center" padding={{ top: 12 }}>
            <ProgressView progressViewStyle="circular" />
            <Text
              font="subheadline"
              foregroundStyle="rgba(255, 255, 255, 0.9)"
              shadow={{ color: "rgba(0, 0, 0, 0.3)", radius: 6, y: 1 }}
            >
              正在连接 Pixiv 登录服务...
            </Text>
          </VStack>
        </VStack>
      ) : (
        <VStack
          alignment="center"
          spacing={24}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}
          padding={32}
        >
          <Text
            font={38}
            fontWeight="heavy"
            foregroundStyle="white"
            shadow={{ color: "rgba(0, 0, 0, 0.32)", radius: 10, y: 3 }}
          >
            Pix-Scripting
          </Text>
          <Button
            title="使用 Pixiv 账号登录"
            buttonStyle="glassProminent"
            tint="#0096FA"
            controlSize="large"
            action={startLogin}
          />

          {error ? (
            <VStack spacing={8} alignment="center" padding={{ top: 8 }}>
              <Text
                font="footnote"
                foregroundStyle={
                  error === "登录已取消"
                    ? "rgba(255, 255, 255, 0.75)"
                    : "#FF6B6B"
                }
                multilineTextAlignment="center"
              >
                {error}
              </Text>
            </VStack>
          ) : null}
        </VStack>
      )}
    </ZStack>
  )
}
