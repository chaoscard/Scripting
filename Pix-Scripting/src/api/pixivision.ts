import { apiGetPublicJson, apiGetPublicText, PixivError } from "./client"
import { derivePixivThumbUrl } from "../image/imageLoader"
import type {
  PixivIllustration,
  PixivPage,
  PixivisionArticle,
  PixivisionArtwork,
  PixivisionDetail,
  PixivisionRelatedSection,
  PixivisionTag,
} from "../types"

const PIXIVISION_HOME_URL = "https://www.pixivision.net/zh/"
const PIXIVISION_ORIGIN = "https://www.pixivision.net"
const PIXIVISION_ALLOWED_ORIGINS = ["https://www.pixivision.net", "https://pixivision.net"]
const PIXIVISION_PAGE_SIZE = 20
const PIXIVISION_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/26.6 PixivIOSApp/8.7.3"

function pixivisionHeaders(referer: string): Record<string, string> {
  return {
    "User-Agent": PIXIVISION_USER_AGENT,
    Referer: referer,
  }
}

export function normalizePixivisionURL(value: string): string {
  let url: URL
  try {
    url = new URL(value, PIXIVISION_ORIGIN)
  } catch {
    throw new PixivError(0, "无效的 Pixivision 地址")
  }
  if (
    url.protocol !== "https:" ||
    !PIXIVISION_ALLOWED_ORIGINS.includes(url.origin) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new PixivError(0, "已阻止非 Pixivision 来源的请求")
  }
  return url.toString()
}

export async function pixivisionHome(
  _accessToken?: string
): Promise<PixivPage<PixivisionArticle>> {
  const html = await apiGetPublicText(
    PIXIVISION_HOME_URL,
    PIXIVISION_ALLOWED_ORIGINS,
    "text/html",
    pixivisionHeaders(PIXIVISION_HOME_URL)
  )
  return parsePixivisionPage(html, 1)
}

export async function nextPixivision(
  nextURL: string,
  _accessToken?: string
): Promise<PixivPage<PixivisionArticle>> {
  const safeURL = normalizePixivisionURL(nextURL)
  const page = Number(safeURL.match(/[?&]p(?:age)?=(\d+)/i)?.[1] ?? "2")
  const response = await apiGetPublicText(
    safeURL,
    PIXIVISION_ALLOWED_ORIGINS,
    "text/html, application/json, */*",
    {
      ...pixivisionHeaders(PIXIVISION_HOME_URL),
    }
  )
  let html = response
  try {
    const json = JSON.parse(response)
    html = typeof json?.body?.html === "string" ? json.body.html : response
  } catch {
    // 兼容服务端直接返回 HTML 的情况
  }
  return parsePixivisionPage(html, page)
}

export async function pixivisionByTag(
  tagOrId: string | number,
  page = 1,
  _accessToken?: string
): Promise<PixivPage<PixivisionArticle>> {
  const raw = String(tagOrId).trim()
  const queryKey = raw.includes("?name=") ? raw.split("?name=")[0] : raw
  const isNumericId = /^\d+$/.test(queryKey)
  const isCategory =
    queryKey.startsWith("c/") ||
    ["illustration", "manga", "cosplay", "special"].includes(queryKey.toLowerCase())
  const categorySlug = queryKey.startsWith("c/") ? queryKey.slice(2) : queryKey

  let url: string
  let referer: string
  if (isNumericId) {
    url = page <= 1
      ? `${PIXIVISION_ORIGIN}/zh/t/${queryKey}`
      : `${PIXIVISION_ORIGIN}/zh/t/${queryKey}?p=${page}`
    referer = `${PIXIVISION_ORIGIN}/zh/t/${queryKey}`
  } else if (isCategory) {
    url = page <= 1
      ? `${PIXIVISION_ORIGIN}/zh/c/${categorySlug}`
      : `${PIXIVISION_ORIGIN}/zh/c/${categorySlug}?p=${page}`
    referer = `${PIXIVISION_ORIGIN}/zh/c/${categorySlug}`
  } else {
    url = page <= 1
      ? `${PIXIVISION_ORIGIN}/zh/s/?q=${encodeURIComponent(queryKey)}`
      : `${PIXIVISION_ORIGIN}/zh/s/?q=${encodeURIComponent(queryKey)}&p=${page}`
    referer = `${PIXIVISION_ORIGIN}/zh/s/?q=${encodeURIComponent(queryKey)}`
  }

  try {
    const html = await apiGetPublicText(
      normalizePixivisionURL(url),
      PIXIVISION_ALLOWED_ORIGINS,
      "text/html",
      pixivisionHeaders(referer)
    )
    const parsed = parsePixivisionPage(html, page)
    return {
      items: parsed.items,
      nextURL:
        parsed.items.length >= PIXIVISION_PAGE_SIZE
          ? isNumericId
            ? `${PIXIVISION_ORIGIN}/zh/t/${queryKey}?p=${page + 1}`
            : isCategory
              ? `${PIXIVISION_ORIGIN}/zh/c/${categorySlug}?p=${page + 1}`
              : `${PIXIVISION_ORIGIN}/zh/s/?q=${encodeURIComponent(queryKey)}&p=${page + 1}`
          : null,
    }
  } catch (err: any) {
    if (err instanceof PixivError && err.status === 404) {
      return { items: [], nextURL: null }
    }
    throw err
  }
}

export async function pixivisionDetail(
  articleID: number,
  _accessToken?: string
): Promise<PixivisionDetail> {
  const url = `${PIXIVISION_ORIGIN}/zh/a/${articleID}`
  const html = await apiGetPublicText(
    normalizePixivisionURL(url),
    PIXIVISION_ALLOWED_ORIGINS,
    "text/html",
    pixivisionHeaders(PIXIVISION_HOME_URL)
  )
  return parsePixivisionDetailPage(html, articleID)
}

// 获取公开 Web 作品元数据（无需登录，快速获取确切真实物理宽高与大图地址）
export async function fetchPublicWebIllustDetail(id: number): Promise<PixivIllustration | null> {
  try {
    const url = `https://www.pixiv.net/ajax/illust/${id}`
    const json = await apiGetPublicJson<any>(
      url,
      ["https://www.pixiv.net", "https://pixiv.net"],
      {
        Referer: "https://www.pixiv.net/",
        "User-Agent": PIXIVISION_USER_AGENT,
      }
    )
    const b = json?.body
    if (!b || !b.width || !b.height) return null
    return {
      id,
      title: b.illustTitle || b.title || `作品 ${id}`,
      type: b.illustType === 2 ? "ugoira" : b.illustType === 1 ? "manga" : "illust",
      image_urls: {
        square_medium: b.urls?.thumb ?? b.urls?.small ?? "",
        medium: b.urls?.small ?? b.urls?.regular ?? "",
        large: b.urls?.regular ?? b.urls?.original ?? "",
      },
      caption: b.description ?? "",
      user: {
        id: Number(b.userId) || 0,
        name: b.userName || "",
        account: b.userAccount || "",
        profile_image_urls: {
          medium: b.profileImageUrl || "",
        },
        is_followed: false,
      },
      tags: Array.isArray(b.tags?.tags)
        ? b.tags.tags.map((t: any) => ({ name: t.tag, translated_name: t.translation?.en ?? null }))
        : [],
      create_date: b.createDate ?? "",
      page_count: b.pageCount ?? 1,
      width: Number(b.width) || 0,
      height: Number(b.height) || 0,
      x_restrict: b.xRestrict ?? 0,
      series: b.seriesNavData ? { id: b.seriesNavData.seriesId, title: b.seriesNavData.title } : null,
      meta_single_page: b.urls?.original ? { original_image_url: b.urls.original } : {},
      meta_pages: [],
      total_view: b.viewCount ?? 0,
      total_bookmarks: b.bookmarkCount ?? 0,
      is_bookmarked: false,
      is_muted: false,
      total_comments: b.commentCount ?? 0,
      illust_ai_type: b.aiType ?? 0,
      comment_access_control: 0,
    }
  } catch {
    return null
  }
}

function extractCardImageURL(card: string): string {
  const bgMatch = card.match(
    /background-image\s*:\s*url\(\s*['"]?(https?:\/\/[^'")\s]+)['"]?\s*\)/i
  )
  if (bgMatch?.[1]) return decodePixivisionEntities(bgMatch[1])
  const imgTag = card.match(/<img\b[^>]*>/i)?.[0] ?? ""
  if (imgTag) {
    const src =
      matchAttribute(imgTag, "src") ||
      matchAttribute(imgTag, "data-src") ||
      matchAttribute(imgTag, "data-original")
    if (src && !src.startsWith("data:")) return decodePixivisionEntities(src)
  }
  const pximgMatch = card.match(
    /https?:\/\/(?:i|s)\.pximg\.net\/[^\s"'<>]+\.(?:jpg|png|jpeg|webp)/i
  )
  if (pximgMatch?.[0]) return pximgMatch[0]
  return ""
}

function extractCardTags(card: string): PixivisionTag[] {
  const tags: PixivisionTag[] = []
  const seen = new Set<string>()
  const tagPattern =
    /<a\b[^>]*href=["'](?:\/zh\/t\/|https?:\/\/www\.pixivision\.net\/zh\/t\/)(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(card)) != null) {
    const id = Number(match[1])
    const tagText = pixivisionHTMLToText(match[2])
    if (tagText && !seen.has(tagText)) {
      seen.add(tagText)
      tags.push({
        id: Number.isFinite(id) ? id : undefined,
        name: tagText,
      })
    }
  }
  return tags
}

export function parsePixivisionPage(
  html: string,
  page = 1
): PixivPage<PixivisionArticle> {
  const items: PixivisionArticle[] = []
  const seenIDs = new Set<number>()

  // 1. 如果是首页，优先提取 Eyecatch 头条卡片（大图推荐）
  const eyecatchMatch = html.match(
    /<article\b[^>]*class=["'][^"']*_article-eyecatch-card[^"']*["'][^>]*>([\s\S]*?<\/article>)/i
  )
  if (eyecatchMatch) {
    const card = eyecatchMatch[1]
    const idText = card.match(/\/zh\/a\/(\d+)/i)?.[1]
    const imageURL = extractCardImageURL(card)
    const date = matchAttribute(card.match(/<time\b[^>]*>/i)?.[0] ?? "", "datetime")
    const titleHTML = card.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? ""
    const categoryHTML =
      card.match(
        /<span\b[^>]*class=["'][^"']*(?:thumbnail-label|_category-label)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
      )?.[1] ?? ""
    const tags = extractCardTags(card)
    if (idText && imageURL && date && titleHTML) {
      const id = Number(idText)
      if (Number.isFinite(id)) {
        seenIDs.add(id)
        items.push({
          id,
          title: pixivisionHTMLToText(titleHTML),
          imageURL,
          date,
          category: pixivisionHTMLToText(categoryHTML) || "特辑",
          tags: tags.length > 0 ? tags : undefined,
        })
      }
    }
  }

  // 2. 提取常规特辑卡片（兼容 li.article-card-container 及 article._article-card 等多端结构）
  const cardPattern =
    /<(?:li\s+class=["']article-card-container["']|article\s+class=["'][^"']*_article-card[^"']*)[^>]*>([\s\S]*?<\/article>)/gi
  let match: RegExpExecArray | null
  while ((match = cardPattern.exec(html)) != null) {
    const card = match[1]
    const idText = card.match(/\/zh\/a\/(\d+)/i)?.[1]
    const imageURL = extractCardImageURL(card)
    const date = matchAttribute(card.match(/<time\b[^>]*>/i)?.[0] ?? "", "datetime")
    const titleHTML = card.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? ""
    const categoryHTML =
      card.match(
        /<span\b[^>]*class=["'][^"']*(?:thumbnail-label|_category-label)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
      )?.[1] ?? ""
    const tags = extractCardTags(card)
    if (!idText || !imageURL || !date || !titleHTML) continue
    const id = Number(idText)
    if (!Number.isFinite(id) || seenIDs.has(id)) continue
    seenIDs.add(id)
    items.push({
      id,
      title: pixivisionHTMLToText(titleHTML),
      imageURL,
      date,
      category: pixivisionHTMLToText(categoryHTML) || "特辑",
      tags: tags.length > 0 ? tags : undefined,
    })
  }

  return {
    items,
    nextURL: items.length >= PIXIVISION_PAGE_SIZE ? buildPixivisionPageURL(page + 1) : null,
  }
}

export function parsePixivisionTagPage(
  html: string,
  tag: string,
  page = 1
): PixivPage<PixivisionArticle> {
  const result = parsePixivisionPage(html, page)
  return {
    items: result.items,
    nextURL: result.items.length >= PIXIVISION_PAGE_SIZE ? buildPixivisionTagPageURL(tag, page + 1) : null,
  }
}

function buildPixivisionPageURL(page: number): string {
  return `${PIXIVISION_ORIGIN}/zh/?p=${page}`
}

function buildPixivisionTagPageURL(tag: string, page: number): string {
  const isNumeric = /^\d+$/.test(tag)
  return isNumeric
    ? `${PIXIVISION_ORIGIN}/zh/t/${tag}?p=${page}`
    : `${PIXIVISION_ORIGIN}/zh/s/?q=${encodeURIComponent(tag)}&p=${page}`
}

export function parsePixivisionDetailPage(
  html: string,
  articleID: number
): PixivisionDetail {
  const title = pixivisionHTMLToText(
    html.match(/<h1\b[^>]*class=["'][^"']*(?:amsp__title|am__title)[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""
  )
  const date = matchAttribute(
    html.match(/<time\b[^>]*class=["'][^"']*[_ ]date[^"']*["'][^>]*>/i)?.[0] ?? "",
    "datetime"
  )
  const categoryMatch =
    html.match(/<span\b[^>]*class=["'][^"']*_category-label[^"']*["'][^>]*>[\s\S]*?href=["'](?:\/zh\/c\/|https?:\/\/www\.pixivision\.net\/zh\/c\/)([^"']+)["']/i) ||
    html.match(/<a\b[^>]*href=["'](?:\/zh\/c\/|https?:\/\/www\.pixivision\.net\/zh\/c\/)([^"']+)["']/i)
  const categorySlug = categoryMatch ? categoryMatch[1].trim() : undefined
  const category = pixivisionHTMLToText(
    html.match(/<span\b[^>]*class=["'][^"']*_category-label[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""
  )
  const mainCategorySlug = categorySlug || (category === "漫画" ? "manga" : "illustration")

  // 1. 解析编辑导语 (Lead text)
  const leadBlock = html.match(
    /<div\b[^>]*class=["'][^"']*(?:amsp__lead|_feature-article-body__lead|am__lead)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  )?.[1]
  const lead = leadBlock ? pixivisionHTMLToParagraphText(leadBlock) : undefined

  // 2. 解析正文描述
  const descriptionBlock =
    html.match(
      /<div\b[^>]*class=["'][^"']*(?:amsp__description-text|am__description-text)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    )?.[1] ??
    html.match(
      /<div\b[^>]*class=["'][^"']*(?:amsp__description|am__description)[^"']*["'][^>]*>([\s\S]*?)(?:<button|<\/div>)/i
    )?.[1] ??
    html.match(
      /<div\b[^>]*class=["'][^"']*(?:fab__paragraph|fabsp__paragraph)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    )?.[1] ??
    html.match(
      /<div\b[^>]*class=["'][^"']*_feature-article-body__paragraph[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*(?:article-item|_feature-article-body__pixiv_illust)|<\/article>)/i
    )?.[1] ??
    ""
  const description = pixivisionHTMLToParagraphText(descriptionBlock)

  // 3. 解析特辑真实标签（限定在头部标签容器或底部标签块内，防止误扫描相关推荐模块的标题外链）
  const tags: PixivisionTag[] = []
  const seenTagNames = new Set<string>()
  const tagContainerMatch =
    html.match(/<ul\b[^>]*class=["'][^"']*am__header-tags[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i) ||
    html.match(/<div\b[^>]*class=["'][^"']*am__tags[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<ul\b[^>]*class=["'][^"']*_tag-list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)

  const tagSource = tagContainerMatch ? tagContainerMatch[1] : ""
  if (tagSource) {
    const tagListPattern =
      /<a\b[^>]*href=["'](?:\/zh\/t\/|https?:\/\/www\.pixivision\.net\/zh\/t\/)(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
    let tagMatch: RegExpExecArray | null
    while ((tagMatch = tagListPattern.exec(tagSource)) != null) {
      const id = Number(tagMatch[1])
      const labelText = pixivisionHTMLToText(tagMatch[2])
      if (labelText && !seenTagNames.has(labelText)) {
        seenTagNames.add(labelText)
        tags.push({
          id: Number.isFinite(id) ? id : undefined,
          name: labelText,
        })
      }
    }
  }

  // 4. 解析正文插画
  const artworks: PixivisionArtwork[] = []
  const artworkPattern =
    /<div\b[^>]*class=["'][^"']*_feature-article-body__pixiv_illust[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*_feature-article-body__pixiv_illust|<div\b[^>]*class=["'][^"']*_feature-article-body__heading|<\/article>)/gi
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
    
    // 提取作者信息
    const authorIDText = block.match(/pixiv\.net\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/(\d+)/i)?.[1]
    const authorNameHTML = block.match(
      /<(?:a|span)\b[^>]*class=["'][^"']*(?:aiwsp__user-name|am__work__user-name)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|span)>/i
    )?.[1] ?? ""

    if (!idText || !imageURL) continue
    const id = Number(idText)
    if (!Number.isFinite(id) || artworks.some((item) => item.id === id)) continue

    const thumbURL = derivePixivThumbUrl(imageURL) ?? imageURL
    artworks.push({
      id,
      title: pixivisionHTMLToText(titleHTML) || `作品 ${id}`,
      imageURL,
      thumbURL,
      authorID: authorIDText ? Number(authorIDText) : undefined,
      authorName: authorNameHTML ? pixivisionHTMLToText(authorNameHTML) : undefined,
    })
  }

  // 5. 解析正文中内嵌特辑卡片
  const embeddedArticles: PixivisionArticle[] = []
  const embeddedPattern =
    /<div\b[^>]*class=["'][^"']*(?:_feature-article-body__article_card|_article-card-container|amsp__recommended-article)[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*(?:_feature-article-body__article_card|_article-card-container|amsp__recommended-article)|<div\b[^>]*class=["'][^"']*_feature-article-body__heading|<\/article>)/gi
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
    const itemDate = matchAttribute(
      block.match(/<time\b[^>]*>/i)?.[0] ?? "",
      "datetime"
    )
    const categoryHTML = block.match(
      /<span\b[^>]*class=["'][^"']*(?:arcsp__thumbnail-label|thumbnail-label|_category-label)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    )?.[1] ?? ""
    if (!idText || !imageURL || !titleHTML) continue
    const id = Number(idText)
    if (!Number.isFinite(id) || id === articleID || embeddedArticles.some((item) => item.id === id)) continue
    embeddedArticles.push({
      id,
      title: pixivisionHTMLToText(titleHTML),
      imageURL,
      date: itemDate,
      category: pixivisionHTMLToText(categoryHTML) || "特辑",
    })
  }

  // 6. 解析底部相关推荐分组 (Related Articles)
  const relatedSections: PixivisionRelatedSection[] = []
  const sectionBlockPattern =
    /<div\b[^>]*class=["'][^"']*(?:amsp__related-articles|_related-articles)[^"']*["'][^>]*data-gtm-category=["']([^"']*)["'][^>]*>([\s\S]*?)<\/ul>/gi
  let sectionMatch: RegExpExecArray | null
  while ((sectionMatch = sectionBlockPattern.exec(html)) != null) {
    const gtmCategory = sectionMatch[1] || ""

    const block = sectionMatch[2]
    const headingMatch =
      block.match(/<div\b[^>]*class=["'][^"']*__heading[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
      block.match(/<h[23]\b[^>]*class=["'][^"']*rla__heading[^"']*["'][^>]*>([\s\S]*?)<\/h[23]>/i) ||
      block.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)
    if (!headingMatch) continue

    const headingHTML = headingMatch[1]

    // 提取分类 slug（如 /zh/c/illustration）
    const sectionCatMatch =
      headingHTML.match(/href=["'](?:\/zh\/c\/|https?:\/\/www\.pixivision\.net\/zh\/c\/)([^"']+)["']/i) ||
      (!headingHTML.includes("/zh/t/") ? headingHTML.match(/data-gtm-label=["']([^"']+)["']/i) : null)
    const sectionCatSlug = sectionCatMatch ? sectionCatMatch[1].trim() : undefined

    // 提取关联标签 ID 与标签名
    const tagMatch =
      headingHTML.match(/href=["'](?:\/zh\/t\/|https?:\/\/www\.pixivision\.net\/zh\/t\/)(\d+)[^"']*["']/i) ||
      block.match(/class=["'][^"']*amsp__show-more-button[^"']*["'][^>]*href=["'](?:\/zh\/t\/|https?:\/\/www\.pixivision\.net\/zh\/t\/)(\d+)[^"']*["']/i)
    const tagId = tagMatch && Number.isFinite(Number(tagMatch[1])) ? Number(tagMatch[1]) : undefined

    const tagNameMatch =
      headingHTML.match(/class=["'][^"']*_article-heading-tag-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      (tagMatch ? headingHTML.match(/data-gtm-label=["']([^"']+)["']/i) : null)
    const tagName = tagNameMatch ? pixivisionHTMLToText(tagNameMatch[1]) : undefined

    // 格式化标签名称：在标签前增加 # 号（例如 "喜欢#点心的人也喜欢这些"、"#点心相关最新文章"）
    const headingHTMLWithHash = headingHTML.replace(
      /<span\b[^>]*class=["'][^"']*_article-heading-tag-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
      "#$1"
    )
    let sectionTitle = pixivisionHTMLToText(headingHTMLWithHash)
    if (tagName && sectionTitle.includes(tagName) && !sectionTitle.includes(`#${tagName}`)) {
      sectionTitle = sectionTitle.replace(tagName, `#${tagName}`)
    }
    if (!sectionTitle) continue

    const isLike = sectionTitle.includes("喜欢") || sectionTitle.includes("也喜欢")
    const isCategoryLatest =
      gtmCategory === "Article Latest" ||
      Boolean(sectionCatSlug) ||
      sectionTitle.includes("插画相关") ||
      sectionTitle.includes("漫画相关")

    let moreRoute: string | undefined
    if (isLike) {
      if (tagId != null && Number.isFinite(tagId)) {
        moreRoute = tagName
          ? `pixivision-tag:${tagId}?name=${encodeURIComponent(tagName)}`
          : `pixivision-tag:${tagId}`
      } else if (tagName) {
        moreRoute = `pixivision-tag:${encodeURIComponent(tagName)}`
      }
    } else if (isCategoryLatest) {
      const catSlug = sectionCatSlug || mainCategorySlug
      const catDisplayName = catSlug === "illustration" ? "插画" : catSlug === "manga" ? "漫画" : catSlug === "cosplay" ? "Cosplay" : catSlug
      moreRoute = `pixivision-tag:c/${catSlug}?name=${encodeURIComponent(catDisplayName)}`
    }

    const sectionArticles: PixivisionArticle[] = []
    const cardPattern =
      /<(?:article|li)\b[^>]*class=["'][^"']*(?:_article-related-card|arrct|article-card)[^"']*["'][^>]*>([\s\S]*?)(?:<\/(?:article|li)>|$)/gi
    let cardMatch: RegExpExecArray | null
    while ((cardMatch = cardPattern.exec(block)) != null) {
      const card = cardMatch[1]
      const idText = card.match(/\/zh\/a\/(\d+)/i)?.[1]
      if (!idText) continue
      const id = Number(idText)
      if (!Number.isFinite(id) || sectionArticles.some((a) => a.id === id)) {
        continue
      }

      const imageURL =
        matchAttribute(card.match(/<img\b[^>]*>/i)?.[0] ?? "", "src") ||
        matchAttribute(card.match(/<img\b[^>]*>/i)?.[0] ?? "", "data-src") ||
        extractCardImageURL(card)

      const titleHTML =
        card.match(/<h[234]\b[^>]*>([\s\S]*?)<\/h[234]>/i)?.[1] ||
        card.match(/class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i)?.[1] ||
        matchAttribute(card.match(/<img\b[^>]*>/i)?.[0] ?? "", "alt")

      const itemDate = matchAttribute(
        card.match(/<time\b[^>]*>/i)?.[0] ?? "",
        "datetime"
      )
      const categoryHTML = card.match(
        /<span\b[^>]*class=["'][^"']*(?:thumbnail-label|_category-label)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
      )?.[1]

      if (imageURL && titleHTML) {
        sectionArticles.push({
          id,
          title: pixivisionHTMLToText(titleHTML),
          imageURL,
          date: itemDate,
          category: categoryHTML ? pixivisionHTMLToText(categoryHTML) : "特辑",
        })
      }
    }

    if (sectionArticles.length > 0) {
      relatedSections.push({
        title: sectionTitle,
        articles: sectionArticles,
        tagId,
        tagName,
        moreRoute,
        isCategoryLatest,
        categorySlug: isCategoryLatest ? (sectionCatSlug || mainCategorySlug) : undefined,
      })
    }
  }

  if (!title || (artworks.length === 0 && embeddedArticles.length === 0)) {
    throw new PixivError(404, "特辑内容不完整或已下架")
  }
  return {
    id: articleID,
    title,
    date,
    category: category || "特辑",
    categorySlug: mainCategorySlug,
    lead: lead || undefined,
    description,
    tags,
    artworks,
    embeddedArticles,
    relatedSections: relatedSections.length > 0 ? relatedSections : undefined,
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
  return decodePixivisionEntities(value)
}

function decodePixivisionEntities(value: string): string {
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
    .replace(
      /&(amp|lt|gt|quot|#39|#x27|apos|nbsp|thinsp|ensp|emsp);/gi,
      (_match: string, name: string) => {
        const lower = name.toLowerCase()
        const entities: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          "#39": "'",
          "#x27": "'",
          apos: "'",
          nbsp: " ",
          thinsp: " ",
          ensp: " ",
          emsp: " ",
        }
        return entities[lower] ?? _match
      }
    )
}

function pixivisionHTMLToText(value: string): string {
  return decodePixivisionEntities(
    value
      .replace(/<br\s*\/?>(?:\r?\n)?/gi, " ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim()
}

function pixivisionHTMLToParagraphText(value: string): string {
  return decodePixivisionEntities(
    value
      .replace(/<button[\s\S]*?<\/button>/gi, "")
      .replace(/<br\s*\/?>(?:\r?\n)?/gi, "\n")
      .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
