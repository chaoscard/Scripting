import { Script } from "scripting"

export const SCRIPT_VERSION = Script.metadata?.version ?? "0.8.126"

export const API_BASE_URL = "https://app-api.pixiv.net"
export const OAUTH_BASE_URL = "https://oauth.secure.pixiv.net"
export const OAUTH_REDIRECT_URI =
  "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"

export const CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT"
export const CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj"
export const HASH_SALT = "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c"

export const USER_AGENT = "PixivAndroidApp/5.0.166 (Android 10.0; Pixel C)"
export const APP_OS = "Android"
export const APP_OS_VERSION = "Android 10.0"
export const APP_VERSION = "5.0.166"
export const ACCEPT_LANGUAGE = "zh-CN"

// 图片域名需要 Referer
export const IMAGE_REFERER = "https://www.pixiv.net/"
export const IMAGE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"

// 请求限速（毫秒），避免触发风控
export const REQUEST_INTERVAL_MS = 400
export const REQUEST_TIMEOUT_SECONDS = 30
