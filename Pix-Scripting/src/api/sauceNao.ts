import { fetch, FormData } from "scripting"
import { getSauceNaoApiKey, getSauceNaoApiKeys, recordSauceNaoQuota } from "../store/sauceNaoStore"

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
  extraInfo?: string
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
  } else if (typeof data.artist === "string" && data.artist.trim()) {
    authorName = data.artist.trim()
  } else if (typeof data.author === "string" && data.author.trim()) {
    authorName = data.author.trim()
  } else if (typeof data.circle === "string" && data.circle.trim()) {
    authorName = data.circle.trim()
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
 * 格式化候选标题（优先提取人类可读的书名、日文名、英文名、作品名等）
 */
export function extractTitleFromSauceNaoData(
  data: Record<string, any>,
  pixivId?: number,
  indexName?: string
): string {
  if (pixivId && typeof data.title === "string" && data.title.trim()) {
    return data.title.trim()
  }
  if (typeof data.jp_name === "string" && data.jp_name.trim()) {
    return data.jp_name.trim()
  }
  if (typeof data.eng_name === "string" && data.eng_name.trim()) {
    return data.eng_name.trim()
  }
  if (typeof data.source === "string" && data.source.trim() && !data.source.startsWith("http://") && !data.source.startsWith("https://") && !/^\d+$/.test(data.source.trim())) {
    return data.source.trim()
  }
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

/**
 * 提取附加元数据（如章节/页码、社团、角色、动画时间等）
 */
export function extractExtraInfoFromSauceNaoData(data: Record<string, any>): string | undefined {
  const parts: string[] = []
  if (data.part !== undefined && data.part !== null && String(data.part).trim()) {
    parts.push(`P${String(data.part).trim()}`)
  } else if (data.page !== undefined && data.page !== null && String(data.page).trim()) {
    parts.push(`P${String(data.page).trim()}`)
  }
  if (typeof data.episode === "string" && data.episode.trim()) {
    parts.push(`EP${data.episode.trim()}`)
  }
  if (typeof data.est_time === "string" && data.est_time.trim()) {
    parts.push(data.est_time.trim())
  }
  if (typeof data.circle === "string" && data.circle.trim()) {
    parts.push(data.circle.trim())
  }
  if (typeof data.characters === "string" && data.characters.trim()) {
    parts.push(data.characters.trim())
  } else if (Array.isArray(data.characters) && data.characters.length > 0) {
    parts.push(data.characters.slice(0, 2).join(", "))
  }
  return parts.length > 0 ? parts.join(" · ") : undefined
}

/**
 * 提取并补全各索引库的外链地址
 */
export function extractExtUrlsFromSauceNaoData(
  data: Record<string, any>,
  indexName?: string
): string[] {
  const urls: string[] = []
  if (Array.isArray(data.ext_urls)) {
    for (const u of data.ext_urls) {
      if (typeof u === "string" && u.trim() && !urls.includes(u.trim())) {
        urls.push(u.trim())
      }
    }
  }

  // 1. 从 source 字段提取合法 URL
  if (typeof data.source === "string" && data.source.trim()) {
    const s = data.source.trim()
    if (s.startsWith("http://") || s.startsWith("https://")) {
      if (!urls.includes(s)) urls.push(s)
    }
  }

  const idx = (indexName || "").toLowerCase()

  // 2. nhentai 索引库 (Index #18)
  const isNhentai = idx.includes("nhentai")
  const nhentaiId = data.nhentai_id || (isNhentai ? (data.id || data.gallery_id) : undefined)
  if (nhentaiId) {
    const u = `https://nhentai.net/g/${nhentaiId}/`
    if (!urls.includes(u)) urls.push(u)
  }

  // 3. E-Hentai / ExHentai (Index #38)
  const isEHentai = !isNhentai && (idx.includes("e-hentai") || idx.includes("exhentai") || idx.includes("e_hentai") || idx.includes("ehentai") || (idx.includes("hentai") && !idx.includes("nhentai")))
  const eHentaiGid = data.ehentai_id || data.gid || data.g_id || (isEHentai ? data.id : undefined)
  const eHentaiToken = data.token || data.gtoken
  if (eHentaiGid && eHentaiToken) {
    const u = `https://e-hentai.org/g/${eHentaiGid}/${eHentaiToken}/`
    if (!urls.includes(u)) urls.push(u)
  } else if (eHentaiGid && !urls.some((x) => x.includes("e-hentai.org") || x.includes("exhentai.org"))) {
    const u = `https://e-hentai.org/?f_search=${eHentaiGid}`
    if (!urls.includes(u)) urls.push(u)
  }

  // 4. Nico Nico Seiga (Index #8)
  const seigaId = data.seiga_id || (idx.includes("seiga") ? data.id : undefined)
  if (seigaId) {
    const u = `https://seiga.nicovideo.jp/watch/im${seigaId}`
    if (!urls.includes(u)) urls.push(u)
  }

  // 5. Nijie
  const nijieId = data.nijie_id || (idx.includes("nijie") ? data.id : undefined)
  if (nijieId) {
    const u = `https://nijie.info/view.php?id=${nijieId}`
    if (!urls.includes(u)) urls.push(u)
  }

  // 6. MangaDex (Index #37)
  const mdId = data.mangadex_id || data.md_id || (idx.includes("mangadex") ? data.id : undefined)
  if (mdId) {
    const u = `https://mangadex.org/chapter/${mdId}`
    if (!urls.includes(u)) urls.push(u)
  }

  // 7. Pawoo (Index #41)
  const pawooId = data.pawoo_id || (idx.includes("pawoo") ? data.id : undefined)
  const pawooUser = data.pawoo_user_username || data.pawoo_user_acct
  if (pawooId && pawooUser) {
    const u = `https://pawoo.net/@${pawooUser}/${pawooId}`
    if (!urls.includes(u)) urls.push(u)
  }

  // 8. Bcy (Index #31)
  const bcyId = data.bcy_id || (idx.includes("bcy") ? data.id : undefined)
  if (bcyId) {
    const u = `https://bcy.net/item/detail/${bcyId}`
    if (!urls.includes(u)) urls.push(u)
  }

  return urls
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

  const availableKeys = customApiKey ? [customApiKey.trim()] : getSauceNaoApiKeys()
  if (availableKeys.length === 0) {
    throw new Error("NEED_API_KEY")
  }

  let lastError: Error | null = null
  let response: any = null
  let usedKey = availableKeys[0]

  // 轮询尝试可用 Key，遇 429 或限流自动故障转移至下一个 Key
  for (let i = 0; i < availableKeys.length; i++) {
    const currentKey = availableKeys[i]
    usedKey = currentKey

    const queryParams = new URLSearchParams({
      output_type: "2",
      api_key: currentKey,
      db: "999",
      numres: "12",
    })
    const requestUrl = `https://saucenao.com/search.php?${queryParams.toString()}`

    const formData = new FormData()
    formData.append("file", jpegData, "image/jpeg", "search.jpg")

    try {
      const resp = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        },
        body: formData,
      })

      if (resp.status === 429) {
        // 当前 Key 每日额度耗尽，记录剩余 0 并尝试下一个 Key
        recordSauceNaoQuota(currentKey, 0, 100)
        lastError = new Error("SauceNAO 搜图请求频率超限（已用完该密钥每日额度）")
        continue
      }

      if (resp.status === 403) {
        lastError = new Error(`SauceNAO API Key (${currentKey.slice(0, 4)}...) 无效或未开通权限`)
        continue
      }

      if (!resp.ok) {
        lastError = new Error(`搜图服务异常 (HTTP ${resp.status})`)
        continue
      }

      response = resp
      break
    } catch (err: any) {
      lastError = err
    }
  }

  if (!response) {
    if (lastError?.message?.includes("超限") && availableKeys.length > 1) {
      throw new Error(`所有已配置的 SauceNAO 密钥 (${availableKeys.length} 个) 均已耗尽今日额度`)
    }
    throw lastError || new Error("搜图服务异常")
  }

  const rawJson = (await response.json()) as any
  const header = rawJson?.header ?? {}

  if (header.status !== 0 && header.status !== undefined) {
    if (header.message?.toLowerCase().includes("anonymous") || header.status === -1) {
      throw new Error("NEED_API_KEY")
    }
    throw new Error(header.message || `搜图失败 (错误代码 ${header.status})`)
  }

  // 记录并更新当前所用 Key 的实际剩余配额与总额度
  if (typeof header.long_remaining === "number") {
    const limit = typeof header.long_limit === "number" ? header.long_limit : 100
    recordSauceNaoQuota(usedKey, header.long_remaining, limit)
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
    const extraInfo = extractExtraInfoFromSauceNaoData(data)
    const extUrls: string[] = extractExtUrlsFromSauceNaoData(data, indexName)
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
      extraInfo,
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
