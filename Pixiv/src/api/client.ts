import { fetch } from "scripting"
import {
  API_BASE_URL,
  OAUTH_BASE_URL,
  ACCEPT_LANGUAGE,
  APP_OS,
  APP_OS_VERSION,
  APP_VERSION,
  CLIENT_ID,
  CLIENT_SECRET,
  HASH_SALT,
  IMAGE_REFERER,
  IMAGE_USER_AGENT,
  REQUEST_INTERVAL_MS,
  REQUEST_TIMEOUT_SECONDS,
  USER_AGENT,
} from "../config"

export class PixivError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// 请求限速：所有常规 API 请求进入同一队列，保证实际发起间隔至少为 REQUEST_INTERVAL_MS。
let lastRequestAt = 0
let paceQueue: Promise<void> = Promise.resolve()

function pace(): Promise<void> {
  const task = paceQueue.then(async () => {
    const wait = Math.max(0, lastRequestAt + REQUEST_INTERVAL_MS - Date.now())
    if (wait > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, wait)
      })
    }
    lastRequestAt = Date.now()
  })
  // 即使未来调度逻辑抛错，也不能让后续请求永久停在已拒绝的队列上。
  paceQueue = task.catch(() => {})
  return task
}

export function clientTime(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00")
}

export function clientHash(time: string): string {
  const data = Data.fromString(time + HASH_SALT)!
  return Crypto.md5(data).toHexString()
}

export function standardHeaders(
  accessToken?: string | null
): Record<string, string> {
  const time = clientTime()
  const headers: Record<string, string> = {
    "X-Client-Time": time,
    "X-Client-Hash": clientHash(time),
    "User-Agent": USER_AGENT,
    "Accept-Language": ACCEPT_LANGUAGE,
    "App-OS": APP_OS,
    "App-OS-Version": APP_OS_VERSION,
    "App-Version": APP_VERSION,
  }
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`
  }
  return headers
}

export function imageHeaders(): Record<string, string> {
  return {
    Referer: IMAGE_REFERER,
    "User-Agent": IMAGE_USER_AGENT,
    Accept: "image/avif,image/webp,image/jpeg,image/png,*/*",
  }
}

function formBody(values: Record<string, string>): string {
  return Object.entries(values)
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    )
    .join("&")
}

async function parseError(data: Data | null): Promise<string> {
  if (!data) return ""
  try {
    const json = JSON.parse(data.toRawString() ?? "")
    const err = json?.error
    if (err?.user_message) return err.user_message
    if (err?.message) return err.message
    if (typeof json?.message === "string") return json.message
  } catch {
    try {
      const text = data.toRawString()?.slice(0, 200) ?? ""
      return text || ""
    } catch {
      // ignore
    }
  }
  return ""
}

export interface RequestOptions {
  headers?: Record<string, string>
  body?: string
  timeout?: number
  skipPace?: boolean
  allowedOrigin?: string
}

function assertAllowedURL(url: string, allowedOrigin: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new PixivError(0, "无效的请求地址")
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== allowedOrigin ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new PixivError(0, "已阻止非预期来源的请求")
  }
}

async function rawRequest(
  url: string,
  method: string,
  opts: RequestOptions = {}
): Promise<{ status: number; data: Data | null }> {
  if (!opts.skipPace) {
    await pace()
  }
  const headers: Record<string, string> = {
    ...opts.headers,
  }
  if (opts.allowedOrigin) {
    assertAllowedURL(url, opts.allowedOrigin)
  }
  const init: any = {
    method,
    headers,
    timeout: opts.timeout ?? REQUEST_TIMEOUT_SECONDS,
    handleRedirect: opts.allowedOrigin
      ? async (request: { url: string }) => {
          try {
            assertAllowedURL(request.url, opts.allowedOrigin!)
            return request
          } catch {
            return null
          }
        }
      : undefined,
  }
  if (opts.body !== undefined) {
    init.body = opts.body
  }
  let response: any
  try {
    response = await fetch(url, init)
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new PixivError(0, "请求超时，请检查网络后重试")
    }
    throw new PixivError(0, `网络错误：${err?.message ?? "未知错误"}`)
  }
  let data: Data | null = null
  try {
    data = await response.data()
  } catch {
    data = null
  }
  return { status: response.status, data }
}

export async function apiGet<T = any>(
  path: string,
  query: Record<string, string>,
  accessToken: string | null
): Promise<T> {
  const params = new URLSearchParams(query).toString()
  const url = `${API_BASE_URL}${path}${params ? `?${params}` : ""}`
  const { status, data } = await rawRequest(url, "GET", {
    headers: standardHeaders(accessToken),
    allowedOrigin: new URL(API_BASE_URL).origin,
  })
  if (status >= 200 && status < 300) {
    if (!data) throw new PixivError(status, "空响应")
    return JSON.parse(data.toRawString() ?? "") as T
  }
  const message = await parseError(data)
  throw new PixivError(status, message || `请求失败（${status}）`)
}

export async function apiPost<T = any>(
  path: string,
  form: Record<string, string>,
  accessToken: string | null
): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  const { status, data } = await rawRequest(url, "POST", {
    headers: {
      ...standardHeaders(accessToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody(form),
    allowedOrigin: new URL(API_BASE_URL).origin,
  })
  if (status >= 200 && status < 300) {
    if (!data) return null as T
    const text = data.toRawString() ?? ""
    if (!text.trim()) return null as T
    try {
      return JSON.parse(text) as T
    } catch {
      // Pixiv 的收藏写入接口可能返回空文本或非 JSON 成功体；
      // HTTP 2xx 已表示服务端接受，不能把响应解析失败误报为保存失败。
      return null as T
    }
  }
  const message = await parseError(data)
  throw new PixivError(status, message || `请求失败（${status}）`)
}

export async function apiGetAbsolute<T = any>(
  url: string,
  accessToken: string | null,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const apiOrigin = new URL(API_BASE_URL).origin
  const { status, data } = await rawRequest(url, "GET", {
    headers: { ...standardHeaders(accessToken), ...(extraHeaders ?? {}) },
    allowedOrigin: apiOrigin,
  })
  if (status >= 200 && status < 300) {
    if (!data) throw new PixivError(status, "空响应")
    return JSON.parse(data.toRawString() ?? "") as T
  }
  const message = await parseError(data)
  throw new PixivError(status, message || `请求失败（${status}）`)
}

// OAuth token 端点
export async function oauthTokenRequest<T = any>(
  values: Record<string, string>
): Promise<T> {
  const url = `${OAUTH_BASE_URL}/auth/token`
  const { status, data } = await rawRequest(url, "POST", {
    headers: {
      ...standardHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...values }),
    allowedOrigin: new URL(OAUTH_BASE_URL).origin,
  })
  if (status >= 200 && status < 300) {
    if (!data) throw new PixivError(status, "空响应")
    const text = data.toRawString() ?? ""
    const json = JSON.parse(text)
    // 兼容两种包装：{response: {...}} 或直接 {...}
    return (json?.response ?? json) as T
  }
  const message = await parseError(data)
  throw new PixivError(status, message || `登录失败（${status}）`)
}

// 请求 App API 域内 HTML 文本（小说阅读器页面等），带认证头。
export async function apiGetText(
  url: string,
  accessToken: string | null,
  accept = "text/html",
  extraHeaders?: Record<string, string>
): Promise<string> {
  const { status, data } = await rawRequest(url, "GET", {
    headers: {
      ...standardHeaders(accessToken),
      Accept: accept,
      ...(extraHeaders ?? {}),
    },
    allowedOrigin: new URL(API_BASE_URL).origin,
  })
  if (status < 200 || status >= 300) {
    const message = await parseError(data)
    throw new PixivError(status, message || `请求失败（${status}）`)
  }
  return data?.toRawString() ?? ""
}

// 请求公开网页文本，不携带 Pixiv Authorization，并限制首跳及重定向 Origin。
export async function apiGetPublicText(
  url: string,
  allowedOrigin: string,
  accept = "text/html",
  extraHeaders?: Record<string, string>
): Promise<string> {
  const { status, data } = await rawRequest(url, "GET", {
    headers: {
      Accept: accept,
      ...(extraHeaders ?? {}),
    },
    allowedOrigin,
  })
  if (status < 200 || status >= 300) {
    const message = await parseError(data)
    throw new PixivError(status, message || `请求失败（${status}）`)
  }
  return data?.toRawString() ?? ""
}

// 请求公开网页 JSON，不携带 Pixiv Authorization，并限制首跳及重定向 Origin。
export async function apiGetPublicJson<T = any>(
  url: string,
  allowedOrigin: string,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const { status, data } = await rawRequest(url, "GET", {
    headers: {
      Accept: "application/json",
      ...(extraHeaders ?? {}),
    },
    allowedOrigin,
  })
  if (status < 200 || status >= 300) {
    const message = await parseError(data)
    throw new PixivError(status, message || `请求失败（${status}）`)
  }
  if (!data) throw new PixivError(status, "空响应")
  return JSON.parse(data.toRawString() ?? "")
}

// 下载二进制（图片等），带 Referer；跳过 API 限速（图片 CDN 并发下载）
export async function downloadBinary(
  url: string,
  extraHeaders?: Record<string, string>
): Promise<Data | null> {
  const { status, data } = await rawRequest(url, "GET", {
    headers: { ...imageHeaders(), ...(extraHeaders ?? {}) },
    timeout: 60,
    skipPace: true,
  })
  if (status >= 200 && status < 300) {
    return data
  }
  console.log("image download failed:", url.slice(0, 90), "status:", status)
  return null
}
