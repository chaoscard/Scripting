import { API_BASE_URL, OAUTH_REDIRECT_URI } from "../config"
import type { AuthTokenResponse, AuthUser } from "../types"
import { oauthTokenRequest } from "./client"

export interface StoredCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  user: AuthUser
}

const CREDENTIALS_KEY = "pixiv_credentials_v1"

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
  return `${API_BASE_URL}/web/v1/login?${params.toString()}`
}

// 从回调 URL 提取授权码
export function extractAuthCode(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!parsed.pathname.includes("/users/auth/pixiv/callback")) {
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
  return (await oauthTokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: OAUTH_REDIRECT_URI,
    include_policy: "true",
  })) as AuthTokenResponse
}

// 用 refresh_token 刷新（token 会轮换）
export async function refreshToken(
  refreshToken: string
): Promise<AuthTokenResponse> {
  return (await oauthTokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    include_policy: "true",
  })) as AuthTokenResponse
}

// 凭证持久化（Keychain）
export function saveCredentials(creds: StoredCredentials): void {
  Keychain.set(CREDENTIALS_KEY, JSON.stringify(creds))
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
    typeof account.id === "string" &&
    account.id.length > 0 &&
    typeof account.name === "string" &&
    typeof account.account === "string" &&
    typeof account.is_premium === "boolean"
  )
}

export function loadCredentials(): StoredCredentials | null {
  const raw = Keychain.get(CREDENTIALS_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isStoredCredentials(parsed)) return parsed
  } catch {
    // 损坏凭证与不完整凭证均不能进入已登录状态。
  }
  clearCredentials()
  return null
}

export function clearCredentials(): void {
  Keychain.remove(CREDENTIALS_KEY)
}

export function needsRefresh(creds: StoredCredentials): boolean {
  return creds.expiresAt - Date.now() < 60_000
}

export function buildCredentialsFromResponse(
  response: AuthTokenResponse
): StoredCredentials {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
    user: response.user,
  }
}
