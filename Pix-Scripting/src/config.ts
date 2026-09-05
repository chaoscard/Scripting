import { Script } from "scripting"

export const SCRIPT_VERSION = Script.metadata?.version ?? "0.8.188"

// 默认服务端点地址
export const DEFAULT_API_BASE_URL = "https://app-api.pixiv.net"
export const DEFAULT_OAUTH_BASE_URL = "https://oauth.secure.pixiv.net"
export const DEFAULT_ACCOUNT_BASE_URL = "https://accounts.pixiv.net"
export const DEFAULT_IMAGE_BASE_URL = "https://i.pximg.net"
export const DEFAULT_STATIC_IMAGE_BASE_URL = "https://s.pximg.net"
export const DEFAULT_WEB_BASE_URL = "https://www.pixiv.net"
export const PIXIV_RE_IMAGE_BASE_URL = "https://i.pixiv.re"

// 向后兼容现有引用
export const API_BASE_URL = DEFAULT_API_BASE_URL
export const OAUTH_BASE_URL = DEFAULT_OAUTH_BASE_URL
export const WEB_BASE_URL = DEFAULT_WEB_BASE_URL
export const OAUTH_REDIRECT_URI =
  "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"

export const CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT"
export const CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj"
export const HASH_SALT = "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c"

export const USER_AGENT = "PixivIOSApp/8.8.1 (iOS 26.6.1; iPhone18,1)"
export const APP_OS = "ios"
export const APP_OS_VERSION = "26.6.1"
export const APP_VERSION = "8.8.1"
export const ACCEPT_LANGUAGE = "zh-CN,zh-Hans;q=0.9"
export const APP_ACCEPT_LANGUAGE = "zh-hans"

// 图片域名需要 Referer
export const IMAGE_REFERER = "https://www.pixiv.net/"
export const IMAGE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"

// 请求限速（毫秒），避免触发风控
export const REQUEST_INTERVAL_MS = 400
export const REQUEST_TIMEOUT_SECONDS = 10
