import { Device } from "scripting"
import { requestPixivRoute } from "../routeNavigation"

export const CORNER_ICON_SIZE = 26

export function formatNumber(n: number | null | undefined): string {
  const value = n ?? 0
  if (value >= 10000) {
    const wan = value / 10000
    return `${wan % 1 === 0 ? wan : wan.toFixed(1)}万`
  }
  if (value >= 1000) {
    const k = value / 1000
    return `${k % 1 === 0 ? k : k.toFixed(1)}k`
  }
  return String(value)
}

// HTML 实体映射（一次性解码，避免 &amp;lt; 被二次解码成 <）
const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  hearts: "♥",
}

export function decodeHtmlEntities(text: string): string {
  if (!text || !text.includes("&")) return text || ""
  return text
    // 1. 十六进制数字实体 &#x2C; / &#X2c;
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (match, hex) => {
      const code = parseInt(hex, 16)
      if (!isNaN(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return match
    })
    // 2. 十进制数字实体 &#44; / &#39; / &#12304; 等
    .replace(/&#(\d+);/g, (match, num) => {
      const code = parseInt(num, 10)
      if (!isNaN(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return match
    })
    // 3. 命名实体 &amp; / &quot; 等
    .replace(/&([a-zA-Z]+);/g, (match, name) => {
      return HTML_ENTITIES[name.toLowerCase()] ?? match
    })
}

// HTML 转纯文本：Pixiv 的简介/用户简介字段是 HTML（<br>、<a> 等），
// 清洗后以纯文本展示（与 Hanairo 的 TextSanitizer 行为一致）。


export function htmlToPlainText(html: string | undefined | null): string {
  return htmlFragmentToPlainText(html).trim()
}

export function htmlFragmentToPlainText(html: string | undefined | null): string {
  if (!html) return ""
  const stripped = html
    .replace(/\r\n|\r/g, "\n")
    .replace(/<(?:\s*\/?\s*)br(?:\s*\/?\s*|\s+[^>]*)>(?:\r?\n)?/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // 清理换行后遗留的孤立残存斜杠（如由 <br /> 误残存的 \n/ Mail ）
    .replace(
      /\n\s*\/\s*(?=[A-Za-z0-9\u4e00-\u9fa5\uac00-\ud7af\u3040-\u30ff])/g,
      "\n"
    )
    // 清除换行后的前导空白（半角空格、制表符、全角空格），确保换行后首个字符严格靠左对齐
    .replace(/\n[ \t\u3000]+/g, "\n")
    .replace(/^[ \t\u3000]+/g, "")
  return decodeHtmlEntities(stripped)
}


export function presentExternalURL(url: string): Promise<void> {
  return Safari.present(url, false)
}

export function formatTextWithBreakOpportunities(text: string, isUrl = false): string {
  if (!text) return ""
  const noBreakBefore = new Set([
    "，", "。", "、", "！", "？", "：", "；",
    "）", "”", "’", "》", "】", "…", "—", "～", "·",
    ",", ".", "!", "?", ":", ";", ")", "\"", "'", "]", ">", "}"
  ])
  const noBreakAfter = new Set([
    "“", "‘", "（", "《", "【", "(", "[", "{", "<"
  ])

  // 按完整的 Unicode Code Point 切分字符（避免拆散 Emoji 等 4 字节代理对）
  const chars = Array.from(text)
  const result: string[] = []

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    result.push(ch)

    if (i < chars.length - 1) {
      const nextCh = chars[i + 1]
      if (
        ch === "\n" || nextCh === "\n" ||
        ch === "\r" || nextCh === "\r" ||
        ch === "\t" || nextCh === "\t" ||
        ch === " " || nextCh === " "
      ) {
        continue
      }

      // 如果当前字符或下一个字符是 Emoji 组合控制符（如变体选择器 VS16 \uFE0F、零宽连字 \u200D 等），不拆分
      if (ch === "\uFE0F" || nextCh === "\uFE0F" || ch === "\u200D" || nextCh === "\u200D") {
        continue
      }

      if (isUrl) {
        // 对于 URL 链接：在所有字符（含字母数字及 / ? & = - _ . : 等符号）间注入断行契机，防止 CoreText 将超长 URL 路径整块推至下一行
        result.push("\u200B")
      } else {
        const code = ch.codePointAt(0) ?? 0
        const nextCode = nextCh.codePointAt(0) ?? 0
        const isCjk = code > 255 || nextCode > 255
        if (!noBreakBefore.has(nextCh) && !noBreakAfter.has(ch)) {
          if (isCjk) {
            // 中日韩文字与任意相邻字符之间注入零宽空格，避免 CoreText 词组级过度避让导致提前换行
            result.push("\u200B")
          } else if (
            ch === "/" || ch === "-" || ch === "_" || ch === "@" ||
            ch === "&" || ch === "=" || ch === "#" || ch === "~" ||
            ch === "+" || ch === "%" || ch === "|" || ch === "\\"
          ) {
            result.push("\u200B")
          }
        }
      }
    }
  }

  return result.join("")
}


export function routeForDescriptionLink(value: string): string | null {
  const decoded = decodeDescriptionLink(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/／/g, "/")
    .trim()
  if (!decoded) return null

  // 1. pixiv:// custom scheme
  const embeddedSeries = decoded.match(
    /^pixiv:\/\/(?:novel\/series|novels\/series|manga\/series|illust\/series|illusts\/series)\/(\d+)$/i
  )
  if (embeddedSeries) {
    if (/novel/i.test(embeddedSeries[0])) return `novelSeries:${embeddedSeries[1]}`
    return `mangaSeries:${embeddedSeries[1]}`
  }

  const embeddedItem = decoded.match(/^pixiv:\/\/(users?|user|artworks|novels?|novel|illusts?|illust)\/(\d+)$/i)
  if (embeddedItem) {
    if (/^user/i.test(embeddedItem[1])) return `user:${embeddedItem[2]}`
    if (/^novel/i.test(embeddedItem[1])) return `novel:${embeddedItem[2]}`
    return `illust:${embeddedItem[2]}`
  }

  const hasURLScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(decoded)
  const isPixivURL = /^(?:https?:\/\/)?(?:www\.)?pixiv\.net(?:\/|$)/i.test(decoded)

  // 支持所有语言前缀，如 /en/, /zh/, /ja/, /zh-tw/, /zh-cn/, /ko/ 等
  const LANG_PREFIX = "(?:[a-zA-Z]{2}(?:-[a-zA-Z0-9]+)?\\/)?"

  // 2. novel series / manga series: pixiv.net/novel/series/123 or pixiv.net/user/123/series/456 or pixiv.net/manga/series/123
  const novelSeriesMatch = decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixiv\\.net)?\\/?${LANG_PREFIX}novel\\/series\\/(\\d+)(?:[/?#].*)?$`, "i")
  )
  if (novelSeriesMatch && (!hasURLScheme || isPixivURL)) {
    const id = Number(novelSeriesMatch[1])
    if (Number.isFinite(id) && id > 0) return `novelSeries:${id}`
  }

  const mangaSeriesMatch = decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixiv\\.net)?\\/?${LANG_PREFIX}(?:users?|user)\\/\\d+\\/series\\/(\\d+)(?:[/?#].*)?$`, "i")
  ) ?? decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixiv\\.net)?\\/?${LANG_PREFIX}(?:manga|illust|illusts)\\/series\\/(\\d+)(?:[/?#].*)?$`, "i")
  )
  if (mangaSeriesMatch && (!hasURLScheme || isPixivURL)) {
    const id = Number(mangaSeriesMatch[1])
    if (Number.isFinite(id) && id > 0) return `mangaSeries:${id}`
  }

  // 3. user / novel / illust: pixiv.net/users/123, pixiv.net/artworks/123, pixiv.net/novel/123, users/123, artworks/123
  const pathMatch = decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixiv\\.net)?\\/?${LANG_PREFIX}(users?|user|artworks|novels?|novel|illusts?|illust)\\/(\\d+)(?:[/?#].*)?$`, "i")
  )
  if (pathMatch && (!hasURLScheme || isPixivURL)) {
    const id = Number(pathMatch[2])
    if (Number.isFinite(id) && id > 0) {
      if (/^user/i.test(pathMatch[1])) return `user:${id}`
      if (/^novel/i.test(pathMatch[1])) return `novel:${id}`
      return `illust:${id}`
    }
  }

  // 4. tags: pixiv.net/tags/TAG or pixiv.net/tags/TAG/novels or pixiv.net/tags/TAG/artworks
  const tagMatch = decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixiv\\.net)?\\/?${LANG_PREFIX}tags\\/([^/?#]+)(?:\\/(novels?|artworks?|illustrations?))?(?:[/?#].*)?$`, "i")
  )
  if (tagMatch && (!hasURLScheme || isPixivURL)) {
    try {
      const tag = decodeURIComponent(tagMatch[1])
      const isNovel = Boolean(tagMatch[2] && /^novels?$/i.test(tagMatch[2]))
      const prefix = isNovel ? "novelTag:" : "tag:"
      if (tag.trim()) return `${prefix}${encodeURIComponent(tag.trim())}`
      return `${prefix}${tagMatch[1]}`
    } catch {
      return `tag:${tagMatch[1]}`
    }
  }

  // 5. legacy novel show & member links: pixiv.net/novel/show.php?id=123, pixiv.net/member.php?id=123, pixiv.net/member_illust.php?illust_id=123
  const novelShow = decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixiv\\.net)?\\/?${LANG_PREFIX}novel\\/show\\.php\\?[^#]*\\bid=(\\d+)`, "i")
  )
  if (novelShow) {
    const id = Number(novelShow[1])
    if (Number.isFinite(id) && id > 0) return `novel:${id}`
  }

  const legacyMember = decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixiv\\.net)?\\/?${LANG_PREFIX}member\\.php\\?[^#]*\\bid=(\\d+)`, "i")
  )
  if (legacyMember) {
    const id = Number(legacyMember[1])
    if (Number.isFinite(id) && id > 0) return `user:${id}`
  }

  const legacyIllust = decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixiv\\.net)?\\/?${LANG_PREFIX}member_illust\\.php\\?[^#]*(?:\\billust_id=|\\bid=)(\\d+)`, "i")
  )
  if (legacyIllust) {
    const id = Number(legacyIllust[1])
    if (Number.isFinite(id) && id > 0) return `illust:${id}`
  }

  const shortPrefix = decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixiv\\.net)?\\/?${LANG_PREFIX}([iun])\\/(\\d+)(?:[/?#].*)?$`, "i")
  )
  if (shortPrefix && (!hasURLScheme || isPixivURL)) {
    const id = Number(shortPrefix[2])
    if (Number.isFinite(id) && id > 0) {
      if (shortPrefix[1].toLowerCase() === "i") return `illust:${id}`
      if (shortPrefix[1].toLowerCase() === "u") return `user:${id}`
      if (shortPrefix[1].toLowerCase() === "n") return `novel:${id}`
    }
  }

  // 6. Pixivision 官方文章与标签：pixivision.net/zh/a/123 或 pixivision.net/a/123 或 /t/123
  const pixivisionMatch = decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixivision\\.net)?\\/?${LANG_PREFIX}a\\/(\\d+)(?:[/?#].*)?$`, "i")
  )
  if (pixivisionMatch) {
    const id = Number(pixivisionMatch[1])
    if (Number.isFinite(id) && id > 0) return `pixivision:${id}`
  }

  const pixivisionTagMatch = decoded.match(
    new RegExp(`^(?:https?:\\/\\/(?:www\\.)?pixivision\\.net)?\\/?${LANG_PREFIX}t\\/([^/?#]+)(?:[/?#].*)?$`, "i")
  )
  if (pixivisionTagMatch) {
    return `pixivision-tag:${pixivisionTagMatch[1]}`
  }

  // 7. uid: 123, pid: 123, nid: 123
  const idReference = decoded.match(/^(uid|pid|nid)\s*[:：#=]?\s*(\d+)$/i)
  if (idReference) {
    const kind = idReference[1].toLowerCase()
    const id = idReference[2]
    if (kind === "uid") return `user:${id}`
    if (kind === "nid") return `novel:${id}`
    return `illust:${id}`
  }

  // 8. External http / www links
  if (/^www\./i.test(decoded)) return `https://${decoded}`
  if (/^https?:\/\//i.test(decoded)) return decoded

  return null
}

export function decodeDescriptionLink(value: string): string {
  return decodeHtmlEntities(value)
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))}分钟前`
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}天前`
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  } catch {
    return iso ?? ""
  }
}



export function estimateVisualLines(text: string): number {
  if (!text) return 0
  const screenWidth =
    typeof Device !== "undefined" && Device.screen?.width
      ? Device.screen.width
      : 390
  const availableWidth = Math.max(280, screenWidth - 56)
  const charsPerLine = availableWidth / 13

  const paragraphs = text.split(/\r?\n/)
  let totalLines = 0
  for (const para of paragraphs) {
    if (!para) {
      totalLines += 1
      continue
    }
    let visualWeight = 0
    for (let i = 0; i < para.length; i++) {
      const code = para.charCodeAt(i)
      const ch = para[i]
      if (code > 255) {
        // 全角标点符号（，。、！？：；“”‘’（）…）占宽稍窄于正方汉字（约 0.8 CJK）
        if (
          ch === "，" ||
          ch === "。" ||
          ch === "、" ||
          ch === "！" ||
          ch === "？" ||
          ch === "：" ||
          ch === "；" ||
          ch === "“" ||
          ch === "”" ||
          ch === "‘" ||
          ch === "’" ||
          ch === "（" ||
          ch === "）" ||
          ch === "…"
        ) {
          visualWeight += 0.8
        } else {
          visualWeight += 1
        }
      } else if (code === 32 || code === 9) {
        // 空格与制表符宽度较小（约 0.25 CJK）
        visualWeight += 0.25
      } else if (
        code === 105 || // i
        code === 108 || // l
        code === 106 || // j
        code === 73 || // I
        code === 49 || // 1
        code === 33 || // !
        code === 44 || // ,
        code === 46 || // .
        code === 58 || // :
        code === 59 || // ;
        code === 39 || // '
        code === 124 // |
      ) {
        // 极窄 ASCII 字符（约 0.3 CJK）
        visualWeight += 0.3
      } else {
        // 常规半角 ASCII 字符（SF Pro 13pt 下约 0.46 CJK）
        visualWeight += 0.46
      }
    }
    totalLines += Math.max(1, Math.ceil(visualWeight / charsPerLine))
  }
  return totalLines
}

