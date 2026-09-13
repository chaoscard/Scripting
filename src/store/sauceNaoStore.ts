declare const Keychain: any

const KEYCHAIN_SAUCENAO_KEY = "pixiv_saucenao_api_key_v1"

export interface SauceNaoKeyEntry {
  key: string
  remaining?: number // long_remaining 剩余可用次数
  limit?: number     // long_limit 总额度（默认 100）
  updatedAt?: number // 最后更新时间戳 (ms)
}

let cachedSauceNaoEntries: SauceNaoKeyEntry[] | null = null
const sauceNaoKeyListeners: Array<(keys: string[]) => void> = []

function parseRawEntries(raw: any): SauceNaoKeyEntry[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw.trim())
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is SauceNaoKeyEntry =>
          Boolean(item && typeof item === "object" && typeof item.key === "string" && item.key.trim())
      )
    }
  } catch {}
  return []
}

/**
 * 获取当前所有配置的 SauceNAO 记录（包含配额与时间戳）
 * 仅从 Keychain（iCloud 同步钥匙串 / 本地钥匙串）读取
 */
export function getSauceNaoEntries(): SauceNaoKeyEntry[] {
  if (cachedSauceNaoEntries !== null) {
    return cachedSauceNaoEntries
  }

  let raw: any = null

  // 1. 尝试从 iCloud 同步钥匙串读取
  try {
    raw = Keychain.get(KEYCHAIN_SAUCENAO_KEY, { synchronizable: true })
  } catch (e) {
    // 降级读取本地
  }

  // 2. 若 iCloud 没有，读取本地 Keychain
  if (!raw) {
    try {
      raw = Keychain.get(KEYCHAIN_SAUCENAO_KEY)
    } catch (e) {
      console.log("Local Keychain read error for SauceNAO:", e)
    }
  }

  cachedSauceNaoEntries = parseRawEntries(raw)
  return cachedSauceNaoEntries
}

/**
 * 保存完整的 SauceNAO 记录（双写 iCloud 钥匙串与本地钥匙串）
 */
function saveSauceNaoEntries(entries: SauceNaoKeyEntry[]): void {
  const cleanEntries: SauceNaoKeyEntry[] = []
  const seen = new Set<string>()
  for (const item of entries) {
    const k = (item.key || "").trim()
    if (k && !seen.has(k)) {
      seen.add(k)
      cleanEntries.push({
        key: k,
        ...(typeof item.remaining === "number" ? { remaining: item.remaining } : {}),
        ...(typeof item.limit === "number" ? { limit: item.limit } : {}),
        ...(typeof item.updatedAt === "number" ? { updatedAt: item.updatedAt } : {}),
      })
    }
  }

  cachedSauceNaoEntries = cleanEntries

  if (cleanEntries.length === 0) {
    clearSauceNaoApiKey()
    return
  }

  const jsonStr = JSON.stringify(cleanEntries)

  try {
    Keychain.set(KEYCHAIN_SAUCENAO_KEY, jsonStr, {
      synchronizable: true,
      accessibility: "first_unlock",
    })
  } catch (e) {
    console.log("Failed to save SauceNAO entries to iCloud Keychain:", e)
  }

  try {
    Keychain.set(KEYCHAIN_SAUCENAO_KEY, jsonStr, {
      synchronizable: false,
      accessibility: "first_unlock_this_device",
    })
  } catch (e) {
    console.log("Failed to save SauceNAO entries to local Keychain:", e)
  }

  notifySauceNaoKeyListeners(cleanEntries.map((e) => e.key))
}

/**
 * 获取当前已配置的所有 SauceNAO API Keys 列表
 */
export function getSauceNaoApiKeys(): string[] {
  return getSauceNaoEntries().map((e) => e.key)
}

/**
 * 获取首个可用 Key，若无则返回空字符串
 */
export function getSauceNaoApiKey(): string {
  const keys = getSauceNaoApiKeys()
  return keys.length > 0 ? keys[0] : ""
}

/**
 * 保存纯 Key 列表（保留已有配额数据，双写 Keychain）
 */
export function saveSauceNaoApiKeys(keys: string[]): void {
  const oldEntries = getSauceNaoEntries()
  const map = new Map<string, SauceNaoKeyEntry>()
  for (const e of oldEntries) {
    map.set(e.key, e)
  }

  const newEntries: SauceNaoKeyEntry[] = []
  for (const k of keys) {
    const trimmed = (k || "").trim()
    if (trimmed && !newEntries.some((e) => e.key === trimmed)) {
      if (map.has(trimmed)) {
        newEntries.push(map.get(trimmed)!)
      } else {
        newEntries.push({ key: trimmed })
      }
    }
  }

  saveSauceNaoEntries(newEntries)
}

/**
 * 单个 Key 保存（兼容老方法）
 */
export function saveSauceNaoApiKey(rawKey: string): void {
  const trimmed = (rawKey || "").trim()
  if (!trimmed) {
    clearSauceNaoApiKey()
  } else {
    saveSauceNaoApiKeys([trimmed])
  }
}

/**
 * 添加单个 API Key
 */
export function addSauceNaoApiKey(rawKey: string): boolean {
  const trimmed = (rawKey || "").trim()
  if (!trimmed) return false
  const currentKeys = getSauceNaoApiKeys()
  if (currentKeys.includes(trimmed)) return false
  saveSauceNaoApiKeys([...currentKeys, trimmed])
  return true
}

/**
 * 移除单个 API Key
 */
export function removeSauceNaoApiKey(rawKey: string): void {
  const trimmed = (rawKey || "").trim()
  const currentKeys = getSauceNaoApiKeys()
  const filtered = currentKeys.filter((k) => k !== trimmed)
  saveSauceNaoApiKeys(filtered)
}

/**
 * 一键彻底清除本地与 iCloud 钥匙串中的所有 SauceNAO 记录
 */
export function clearSauceNaoApiKey(): void {
  cachedSauceNaoEntries = []

  try {
    Keychain.remove(KEYCHAIN_SAUCENAO_KEY)
  } catch (e) {
    console.log("Failed to remove local SauceNAO keychain key:", e)
  }

  try {
    Keychain.remove(KEYCHAIN_SAUCENAO_KEY, { synchronizable: true })
  } catch (e) {
    console.log("Failed to remove iCloud SauceNAO keychain key:", e)
  }

  notifySauceNaoKeyListeners([])
}

/**
 * 记录与更新指定 Key 的额度用量（完全存储在 Keychain 中，杜绝明文磁盘文件）
 */
export function recordSauceNaoQuota(key: string, remaining: number, limit = 100): void {
  const trimmed = (key || "").trim()
  if (!trimmed) return

  const entries = getSauceNaoEntries()
  const idx = entries.findIndex((e) => e.key === trimmed)
  const target: SauceNaoKeyEntry = idx >= 0 ? { ...entries[idx] } : { key: trimmed }

  target.remaining = Math.max(0, Math.min(limit, remaining))
  target.limit = limit > 0 ? limit : 100
  target.updatedAt = Date.now()

  let newEntries: SauceNaoKeyEntry[]
  if (idx >= 0) {
    newEntries = [...entries]
    newEntries[idx] = target
  } else {
    newEntries = [...entries, target]
  }

  saveSauceNaoEntries(newEntries)
}

/**
 * 获取全局配额用量统计：已用次数 / 总额度（根据 Keychain 中的用量数据计算）
 */
export function getSauceNaoQuotaStats(): { used: number; total: number; keyCount: number } {
  const entries = getSauceNaoEntries()
  const keyCount = entries.length
  if (keyCount === 0) {
    return { used: 0, total: 0, keyCount: 0 }
  }

  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000

  let totalLimit = 0
  let totalUsed = 0

  for (const entry of entries) {
    const keyLimit = entry.limit && entry.limit > 0 ? entry.limit : 100
    totalLimit += keyLimit

    if (entry.updatedAt && now - entry.updatedAt < oneDayMs) {
      const rem = typeof entry.remaining === "number" ? entry.remaining : keyLimit
      const used = Math.max(0, keyLimit - rem)
      totalUsed += used
    }
  }

  return {
    used: totalUsed,
    total: totalLimit > 0 ? totalLimit : keyCount * 100,
    keyCount,
  }
}

/**
 * 监听 SauceNAO 密钥变更事件
 */
export function onSauceNaoKeyChanged(listener: (keys: string[]) => void): () => void {
  sauceNaoKeyListeners.push(listener)
  return () => {
    const idx = sauceNaoKeyListeners.indexOf(listener)
    if (idx >= 0) {
      sauceNaoKeyListeners.splice(idx, 1)
    }
  }
}

function notifySauceNaoKeyListeners(keys: string[]) {
  for (const fn of sauceNaoKeyListeners) {
    try {
      fn(keys)
    } catch {}
  }
}
