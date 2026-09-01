import { apiGetPublicText, PixivError } from "./client"
import type {
  PixivPage,
  PixivisionArticle,
  PixivisionArtwork,
  PixivisionDetail,
  PixivisionTag,
} from "../types"

const PIXIVISION_HOME_URL = "https://www.pixivision.net/zh/"
const PIXIVISION_ORIGIN = "https://www.pixivision.net"
const PIXIVISION_ALLOWED_ORIGINS = ["https://www.pixivision.net", "https://pixivision.net"]
const PIXIVISION_PAGE_SIZE = 20
const PIXIVISION_AJAX_PATH = "/pixivisionsp/zh/ajax-api/index"
const PIXIVISION_TAG_AJAX_PATH = "/pixivisionsp/zh/ajax-api/tag"
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
  const page = Number(safeURL.match(/[?&]page=(\d+)/i)?.[1] ?? "2")
  const response = await apiGetPublicText(
    safeURL,
    PIXIVISION_ALLOWED_ORIGINS,
    "application/json, text/javascript, */*; q=0.01",
    {
      ...pixivisionHeaders(PIXIVISION_HOME_URL),
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
  return parsePixivisionPage(html, page)
}

export async function pixivisionByTag(
  tag: string,
  page = 1,
  _accessToken?: string
): Promise<PixivPage<PixivisionArticle>> {
  const tagUrl = `${PIXIVISION_ORIGIN}/zh/t/${encodeURIComponent(tag)}`
  if (page <= 1) {
    const html = await apiGetPublicText(
      tagUrl,
      PIXIVISION_ALLOWED_ORIGINS,
      "text/html",
      pixivisionHeaders(PIXIVISION_HOME_URL)
    )
    return parsePixivisionTagPage(html, tag, 1)
  }

  const ajaxUrl = `${PIXIVISION_ORIGIN}${PIXIVISION_TAG_AJAX_PATH}?tag=${encodeURIComponent(tag)}&page=${page}&per_page=${PIXIVISION_PAGE_SIZE}`
  const response = await apiGetPublicText(
    ajaxUrl,
    PIXIVISION_ALLOWED_ORIGINS,
    "application/json, text/javascript, */*; q=0.01",
    {
      ...pixivisionHeaders(tagUrl),
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
  return parsePixivisionTagPage(html, tag, page)
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

function extractCardTags(card: string): string[] {
  const tags: string[] = []
  const tagPattern = /<a\b[^>]*class=["'][^"']*(?:_tag-item|tag-label|arcsp__tag)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(card)) != null) {
    const tagText = pixivisionHTMLToText(match[1])
    if (tagText && !tags.includes(tagText)) {
      tags.push(tagText)
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
    nextURL: items.length > 0 ? buildPixivisionPageURL(page + 1) : null,
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
    nextURL: result.items.length > 0 ? buildPixivisionTagPageURL(tag, page + 1) : null,
  }
}

function buildPixivisionPageURL(page: number): string {
  return `${PIXIVISION_ORIGIN}${PIXIVISION_AJAX_PATH}?page=${page}&per_page=${PIXIVISION_PAGE_SIZE}`
}

function buildPixivisionTagPageURL(tag: string, page: number): string {
  return `${PIXIVISION_ORIGIN}${PIXIVISION_TAG_AJAX_PATH}?tag=${encodeURIComponent(tag)}&page=${page}&per_page=${PIXIVISION_PAGE_SIZE}`
}

function parseArtworkDimensions(url: string): { width?: number; height?: number } {
  // 匹配类似 /c/768x1200_80/ 或 /c/540x540_70/ 中的宽高
  const match = url.match(/\/c\/(\d+)x(\d+)(?:_\d+)?\//i)
  if (match) {
    const width = Number(match[1])
    const height = Number(match[2])
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height }
    }
  }
  return {}
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
  const category = pixivisionHTMLToText(
    html.match(/<span\b[^>]*class=["'][^"']*_category-label[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""
  )

  // 1. 解析编辑导语 (Lead text)
  const leadBlock = html.match(
    /<div\b[^>]*class=["'][^"']*(?:amsp__lead|_feature-article-body__lead|am__lead)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  )?.[1]
  const lead = leadBlock ? pixivisionHTMLToParagraphText(leadBlock) : undefined

  // 2. 解析正文描述
  const descriptionBlock = html.match(
    /<div\b[^>]*class=["'][^"']*amsp__description-text[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i
  )?.[1] ?? html.match(
    /<div\b[^>]*class=["'][^"']*_feature-article-body__paragraph[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*article-item|<\/article>)/i
  )?.[1] ?? ""
  const description = pixivisionHTMLToParagraphText(descriptionBlock)

  // 3. 解析特辑标签
  const tags: PixivisionTag[] = []
  const seenTagNames = new Set<string>()
  const tagListPattern = /<a\b[^>]*href=["'](?:\/zh\/t\/|https?:\/\/www\.pixivision\.net\/zh\/t\/)([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = tagListPattern.exec(html)) != null) {
    const rawName = decodeURIComponent(tagMatch[1].trim())
    const labelText = pixivisionHTMLToText(tagMatch[2]) || rawName
    if (labelText && !seenTagNames.has(labelText)) {
      seenTagNames.add(labelText)
      tags.push({ name: labelText })
    }
  }

  // 4. 解析正文插画
  const artworks: PixivisionArtwork[] = []
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
    
    // 提取作者信息
    const authorIDText = block.match(/pixiv\.net\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/(\d+)/i)?.[1]
    const authorNameHTML = block.match(
      /<(?:a|span)\b[^>]*class=["'][^"']*(?:aiwsp__user-name|am__work__user-name)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|span)>/i
    )?.[1] ?? ""

    if (!idText || !imageURL) continue
    const id = Number(idText)
    if (!Number.isFinite(id) || artworks.some((item) => item.id === id)) continue

    const dimensions = parseArtworkDimensions(imageURL)

    artworks.push({
      id,
      title: pixivisionHTMLToText(titleHTML) || `作品 ${id}`,
      imageURL,
      authorID: authorIDText ? Number(authorIDText) : undefined,
      authorName: authorNameHTML ? pixivisionHTMLToText(authorNameHTML) : undefined,
      width: dimensions.width,
      height: dimensions.height,
    })
  }

  // 5. 解析内嵌与推荐特辑
  const embeddedArticles: PixivisionArticle[] = []
  const embeddedPattern = /<div\b[^>]*class=["'][^"']*(?:_feature-article-body__article_card|_article-card-container|amsp__recommended-article)[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*(?:_feature-article-body__article_card|_article-card-container|amsp__recommended-article)|<div\b[^>]*class=["'][^"']*_feature-article-body__heading|<\/article>)/gi
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

  if (!title || (artworks.length === 0 && embeddedArticles.length === 0)) {
    throw new PixivError(404, "特辑内容不完整或已下架")
  }
  return {
    id: articleID,
    title,
    date,
    category: category || "特辑",
    lead: lead || undefined,
    description,
    tags,
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
      .replace(/<br\s*\/?>(?:\r?\n)?/gi, "\n")
      .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
