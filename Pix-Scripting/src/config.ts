import { Script } from "scripting"

export const SCRIPT_VERSION = Script.metadata?.version ?? "1.8.10"

// 默认服务端点地址
export const DEFAULT_API_BASE_URL = "https://app-api.pixiv.net"
export const DEFAULT_OAUTH_BASE_URL = "https://oauth.secure.pixiv.net"
export const DEFAULT_ACCOUNT_BASE_URL = "https://accounts.pixiv.net"
export const DEFAULT_IMAGE_BASE_URL = "https://i.pximg.net"
export const DEFAULT_STATIC_IMAGE_BASE_URL = "https://s.pximg.net"
export const DEFAULT_WEB_BASE_URL = "https://www.pixiv.net"
export const PIXIV_RE_IMAGE_BASE_URL = "https://i.pixiv.re"

// OAuth 客户端认证凭据与重定向地址
export const OAUTH_REDIRECT_URI =
  "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"
export const CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT"
export const CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj"
export const HASH_SALT = "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c"

// 客户端指纹：严格对齐主流第三方 PixEz 标准规范（API 走 Android 凭据闭环，图片 CDN 走 iOS 专用流）
export const USER_AGENT = "PixivAndroidApp/5.0.155 (Android 10.0; Pixel C)"
export const APP_OS = "Android"
export const APP_OS_VERSION = "Android 10.0"
export const APP_VERSION = "5.0.166"
export const ACCEPT_LANGUAGE = "zh-CN,zh-Hans;q=0.9"
export const APP_ACCEPT_LANGUAGE = "zh-hans"

// 图片 CDN（i.pximg.net）防盗链与放行指纹：对齐 PixEz hoster/fetcher 规范
export const IMAGE_REFERER = "https://app-api.pixiv.net/"
export const IMAGE_USER_AGENT = "PixivIOSApp/5.8.0"

// 请求限速（毫秒），避免触发风控
export const REQUEST_INTERVAL_MS = 400
export const REQUEST_TIMEOUT_SECONDS = 10
