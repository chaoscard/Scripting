import { fetch, FormData } from "scripting"
import { getSauceNaoApiKey } from "../store/sauceNaoStore"

declare const UIImage: any
declare const Data: any

export interface SauceNAOMatch {
  similarity: number
  thumbnailUrl: string
  title: string
  pixivId?: number
  authorName?: string
  authorId?: number
  authorUrl?: string
  indexName?: string
  extUrls: string[]
  isPixiv: boolean
}

export interface SauceNAOResponse {
  header: {
    status: number
    results_returned: number
    short_remaining?: number
    long_remaining?: number
    message?: string
  }
  results: SauceNAOMatch[]
}

/**
 * 深度解析与提取 Pixiv 作品 ID
 * 覆盖：pixiv_id、illust_id、source (Pixiv URL/pximg/纯数字)、ext_urls 多源复合结构
 */
export function extractPixivIdFromSauceNaoData(data: Record<string, any>): number | undefined {
  if (typeof data.pixiv_id === "number" && data.pixiv_id > 0) return data.pixiv_id
  if (typeof data.pixiv_id === "string" && /^\d+$/.test(data.pixiv_id)) return parseInt(data.pixiv_id, 10)
  if (typeof data.illust_id === "number" && data.illust_id > 0) return data.illust_id
  if (typeof data.illust_id === "string" && /^\d+$/.test(data.illust_id)) return parseInt(data.illust_id, 10)

  const candidates: string[] = []
  if (typeof data.source === "string" && data.source.trim()) candidates.push(data.source.trim())
  if (Array.isArray(data.ext_urls)) {
    for (const u of data.ext_urls) {
      if (typeof u === "string" && u.trim()) candidates.push(u.trim())
    }
  }

  for (const text of candidates) {
    // 1. 标准 Pixiv 链接与简写：artworks/123456, illust_id=123456, /i/123456
    const m1 = text.match(/(?:artworks\/|illust_id=|\/i\/)(\d+)/i)
    if (m1) return parseInt(m1[1], 10)
    // 2. Pixiv 静态图床原始链接：pximg.net/.../123456_p0.jpg
    const m2 = text.match(/pximg\.net\/.+?\/(\d+)(?:_[a-z0-9]+|\.[a-z0-9]+)/i)
    if (m2) return parseInt(m2[1], 10)
    // 3. 纯数字 ID
    const m3 = text.match(/^(\d{6,12})$/)
    if (m3) return parseInt(m3[1], 10)
  }

  return undefined
}

/**
 * 异步穿透查询 Booru 图库（Danbooru / Gelbooru / Yande.re 等）以溯源原画 Pixiv ID 及 Pixiv 画师 UID
 */
export async function resolveBooruPixivId(data: Record<string, any>): Promise<{
  pixivId?: number
  authorId?: number
  authorName?: string
  authorUrl?: string
}> {
  // 1. Danbooru 溯源 (官方公开高速 JSON API)
  const danbooruId =
    data.danbooru_id ||
    (Array.isArray(data.ext_urls) && data.ext_urls[0]?.match(/danbooru\.donmai\.us\/posts\/(\d+)/)?.[1])

  if (danbooruId) {
    try {
      const resp = await fetch(`https://danbooru.donmai.us/posts/${danbooruId}.json`, {
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
      })
      if (resp.ok) {
        const post = (await resp.json()) as any
        let pixivId: number | undefined = undefined
        if (typeof post?.pixiv_id === "number" && post.pixiv_id > 0) {
          pixivId = post.pixiv_id
        } else if (typeof post?.source === "string") {
          const m = post.source.match(/(?:artworks\/|illust_id=|\/i\/|pximg\.net\/.+?\/)(\d+)/i)
          if (m) pixivId = parseInt(m[1], 10)
        }
        const authorName = post?.tag_string_artist || undefined
        let authorId: number | undefined = undefined
        let authorUrl: string | undefined = undefined

        // 若艺术家存在，查询 Danbooru artist_urls 快速获取其关联的 Pixiv 主页 ID
        if (authorName) {
          try {
            const artResp = await fetch(
              `https://danbooru.donmai.us/artists.json?search[name]=${encodeURIComponent(authorName)}`,
              { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" } }
            )
            if (artResp.ok) {
              const artList = (await artResp.json()) as any[]
              const artId = artList?.[0]?.id
              if (artId) {
                const urlResp = await fetch(
                  `https://danbooru.donmai.us/artist_urls.json?search[artist_id]=${artId}`,
                  { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" } }
                )
                if (urlResp.ok) {
                  const urlList = (await urlResp.json()) as any[]
                  for (const item of urlList) {
                    const m = item?.url?.match(/(?:pixiv\.net\/(?:[a-z]{2}\/)?users\/|member\.php\?id=)(\d+)/i)
                    if (m) {
                      authorId = parseInt(m[1], 10)
                      break
                    }
                  }
                }
              }
            }
          } catch {}

          if (!authorId) {
            authorUrl = `https://danbooru.donmai.us/posts?tags=${encodeURIComponent(authorName)}`
          }
        }

        return { pixivId, authorId, authorName, authorUrl }
      }
    } catch {}
  }

  // 2. Gelbooru 溯源
  const gelbooruId =
    data.gelbooru_id ||
    (Array.isArray(data.ext_urls) && data.ext_urls[0]?.match(/gelbooru\.com\/.*id=(\d+)/)?.[1])

  if (gelbooruId) {
    try {
      const resp = await fetch(
        `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&id=${gelbooruId}`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
        }
      )
      if (resp.ok) {
        const postData = (await resp.json()) as any
        const post = postData?.post?.[0]
        const source = post?.source
        let pixivId: number | undefined = undefined
        if (typeof source === "string") {
          const m = source.match(/(?:artworks\/|illust_id=|\/i\/|pximg\.net\/.+?\/)(\d+)/i)
          if (m) pixivId = parseInt(m[1], 10)
        }
        return { pixivId }
      }
    } catch {}
  }

  // 3. Yande.re 溯源
  const yandereId =
    data.yandere_id ||
    (Array.isArray(data.ext_urls) && data.ext_urls[0]?.match(/yande\.re\/post\/show\/(\d+)/)?.[1])

  if (yandereId) {
    try {
      const resp = await fetch(`https://yande.re/post.json?tags=id:${yandereId}`, {
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
      })
      if (resp.ok) {
        const postData = (await resp.json()) as any
        const post = postData?.[0]
        const source = post?.source
        let pixivId: number | undefined = undefined
        if (typeof source === "string") {
          const m = source.match(/(?:artworks\/|illust_id=|\/i\/|pximg\.net\/.+?\/)(\d+)/i)
          if (m) pixivId = parseInt(m[1], 10)
        }
        return { pixivId }
      }
    } catch {}
  }

  return {}
}

/**
 * 深度解析创作者信息（支持 Pixiv、Danbooru、Gelbooru、Twitter、DeviantArt 等多图库结构）
 */
export function extractAuthorInfoFromSauceNaoData(
  data: Record<string, any>,
  indexName?: string
): {
  authorId?: number
  authorName?: string
  authorUrl?: string
} {
  let authorId: number | undefined = undefined
  if (typeof data.member_id === "number" && data.member_id > 0) {
    authorId = data.member_id
  } else if (typeof data.member_id === "string" && /^\d+$/.test(data.member_id)) {
    authorId = parseInt(data.member_id, 10)
  } else if (typeof data.author_id === "number" && data.author_id > 0) {
    authorId = data.author_id
  } else if (typeof data.author_id === "string" && /^\d+$/.test(data.author_id)) {
    authorId = parseInt(data.author_id, 10)
  } else if (typeof data.user_id === "number" && data.user_id > 0) {
    authorId = data.user_id
  } else if (typeof data.user_id === "string" && /^\d+$/.test(data.user_id)) {
    authorId = parseInt(data.user_id, 10)
  }

  // 从 source / ext_urls / author_url 提取 authorId: pixiv.net/users/123456 或 member.php?id=123456
  if (!authorId) {
    const candidates: string[] = []
    if (typeof data.source === "string" && data.source.trim()) candidates.push(data.source.trim())
    if (typeof data.author_url === "string" && data.author_url.trim()) candidates.push(data.author_url.trim())
    if (typeof data.user_url === "string" && data.user_url.trim()) candidates.push(data.user_url.trim())
    if (typeof data.creator_url === "string" && data.creator_url.trim()) candidates.push(data.creator_url.trim())
    if (Array.isArray(data.ext_urls)) {
      for (const u of data.ext_urls) {
        if (typeof u === "string" && u.trim()) candidates.push(u.trim())
      }
    }
    for (const text of candidates) {
      const m = text.match(/(?:pixiv\.net\/(?:[a-z]{2}\/)?users\/|member\.php\?id=)(\d+)/i)
      if (m) {
        authorId = parseInt(m[1], 10)
        break
      }
    }
  }

  let authorName: string | undefined = undefined
  if (typeof data.member_name === "string" && data.member_name.trim()) {
    authorName = data.member_name.trim()
  } else if (typeof data.author_name === "string" && data.author_name.trim()) {
    authorName = data.author_name.trim()
  } else if (typeof data.artist_name === "string" && data.artist_name.trim()) {
    authorName = data.artist_name.trim()
  } else if (typeof data.creator === "string" && data.creator.trim()) {
    authorName = data.creator.trim()
  } else if (Array.isArray(data.creator) && data.creator.length > 0) {
    authorName = data.creator.filter((c: any) => typeof c === "string" && c.trim()).join(", ")
  } else if (typeof data.twitter_user_name === "string" && data.twitter_user_name.trim()) {
    authorName = data.twitter_user_name.trim()
  } else if (typeof data.twitter_user_handle === "string" && data.twitter_user_handle.trim()) {
    authorName = `@${data.twitter_user_handle.trim()}`
  }

  let authorUrl: string | undefined = undefined
  if (typeof data.author_url === "string" && data.author_url.trim()) {
    authorUrl = data.author_url.trim()
  } else if (typeof data.user_url === "string" && data.user_url.trim()) {
    authorUrl = data.user_url.trim()
  } else if (typeof data.creator_url === "string" && data.creator_url.trim()) {
    authorUrl = data.creator_url.trim()
  } else if (authorId) {
    authorUrl = `https://www.pixiv.net/users/${authorId}`
  } else if (typeof data.twitter_user_handle === "string" && data.twitter_user_handle.trim()) {
    authorUrl = `https://x.com/${data.twitter_user_handle.trim()}`
  } else if (authorName) {
    const idx = (indexName || "").toLowerCase()
    if (idx.includes("danbooru")) {
      authorUrl = `https://danbooru.donmai.us/posts?tags=${encodeURIComponent(authorName)}`
    } else if (idx.includes("gelbooru")) {
      authorUrl = `https://gelbooru.com/index.php?page=post&s=list&tags=${encodeURIComponent(authorName)}`
    } else if (idx.includes("yande.re")) {
      authorUrl = `https://yande.re/post?tags=${encodeURIComponent(authorName)}`
    } else if (idx.includes("artstation")) {
      authorUrl = `https://www.artstation.com/${encodeURIComponent(authorName)}`
    } else if (idx.includes("deviantart")) {
      authorUrl = `https://www.deviantart.com/${encodeURIComponent(authorName)}`
    }
  }

  return { authorId, authorName, authorUrl }
}

/**
 * 格式化候选标题
 */
export function extractTitleFromSauceNaoData(
  data: Record<string, any>,
  pixivId?: number,
  indexName?: string
): string {
  if (typeof data.title === "string" && data.title.trim()) {
    return data.title.trim()
  }
  if (pixivId) {
    return `Pixiv #${pixivId}`
  }
  if (typeof data.characters === "string" && data.characters.trim()) {
    return data.characters.trim()
  }
  if (Array.isArray(data.characters) && data.characters.length > 0) {
    return data.characters.join(", ")
  }
  if (typeof data.material === "string" && data.material.trim()) {
    return data.material.trim()
  }
  return indexName || "未知来源"
}

export async function searchImageBySauceNAO(
  image: any,
  customApiKey?: string
): Promise<SauceNAOResponse> {
  if (!image) {
    throw new Error("未提供有效图片")
  }

  // 1. 本地轻量预处理与缩放（最长边压到 800px，兼顾清晰度与上传性能）
  let prepared = image
  try {
    const maxSide = Math.max(image.width || 0, image.height || 0)
    if (maxSide > 800) {
      const scale = 800 / maxSide
      const targetW = Math.round((image.width || 800) * scale)
      const targetH = Math.round((image.height || 800) * scale)
      const thumb = image.preparingThumbnail({ width: targetW, height: targetH })
      if (thumb) prepared = thumb
    }
  } catch {
    // 缩放异常时使用原始图片
  }

  let jpegData: any = null
  if (typeof prepared.toJPEGData === "function") {
    jpegData = prepared.toJPEGData(0.8)
  }
  if (!jpegData && typeof Data !== "undefined" && typeof Data.fromJPEG === "function") {
    jpegData = Data.fromJPEG(prepared, 0.8)
  }
  if (!jpegData) {
    throw new Error("图片转码 JPEG 失败")
  }

  const apiKey = (customApiKey !== undefined ? customApiKey : getSauceNaoApiKey()).trim()
  if (!apiKey) {
    throw new Error("NEED_API_KEY")
  }

  // SauceNAO 官方 API 要求将控制参数置于 URL Query，二进制图片置于 multipart body
  const queryParams = new URLSearchParams({
    output_type: "2",
    api_key: apiKey,
    db: "999",
    numres: "12",
  })
  const requestUrl = `https://saucenao.com/search.php?${queryParams.toString()}`

  const formData = new FormData()
  formData.append("file", jpegData, "image/jpeg", "search.jpg")

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    },
    body: formData,
  })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("SauceNAO 搜图请求频率超限，请稍后重试（免费个人 Key 每日限额 100 次）")
    }
    if (response.status === 403) {
      throw new Error("SauceNAO API Key 无效或未开通 API 权限，请在右上角 ⚙️ 中检查密钥")
    }
    throw new Error(`搜图服务异常 (HTTP ${response.status})`)
  }

  const rawJson = (await response.json()) as any
  const header = rawJson?.header ?? {}

  if (header.status !== 0 && header.status !== undefined) {
    if (header.message?.toLowerCase().includes("anonymous") || header.status === -1) {
      throw new Error("NEED_API_KEY")
    }
    throw new Error(header.message || `搜图失败 (错误代码 ${header.status})`)
  }

  const rawResults = Array.isArray(rawJson?.results) ? rawJson.results : []
  const matches: SauceNAOMatch[] = []

  for (const item of rawResults) {
    const sim = parseFloat(item?.header?.similarity || "0")
    const thumb = item?.header?.thumbnail || ""
    const indexName = item?.header?.index_name || ""
    const data = item?.data || {}

    const pixivId = extractPixivIdFromSauceNaoData(data)
    const { authorId, authorName, authorUrl } = extractAuthorInfoFromSauceNaoData(data, indexName)
    const title = extractTitleFromSauceNaoData(data, pixivId, indexName)
    const extUrls: string[] = Array.isArray(data.ext_urls)
      ? data.ext_urls.filter((u: any) => typeof u === "string")
      : []
    const isPixiv = Boolean(pixivId) || indexName.toLowerCase().includes("pixiv")

    matches.push({
      similarity: sim,
      thumbnailUrl: thumb,
      title,
      pixivId,
      authorName,
      authorId,
      authorUrl,
      indexName,
      extUrls,
      isPixiv,
    })
  }

  // 异步并发补充溯源 Booru 库的 Pixiv 作品 ID 与创作者 Pixiv UID
  await Promise.allSettled(
    matches.map(async (m, idx) => {
      const rawData = rawResults[idx]?.data || {}
      const res = await resolveBooruPixivId(rawData)
      if (res.pixivId && !m.pixivId) {
        m.pixivId = res.pixivId
        m.isPixiv = true
        if (m.title === "未知来源" || m.title.startsWith("Index #")) {
          m.title = `Pixiv #${res.pixivId}`
        }
      }
      if (res.authorId && !m.authorId) {
        m.authorId = res.authorId
      }
      if (res.authorName && !m.authorName) {
        m.authorName = res.authorName
      }
      if (res.authorUrl && !m.authorUrl) {
        m.authorUrl = res.authorUrl
      }
    })
  )

  // 按相似度降序排列
  matches.sort((a, b) => b.similarity - a.similarity)

  return {
    header: {
      status: header.status ?? 0,
      results_returned: matches.length,
      short_remaining: header.short_remaining,
      long_remaining: header.long_remaining,
      message: header.message,
    },
    results: matches,
  }
}
