import { OAUTH_REDIRECT_URI } from "../config"
import { getApiBaseUrl } from "../store/settings"
import type { AuthTokenResponse, AuthUser } from "../types"
import { oauthTokenRequest } from "./client"

export interface StoredCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  user: AuthUser
  webCookie?: string | null
}

export interface StoredAccountProfile {
  id: string
  name: string
  account: string
  avatarUrl?: string | null
  mailAddress?: string
  isPremium?: boolean
  refreshToken: string
  accessToken: string
  expiresAt: number
  webCookie?: string | null
  lastActiveAt: number
}

const CREDENTIALS_KEY = "pixiv_credentials_v1"
const MULTI_ACCOUNTS_KEY = "pixiv_multi_accounts_v1"

export function loadAllStoredAccounts(): StoredAccountProfile[] {
  try {
    const raw = Keychain.get(MULTI_ACCOUNTS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (a) => a && typeof a.id === "string" && a.id.length > 0 && typeof a.refreshToken === "string"
        )
      }
    }
  } catch (e: any) {
    console.log("Keychain loadAllStoredAccounts error:", e?.message ?? e)
  }
  return []
}

export function saveAllStoredAccounts(accounts: StoredAccountProfile[]): void {
  try {
    Keychain.set(MULTI_ACCOUNTS_KEY, JSON.stringify(accounts))
  } catch (e: any) {
    console.log("Keychain saveAllStoredAccounts error:", e?.message ?? e)
  }
}

export function upsertStoredAccount(creds: StoredCredentials): void {
  if (!creds || !creds.user || !creds.user.id) return
  const current = loadAllStoredAccounts()
  const uid = String(creds.user.id)
  const filtered = current.filter((a) => a.id !== uid)
  const profile: StoredAccountProfile = {
    id: uid,
    name: creds.user.name,
    account: creds.user.account,
    avatarUrl:
      creds.user.profile_image_urls?.px_170x170 ||
      creds.user.profile_image_urls?.px_50x50 ||
      null,
    mailAddress: creds.user.mail_address,
    isPremium: creds.user.is_premium,
    refreshToken: creds.refreshToken,
    accessToken: creds.accessToken,
    expiresAt: creds.expiresAt,
    webCookie: creds.webCookie ?? null,
    lastActiveAt: Date.now(),
  }
  saveAllStoredAccounts([profile, ...filtered])
}

export function removeStoredAccount(userId: string | number): void {
  const uid = String(userId)
  const current = loadAllStoredAccounts()
  const filtered = current.filter((a) => a.id !== uid)
  saveAllStoredAccounts(filtered)
}

function base64URLEncode(data: Data): string {
  return data
    .toBase64String()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

// 生成 PKCE code_verifier（43 字符，URL-safe）
export function generateCodeVerifier(): string {
  const random = Crypto.generateSymmetricKey(256)
  return base64URLEncode(random)
}

// 计算 code_challenge = base64url(sha256(verifier))
export function generateCodeChallenge(verifier: string): string {
  const digest = Crypto.sha256(Data.fromRawString(verifier)!)
  return base64URLEncode(digest)
}

// 构造 PKCE 授权 URL（内嵌 WebView 打开）
export function buildAuthorizationURL(challenge: string): string {
  const params = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: "S256",
    client: "pixiv-android",
  })
  return `${getApiBaseUrl()}/web/v1/login?${params.toString()}`
}

// 从回调 URL 提取授权码（严格比对协议、路径及域名）
export function extractAuthCode(url: string): string | null {
  try {
    const parsed = new URL(url)
    const expected = new URL(OAUTH_REDIRECT_URI)
    const currentApiHost = new URL(getApiBaseUrl()).host
    const isHostMatched =
      parsed.host === expected.host || parsed.host === currentApiHost

    if (
      parsed.protocol !== expected.protocol ||
      !isHostMatched ||
      parsed.pathname !== expected.pathname ||
      parsed.username ||
      parsed.password
    ) {
      return null
    }
    return parsed.searchParams.get("code")
  } catch {
    return null
  }
}

// 用授权码交换 token
export async function exchangeCode(
  code: string,
  verifier: string
): Promise<AuthTokenResponse> {
  return await oauthTokenRequest<AuthTokenResponse>({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: OAUTH_REDIRECT_URI,
    include_policy: "true",
  })
}

// 用 refresh_token 刷新（token 会轮换）
export async function refreshToken(
  refreshToken: string
): Promise<AuthTokenResponse> {
  return await oauthTokenRequest<AuthTokenResponse>({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    include_policy: "true",
  })
}

// 凭证持久化：严格收敛于 Keychain，不向普通 Storage 写入敏感凭据
export function saveCredentials(creds: StoredCredentials): void {
  const serialized = JSON.stringify(creds)
  try {
    Keychain.set(CREDENTIALS_KEY, serialized)
    upsertStoredAccount(creds)
  } catch (e: any) {
    console.log("Keychain save error:", e?.message ?? e)
  }
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  const user = candidate.user
  if (!user || typeof user !== "object") return false
  const account = user as Record<string, unknown>
  return (
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0 &&
    typeof candidate.refreshToken === "string" &&
    candidate.refreshToken.length > 0 &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    (typeof account.id === "string" || typeof account.id === "number") &&
    String(account.id).length > 0 &&
    typeof account.name === "string" &&
    typeof account.account === "string"
  )
}

export function loadCredentials(): StoredCredentials | null {
  let parsed: unknown = null
  try {
    const raw = Keychain.get(CREDENTIALS_KEY)
    if (raw) {
      parsed = JSON.parse(raw)
    }
  } catch (e: any) {
    console.log("Keychain read error:", e?.message ?? e)
  }

  if (isStoredCredentials(parsed)) {
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      webCookie: typeof parsed.webCookie === "string" ? parsed.webCookie : null,
      user: {
        id: String(parsed.user.id),
        name: parsed.user.name,
        account: parsed.user.account,
        mail_address: parsed.user.mail_address,
        is_premium: Boolean(parsed.user.is_premium),
        profile_image_urls: parsed.user.profile_image_urls,
      },
    }
  }
  return null
}

export function isPixivCookieDomain(domain?: string | null): boolean {
  if (!domain) return false
  const clean = domain.startsWith(".") ? domain.slice(1).toLowerCase() : domain.toLowerCase()
  return clean === "pixiv.net" || clean.endsWith(".pixiv.net")
}

export async function clearPixivWebCookies(): Promise<void> {
  try {
    const webView = new WebViewController()
    try {
      const allCookies = await webView.getAllCookies()
      for (const c of allCookies) {
        if (isPixivCookieDomain(c.domain)) {
          await webView.deleteCookie({
            name: c.name,
            domain: c.domain,
            path: c.path || "/",
          })
        }
      }
    } finally {
      webView.dispose()
    }
  } catch (e) {
    console.log("clearPixivWebCookies error:", e)
  }
}

export function clearCredentials(): void {
  try {
    Keychain.remove(CREDENTIALS_KEY)
  } catch {}
  // 异步清理 WebView 容器内的 Pixiv Web 会话与 Cookie，防止切号复用
  clearPixivWebCookies().catch(() => {})
}

export function needsRefresh(creds: StoredCredentials): boolean {
  // 提前 5 分钟刷新，避免临界点并发请求命中 401 争抢刷新
  return creds.expiresAt - Date.now() < 300_000
}

export function buildCredentialsFromResponse(
  response: AuthTokenResponse,
  webCookie?: string | null
): StoredCredentials {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000,
    webCookie: webCookie ?? null,
    user: {
      id: String(response.user.id),
      name: response.user.name,
      account: response.user.account,
      mail_address: response.user.mail_address,
      is_premium: Boolean(response.user.is_premium),
      profile_image_urls: response.user.profile_image_urls,
    },
  }
}
