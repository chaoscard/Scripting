export interface PixivEmojiItem {
  code: string
  id: string
}

export interface PixivStampItem {
  id: number
  url: string
}

export interface PixivStampCategory {
  key: string
  title: string
  stamps: PixivStampItem[]
}

export const PIXIV_EMOJIS: PixivEmojiItem[] = [
  { code: "(normal)", id: "101" },
  { code: "(surprise)", id: "102" },
  { code: "(serious)", id: "103" },
  { code: "(heaven)", id: "104" },
  { code: "(happy)", id: "105" },
  { code: "(excited)", id: "106" },
  { code: "(sing)", id: "107" },
  { code: "(cry)", id: "108" },
  { code: "(normal2)", id: "201" },
  { code: "(shame2)", id: "202" },
  { code: "(love2)", id: "203" },
  { code: "(interesting2)", id: "204" },
  { code: "(blush2)", id: "205" },
  { code: "(fire2)", id: "206" },
  { code: "(angry2)", id: "207" },
  { code: "(shine2)", id: "208" },
  { code: "(panic2)", id: "209" },
  { code: "(normal3)", id: "301" },
  { code: "(satisfaction3)", id: "302" },
  { code: "(surprise3)", id: "303" },
  { code: "(smile3)", id: "304" },
  { code: "(shock3)", id: "305" },
  { code: "(gaze3)", id: "306" },
  { code: "(wink3)", id: "307" },
  { code: "(happy3)", id: "308" },
  { code: "(excited3)", id: "309" },
  { code: "(love3)", id: "310" },
  { code: "(normal4)", id: "401" },
  { code: "(surprise4)", id: "402" },
  { code: "(serious4)", id: "403" },
  { code: "(love4)", id: "404" },
  { code: "(shine4)", id: "405" },
  { code: "(sweat4)", id: "406" },
  { code: "(shame4)", id: "407" },
  { code: "(sleep4)", id: "408" },
  { code: "(heart)", id: "501" },
  { code: "(teardrop)", id: "502" },
  { code: "(star)", id: "503" },
]

export function emojiUrlOf(id: string): string {
  return `https://s.pximg.net/common/images/emoji/${id}.png`
}

export function stampUrlOf(id: number): string {
  return `https://s.pximg.net/common/images/stamp/generated-stamps/${id}_s.jpg`
}

export const EMOJI_CODE_TO_URL = new Map<string, string>(
  PIXIV_EMOJIS.map((e) => [e.code, emojiUrlOf(e.id)])
)

function makeCategory(key: string, title: string, ids: number[]): PixivStampCategory {
  return {
    key,
    title,
    stamps: ids.map((id) => ({ id, url: stampUrlOf(id) })),
  }
}

export const PIXIV_STAMP_CATEGORIES: PixivStampCategory[] = [
  makeCategory("100", "经典", [101, 102, 103, 104, 105, 106, 107, 108, 109, 110]),
  makeCategory("200", "可爱", [201, 202, 203, 204, 205, 206, 207, 208, 209, 210]),
  makeCategory("300", "情绪", [301, 302, 303, 304, 305, 306, 307, 308, 309, 310]),
  makeCategory("400", "搞怪", [401, 402, 403, 404, 405, 406, 407, 408, 409, 410]),
  makeCategory("600", "日常", [601, 602, 603, 604, 605, 606, 607, 608, 609, 610]),
  makeCategory("700", "特别", [701, 702, 703, 704, 705, 706, 707, 708, 709, 710]),
]

export const ALL_PIXIV_STAMPS: PixivStampItem[] = PIXIV_STAMP_CATEGORIES.flatMap((c) => c.stamps)

export type CommentToken =
  | { type: "text"; text: string }
  | { type: "emoji"; code: string; url: string }

const EMOJI_REGEX = /(\([a-zA-Z0-9_]+\))/g
const tokenCache = new Map<string, CommentToken[]>()
const MAX_TOKEN_CACHE_SIZE = 500

export function tokenizeCommentText(text: string): CommentToken[] {
  if (!text) return []
  const cached = tokenCache.get(text)
  if (cached) return cached

  const parts = text.split(EMOJI_REGEX)
  const tokens: CommentToken[] = []
  for (const part of parts) {
    if (!part) continue
    const emojiUrl = EMOJI_CODE_TO_URL.get(part)
    if (emojiUrl) {
      tokens.push({ type: "emoji", code: part, url: emojiUrl })
    } else {
      tokens.push({ type: "text", text: part })
    }
  }
  if (tokenCache.size >= MAX_TOKEN_CACHE_SIZE) {
    tokenCache.clear()
  }
  tokenCache.set(text, tokens)
  return tokens
}
