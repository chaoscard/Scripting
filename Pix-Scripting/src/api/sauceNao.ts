import { fetch, FormData } from "scripting"
import { loadSettings } from "../store/settings"

declare const UIImage: any
declare const Data: any

export interface SauceNAOMatch {
  similarity: number
  thumbnailUrl: string
  title: string
  pixivId?: number
  authorName?: string
  authorId?: number
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

export async function searchImageBySauceNAO(
  image: any,
  customApiKey?: string
): Promise<SauceNAOResponse> {
  if (!image) {
    throw new Error("未提供有效图片")
  }

  // 1. 本地轻量预处理与缩放（避免超大图片上传超时或超出接口大小限制，最长边压到 800px）
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

  const jpegData = prepared.toJPEGData(0.8)
  if (!jpegData) {
    throw new Error("图片转码 JPEG 失败")
  }

  const apiKey = customApiKey || loadSettings().sauceNaoApiKey || ""

  const formData = new FormData()
  formData.append("output_type", "2")
  formData.append("numres", "12")
  formData.append("db", "999")
  if (apiKey.trim()) {
    formData.append("api_key", apiKey.trim())
  }
  formData.append("file", jpegData, "search.jpg")

  const response = await fetch("https://saucenao.com/search.php", {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("SauceNAO 搜图请求频率超限，请稍后重试或在设置中填入 API Key")
    }
    if (response.status === 403) {
      throw new Error("SauceNAO API Key 无效或权限不足")
    }
    throw new Error(`搜图服务异常 (HTTP ${response.status})`)
  }

  const rawJson = (await response.json()) as any
  const header = rawJson?.header ?? {}

  if (header.status !== 0 && header.status !== undefined) {
    throw new Error(header.message || `搜图失败 (错误代码 ${header.status})`)
  }

  const rawResults = Array.isArray(rawJson?.results) ? rawJson.results : []
  const matches: SauceNAOMatch[] = []

  for (const item of rawResults) {
    const sim = parseFloat(item?.header?.similarity || "0")
    const thumb = item?.header?.thumbnail || ""
    const indexName = item?.header?.index_name || ""
    const data = item?.data || {}

    let pixivId: number | undefined = undefined
    if (typeof data.pixiv_id === "number" && data.pixiv_id > 0) {
      pixivId = data.pixiv_id
    } else if (typeof data.pixiv_id === "string" && /^\d+$/.test(data.pixiv_id)) {
      pixivId = parseInt(data.pixiv_id, 10)
    }

    // 从 ext_urls 中提取 pixiv artworks ID
    const extUrls: string[] = Array.isArray(data.ext_urls) ? data.ext_urls : []
    if (!pixivId) {
      for (const u of extUrls) {
        const m = u.match(/artworks\/(\d+)/) || u.match(/illust_id=(\d+)/)
        if (m) {
          pixivId = parseInt(m[1], 10)
          break
        }
      }
    }

    let authorId: number | undefined = undefined
    if (typeof data.member_id === "number" && data.member_id > 0) {
      authorId = data.member_id
    } else if (typeof data.member_id === "string" && /^\d+$/.test(data.member_id)) {
      authorId = parseInt(data.member_id, 10)
    }

    const title = data.title || (pixivId ? `Pixiv #${pixivId}` : indexName || "未知来源")
    const authorName = data.member_name || data.author_name || undefined
    const isPixiv = Boolean(pixivId) || indexName.toLowerCase().includes("pixiv")

    matches.push({
      similarity: sim,
      thumbnailUrl: thumb,
      title,
      pixivId,
      authorName,
      authorId,
      indexName,
      extUrls,
      isPixiv,
    })
  }

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
