import { useEffect, useState } from "scripting"
import { fetchTagInfo } from "../api/pixiv"
import type { PixivTagDetail } from "../types"

// 内存缓存 Map：保存已解析的标签详情，避免重复请求
const tagInfoCache = new Map<string, PixivTagDetail | null>()
const tagInfoPending = new Map<string, Promise<PixivTagDetail | null>>()

export async function getTagInfo(tagName: string): Promise<PixivTagDetail | null> {
  const cleanTag = tagName.trim()
  if (!cleanTag) return null

  if (tagInfoCache.has(cleanTag)) {
    return tagInfoCache.get(cleanTag) ?? null
  }

  const pending = tagInfoPending.get(cleanTag)
  if (pending) {
    return pending
  }

  const request = fetchTagInfo(cleanTag)
    .then((info) => {
      tagInfoCache.set(cleanTag, info)
      tagInfoPending.delete(cleanTag)
      return info
    })
    .catch(() => {
      tagInfoCache.set(cleanTag, null)
      tagInfoPending.delete(cleanTag)
      return null
    })

  tagInfoPending.set(cleanTag, request)
  return request
}

export function useTagInfo(tagName: string) {
  const cleanTag = tagName.trim()
  const cached = tagInfoCache.get(cleanTag)
  const [data, setData] = useState<PixivTagDetail | null | undefined>(cached)
  const [loading, setLoading] = useState<boolean>(cached === undefined)

  useEffect(() => {
    if (!cleanTag) {
      setData(null)
      setLoading(false)
      return
    }

    if (tagInfoCache.has(cleanTag)) {
      setData(tagInfoCache.get(cleanTag) ?? null)
      setLoading(false)
      return
    }

    let isMounted = true
    setLoading(true)

    getTagInfo(cleanTag).then((res) => {
      if (isMounted) {
        setData(res)
        setLoading(false)
      }
    })

    return () => {
      isMounted = false
    }
  }, [cleanTag])

  return { data, loading }
}
