import { loadSettings, updateSettings } from "./settings"

declare const Keychain: any
declare const Storage: any

const KEYCHAIN_SAUCENAO_KEY = "pixiv_saucenao_api_key_v1"
const STORAGE_SAUCENAO_QUOTA_KEY = "pixiv_saucenao_quota_v1"

export interface SauceNAOQuotaRecord {
  remaining: number // long_remaining 剩余可用次数
  limit: number     // long_limit 总额度（默认 100）
  updatedAt: number // 最后更新时间戳 (ms)
}

let cachedSauceNaoKeys: string[] | null = null
const sauceNaoKeyListeners: Array<(keys: string[]) => void> = []

/**
 * 获取当前已配置的所有 SauceNAO API Keys 列表
 * 优先级：内存缓存 -> iCloud Keychain -> 本地 Keychain -> Settings 兜底
 */
export function getSauceNaoApiKeys(): string[] {
  if (cachedSauceNaoKeys !== null) {
    return cachedSauceNaoKeys
  }

  let raw: any = null

  // 1. 尝试从 iCloud 同步钥匙串读取
  try {
    raw = Keychain.get(KEYCHAIN_SAUCENAO_KEY, { synchronizable: true })
  } catch (e) {
    // 降级读取本地
  }

  // 2. 如果 iCloud 没有，读取本地 Keychain
  if (!raw) {
    try {
      raw = Keychain.get(KEYCHAIN_SAUCENAO_KEY)
    } catch (e) {
      console.log("Local Keychain read error for SauceNAO:", e)
    }
  }

  // 3. 兼容老版本 settings 存储，并自动迁移
  if (!raw) {
    try {
      const settingsKey = loadSettings().sauceNaoApiKey
      if (settingsKey && settingsKey.trim()) {
        raw = settingsKey.trim()
        saveSauceNaoApiKeys([raw])
      }
    } catch {}
  }

  const keys: string[] = []
  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim()
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "string" && item.trim() && !keys.includes(item.trim())) {
              keys.push(item.trim())
            }
          }
        }
      } catch {
        keys.push(trimmed)
      }
    } else {
      keys.push(trimmed)
    }
  }

  cachedSauceNaoKeys = keys
  return cachedSauceNaoKeys
}

/**
 * 兼容单 Key 获取（返回第一个可用 Key，若无则返回空字符串）
 */
export function getSauceNaoApiKey(): string {
  const keys = getSauceNaoApiKeys()
  return keys.length > 0 ? keys[0] : ""
}

/**
 * 保存完整的 SauceNAO Keys 列表（双写 iCloud 钥匙串与本地钥匙串）
 */
export function saveSauceNaoApiKeys(keys: string[]): void {
  const cleanKeys: string[] = []
  for (const k of keys) {
    if (typeof k === "string" && k.trim() && !cleanKeys.includes(k.trim())) {
      cleanKeys.push(k.trim())
    }
  }

  cachedSauceNaoKeys = cleanKeys

  if (cleanKeys.length === 0) {
    clearSauceNaoApiKey()
    return
  }

  const jsonStr = JSON.stringify(cleanKeys)

  try {
    // 1. 写入 iCloud 同步钥匙串
    Keychain.set(KEYCHAIN_SAUCENAO_KEY, jsonStr, {
      synchronizable: true,
      accessibility: "first_unlock",
    })
  } catch (e) {
    console.log("Failed to save SauceNAO keys to iCloud Keychain:", e)
  }

  try {
    // 2. 写入本地钥匙串备份
    Keychain.set(KEYCHAIN_SAUCENAO_KEY, jsonStr, {
      synchronizable: false,
      accessibility: "first_unlock_this_device",
    })
  } catch (e) {
    console.log("Failed to save SauceNAO keys to local Keychain:", e)
  }

  try {
    updateSettings({ sauceNaoApiKey: cleanKeys[0] || "" })
  } catch {}

  notifySauceNaoKeyListeners(cleanKeys)
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
  const current = getSauceNaoApiKeys()
  if (current.includes(trimmed)) return false
  saveSauceNaoApiKeys([...current, trimmed])
  return true
}

/**
 * 移除单个 API Key
 */
export function removeSauceNaoApiKey(rawKey: string): void {
  const trimmed = (rawKey || "").trim()
  const current = getSauceNaoApiKeys()
  const filtered = current.filter((k) => k !== trimmed)
  saveSauceNaoApiKeys(filtered)
}

/**
 * 一键彻底清除本地与 iCloud 钥匙串中的所有 SauceNAO API Key
 */
export function clearSauceNaoApiKey(): void {
  cachedSauceNaoKeys = []

  try {
    // 1. 从本地钥匙串删除
    Keychain.remove(KEYCHAIN_SAUCENAO_KEY)
  } catch (e) {
    console.log("Failed to remove local SauceNAO keychain key:", e)
  }

  try {
    // 2. 同步从 iCloud 钥匙串删除
    Keychain.remove(KEYCHAIN_SAUCENAO_KEY, { synchronizable: true })
  } catch (e) {
    console.log("Failed to remove iCloud SauceNAO keychain key:", e)
  }

  try {
    updateSettings({ sauceNaoApiKey: "" })
  } catch {}

  try {
    if (typeof Storage !== "undefined" && typeof Storage.remove === "function") {
      Storage.remove(STORAGE_SAUCENAO_QUOTA_KEY)
    }
  } catch {}

  notifySauceNaoKeyListeners([])
}

/**
 * 记录与更新指定 Key 的额度用量
 */
export function recordSauceNaoQuota(key: string, remaining: number, limit = 100): void {
  const trimmed = (key || "").trim()
  if (!trimmed) return

  let quotaMap: Record<string, SauceNAOQuotaRecord> = {}
  try {
    if (typeof Storage !== "undefined" && typeof Storage.get === "function") {
      quotaMap = Storage.get(STORAGE_SAUCENAO_QUOTA_KEY) || {}
    }
  } catch {}

  quotaMap[trimmed] = {
    remaining: Math.max(0, Math.min(limit, remaining)),
    limit: limit > 0 ? limit : 100,
    updatedAt: Date.now(),
  }

  try {
    if (typeof Storage !== "undefined" && typeof Storage.set === "function") {
      Storage.set(STORAGE_SAUCENAO_QUOTA_KEY, quotaMap)
    }
  } catch {}
}

/**
 * 获取全局配额用量统计：已用次数 / 总额度
 */
export function getSauceNaoQuotaStats(): { used: number; total: number; keyCount: number } {
  const keys = getSauceNaoApiKeys()
  const keyCount = keys.length
  if (keyCount === 0) {
    return { used: 0, total: 0, keyCount: 0 }
  }

  let quotaMap: Record<string, SauceNAOQuotaRecord> = {}
  try {
    if (typeof Storage !== "undefined" && typeof Storage.get === "function") {
      quotaMap = Storage.get(STORAGE_SAUCENAO_QUOTA_KEY) || {}
    }
  } catch {}

  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000

  let totalLimit = 0
  let totalUsed = 0

  for (const k of keys) {
    const record = quotaMap[k]
    const keyLimit = record?.limit && record.limit > 0 ? record.limit : 100
    totalLimit += keyLimit

    if (record && record.updatedAt && now - record.updatedAt < oneDayMs) {
      const used = Math.max(0, keyLimit - record.remaining)
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
