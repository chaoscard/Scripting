import type {
  PixivAutocompleteResponse,
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
  PixivVisionArticle,
  PixivVisionDetail,
  PixivPage,
  PixivWatchlistSeries,
  PixivWatchlistResponse,
  PixivTrendingTag,
  PixivTrendingTagsResponse,
  PixivUserDetail,
  PixivUserPreview,
  PixivUserPreviewListResponse,
  PixivWebUserDetail,
  TextEmbeddedImage,
  UgoiraMetadataResponse,
} from "../types"
import { API_BASE_URL } from "../config"
import { notifyUserFollowChanged } from "../store/userFollow"
import {
  notifyIllustBookmarkChanged,
  notifyNovelBookmarkChanged,
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
} from "./client"

export type RecommendationKind = "illustration" | "manga"
export type NewWorkKind = "illustration" | "manga"
export type Visibility = "public" | "private"
export type FollowRestriction = "all" | Visibility
export type UserConnectionKind = "following" | "follower"

export interface SearchOptions {
  target: string
  sort: string
  aiFilter?: number
  word: string
  startDate?: string
  endDate?: string
  bookmarkThreshold?: number
}

// ---------- 推荐 ----------

export async function recommendations(
  kind: RecommendationKind,
  accessToken: string
): Promise<PixivPage<PixivIllustration>> {
  const path =
    kind === "illustration" ? "/v1/illust/recommended" : "/v1/manga/recommended"
  const json = await apiGet<PixivIllustListResponse>(
    path,
    { filter: "for_ios", include_ranking_label: "true" },
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
    { include_ranking_label: "true" },
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

const VISION_HOME_URL = "https://www.pixivision.net/zh/"
const VISION_ORIGIN = "https://www.pixivision.net"
const VISION_PAGE_SIZE = 20
const VISION_AJAX_PATH = "/pixivisionsp/zh/ajax-api/index"
const VISION_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/26.6 PixivIOSApp/8.7.3"

function visionHeaders(referer: string): Record<string, string> {
  return {
    "User-Agent": VISION_USER_AGENT,
    Referer: referer,
  }
}

function normalizeVisionURL(value: string): string {
  let url: URL
  try {
    url = new URL(value, VISION_ORIGIN)
  } catch {
    throw new PixivError(0, "无效的 Pixivision 地址")
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== VISION_ORIGIN ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new PixivError(0, "已阻止非 Pixivision 来源的请求")
  }
  return url.toString()
}

export async function visionHome(
  accessToken: string
): Promise<PixivPage<PixivVisionArticle>> {
  const html = await apiGetPublicText(
    VISION_HOME_URL,
    VISION_ORIGIN,
    "text/html",
    visionHeaders(VISION_HOME_URL)
  )
  return parseVisionPage(html, 1)
}

export async function nextVision(
  nextURL: string,
  accessToken: string
): Promise<PixivPage<PixivVisionArticle>> {
  const safeURL = normalizeVisionURL(nextURL)
  const page = Number(safeURL.match(/[?&]page=(\d+)/i)?.[1] ?? "2")
  const response = await apiGetPublicText(
    safeURL,
    VISION_ORIGIN,
    "application/json, text/javascript, */*; q=0.01",
    {
      ...visionHeaders(VISION_HOME_URL),
      "X-Requested-With": "XMLHttpRequest",
    }
  )
  let html = response
  try {
    const json = JSON.parse(response)
    html = typeof json?.body?.html === "string" ? json.body.html : response
  } catch {
    // 兼容服务端直接返回 HTML 的情况
  }
  return parseVisionPage(html, page)
}

export async function visionDetail(
  articleID: number,
  accessToken: string
): Promise<PixivVisionDetail> {
  const url = `${VISION_ORIGIN}/zh/a/${articleID}`
  const html = await apiGetPublicText(
    normalizeVisionURL(url),
    VISION_ORIGIN,
    "text/html",
    visionHeaders(VISION_HOME_URL)
  )
  return parseVisionDetailPage(html, articleID)
}

export function parseVisionPage(
  html: string,
  page = 1
): PixivPage<PixivVisionArticle> {
  const items: PixivVisionArticle[] = []
  const cardPattern = /<li\s+class=["']article-card-container["'][^>]*>([\s\S]*?<\/article>)\s*<\/li>/gi
  let match: RegExpExecArray | null
  while ((match = cardPattern.exec(html)) != null) {
    const card = match[1]
    const idText = card.match(/\/zh\/a\/(\d+)/i)?.[1]
    const imageURL = matchAttribute(card.match(/<img\b[^>]*>/i)?.[0] ?? "", "src")
    const date = matchAttribute(card.match(/<time\b[^>]*>/i)?.[0] ?? "", "datetime")
    const titleHTML = card.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? ""
    const categoryHTML = card.match(
      /<span\b[^>]*class=["'][^"']*arcsp__thumbnail-label[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    )?.[1] ?? ""
    if (!idText || !imageURL || !date || !titleHTML) continue
    items.push({
      id: Number(idText),
      title: visionHTMLToText(titleHTML),
      imageURL,
      date,
      category: visionHTMLToText(categoryHTML) || "精选",
    })
  }

  const nextPath = matchAttribute(
    html.match(/data-next-url=["'][^"']+["']/i)?.[0] ?? "",
    "data-next-url"
  )
  const hasFullPage = items.length >= VISION_PAGE_SIZE
  return {
    items,
    nextURL: hasFullPage
      ? buildVisionPageURL(page + 1)
      : nextPath
        ? normalizeVisionURL(nextPath)
        : null,
  }
}

function buildVisionPageURL(page: number): string {
  return `${VISION_ORIGIN}${VISION_AJAX_PATH}?page=${page}&per_page=${VISION_PAGE_SIZE}`
}

export function parseVisionDetailPage(
  html: string,
  articleID: number
): PixivVisionDetail {
  const title = visionHTMLToText(
    html.match(/<h1\b[^>]*class=["'][^"']*(?:amsp__title|am__title)[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""
  )
  const date = matchAttribute(
    html.match(/<time\b[^>]*class=["'][^"']*[_ ]date[^"']*["'][^>]*>/i)?.[0] ?? "",
    "datetime"
  )
  const category = visionHTMLToText(
    html.match(/<span\b[^>]*class=["'][^"']*_category-label[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""
  )
  const descriptionBlock = html.match(
    /<div\b[^>]*class=["'][^"']*amsp__description-text[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i
  )?.[1] ?? html.match(
    /<div\b[^>]*class=["'][^"']*_feature-article-body__paragraph[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*article-item|<\/article>)/i
  )?.[1] ?? ""
  const description = visionHTMLToParagraphText(descriptionBlock)
  const artworks: PixivVisionDetail["artworks"] = []
  const embeddedArticles: PixivVisionArticle[] = []
  const artworkPattern = /<div\b[^>]*class=["'][^"']*_feature-article-body__pixiv_illust[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*_feature-article-body__pixiv_illust|<div\b[^>]*class=["'][^"']*_feature-article-body__heading|<\/article>)/gi
  let artworkMatch: RegExpExecArray | null
  while ((artworkMatch = artworkPattern.exec(html)) != null) {
    const block = artworkMatch[1]
    const idText = block.match(/pixiv\.net\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artworks\/(\d+)/i)?.[1]
    const imageURL = matchAttribute(
      block.match(/(?:aiwsp__main|am__work__main)[\s\S]*?<img\b[^>]*>/i)?.[0] ?? "",
      "src"
    )
    const titleHTML = block.match(
      /<h[23]\b[^>]*class=["'][^"']*(?:aiwsp__title|am__work__title)[^"']*["'][^>]*>([\s\S]*?)<\/h[23]>/i
    )?.[1] ?? ""
    if (!idText || !imageURL) continue
    const id = Number(idText)
    if (!Number.isFinite(id) || artworks.some((item) => item.id === id)) continue
    artworks.push({
      id,
      title: visionHTMLToText(titleHTML) || `作品 ${id}`,
      imageURL,
    })
  }

  const embeddedPattern = /<div\b[^>]*class=["'][^"']*_feature-article-body__article_card[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*_feature-article-body__article_card|<div\b[^>]*class=["'][^"']*_feature-article-body__heading|<\/article>)/gi
  let embeddedMatch: RegExpExecArray | null
  while ((embeddedMatch = embeddedPattern.exec(html)) != null) {
    const block = embeddedMatch[1]
    const idText = block.match(/href=["'](?:https?:\/\/www\.pixivision\.net)?\/zh\/a\/(\d+)["']/i)?.[1]
    const imageURL =
      matchAttribute(block.match(/<img\b[^>]*>/i)?.[0] ?? "", "src") ||
      matchBackgroundImageURL(block)
    const titleHTML = block.match(
      /class=["'][^"']*arcsp__title[^"']*["'][^>]*>[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>/i
    )?.[1] ?? block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? ""
    const date = matchAttribute(
      block.match(/<time\b[^>]*>/i)?.[0] ?? "",
      "datetime"
    )
    const categoryHTML = block.match(
      /<span\b[^>]*class=["'][^"']*arcsp__thumbnail-label[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    )?.[1] ?? ""
    if (!idText || !imageURL || !titleHTML) continue
    const id = Number(idText)
    if (!Number.isFinite(id) || embeddedArticles.some((item) => item.id === id)) continue
    embeddedArticles.push({
      id,
      title: visionHTMLToText(titleHTML),
      imageURL,
      date,
      category: visionHTMLToText(categoryHTML) || "精选",
    })
  }

  if (!title || (artworks.length === 0 && embeddedArticles.length === 0)) {
    throw new PixivError(404, "Vision 文章内容不完整")
  }
  return {
    id: articleID,
    title,
    date,
    category: category || "精选",
    description,
    artworks,
    embeddedArticles,
  }
}

function matchAttribute(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return tag.match(new RegExp(`${escaped}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? ""
}

function matchBackgroundImageURL(html: string): string {
  const value = html.match(
    /background-image\s*:\s*url\(\s*["']?([^"')\s]+)["']?\s*\)/i
  )?.[1] ?? ""
  return decodeVisionEntities(value)
}

function decodeVisionEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match: string, code: string) => {
      try {
        return String.fromCodePoint(Number(code))
      } catch {
        return _match
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match: string, code: string) => {
      try {
        return String.fromCodePoint(parseInt(code, 16))
      } catch {
        return _match
      }
    })
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_match: string, name: string) => {
      const entities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        "#39": "'",
        nbsp: " ",
      }
      return entities[name] ?? _match
    })
}

function visionHTMLToText(value: string): string {
  return decodeVisionEntities(
    value
      .replace(/<br\s*\/?>(?:\r?\n)?/gi, " ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim()
}

function visionHTMLToParagraphText(value: string): string {
  return decodeVisionEntities(
    value
      .replace(/<br\s*\/?>(?:\r?\n)?/gi, "\n")
      .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}




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
): Promise<{ name: string; translated_name?: string | null }[]> {
  const json = await apiGet<PixivAutocompleteResponse>(
    "/v2/search/autocomplete",
    { merge_plain_keyword_results: "true", word },
    accessToken
  )
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

const WEB_BASE_ORIGIN = "https://www.pixiv.net"
const WEB_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/26.6"

export async function fetchWebUserDetail(
  userID: number
): Promise<PixivWebUserDetail | null> {
  const url = `${WEB_BASE_ORIGIN}/ajax/user/${userID}?full=1`
  try {
    const json = await apiGetPublicJson<{ error: boolean; body?: PixivWebUserDetail }>(url, WEB_BASE_ORIGIN, {
      "User-Agent": WEB_USER_AGENT,
      Referer: `${WEB_BASE_ORIGIN}/users/${userID}`,
    })
    if (json?.error === false && json?.body) {
      return json.body as PixivWebUserDetail
    }
    return null
  } catch (error) {
    console.log("fetchWebUserDetail error:", error)
    return null
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
  return json?.follow_detail ?? { is_followed: false }
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
  notifyUserFollowChanged(userID, true)
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
      const webData = await apiGetPublicJson<{
        body?: { textEmbeddedImages?: Record<string, TextEmbeddedImage> }
      }>(
        `${WEB_BASE_ORIGIN}/ajax/novel/${id}`,
        WEB_BASE_ORIGIN,
        { Referer: `${WEB_BASE_ORIGIN}/novel/show.php?id=${id}` }
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

export async function searchNovels(
  word: string,
  sort: "date_desc" | "popular_desc" | "date_asc",
  accessToken: string
): Promise<PixivPage<PixivNovel>> {
  const json = await apiGet<PixivNovelListResponse>(
    "/v1/search/novel",
    { search_target: "partial_match_for_tags", sort, word },
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
