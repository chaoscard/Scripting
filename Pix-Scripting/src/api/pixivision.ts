import { apiGetPublicJson, apiGetPublicText, PixivError } from "./client"
import { derivePixivThumbUrl, recordPixivisionCoverUrl } from "../image/imageLoader"
import type {
  PixivIllustration,
  PixivPage,
  PixivisionArticle,
  PixivisionArtwork,
  PixivisionBodyBlock,
  PixivisionDetail,
  PixivisionProfile,
  PixivisionRelatedSection,
  PixivisionTag,
  PixivisionTocItem,
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

function parseArticleDimensions(imageURL: string): { width?: number; height?: number } {
  const match = imageURL.match(/\/c\/(\d+)x(\d+)/)
  if (match) {
    const w = Number(match[1])
    const h = Number(match[2])
    if (w > 0 && h > 0) return { width: w, height: h }
  }
  return {}
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
        const dims = parseArticleDimensions(imageURL)
        items.push({
          id,
          title: pixivisionHTMLToText(titleHTML),
          imageURL,
          thumbURL: derivePixivThumbUrl(imageURL) ?? imageURL,
          date,
          category: pixivisionHTMLToText(categoryHTML) || "特辑",
          tags: tags.length > 0 ? tags : undefined,
          width: dims.width,
          height: dims.height,
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
    const dims = parseArticleDimensions(imageURL)
    items.push({
      id,
      title: pixivisionHTMLToText(titleHTML),
      imageURL,
      thumbURL: derivePixivThumbUrl(imageURL) ?? imageURL,
      date,
      category: pixivisionHTMLToText(categoryHTML) || "特辑",
      tags: tags.length > 0 ? tags : undefined,
      width: dims.width,
      height: dims.height,
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

function isPixivSignupPromo(text: string): boolean {
  return /(?:注册\s*pixiv|立刻注册|免费注册|pixiv\s*アカウント|pixivに登録|sign\s*up)/i.test(text)
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
  const rawThumbnailURL =
    html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta\b[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<div\b[^>]*class=["'][^"']*(?:am__main-visual|amsp__main-visual|_main-visual)[^"']*["'][^>]*>[\s\S]*?<img\b[^>]*src=["']([^"']+)["']/i)?.[1]
  const thumbnailURL = rawThumbnailURL ? rawThumbnailURL.trim() : undefined
  if (thumbnailURL) {
    recordPixivisionCoverUrl(articleID, thumbnailURL)
  }
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

  // 4. 解析正文流式区块 (Body Blocks) 与目录 (Table of Contents)
  const blocks: PixivisionBodyBlock[] = []
  const tableOfContents: PixivisionTocItem[] = []
  const artworks: PixivisionArtwork[] = []
  const embeddedArticles: PixivisionArticle[] = []
  const seenArtworks = new Set<number>()
  const seenEmbeddedArticles = new Set<number>()

  // 4.1 界定正文主体范围（排除底部相关推荐、分享与页脚）
  const startBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*\b_feature-article-body\b(?![a-zA-Z0-9_-])/i)
  const startBodyIndex = startBodyMatch ? (startBodyMatch.index ?? -1) : -1

  let bodySlice = ""
  if (startBodyIndex !== -1) {
    const bottomMarkers = [
      /<div\b[^>]*class=["'][^"']*(?:amsp__related-articles|_related-articles|related-articles)/i,
      /<div\b[^>]*class=["'][^"']*(?:am__footer|amsp__footer)/i,
      /<div\b[^>]*class=["'][^"']*(?:_article-share|share-buttons)/i,
      /<footer\b/i,
    ]
    let endBodyIndex = html.length
    for (const marker of bottomMarkers) {
      const m = html.slice(startBodyIndex).match(marker)
      if (m && m.index != null && m.index > 0) {
        const absolutePos = startBodyIndex + m.index
        if (absolutePos < endBodyIndex) {
          endBodyIndex = absolutePos
        }
      }
    }
    bodySlice = html.slice(startBodyIndex, endBodyIndex)
  }

  // 4.2 扫描所有以 _feature-article-body__ 开头的区块
  if (bodySlice) {
    const blockPattern =
      /(<div\b[^>]*class=["'][^"']*_feature-article-body__([a-zA-Z0-9_]+)[^"']*["'][^>]*>[\s\S]*?)(?=<div\b[^>]*class=["'][^"']*_feature-article-body__|$)/gi
    let blockMatch: RegExpExecArray | null
    let pendingQuestion: string | null = null
    let inSignupPromoSection = false
    let currentArtwork: PixivisionArtwork | null = null

    while ((blockMatch = blockPattern.exec(bodySlice)) != null) {
      const rawBlock = blockMatch[1]
      const blockType = blockMatch[2]

      if (blockType === "table_of_contents") {
        const linkPattern = /<a\b[^>]*href=["']#([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
        let lMatch: RegExpExecArray | null
        while ((lMatch = linkPattern.exec(rawBlock)) != null) {
          const id = lMatch[1]
          const itemTitle = pixivisionHTMLToText(lMatch[2])
          if (id && itemTitle && !isPixivSignupPromo(itemTitle)) {
            tableOfContents.push({ id, title: itemTitle })
          }
        }
      } else if (blockType === "heading") {
        const idAttr = matchAttribute(rawBlock, "id")
        const headingText = pixivisionHTMLToText(
          rawBlock.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)?.[1] ?? rawBlock
        )
        if (isPixivSignupPromo(headingText)) {
          inSignupPromoSection = true
          continue
        } else {
          inSignupPromoSection = false
        }
        if (headingText) {
          currentArtwork = null
          blocks.push({
            type: "heading",
            id: idAttr || undefined,
            title: headingText,
            level: 1,
          })
        }
      } else {
        // 过滤官方在合辑末尾定点插入的引导注册 pixiv 的宣传广告块
        const isSignupPromoBlock =
          inSignupPromoSection ||
          rawBlock.includes("accounts.pixiv.net/signup") ||
          rawBlock.includes("article_parts__signup") ||
          (blockType === "image" && rawBlock.includes("798978602"))
        if (isSignupPromoBlock) {
          continue
        }

        if (blockType === "subheading") {
        const subText = pixivisionHTMLToText(
          rawBlock.match(/<h[34]\b[^>]*>([\s\S]*?)<\/h[34]>/i)?.[1] ?? rawBlock
        )
        if (subText) {
          blocks.push({
            type: "subheading",
            title: subText,
          })
        }
      } else if (blockType === "pixiv_illust") {
        const idText = rawBlock.match(/pixiv\.net\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artworks\/(\d+)/i)?.[1]
        const imageURL = matchAttribute(
          rawBlock.match(/(?:aiwsp__main|am__work__main)[\s\S]*?<img\b[^>]*>/i)?.[0] ?? "",
          "src"
        )
        const titleHTML = rawBlock.match(
          /<h[23]\b[^>]*class=["'][^"']*(?:aiwsp__title|am__work__title)[^"']*["'][^>]*>([\s\S]*?)<\/h[23]>/i
        )?.[1] ?? ""
        const authorIDText = rawBlock.match(/pixiv\.net\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/(\d+)/i)?.[1]
        const authorNameHTML = rawBlock.match(
          /<(?:a|span)\b[^>]*class=["'][^"']*(?:aiwsp__user-name|am__work__user-name)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|span)>/i
        )?.[1] ?? ""

        if (idText && imageURL) {
          const id = Number(idText)
          if (Number.isFinite(id)) {
            const thumbURL = derivePixivThumbUrl(imageURL) ?? imageURL
            const artwork: PixivisionArtwork = {
              id,
              title: pixivisionHTMLToText(titleHTML) || `作品 ${id}`,
              imageURL,
              thumbURL,
              authorID: authorIDText ? Number(authorIDText) : undefined,
              authorName: authorNameHTML ? pixivisionHTMLToText(authorNameHTML) : undefined,
            }
            if (!seenArtworks.has(id)) {
              seenArtworks.add(id)
              artworks.push(artwork)
            }
            currentArtwork = artwork
            blocks.push({
              type: "illust",
              artwork,
            })
          }
        }
      } else if (blockType === "article_card") {
        const idText = rawBlock.match(/href=["'](?:https?:\/\/www\.pixivision\.net)?\/zh\/a\/(\d+)["']/i)?.[1]
        const imageURL =
          matchAttribute(rawBlock.match(/<img\b[^>]*>/i)?.[0] ?? "", "src") ||
          matchBackgroundImageURL(rawBlock)
        const titleHTML =
          rawBlock.match(/class=["'][^"']*arcsp__title[^"']*["'][^>]*>[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ??
          rawBlock.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? ""
        const itemDate = matchAttribute(
          rawBlock.match(/<time\b[^>]*>/i)?.[0] ?? "",
          "datetime"
        )
        const categoryHTML = rawBlock.match(
          /<span\b[^>]*class=["'][^"']*(?:arcsp__thumbnail-label|thumbnail-label|_category-label)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
        )?.[1] ?? ""
        const cardTags = extractCardTags(rawBlock)

        if (idText && imageURL && titleHTML) {
          const id = Number(idText)
          if (Number.isFinite(id) && id !== articleID) {
            const dims = parseArticleDimensions(imageURL)
            const article: PixivisionArticle = {
              id,
              title: pixivisionHTMLToText(titleHTML),
              imageURL,
              thumbURL: derivePixivThumbUrl(imageURL) ?? imageURL,
              date: itemDate,
              category: pixivisionHTMLToText(categoryHTML) || "特辑",
              tags: cardTags.length > 0 ? cardTags : undefined,
              width: dims.width,
              height: dims.height,
            }
            if (!seenEmbeddedArticles.has(id)) {
              seenEmbeddedArticles.add(id)
              embeddedArticles.push(article)
            }
            blocks.push({
              type: "article_card",
              article,
            })
          }
        }
      } else if (blockType === "profile") {
        const nameText = pixivisionHTMLToText(
          rawBlock.match(/<div\b[^>]*class=["'][^"']*profile-name[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""
        )
        const avatarURL = matchAttribute(
          rawBlock.match(/<img\b[^>]*class=["'][^"']*profile-icon[^"']*["'][^>]*>/i)?.[0] ?? "",
          "src"
        )
        const descText = pixivisionHTMLToParagraphText(
          rawBlock.match(/<div\b[^>]*class=["'][^"']*profile-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""
        )
        const profileLinks: { title: string; url: string }[] = []
        const linkMatches = rawBlock.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
        for (const lm of linkMatches) {
          const lTitle = pixivisionHTMLToText(lm[2])
          const lUrl = lm[1]
          if (lTitle && lUrl) {
            profileLinks.push({ title: lTitle, url: lUrl })
          }
        }
        if (nameText || descText) {
          blocks.push({
            type: "profile",
            profile: {
              name: nameText || "创作者",
              avatarURL: avatarURL || undefined,
              description: descText,
              links: profileLinks.length > 0 ? profileLinks : undefined,
            },
          })
        }
      } else if (blockType === "question") {
        const qText = pixivisionHTMLToParagraphText(
          rawBlock.match(/<div\b[^>]*class=["'][^"']*question[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? rawBlock
        )
        if (qText) {
          pendingQuestion = qText
        }
      } else if (blockType === "answer") {
        const aText = pixivisionHTMLToParagraphText(
          rawBlock.match(/<div\b[^>]*class=["'][^"']*answer-text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? rawBlock
        )
        const avatarURL =
          matchBackgroundImageURL(rawBlock) ||
          matchAttribute(rawBlock.match(/<img\b[^>]*>/i)?.[0] ?? "", "src")
        if (aText) {
          if (pendingQuestion) {
            blocks.push({
              type: "qa",
              question: pendingQuestion,
              answer: aText,
              answerAvatarURL: avatarURL || undefined,
            })
            pendingQuestion = null
          } else {
            blocks.push({
              type: "paragraph",
              text: aText,
            })
          }
        }
      } else if (blockType === "quote") {
        const quoteBody = pixivisionHTMLToParagraphText(
          rawBlock.match(/<div\b[^>]*class=["'][^"']*fab__quote__body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""
        )
        const quoteSource = pixivisionHTMLToText(
          rawBlock.match(/<div\b[^>]*class=["'][^"']*fab__quote__source[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""
        )
        if (quoteBody) {
          blocks.push({
            type: "quote",
            text: quoteBody,
            source: quoteSource || undefined,
          })
        }
      } else if (blockType === "link") {
        const commentBody = pixivisionHTMLToParagraphText(
          rawBlock.match(/<div\b[^>]*class=["'][^"']*comment-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""
        )
        if (commentBody) {
          blocks.push({
            type: "comment",
            text: commentBody,
          })
        }
      } else if (blockType === "movie") {
        const videoSrc = matchAttribute(
          rawBlock.match(/<iframe\b[^>]*>/i)?.[0] ?? "",
          "src"
        )
        if (videoSrc) {
          blocks.push({
            type: "movie",
            videoURL: videoSrc,
          })
        }
      } else if (blockType === "image") {
        const src = matchAttribute(
          rawBlock.match(/<img\b[^>]*>/i)?.[0] ?? "",
          "src"
        )
        const caption = pixivisionHTMLToText(
          rawBlock.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? ""
        )
        const linkURL = matchAttribute(
          rawBlock.match(/<a\b[^>]*>/i)?.[0] ?? "",
          "href"
        )
        if (src) {
          const dims = parseArticleDimensions(src)
          const thumbURL = derivePixivThumbUrl(src) ?? src

          let associatedArtworkID: number | undefined
          let galleryPageIndex: number | undefined

          // 若处于某个特定作品段落内且非外链 Banner，将该图片归为该作品的独家草稿/过程图
          if (currentArtwork && !linkURL) {
            currentArtwork.draftImages = currentArtwork.draftImages || []
            currentArtwork.draftImages.push({
              imageURL: src,
              thumbURL,
              width: dims.width,
              height: dims.height,
              caption: caption || undefined,
            })
            associatedArtworkID = currentArtwork.id
            galleryPageIndex = currentArtwork.draftImages.length // 1-based index（0 为原作品）
          }

          blocks.push({
            type: "image",
            src,
            thumbURL,
            caption: caption || undefined,
            width: dims.width,
            height: dims.height,
            linkURL: linkURL || undefined,
            associatedArtworkID,
            galleryPageIndex,
          })
        }
      } else if (blockType === "caption") {
        const capText = pixivisionHTMLToText(rawBlock)
        if (capText) {
          blocks.push({
            type: "caption",
            text: capText,
          })
        }
      } else if (blockType === "credit") {
        const creditText = pixivisionHTMLToText(rawBlock)
        if (creditText) {
          blocks.push({
            type: "credit",
            text: creditText,
          })
        }
      } else if (blockType === "paragraph") {
        const pText = pixivisionHTMLToParagraphText(rawBlock)
        if (pText && !isPixivSignupPromo(pText)) {
          blocks.push({
            type: "paragraph",
            text: pText,
          })
        }
      }
      }
    }

    if (pendingQuestion) {
      blocks.push({
        type: "paragraph",
        text: pendingQuestion,
      })
      pendingQuestion = null
    }
  }

  // 4.3 降级兼容：极少数极老旧特辑若未解析出 blocks，使用正则表达式直接扫描
  if (blocks.length === 0 && artworks.length === 0) {
    const fallbackArtworkPattern =
      /<div\b[^>]*class=["'][^"']*_feature-article-body__pixiv_illust[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*_feature-article-body__pixiv_illust|<div\b[^>]*class=["'][^"']*_feature-article-body__heading|<\/article>)/gi
    let fallbackArtMatch: RegExpExecArray | null
    while ((fallbackArtMatch = fallbackArtworkPattern.exec(html)) != null) {
      const block = fallbackArtMatch[1]
      const idText = block.match(/pixiv\.net\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artworks\/(\d+)/i)?.[1]
      const imageURL = matchAttribute(
        block.match(/(?:aiwsp__main|am__work__main)[\s\S]*?<img\b[^>]*>/i)?.[0] ?? "",
        "src"
      )
      const titleHTML = block.match(
        /<h[23]\b[^>]*class=["'][^"']*(?:aiwsp__title|am__work__title)[^"']*["'][^>]*>([\s\S]*?)<\/h[23]>/i
      )?.[1] ?? ""
      const authorIDText = block.match(/pixiv\.net\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/(\d+)/i)?.[1]
      const authorNameHTML = block.match(
        /<(?:a|span)\b[^>]*class=["'][^"']*(?:aiwsp__user-name|am__work__user-name)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|span)>/i
      )?.[1] ?? ""

      if (!idText || !imageURL) continue
      const id = Number(idText)
      if (!Number.isFinite(id) || artworks.some((item) => item.id === id)) continue

      const thumbURL = derivePixivThumbUrl(imageURL) ?? imageURL
      const artwork: PixivisionArtwork = {
        id,
        title: pixivisionHTMLToText(titleHTML) || `作品 ${id}`,
        imageURL,
        thumbURL,
        authorID: authorIDText ? Number(authorIDText) : undefined,
        authorName: authorNameHTML ? pixivisionHTMLToText(authorNameHTML) : undefined,
      }
      artworks.push(artwork)
      blocks.push({ type: "illust", artwork })
    }
  }

  // 5. 解析底部相关推荐分组 (Related Articles)
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
        const dims = parseArticleDimensions(imageURL)
        sectionArticles.push({
          id,
          title: pixivisionHTMLToText(titleHTML),
          imageURL,
          thumbURL: derivePixivThumbUrl(imageURL) ?? imageURL,
          date: itemDate,
          category: categoryHTML ? pixivisionHTMLToText(categoryHTML) : "特辑",
          width: dims.width,
          height: dims.height,
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

  if (!title || (artworks.length === 0 && embeddedArticles.length === 0 && blocks.length === 0)) {
    throw new PixivError(404, "特辑内容不完整或已下架")
  }
  return {
    id: articleID,
    title,
    date,
    category: category || "特辑",
    categorySlug: mainCategorySlug,
    thumbnailURL,
    lead: lead || undefined,
    description,
    tags,
    artworks,
    embeddedArticles,
    relatedSections: relatedSections.length > 0 ? relatedSections : undefined,
    tableOfContents: tableOfContents.length > 0 ? tableOfContents : undefined,
    blocks: blocks.length > 0 ? blocks : undefined,
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
  const stripped = value
    .replace(/<button[\s\S]*?<\/button>/gi, "")
    .replace(/<br\s*\/?>(?:\r?\n)?/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
    .replace(/<(?!(\/?a\b))[^>]+>/gi, "")
    .replace(/<a\b[^>]*>\s*<\/a>/gi, "")
  return decodePixivisionEntities(stripped)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
