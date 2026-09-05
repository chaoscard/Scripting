import type {
  PixivAutocompleteResponse,
  PixivAutocompleteTag,
  PixivBookmarkDetail,
  PixivBookmarkDetailResponse,
  PixivBookmarkTag,
  PixivBookmarkTagListResponse,
  PixivComment,
  PixivCommentsResponse,
  PixivFollowDetail,
  PixivFollowDetailResponse,
  PixivIllustration,
  PixivIllustDetailResponse,
  PixivIllustListResponse,
  PixivIllustrationSeriesResponse,
  PixivNovel,
  PixivNovelDetail,
  PixivNovelDetailResponse,
  PixivNovelListResponse,
  PixivNovelMarker,
  PixivNovelMarkersResponse,
  PixivNovelSeriesResponse,
  PixivNotification,
  PixivNotificationListResponse,
  PixivisionArticle,
  PixivisionDetail,
  PixivPage,
  PixivWatchlistSeries,
  PixivWatchlistResponse,
  PixivTrendingTag,
  PixivTrendingTagsResponse,
  PixivTagDetail,
  PixivTagInfoResponse,
  PixivUserDetail,
  PixivUserPreview,
  PixivUserPreviewListResponse,
  PixivWebUserDetail,
  PixivWebUserTag,
  SearchOptions,
  TextEmbeddedImage,
  UgoiraMetadataResponse,
} from "../types"
import { API_BASE_URL, DEFAULT_WEB_BASE_URL } from "../config"
import { getWebBaseUrl } from "../store/settings"
import { isPixivCookieDomain, clearPixivWebCookies } from "./auth"
import { session } from "./session"
import { notifyUserFollowChanged, recordUserFollowed } from "../store/userFollow"
import {
  notifyIllustBookmarkChanged,
  notifyNovelBookmarkChanged,
  notifyNovelMarkerChanged,
  notifyWatchlistChanged,
} from "../store/bookmarkSync"
import {
  apiGet,
  apiGetAbsolute,
  apiGetPublicJson,
  apiGetPublicText,
  apiGetText,
  apiPost,
  PixivError,
  QueryParams,
} from "./client"

export type RecommendationKind = "illustration" | "manga"
export type NewWorkKind = "illustration" | "manga"
export type Visibility = "public" | "private"
export type FollowRestriction = "all" | Visibility
export type UserConnectionKind = "following" | "follower"

// ---------- 推荐 ----------

export async function recommendations(
  kind: RecommendationKind,
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const path =
    kind === "illustration" ? "/v1/illust/recommended" : "/v1/manga/recommended"
  const json = await apiGet<PixivIllustListResponse>(
    path,
    {
      filter: "for_ios",
      include_ranking_illusts: "true",
    },
    accessToken
  )
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

// 小说推荐（/v1/novel/recommended，无需 filter=for_ios）
export async function recommendedNovels(
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const json = await apiGet<PixivNovelListResponse>(
    "/v1/novel/recommended",
    {
      include_ranking_novels: "true",
    },
    accessToken
  )
  return { items: json?.novels ?? [], nextURL: json?.next_url ?? null }
}

// ---------- 最新作品 ----------

export async function newIllustrations(
  kind: NewWorkKind,
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const contentType = kind === "illustration" ? "illust" : "manga"
  const json = await apiGet<PixivIllustListResponse>(
    "/v1/illust/new",
    { filter: "for_ios", content_type: contentType },
    accessToken
  )
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

export async function newNovels(
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const json = await apiGet<PixivNovelListResponse>("/v1/novel/new", {}, accessToken)
  return { items: json?.novels ?? [], nextURL: json?.next_url ?? null }
}

export {
  pixivisionHome,
  nextPixivision,
  pixivisionByTag,
  pixivisionDetail,
  fetchPublicWebIllustDetail,
  parsePixivisionPage,
  parsePixivisionTagPage,
  parsePixivisionDetailPage,
  normalizePixivisionURL,
} from "./pixivision"

export async function ranking(
  mode: string,
  date: string | null,
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const query: Record<string, string> = { filter: "for_ios", mode }
  if (date) query["date"] = date
  const json = await apiGet<PixivIllustListResponse>("/v1/illust/ranking", query, accessToken)
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

export async function novelRanking(
  mode: string,
  date: string | null,
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const query: Record<string, string> = { mode }
  if (date) query["date"] = date
  const json = await apiGet<PixivNovelListResponse>("/v1/novel/ranking", query, accessToken)
  return { items: json?.novels ?? [], nextURL: json?.next_url ?? null }
}

// ---------- 关注动态 ----------

export async function followingNovels(
  restrict: FollowRestriction,
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const json = await apiGet<PixivNovelListResponse>(
    "/v1/novel/follow",
    { restrict },
    accessToken
  )
  return { items: json?.novels ?? [], nextURL: json?.next_url ?? null }
}

export async function followingFeed(
  restrict: FollowRestriction,
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const json = await apiGet<PixivIllustListResponse>(
    "/v2/illust/follow",
    { filter: "for_ios", restrict },
    accessToken
  )
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

export async function myPixivFeed(
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const json = await apiGet<PixivIllustListResponse>("/v2/illust/mypixiv", { filter: "for_ios" }, accessToken)
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

export async function myPixivNovels(
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const json = await apiGet<PixivNovelListResponse>("/v1/novel/mypixiv", {}, accessToken)
  return { items: json?.novels ?? [], nextURL: json?.next_url ?? null }
}

export async function watchlistManga(
  accessToken: string
): Promise<PixivPage<PixivWatchlistSeries>> {
  const json = await apiGet<PixivWatchlistResponse>("/v1/watchlist/manga", {}, accessToken)
  const items = json?.series ?? []
  return { items, nextURL: json?.next_url ?? null }
}

export async function watchlistNovels(
  accessToken: string
): Promise<PixivPage<PixivWatchlistSeries>> {
  const json = await apiGet<PixivWatchlistResponse>("/v1/watchlist/novel", {}, accessToken)
  const items = json?.series ?? []
  return { items, nextURL: json?.next_url ?? null }
}

export async function addWatchlistSeries(
  seriesID: number,
  kind: "manga" | "novel",
  accessToken: string
): Promise<void> {
  const endpoint = kind === "manga" ? "/v1/watchlist/manga/add" : "/v1/watchlist/novel/add"
  const body: Record<string, string> =
    kind === "manga"
      ? { illust_series_id: String(seriesID), series_id: String(seriesID) }
      : { novel_series_id: String(seriesID), series_id: String(seriesID) }
  await apiPost(endpoint, body, accessToken)
  notifyWatchlistChanged(seriesID, kind, true)
}

export async function deleteWatchlistSeries(
  seriesID: number,
  kind: "manga" | "novel",
  accessToken: string
): Promise<void> {
  const endpoint = kind === "manga" ? "/v1/watchlist/manga/delete" : "/v1/watchlist/novel/delete"
  const body: Record<string, string> =
    kind === "manga"
      ? { illust_series_id: String(seriesID), series_id: String(seriesID) }
      : { novel_series_id: String(seriesID), series_id: String(seriesID) }
  await apiPost(endpoint, body, accessToken)
  notifyWatchlistChanged(seriesID, kind, false)
}

// ---------- 收藏 ----------

export async function bookmarks(
  userID: number,
  restrict: Visibility,
  tag: string | null,
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const query: Record<string, string> = {
    user_id: String(userID),
    restrict,
  }
  if (tag) query["tag"] = tag
  const json = await apiGet<PixivIllustListResponse>("/v1/user/bookmarks/illust", query, accessToken)
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

export async function bookmarkTags(
  userID: number,
  restrict: Visibility,
  accessToken: string
): Promise<PixivPage<PixivBookmarkTag>> {
  const json = await apiGet<PixivBookmarkTagListResponse>(
    "/v1/user/bookmark-tags/illust",
    { user_id: String(userID), restrict },
    accessToken
  )
  return { items: json?.bookmark_tags ?? [], nextURL: json?.next_url ?? null }
}

export async function bookmarkDetail(
  id: number,
  accessToken: string
): Promise<PixivBookmarkDetail> {
  const json = await apiGet<PixivBookmarkDetailResponse>(
    "/v2/illust/bookmark/detail",
    { illust_id: String(id) },
    accessToken
  )
  const detail = json?.bookmark_detail
  const rawTags = Array.isArray(detail?.tags) ? detail.tags : []
  const tags = rawTags
    .map((tag: any) => ({
      name: typeof tag === "string" ? tag : tag?.name,
      is_registered:
        typeof tag === "string" ? true : tag?.is_registered === true,
    }))
    .filter(
      (tag: any): tag is { name: string; is_registered: boolean } =>
        typeof tag.name === "string" && tag.name.length > 0
    )
  return {
    is_bookmarked: detail?.is_bookmarked === true,
    tags,
    restrict: detail?.restrict === "private" ? "private" : "public",
  }
}

export async function addBookmark(
  id: number,
  restrict: Visibility,
  tags: string[],
  accessToken: string
): Promise<void> {
  const form: Record<string, string> = {
    illust_id: String(id),
    restrict,
  }
  const clean = tags.map((t) => t.trim()).filter((t) => t.length > 0)
  if (clean.length > 0) {
    form["tags[]"] = clean.join(" ")
  }
  await apiPost("/v2/illust/bookmark/add", form, accessToken)
  notifyIllustBookmarkChanged(id, true, restrict, clean)
}

export async function removeBookmark(
  id: number,
  accessToken: string
): Promise<void> {
  await apiPost(
    "/v1/illust/bookmark/delete",
    { illust_id: String(id) },
    accessToken
  )
  notifyIllustBookmarkChanged(id, false)
}

export async function deleteIllust(
  id: number,
  accessToken: string
): Promise<void> {
  await apiPost(
    "/v1/illust/delete",
    { illust_id: String(id) },
    accessToken
  )
}

// ---------- 搜索 ----------

export async function searchIllustrations(
  options: SearchOptions,
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const query: Record<string, string> = {
    filter: "for_ios",
    merge_plain_keyword_results: "true",
    search_target: options.target,
    sort: options.sort,
    word: options.word,
  }
  if (options.aiFilter != null) {
    query["search_ai_type"] = String(options.aiFilter)
  }
  if (options.startDate) query["start_date"] = options.startDate
  if (options.endDate) query["end_date"] = options.endDate
  if (options.bookmarkThreshold && options.bookmarkThreshold > 0) {
    query["word"] = `${options.word} ${options.bookmarkThreshold}users入り`
  }
  const json = await apiGet<PixivIllustListResponse>("/v1/search/illust", query, accessToken)
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

export async function searchAutocomplete(
  word: string,
  accessToken: string
): Promise<PixivAutocompleteTag[]> {
  const json = await apiGet<PixivAutocompleteResponse>(
    "/v2/search/autocomplete",
    { merge_plain_keyword_results: "true", word },
    accessToken
  )
  if (Array.isArray(json?.tags) && json.tags.length > 0) {
    return json.tags
  }
  if (Array.isArray(json?.search_auto_complete_keywords)) {
    return json.search_auto_complete_keywords.map((name) => ({ name }))
  }
  return json?.tags ?? []
}

export async function searchUsers(
  word: string,
  accessToken: string
): Promise<PixivPage<PixivUserPreview>> {
  const json = await apiGet<PixivUserPreviewListResponse>(
    "/v1/search/user",
    { filter: "for_ios", word },
    accessToken
  )
  return { items: json?.user_previews ?? [], nextURL: json?.next_url ?? null }
}

export async function trendingTags(
  accessToken: string
): Promise<PixivTrendingTag[]> {
  const json = await apiGet<PixivTrendingTagsResponse>(
    "/v1/trending-tags/illust",
    { filter: "for_ios" },
    accessToken
  )
  return json?.trend_tags ?? []
}

export async function trendingNovelTags(
  accessToken: string
): Promise<PixivTrendingTag[]> {
  const json = await apiGet<PixivTrendingTagsResponse>(
    "/v1/trending-tags/novel",
    { filter: "for_ios" },
    accessToken
  )
  return json?.trend_tags ?? []
}

export async function recommendedUsers(
  accessToken: string
): Promise<PixivPage<PixivUserPreview>> {
  const json = await apiGet<PixivUserPreviewListResponse>(
    "/v1/user/recommended",
    { filter: "for_ios" },
    accessToken
  )
  return { items: json?.user_previews ?? [], nextURL: json?.next_url ?? null }
}

export async function userRelated(
  seedUserID: number,
  accessToken: string
): Promise<PixivPage<PixivUserPreview>> {
  const json = await apiGet<PixivUserPreviewListResponse>(
    "/v1/user/related",
    { filter: "for_ios", seed_user_id: String(seedUserID) },
    accessToken
  )
  return { items: json?.user_previews ?? [], nextURL: json?.next_url ?? null }
}

// ---------- 作品详情 ----------

export async function illustrationDetail(
  id: number,
  accessToken: string
): Promise<PixivIllustration> {
  const json = await apiGet<PixivIllustDetailResponse>(
    "/v1/illust/detail",
    { illust_id: String(id) },
    accessToken
  )
  if (!json?.illust) throw new PixivError(404, "作品不存在")
  return json.illust
}

export async function relatedIllustrations(
  id: number,
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const json = await apiGet<PixivIllustListResponse>(
    "/v2/illust/related",
    { illust_id: String(id) },
    accessToken
  )
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

export async function illustrationSeries(
  id: number,
  accessToken: string
): Promise<PixivIllustrationSeriesResponse> {
  const json = await apiGet<PixivIllustrationSeriesResponse>(
    "/v1/illust/series",
    { illust_series_id: String(id) },
    accessToken
  )
  return json
}

export async function nextIllustrationSeries(
  nextURL: string,
  accessToken: string
): Promise<PixivIllustrationSeriesResponse> {
  return await apiGetAbsolute<PixivIllustrationSeriesResponse>(nextURL, accessToken)
}
export async function novelSeries(
  id: number,
  accessToken: string
): Promise<PixivNovelSeriesResponse> {
  const json = await apiGet<PixivNovelSeriesResponse>(
    "/v2/novel/series",
    { series_id: String(id) },
    accessToken
  )
  return json
}
export async function nextNovelSeries(
  nextURL: string,
  accessToken: string
): Promise<PixivNovelSeriesResponse> {
  return await apiGetAbsolute<PixivNovelSeriesResponse>(nextURL, accessToken)
}
export async function comments(
  illustID: number,
  accessToken: string
): Promise<PixivPage<PixivComment>> {
  const json = await apiGet<PixivCommentsResponse>(
    "/v3/illust/comments",
    { illust_id: String(illustID) },
    accessToken
  )
  return { items: json?.comments ?? [], nextURL: json?.next_url ?? null }
}

export async function commentReplies(
  commentID: number,
  accessToken: string
): Promise<PixivPage<PixivComment>> {
  const json = await apiGet<PixivCommentsResponse>(
    "/v2/illust/comment/replies",
    { comment_id: String(commentID) },
    accessToken
  )
  return { items: json?.comments ?? [], nextURL: json?.next_url ?? null }
}

export async function postComment(
  illustID: number,
  comment: string,
  parentCommentID: number | null,
  accessToken: string,
  stampID?: number | null
): Promise<void> {
  const form: Record<string, string> = {
    illust_id: String(illustID),
  }
  if (comment) {
    form["comment"] = comment
  }
  if (stampID != null) {
    form["stamp_id"] = String(stampID)
  }
  if (parentCommentID != null) {
    form["parent_comment_id"] = String(parentCommentID)
  }
  await apiPost("/v1/illust/comment/add", form, accessToken)
}

// ---------- 用户 ----------

function getWebOrigin(): string {
  return getWebBaseUrl()
}

function getAllowedWebOrigins(): string[] {
  const current = getWebBaseUrl()
  const list = [DEFAULT_WEB_BASE_URL, "https://pixiv.net"]
  try {
    const origin = new URL(current).origin
    if (!list.includes(origin)) list.push(origin)
  } catch {}
  return list
}

const WEB_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/26.6"

export function getWebHeaders(referer: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": WEB_USER_AGENT,
    Referer: referer,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  }
  const cookie = session.webCookie
  if (cookie) {
    headers["Cookie"] = cookie
  }
  return headers
}

export { isPixivCookieDomain, clearPixivWebCookies }

export async function syncWebCookies(): Promise<boolean> {
  const webView = new WebViewController()
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
      const cookieStr = Array.from(cookieMap.entries())
        .map(([name, val]) => `${name}=${val}`)
        .join("; ")
      session.updateWebCookie(cookieStr)
      return true
    }
    return false
  } catch (e) {
    console.log("syncWebCookies error:", e)
    return false
  } finally {
    webView.dispose()
  }
}

export async function fetchWebUserDetail(
  userID: number
): Promise<PixivWebUserDetail | null> {
  const origin = getWebOrigin()
  const url = `${origin}/ajax/user/${userID}?full=1`
  try {
    const json = await apiGetPublicJson<{ error: boolean; body?: PixivWebUserDetail }>(
      url,
      getAllowedWebOrigins(),
      getWebHeaders(`${origin}/users/${userID}`)
    )
    if (json?.error === false && json?.body) {
      return json.body as PixivWebUserDetail
    }
    return null
  } catch (error) {
    console.log("fetchWebUserDetail error:", error)
    return null
  }
}

export interface WebIllustWorkItem {
  id: string | number
  title: string
  illustType?: number
  xRestrict?: number
  restrict?: number
  sl?: number
  url: string
  description?: string
  tags?: string[]
  userId: string | number
  userName: string
  width?: number
  height?: number
  pageCount?: number
  bookmarkData?: unknown
  bookmarkCount?: number
  createDate?: string
  aiType?: number
  profileImageUrl?: string
}

export interface WebNovelWorkItem {
  id: string | number
  title: string
  genre?: string
  xRestrict?: number
  restrict?: number
  url: string
  tags?: string[]
  userId: string | number
  userName: string
  profileImageUrl?: string
  textCount?: number
  wordCount?: number
  readingTime?: number
  description?: string
  bookmarkData?: unknown
  bookmarkCount?: number
  createDate?: string
  aiType?: number
  seriesId?: string | number
  seriesTitle?: string
  seriesContentOrder?: number
}

function mapWebIllustToPixivIllustration(item: WebIllustWorkItem): PixivIllustration {
  const square = item.url || ""
  const medium = square.includes("img-master")
    ? square.replace("/c/250x250_80_a2/img-master/", "/c/540x540_70/img-master/").replace("_square1200.", "_master1200.")
    : square.includes("custom-thumb")
      ? square.replace("/c/250x250_80_a2/custom-thumb/", "/c/540x540_70/custom-thumb/").replace("_custom1200.", "_master1200.")
      : square
  const large = square.includes("img-master")
    ? square.replace("/c/250x250_80_a2/img-master/", "/c/600x1200_90/img-master/").replace("_square1200.", "_master1200.")
    : square.includes("custom-thumb")
      ? square.replace("/c/250x250_80_a2/custom-thumb/", "/c/600x1200_90/custom-thumb/").replace("_custom1200.", "_master1200.")
      : square

  return {
    id: Number(item.id),
    title: item.title || "",
    type: item.illustType === 1 ? "manga" : item.illustType === 2 ? "ugoira" : "illust",
    image_urls: {
      square_medium: square,
      medium,
      large,
    },
    caption: item.description || "",
    user: {
      id: Number(item.userId),
      name: item.userName || "",
      account: item.userName || "",
      profile_image_urls: {
        medium: item.profileImageUrl || "",
      },
      is_followed: false,
    },
    tags: (item.tags || []).map((t) => ({ name: t, translated_name: null })),
    create_date: item.createDate || new Date().toISOString(),
    page_count: item.pageCount || 1,
    width: item.width || 0,
    height: item.height || 0,
    x_restrict: item.xRestrict || 0,
    series: null,
    total_view: 0,
    total_bookmarks: item.bookmarkCount || 0,
    is_bookmarked: item.bookmarkData != null,
    is_muted: false,
    illust_ai_type: item.aiType || 0,
    total_comments: 0,
    comment_access_control: 0,
    meta_pages: [],
  }
}

function mapWebNovelToPixivNovel(item: WebNovelWorkItem): PixivNovel {
  return {
    id: Number(item.id),
    title: item.title || "",
    caption: item.description || "",
    user: {
      id: Number(item.userId),
      name: item.userName || "",
      account: item.userName || "",
      profile_image_urls: {
        medium: item.profileImageUrl || "",
      },
      is_followed: false,
    },
    tags: (item.tags || []).map((t) => ({ name: t, translated_name: null })),
    create_date: item.createDate || new Date().toISOString(),
    page_count: 1,
    x_restrict: item.xRestrict || 0,
    total_view: 0,
    total_bookmarks: item.bookmarkCount || 0,
    is_bookmarked: item.bookmarkData != null,
    is_muted: false,
    novel_ai_type: item.aiType || 0,
    total_comments: 0,
    text_length: item.textCount || item.wordCount || 0,
    visible: true,
    series: item.seriesId
      ? {
          id: Number(item.seriesId),
          title: item.seriesTitle || "",
        }
      : null,
    image_urls: {
      square_medium: item.url || "",
      medium: item.url || "",
      large: item.url || "",
    },
  }
}

export async function fetchUserWorkTags(
  userID: number,
  kind: "illust" | "manga" | "novel",
  limit = 20
): Promise<PixivWebUserTag[]> {
  const origin = getWebOrigin()
  const touchUrl =
    kind === "novel"
      ? `${origin}/touch/ajax/user/novels?id=${userID}&sensitiveFilterMode=userSetting&lang=zh`
      : `${origin}/touch/ajax/user/illusts?id=${userID}&type=${kind === "illust" ? "illust" : "manga"}&sensitiveFilterMode=userSetting&lang=zh`
  try {
    const json = await apiGetPublicJson<{
      error: boolean
      body?: { tags?: PixivWebUserTag[] }
    }>(
      touchUrl,
      getAllowedWebOrigins(),
      getWebHeaders(`${origin}/users/${userID}`)
    )
    if (
      json?.error === false &&
      Array.isArray(json.body?.tags) &&
      json.body.tags.length > 0
    ) {
      return json.body.tags.slice(0, limit)
    }
  } catch (error) {
    console.log("fetchUserWorkTags touch error:", error)
  }

  // Fallback to desktop ajax tags endpoint if touch endpoint fails or returns empty
  const path = kind === "illust" ? "illusts" : kind === "manga" ? "manga" : "novels"
  const url = `${origin}/ajax/user/${userID}/${path}/tags?lang=zh`
  try {
    const json = await apiGetPublicJson<{ error: boolean; body?: PixivWebUserTag[] }>(
      url,
      getAllowedWebOrigins(),
      getWebHeaders(`${origin}/users/${userID}`)
    )
    if (json?.error === false && Array.isArray(json.body)) {
      const sorted = [...json.body].sort((a, b) => (b.cnt ?? 0) - (a.cnt ?? 0))
      return sorted.slice(0, limit)
    }
    return []
  } catch (error) {
    console.log("fetchUserWorkTags fallback error:", error)
    return []
  }
}

export async function fetchUserTagFilteredWorks(
  userID: number,
  kind: "illust" | "manga",
  tag: string,
  offset = 0,
  limit = 48
): Promise<PixivPage<PixivIllustration>> {
  const origin = getWebOrigin()
  const path = kind === "illust" ? "illusts" : "manga"
  const url = `${origin}/ajax/user/${userID}/${path}/tag?tag=${encodeURIComponent(tag)}&offset=${offset}&limit=${limit}&sensitiveFilterMode=userSetting&lang=zh`
  try {
    const json = await apiGetPublicJson<{
      error: boolean
      body?: { works: WebIllustWorkItem[]; total: number }
    }>(
      url,
      getAllowedWebOrigins(),
      getWebHeaders(`${origin}/users/${userID}`)
    )
    if (json?.error === false && json.body && Array.isArray(json.body.works)) {
      const works = json.body.works.map(mapWebIllustToPixivIllustration)
      const total = json.body.total ?? 0
      const nextOffset = offset + works.length
      const nextURL =
        nextOffset < total && works.length > 0
          ? `web-tag://${kind}/${userID}?tag=${encodeURIComponent(tag)}&offset=${nextOffset}&limit=${limit}`
          : null
      return { items: works, nextURL }
    }
    return { items: [], nextURL: null }
  } catch (error) {
    console.log("fetchUserTagFilteredWorks error:", error)
    return { items: [], nextURL: null }
  }
}

export async function fetchUserTagFilteredNovels(
  userID: number,
  tag: string,
  offset = 0,
  limit = 24
): Promise<PixivPage<PixivNovel>> {
  const origin = getWebOrigin()
  const url = `${origin}/ajax/user/${userID}/novels/tag?tag=${encodeURIComponent(tag)}&offset=${offset}&limit=${limit}&sensitiveFilterMode=userSetting&lang=zh`
  try {
    const json = await apiGetPublicJson<{
      error: boolean
      body?: { works: WebNovelWorkItem[]; total: number }
    }>(
      url,
      getAllowedWebOrigins(),
      getWebHeaders(`${origin}/users/${userID}`)
    )
    if (json?.error === false && json.body && Array.isArray(json.body.works)) {
      const works = json.body.works.map(mapWebNovelToPixivNovel)
      const total = json.body.total ?? 0
      const nextOffset = offset + works.length
      const nextURL =
        nextOffset < total && works.length > 0
          ? `web-tag://novel/${userID}?tag=${encodeURIComponent(tag)}&offset=${nextOffset}&limit=${limit}`
          : null
      return { items: works, nextURL }
    }
    return { items: [], nextURL: null }
  } catch (error) {
    console.log("fetchUserTagFilteredNovels error:", error)
    return { items: [], nextURL: null }
  }
}

export async function fetchTagFilteredWorksByUrl(
  nextURL: string
): Promise<PixivPage<PixivIllustration>> {
  try {
    const parsed = new URL(nextURL)
    const kind = parsed.hostname as "illust" | "manga"
    const userID = Number(parsed.pathname.replace(/^\//, ""))
    const tag = parsed.searchParams.get("tag") || ""
    const offset = Number(parsed.searchParams.get("offset") || "0")
    const limit = Number(parsed.searchParams.get("limit") || "48")
    return fetchUserTagFilteredWorks(userID, kind, tag, offset, limit)
  } catch (e) {
    console.log("fetchTagFilteredWorksByUrl error:", e)
    return { items: [], nextURL: null }
  }
}

export async function fetchTagFilteredNovelsByUrl(
  nextURL: string
): Promise<PixivPage<PixivNovel>> {
  try {
    const parsed = new URL(nextURL)
    const userID = Number(parsed.pathname.replace(/^\//, ""))
    const tag = parsed.searchParams.get("tag") || ""
    const offset = Number(parsed.searchParams.get("offset") || "0")
    const limit = Number(parsed.searchParams.get("limit") || "24")
    return fetchUserTagFilteredNovels(userID, tag, offset, limit)
  } catch (e) {
    console.log("fetchTagFilteredNovelsByUrl error:", e)
    return { items: [], nextURL: null }
  }
}

export async function userDetail(
  id: number,
  accessToken: string
): Promise<PixivUserDetail> {
  const json = await apiGet<PixivUserDetail>(
    "/v1/user/detail",
    { user_id: String(id) },
    accessToken
  )
  return json
}

export async function userWorks(
  id: number,
  type: "illust" | "manga",
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const json = await apiGet<PixivIllustListResponse>(
    "/v1/user/illusts",
    { user_id: String(id), type },
    accessToken
  )
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

export async function userNovels(
  id: number,
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const json = await apiGet<PixivNovelListResponse>(
    "/v1/user/novels",
    { user_id: String(id) },
    accessToken
  )
  return { items: json?.novels ?? [], nextURL: json?.next_url ?? null }
}

export async function userNovelBookmarks(
  id: number,
  restrict: Visibility,
  tag: string | null,
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const query: Record<string, string> = { user_id: String(id), restrict }
  if (tag) query["tag"] = tag
  const json = await apiGet<PixivNovelListResponse>(
    "/v1/user/bookmarks/novel",
    query,
    accessToken
  )
  return { items: json?.novels ?? [], nextURL: json?.next_url ?? null }
}

export async function userBookmarks(
  id: number,
  restrict: Visibility,
  accessToken: string,
  tag?: string | null
): Promise<PixivPage<PixivIllustration>> {
  const query: Record<string, string> = { user_id: String(id), restrict }
  if (tag) query["tag"] = tag
  const json = await apiGet<PixivIllustListResponse>("/v1/user/bookmarks/illust", query, accessToken)
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

export async function userConnections(
  userID: number,
  kind: UserConnectionKind,
  restrict: Visibility,
  accessToken: string
): Promise<PixivPage<PixivUserPreview>> {
  const path = kind === "following" ? "/v1/user/following" : "/v1/user/follower"
  const json = await apiGet<PixivUserPreviewListResponse>(
    path,
    { user_id: String(userID), restrict },
    accessToken
  )
  return { items: json?.user_previews ?? [], nextURL: json?.next_url ?? null }
}

export async function myPixivUsers(
  userID: number,
  accessToken: string
): Promise<PixivPage<PixivUserPreview>> {
  const json = await apiGet<PixivUserPreviewListResponse>(
    "/v1/user/mypixiv",
    { user_id: String(userID) },
    accessToken
  )
  return { items: json?.user_previews ?? [], nextURL: json?.next_url ?? null }
}

export async function followDetail(
  userID: number,
  accessToken: string
): Promise<PixivFollowDetail> {
  const json = await apiGet<PixivFollowDetailResponse>(
    "/v1/user/follow/detail",
    { user_id: String(userID) },
    accessToken
  )
  const detail = json?.follow_detail ?? { is_followed: false }
  if (detail.is_followed) {
    recordUserFollowed(userID, true, detail.restrict ?? "public")
  } else {
    recordUserFollowed(userID, false)
  }
  return detail
}

export async function followUser(
  userID: number,
  restrict: Visibility,
  accessToken: string
): Promise<void> {
  await apiPost(
    "/v1/user/follow/add",
    { user_id: String(userID), restrict },
    accessToken
  )
  notifyUserFollowChanged(userID, true, restrict)
}

export async function unfollowUser(
  userID: number,
  accessToken: string
): Promise<void> {
  await apiPost(
    "/v1/user/follow/delete",
    { user_id: String(userID) },
    accessToken
  )
  notifyUserFollowChanged(userID, false)
}

export async function editAIShowSettings(
  showAI: boolean,
  accessToken: string
): Promise<any> {
  return apiPost(
    "/v1/user/ai-show-settings/edit",
    { show_ai: showAI ? "true" : "false" },
    accessToken
  )
}

// ---------- 关注标签 ----------

export async function followTag(
  tagName: string,
  restrict: Visibility,
  accessToken: string
): Promise<void> {
  await apiPost(
    "/v1/tag/follow",
    { tag_name: tagName, restrict },
    accessToken
  )
}

export async function unfollowTag(
  tagName: string,
  accessToken: string
): Promise<void> {
  await apiPost("/v1/tag/unfollow", { tag_name: tagName }, accessToken)
}

// ---------- Ugoira ----------

export async function ugoiraMetadata(
  id: number,
  accessToken: string
): Promise<UgoiraMetadataResponse["ugoira_metadata"]> {
  const json = await apiGet<UgoiraMetadataResponse>(
    "/v1/ugoira/metadata",
    { illust_id: String(id) },
    accessToken
  )
  return json?.ugoira_metadata
}

// ---------- 小说 ----------

// 注意：Pixiv 小说接口与插画不同——详情是 /v2/novel/detail（参数 novel_id），
// 正文 /v1/novel/text 也用 novel_id（PixEz 验证）；v1/novel/detail 不存在（404）

export async function novelDetail(
  id: number,
  accessToken: string
): Promise<PixivNovelDetail> {
  const json = await apiGet<PixivNovelDetailResponse>(
    "/v2/novel/detail",
    { novel_id: String(id) },
    accessToken
  )
  return json?.novel
}

export async function relatedNovels(
  id: number,
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const json = await apiGet<PixivNovelListResponse>(
    "/v1/novel/related",
    { novel_id: String(id) },
    accessToken
  )
  return { items: json?.novels ?? [], nextURL: json?.next_url ?? null }
}

// ---------- 小说正文（官方阅读器页面） ----------

// 官方 iOS app 的正文获取方式：请求 /webview/v2/novel（阅读器 HTML 页面），
// 正文在页面注入的 window.pixiv.novel.text（纯文本）里，同时有 coverUrl 封面。
// 单独的 /v1/novel/text 接口已不存在（404）。

export interface NovelViewerData {
  text: string
  coverUrl?: string
  title?: string
  textEmbeddedImages?: Record<string, TextEmbeddedImage>
}

export async function novelViewerData(
  id: number,
  accessToken: string
): Promise<NovelViewerData> {
  // 参数与官方 iOS app 8.7.3 抓包一致
  const url =
    `${API_BASE_URL}/webview/v2/novel?id=${id}` +
    "&font=gothic&font_size=1.0em&line_height=1.8" +
    "&color=%23B7B7B7&background_color=%231F1F1F" +
    "&mode=horizontal&theme=dark&margin_top=60px&margin_bottom=50px" +
    "&viewer_version=20260126_viewer_comments&view_name=HomeNovel"
  const html = await apiGetText(url, accessToken)
  const novel = extractNovelJson(html)

  let textEmbeddedImages: Record<string, TextEmbeddedImage> | undefined =
    novel?.textEmbeddedImages ||
    novel?.images ||
    novel?.embedded_images ||
    novel?.text_embedded_images ||
    extractEmbeddedImagesFromHtml(html) ||
    undefined

  const text = novel?.text ?? ""

  // 检查已解析的图片字典中是否包含有效图片
  const hasEmbeddedImages =
    textEmbeddedImages != null &&
    typeof textEmbeddedImages === "object" &&
    Object.keys(textEmbeddedImages).length > 0

  // 若正文包含 uploadedimage 标签但尚未取得有效图片字典，则从 Web 端点降级补充拉取
  if (!hasEmbeddedImages && /\[uploadedimage:\s*[^\]]+\]/i.test(text)) {
    try {
      const origin = getWebOrigin()
      const webData = await apiGetPublicJson<{
        body?: { textEmbeddedImages?: Record<string, TextEmbeddedImage> }
      }>(
        `${origin}/ajax/novel/${id}`,
        getAllowedWebOrigins(),
        getWebHeaders(`${origin}/novel/show.php?id=${id}`)
      )
      if (webData?.body?.textEmbeddedImages) {
        textEmbeddedImages = webData.body.textEmbeddedImages
      }
    } catch {
      // 降级处理
    }
  }

  return {
    text,
    coverUrl: novel?.coverUrl,
    title: novel?.title,
    textEmbeddedImages,
  }
}

// 括号平衡 JSON 对象提取器，兼容字符串内大括号与转义
function extractBalancedJsonObject(html: string, start: number): any | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === "\\") esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === "{") {
      depth++
      continue
    }
    if (ch === "}") {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

// 从阅读器 HTML 中提取 window.pixiv.novel 对象
function extractNovelJson(html: string): any | null {
  const marker = "novel: {"
  const idx = html.indexOf(marker)
  if (idx < 0) return null
  const start = html.indexOf("{", idx)
  if (start < 0) return null
  return extractBalancedJsonObject(html, start)
}

// 从阅读器 HTML 中尝试提取独立的 textEmbeddedImages 字典
function extractEmbeddedImagesFromHtml(html: string): Record<string, TextEmbeddedImage> | undefined {
  if (!html) return undefined
  const markers = [
    '"textEmbeddedImages":',
    'textEmbeddedImages:',
    '"text_embedded_images":',
    'text_embedded_images:',
    '"embedded_images":',
    'embedded_images:',
  ]
  for (const marker of markers) {
    const idx = html.indexOf(marker)
    if (idx >= 0) {
      const start = html.indexOf("{", idx)
      if (start >= 0) {
        const obj = extractBalancedJsonObject(html, start)
        if (obj && typeof obj === "object" && Object.keys(obj).length > 0) {
          return obj as Record<string, TextEmbeddedImage>
        }
      }
    }
  }
  return undefined
}

// 小说阅读书签：iOS App 8.7.3 抓包确认。
// GET /v2/novel/markers -> { marked_novels: [{ novel, novel_marker: { page } }], next_url }
export async function novelMarkers(
  accessToken: string
): Promise<PixivPage<PixivNovelMarker>> {
  const json = await apiGet<PixivNovelMarkersResponse>("/v2/novel/markers", {}, accessToken)
  const items = Array.isArray(json?.marked_novels)
    ? json.marked_novels
      .filter((item: any) => item?.novel?.id != null)
      .map((item: any) => ({ ...item, id: item.novel.id }))
    : []
  return { items, nextURL: json?.next_url ?? null }
}

export async function nextNovelMarkers(
  nextURL: string,
  accessToken: string
): Promise<PixivPage<PixivNovelMarker>> {
  const json = await apiGetAbsolute<PixivNovelMarkersResponse>(nextURL, accessToken)
  const items = Array.isArray(json?.marked_novels)
    ? json.marked_novels
      .filter((item: any) => item?.novel?.id != null)
      .map((item: any) => ({ ...item, id: item.novel.id }))
    : []
  return { items, nextURL: json?.next_url ?? null }
}

export async function addNovelMarker(
  novelID: number,
  page: number,
  accessToken: string
): Promise<void> {
  const form: Record<string, string> = {
    novel_id: String(novelID),
    page: String(page),
  }
  try {
    await apiPost("/v2/novel/marker/add", form, accessToken)
    notifyNovelMarkerChanged(novelID, page)
    return
  } catch (err: any) {
    if (err?.status === 404) {
      try {
        await apiPost("/v1/novel/marker/add", form, accessToken)
        notifyNovelMarkerChanged(novelID, page)
        return
      } catch {}
    }
  }

  // Pixiv 官方每本小说仅允许保留一个书签，若已存在其他页书签则可能拒绝直接添加；
  // 先尝试删除旧书签，再重新添加新页码书签
  try {
    await deleteNovelMarker(novelID, accessToken)
  } catch {}

  try {
    await apiPost("/v2/novel/marker/add", form, accessToken)
  } catch (err2: any) {
    if (err2?.status === 404) {
      await apiPost("/v1/novel/marker/add", form, accessToken)
    } else {
      throw err2
    }
  }
  notifyNovelMarkerChanged(novelID, page)
}

export async function deleteNovelMarker(
  novelID: number,
  accessToken: string
): Promise<void> {
  const form: Record<string, string> = {
    novel_id: String(novelID),
  }
  try {
    await apiPost("/v2/novel/marker/delete", form, accessToken)
  } catch (err: any) {
    if (err?.status === 404) {
      await apiPost("/v1/novel/marker/delete", form, accessToken)
    } else {
      throw err
    }
  }
  notifyNovelMarkerChanged(novelID, null)
}

export async function searchNovels(
  options: SearchOptions,
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const query: Record<string, string> = {
    filter: "for_ios",
    merge_plain_keyword_results: "true",
    search_target: options.target || "partial_match_for_tags",
    sort: options.sort || "date_desc",
    word: options.word,
  }
  if (options.aiFilter != null) {
    query["search_ai_type"] = String(options.aiFilter)
  }
  if (options.startDate) query["start_date"] = options.startDate
  if (options.endDate) query["end_date"] = options.endDate
  if (options.bookmarkThreshold && options.bookmarkThreshold > 0) {
    query["word"] = `${options.word} ${options.bookmarkThreshold}users入り`
  }
  const json = await apiGet<PixivNovelListResponse>(
    "/v1/search/novel",
    query,
    accessToken
  )
  return { items: json?.novels ?? [], nextURL: json?.next_url ?? null }
}

export async function novelComments(
  id: number,
  accessToken: string
): Promise<PixivPage<PixivComment>> {
  const json = await apiGet<PixivCommentsResponse>(
    "/v3/novel/comments",
    { novel_id: String(id) },
    accessToken
  )
  return { items: json?.comments ?? [], nextURL: json?.next_url ?? null }
}

export async function postNovelComment(
  novelID: number,
  comment: string,
  parentCommentID: number | null,
  accessToken: string,
  stampID?: number | null
): Promise<void> {
  const form: Record<string, string> = {
    novel_id: String(novelID),
  }
  if (comment) {
    form["comment"] = comment
  }
  if (stampID != null) {
    form["stamp_id"] = String(stampID)
  }
  if (parentCommentID != null) {
    form["parent_comment_id"] = String(parentCommentID)
  }
  await apiPost("/v1/novel/comment/add", form, accessToken)
}

export async function novelCommentReplies(
  commentID: number,
  accessToken: string
): Promise<PixivPage<PixivComment>> {
  const json = await apiGet<PixivCommentsResponse>(
    "/v2/novel/comment/replies",
    { comment_id: String(commentID) },
    accessToken
  )
  return { items: json?.comments ?? [], nextURL: json?.next_url ?? null }
}

export async function novelBookmarkTags(
  restrict: Visibility,
  accessToken: string
): Promise<PixivPage<PixivBookmarkTag>> {
  const json = await apiGet<PixivBookmarkTagListResponse>(
    "/v1/user/bookmark-tags/novel",
    { restrict },
    accessToken
  )
  return { items: json?.bookmark_tags ?? [], nextURL: json?.next_url ?? null }
}

export async function novelBookmarkDetail(
  id: number,
  accessToken: string
): Promise<PixivBookmarkDetail> {
  const json = await apiGet<PixivBookmarkDetailResponse>(
    "/v2/novel/bookmark/detail",
    { novel_id: String(id) },
    accessToken
  )
  const detail = json?.bookmark_detail
  const rawTags = Array.isArray(detail?.tags) ? detail.tags : []
  const tags = rawTags
    .map((tag: any) => ({
      name: typeof tag === "string" ? tag : tag?.name,
      is_registered:
        typeof tag === "string" ? true : tag?.is_registered === true,
    }))
    .filter(
      (tag: any): tag is { name: string; is_registered: boolean } =>
        typeof tag.name === "string" && tag.name.length > 0
    )
  return {
    is_bookmarked: detail?.is_bookmarked === true,
    tags,
    restrict: detail?.restrict === "private" ? "private" : "public",
  }
}

export async function addNovelBookmark(
  id: number,
  restrict: Visibility,
  accessToken: string,
  tags: string[] = []
): Promise<void> {
  const form: Record<string, string> = {
    novel_id: String(id),
    restrict,
  }
  const clean = tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
  if (clean.length > 0) form["tags[]"] = clean.join(" ")
  await apiPost("/v2/novel/bookmark/add", form, accessToken)
  notifyNovelBookmarkChanged(id, true, restrict, clean)
}

export async function removeNovelBookmark(
  id: number,
  accessToken: string
): Promise<void> {
  await apiPost(
    "/v1/novel/bookmark/delete",
    { novel_id: String(id) },
    accessToken
  )
  notifyNovelBookmarkChanged(id, false)
}

export async function deleteNovel(
  id: number,
  accessToken: string
): Promise<void> {
  await apiPost(
    "/v1/novel/delete",
    { novel_id: String(id) },
    accessToken
  )
}

// ---------- 标签百科与摘要 ----------

export async function fetchTagInfo(tagName: string): Promise<PixivTagDetail | null> {
  const cleanTag = tagName.trim()
  if (!cleanTag) return null
  try {
    const origin = getWebOrigin()
    const url = `${origin}/ajax/tag/info?tag=${encodeURIComponent(cleanTag)}`
    const json = await apiGetPublicJson<PixivTagInfoResponse>(
      url,
      getAllowedWebOrigins(),
      {
        Referer: `${origin}/`,
      }
    )
    if (!json || json.error || !json.body) {
      return null
    }
    const body = json.body
    const abstract = body.abstract || body.ja?.abstract || body.en?.abstract || undefined
    const hasEncyclopedia = Boolean(abstract || body.thumbnail)
    return {
      tag: body.tag || cleanTag,
      abstract,
      thumbnailUrl: body.thumbnail || null,
      dicUrl: body.ja?.url || body.en?.url || null,
      hasEncyclopedia,
    }
  } catch {
    return null
  }
}

// ---------- 通知 ----------

export type { PixivNotification, PixivNotificationContent, PixivNotificationViewMore } from "../types"

export async function notifications(
  accessToken: string
): Promise<{ items: PixivNotification[]; nextURL: string | null }> {
  const json = await apiGet<PixivNotificationListResponse>("/v1/notification/list", {}, accessToken)
  return {
    items: json?.notifications ?? [],
    nextURL: json?.next_url ?? null,
  }
}

export async function nextNotifications(
  nextURL: string,
  accessToken: string
): Promise<{ items: PixivNotification[]; nextURL: string | null }> {
  const json = await apiGetAbsolute<PixivNotificationListResponse>(nextURL, accessToken)
  return {
    items: json?.notifications ?? [],
    nextURL: json?.next_url ?? null,
  }
}

export async function notificationViewMore(
  notificationID: number,
  accessToken: string
): Promise<{ items: PixivNotification[]; nextURL: string | null }> {
  const json = await apiGet<PixivNotificationListResponse>(
    "/v1/notification/view-more",
    { notification_id: String(notificationID) },
    accessToken
  )
  return {
    items: json?.notifications ?? [],
    nextURL: json?.next_url ?? null,
  }
}

// ---------- 分页 ----------

export async function nextIllustrations(
  nextURL: string,
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const json = await apiGetAbsolute<PixivIllustListResponse>(nextURL, accessToken)
  return { items: json?.illusts ?? [], nextURL: json?.next_url ?? null }
}

export async function nextWatchlist(
  nextURL: string,
  accessToken: string
): Promise<PixivPage<PixivWatchlistSeries>> {
  const json = await apiGetAbsolute<PixivWatchlistResponse>(nextURL, accessToken)
  const items = json?.series ?? []
  return { items, nextURL: json?.next_url ?? null }
}

export async function nextUsers(
  nextURL: string,
  accessToken: string
): Promise<PixivPage<PixivUserPreview>> {
  const json = await apiGetAbsolute<PixivUserPreviewListResponse>(nextURL, accessToken)
  return { items: json?.user_previews ?? [], nextURL: json?.next_url ?? null }
}

export async function nextComments(
  nextURL: string,
  accessToken: string
): Promise<PixivPage<PixivComment>> {
  const json = await apiGetAbsolute<PixivCommentsResponse>(nextURL, accessToken)
  return { items: json?.comments ?? [], nextURL: json?.next_url ?? null }
}

export async function nextNovels(
  nextURL: string,
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const json = await apiGetAbsolute<PixivNovelListResponse>(nextURL, accessToken)
  return { items: json?.novels ?? [], nextURL: json?.next_url ?? null }
}
