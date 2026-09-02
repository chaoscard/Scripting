// Pixiv API 数据模型（对齐 app-api.pixiv.net 返回结构）

export interface PixivImageUrls {
  square_medium?: string
  medium?: string
  large?: string
  original?: string
}

export interface PixivTag {
  name: string
  translated_name?: string | null
}

export interface PixivUser {
  id: number
  name: string
  account: string
  profile_image_urls?: { medium?: string }
  comment?: string
  is_followed?: boolean
  is_mypixiv?: boolean
}

export interface PixivSeries {
  id: number
  title?: string | null
}

export interface PixivWatchlistSeries {
  id: number
  title: string
  url?: string | null
  mask_text?: string | null
  published_content_count: number
  last_published_content_datetime?: string | null
  latest_content_id?: number | null
  user?: PixivUser | null
}

export interface PixivMetaPage {
  image_urls: PixivImageUrls
}

export interface PixivMetaSinglePage {
  original_image_url?: string
}

export interface PixivIllustration {
  id: number
  title: string
  type: "illust" | "manga" | "ugoira"
  image_urls: PixivImageUrls
  caption: string
  user: PixivUser
  tags: PixivTag[]
  create_date: string
  page_count: number
  width: number
  height: number
  x_restrict: number
  series?: PixivSeries | null
  episode_number?: number
  meta_single_page?: PixivMetaSinglePage
  meta_pages: PixivMetaPage[]
  total_view: number
  total_bookmarks: number
  is_bookmarked: boolean
  is_muted: boolean
  illust_ai_type: number
  total_comments: number
  comment_access_control: number
}

export interface PixivisionTag {
  id?: number
  name: string
}

export interface PixivisionArticle {
  id: number
  title: string
  imageURL: string
  date: string
  category: string
  tags?: PixivisionTag[]
}

export interface PixivisionRelatedSection {
  title: string
  articles: PixivisionArticle[]
  tagId?: number
  tagName?: string
  moreRoute?: string
  isCategoryLatest?: boolean
  categorySlug?: string
}

export interface PixivisionArtwork {
  id: number
  title: string
  imageURL: string
  thumbURL?: string
  authorName?: string
  authorID?: number
  width?: number
  height?: number
  comment?: string
}

export interface PixivisionDetail {
  id: number
  title: string
  date: string
  category: string
  categorySlug?: string
  lead?: string
  description: string
  tags: PixivisionTag[]
  artworks: PixivisionArtwork[]
  embeddedArticles: PixivisionArticle[]
  relatedSections?: PixivisionRelatedSection[]
}

export interface PixivPage<T> {
  items: T[]
  nextURL: string | null
}

export interface PixivUserDetail {
  user: PixivUser
  profile: {
    webpage?: string
    gender?: string
    birth?: string
    region?: string
    job?: string
    total_follow_users: number
    total_mypixiv_users: number
    total_illusts: number
    total_manga: number
    total_novels: number
    total_illust_bookmarks_public: number
    total_illust_series: number
    background_image_url?: string
    twitter_account?: string
    twitter_url?: string
    is_premium: boolean
  }
  workspace?: {
    pc?: string
    monitor?: string
    tool?: string
    tablet?: string
    music?: string
    desk?: string
    chair?: string
    comment?: string
  } | null
}

export interface PixivWebSocialItem {
  url: string
}

export interface PixivWebNamedField {
  name: string | null
  privacyLevel?: string | null
  region?: string | null
  prefecture?: string | null
}

export interface PixivWebWorkspace {
  userWorkspacePc?: string | null
  userWorkspaceMonitor?: string | null
  userWorkspaceTool?: string | null
  userWorkspaceTablet?: string | null
  userWorkspaceMouse?: string | null
  userWorkspaceScanner?: string | null
  userWorkspacePrinter?: string | null
  userWorkspaceDesktop?: string | null
  userWorkspaceMusic?: string | null
  userWorkspaceDesk?: string | null
  userWorkspaceChair?: string | null
  userWorkspaceComment?: string | null
  [key: string]: string | null | undefined
}

export interface PixivWebUserTag {
  tag: string
  tag_translation?: string
  tag_yomigana?: string
  cnt: number
}

export interface PixivWebUserDetail {
  userId: string
  name: string
  image?: string
  imageBig?: string
  comment?: string
  commentHtml?: string
  webpage?: string | null
  social?: Record<string, PixivWebSocialItem> | PixivWebSocialItem[] | null
  region?: PixivWebNamedField | null
  age?: PixivWebNamedField | null
  birthDay?: PixivWebNamedField | null
  gender?: PixivWebNamedField | null
  job?: PixivWebNamedField | null
  workspace?: PixivWebWorkspace | null
}

export interface PixivUserPreview {
  user: PixivUser
  illusts: PixivIllustration[]
  novels?: PixivNovel[]
  is_muted: boolean
}

export interface PixivTrendingTag {
  tag: string
  translated_name?: string | null
  illust?: { id: number; title?: string; image_urls: PixivImageUrls } | PixivIllustration
  novel?: { id: number; title?: string; image_urls: PixivImageUrls } | PixivNovel
}

export interface PixivStamp {
  stamp_id: number
  stamp_url: string
}

export interface PixivComment {
  id: number
  comment: string
  date: string
  user: PixivUser
  parent_comment?: {
    id: number
    user: PixivUser
    comment?: string
    stamp?: PixivStamp | null
  } | null
  parent_comment_id?: number
  has_replies?: boolean
  reply_count?: number
  stamp?: PixivStamp | null
}

export interface PixivBookmarkDetailTag {
  name: string
  is_registered: boolean
}

export interface PixivBookmarkDetail {
  is_bookmarked: boolean
  tags?: PixivBookmarkDetailTag[]
  restrict?: "public" | "private"
}

export interface PixivBookmarkTag {
  name: string
  count: number
  tags?: string[]
}

export interface PixivFollowDetail {
  is_followed: boolean
}

export interface UgoiraFrame {
  file: string
  delay: number
}

export interface UgoiraMetadata {
  zip_urls: { medium?: string }
  frames: UgoiraFrame[]
}

export interface UgoiraMetadataResponse {
  // 注意：Pixiv 返回的顶层字段是 ugoira_metadata（不是 metadata）
  ugoira_metadata: UgoiraMetadata
}

export interface PixivIllustrationSeriesItem {
  id: number
  title: string
  illust_type: string
  create_date: string
  page_count: number
  width: number
  height: number
  image_urls?: PixivImageUrls
  user?: PixivUser | null
  x_restrict?: number
  tags?: PixivTag[]
  total_view?: number
  total_bookmarks?: number
  is_bookmarked?: boolean
  is_muted?: boolean
  illust_ai_type?: number
  total_comments?: number
  comment_access_control?: number
  meta_single_page?: PixivMetaSinglePage
  meta_pages?: PixivMetaPage[]
  caption?: string
}

export interface PixivIllustrationSeriesDetail {
  id: number
  title: string
  caption?: string
  series_work_count?: number
  is_concluded?: boolean
  is_original?: boolean
  is_watched?: boolean
  watchlist_added?: boolean
  url?: string | null
  cover_image_urls?: PixivImageUrls
  user?: PixivUser | null
}

export interface PixivIllustrationSeriesResponse {
  illust_series_detail: PixivIllustrationSeriesDetail
  illust_series_first_illust?: PixivIllustrationSeriesItem | null
  illusts: PixivIllustrationSeriesItem[]
  next_url?: string | null
}

export interface PixivNovelSeriesDetail {
  id: number
  title: string
  caption?: string
  content_count?: number
  is_concluded?: boolean
  is_original?: boolean
  is_watched?: boolean
  watchlist_added?: boolean
  url?: string | null
  cover_image_urls?: PixivImageUrls
  user?: PixivUser | null
}

export interface PixivNovelSeriesResponse {
  novel_series_detail: PixivNovelSeriesDetail
  novel_series_first_novel?: PixivNovel | null
  novel_series_latest_novel?: PixivNovel | null
  novels: PixivNovel[]
  next_url?: string | null
}
export interface PixivNovel {
  id: number
  title: string
  caption?: string
  user: PixivUser
  tags: PixivTag[]
  create_date: string
  page_count: number
  x_restrict: number
  total_view: number
  total_bookmarks: number
  is_bookmarked: boolean
  is_muted: boolean
  novel_ai_type?: number
  total_comments: number
  text_length?: number
  visible: boolean
  series?: PixivSeries | null
  episode_number?: number
  novel_marker?: {
    page: number
  } | null
  image_urls?: {
    square_medium?: string
    medium?: string
    large?: string
  } | null
  cover?: {
    urls?: { "240mw"?: string; "480mw"?: string; "1200x1200"?: string }
  } | null
}


export interface PixivNovelMarker {
  id: number
  novel: PixivNovel
  novel_marker: {
    page: number
  }
}

export interface TextEmbeddedImage {
  novelImageId?: string
  sl?: string
  urls: {
    "128x128"?: string
    "240mw"?: string
    "480mw"?: string
    "1200x1200"?: string
    original?: string
  }
}

export interface PixivNovelDetail {
  id: number
  title: string
  user: PixivUser
  tags: PixivTag[]
  caption?: string
  text_length?: number
  create_date: string
  page_count: number
  x_restrict: number
  total_view: number
  total_bookmarks: number
  is_bookmarked: boolean
  total_comments: number
  cover?: { urls?: { "240mw"?: string; "480mw"?: string; "1200x1200"?: string } }
  image_urls?: PixivImageUrls | null
  textEmbeddedImages?: Record<string, TextEmbeddedImage>
  content: string
  episode_number?: number
  novel_marker?: {
    page: number
  } | null
  series?: {
    id: number
    title?: string
  } | null
  series_next?: {
    id: number
    title?: string
    url?: string
  } | null
  series_prev?: {
    id: number
    title?: string
    url?: string
  } | null
}

export interface AuthUser {
  id: string
  name: string
  account: string
  mail_address?: string
  is_premium: boolean
  profile_image_urls?: {
    px_16x16?: string
    px_50x50?: string
    px_170x170?: string
  }
}

export interface AuthTokenResponse {
  access_token: string
  expires_in: number
  refresh_token: string
  user: AuthUser
}

// ---------- API 响应结构类型 ----------

export interface PixivIllustListResponse {
  illusts: PixivIllustration[]
  next_url?: string | null
}

export interface PixivNovelListResponse {
  novels: PixivNovel[]
  next_url?: string | null
}

export interface PixivWatchlistResponse {
  series: PixivWatchlistSeries[]
  next_url?: string | null
}

export interface PixivUserPreviewListResponse {
  user_previews: PixivUserPreview[]
  next_url?: string | null
}

export interface PixivBookmarkTagListResponse {
  bookmark_tags: PixivBookmarkTag[]
  next_url?: string | null
}

export interface PixivTrendingTagsResponse {
  trend_tags: PixivTrendingTag[]
}

export interface PixivCommentsResponse {
  comments: PixivComment[]
  next_url?: string | null
}

export interface PixivIllustDetailResponse {
  illust: PixivIllustration
}

export interface PixivNovelDetailResponse {
  novel: PixivNovelDetail
}

export interface PixivBookmarkDetailRawTag {
  name?: string
  is_registered?: boolean
}

export interface PixivBookmarkDetailResponse {
  bookmark_detail: {
    is_bookmarked: boolean
    tags?: Array<PixivBookmarkDetailRawTag | string>
    restrict?: "public" | "private" | string
  }
}

export interface PixivFollowDetailResponse {
  follow_detail: PixivFollowDetail
}

export interface PixivNovelMarkerItem {
  novel: PixivNovel
  novel_marker: {
    page: number
  }
}

export interface PixivNovelMarkersResponse {
  marked_novels: PixivNovelMarkerItem[]
  next_url?: string | null
}

export interface PixivAutocompleteTag {
  name: string
  translated_name?: string | null
}

export interface PixivAutocompleteResponse {
  tags?: PixivAutocompleteTag[]
  search_auto_complete_keywords?: string[]
}

export interface PixivNotificationContent {
  text: string
  left_icon: string | null
  left_image: string | null
  right_icon: string | null
  right_image: string | null
}

export interface PixivNotificationViewMore {
  unread_exists: boolean
  title: string
}

export interface PixivNotification {
  id: number
  created_datetime: string
  type: number
  content: PixivNotificationContent
  view_more: PixivNotificationViewMore | null
  target_url: string
  is_read: boolean
}

export interface PixivNotificationListResponse {
  notifications: PixivNotification[]
  next_url?: string | null
}

// ---------- 高级搜索相关类型 ----------

export type SearchScope = "illust" | "novel" | "user"

export type SearchCategory =
  | "all_illust"
  | "illust"
  | "manga"
  | "ugoira"
  | "novel"

export type SearchTargetIllust =
  | "partial_match_for_tags"
  | "exact_match_for_tags"
  | "title_and_caption"

export type SearchTargetNovel =
  | "partial_match_for_tags"
  | "exact_match_for_tags"
  | "text"
  | "keyword"

export type SearchSort =
  | "date_desc"
  | "popular_desc"
  | "date_asc"
  | "popular_male_desc"
  | "popular_female_desc"

export type SearchMediaFilter = "all" | "illust" | "manga" | "ugoira"

export type BookmarkThreshold =
  | 0
  | 300
  | 500
  | 1000
  | 5000
  | 10000
  | 20000
  | 30000
  | 50000

export interface SearchOptions {
  target: string
  sort: string
  aiFilter?: number
  word: string
  startDate?: string
  endDate?: string
  bookmarkThreshold?: number
}

export interface AdvancedSearchParams {
  word: string
  category: SearchCategory
  scope: SearchScope
  target: string
  sort: SearchSort
  mediaFilter: SearchMediaFilter
  bookmarkThreshold: BookmarkThreshold
  useDateRange: boolean
  startDate: string // "YYYY-MM-DD"
  endDate: string // "YYYY-MM-DD"
  startTimestamp: number
  endTimestamp: number
}

export interface PixivTagInfoResponse {
  error: boolean
  message: string
  body: {
    tag?: string
    abstract?: string
    thumbnail?: string | null
    ja?: {
      tag?: string
      abstract?: string
      url?: string
    } | null
    en?: {
      tag?: string
      abstract?: string
      url?: string
    } | null
    is_view_lead_wire?: boolean
  }
}

export interface PixivTagDetail {
  tag: string
  abstract?: string
  thumbnailUrl?: string | null
  dicUrl?: string | null
  hasEncyclopedia: boolean
}

