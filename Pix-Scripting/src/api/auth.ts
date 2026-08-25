import { API_BASE_URL, OAUTH_REDIRECT_URI } from "../config"
import type { AuthTokenResponse, AuthUser } from "../types"
import { oauthTokenRequest } from "./client"

export interface StoredCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  user: AuthUser
  webCookie?: string | null
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

// 凭证持久化（Keychain + Storage 双重保障）
export function saveCredentials(creds: StoredCredentials): void {
  const serialized = JSON.stringify(creds)
  try {
    Keychain.set(CREDENTIALS_KEY, serialized)
  } catch (e: any) {
    console.log("Keychain save error:", e?.message ?? e)
  }
  try {
    Storage.set(CREDENTIALS_KEY, creds)
  } catch (e: any) {
    console.log("Storage save error:", e?.message ?? e)
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

  if (!parsed || !isStoredCredentials(parsed)) {
    try {
      const stored = Storage.get(CREDENTIALS_KEY)
      if (stored && isStoredCredentials(stored)) {
        parsed = stored
        try {
          Keychain.set(CREDENTIALS_KEY, JSON.stringify(stored))
        } catch {}
      }
    } catch {}
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

export function clearCredentials(): void {
  try {
    Keychain.remove(CREDENTIALS_KEY)
  } catch {}
  try {
    Storage.remove(CREDENTIALS_KEY)
  } catch {}
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
