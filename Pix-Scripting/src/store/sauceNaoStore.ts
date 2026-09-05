import { loadSettings, updateSettings } from "./settings"

declare const Keychain: any

const KEYCHAIN_SAUCENAO_KEY = "pixiv_saucenao_api_key_v1"

let cachedSauceNaoKey: string | null = null
const sauceNaoKeyListeners: Array<(key: string) => void> = []

/**
 * 获取当前的 SauceNAO API Key
 * 优先级：内存缓存 -> iCloud Keychain -> 本地 Keychain -> Settings 兜底
 */
export function getSauceNaoApiKey(): string {
  if (cachedSauceNaoKey !== null) {
    return cachedSauceNaoKey
  }

  let key: string | null = null

  // 1. 尝试从 iCloud 同步钥匙串读取
  try {
    key = Keychain.get(KEYCHAIN_SAUCENAO_KEY, { synchronizable: true })
  } catch (e) {
    // 降级读取本地
  }

  // 2. 如果 iCloud 没有，读取本地 Keychain
  if (!key) {
    try {
      key = Keychain.get(KEYCHAIN_SAUCENAO_KEY)
    } catch (e) {
      console.log("Local Keychain read error for SauceNAO:", e)
    }
  }

  // 3. 兼容已有的 settings 存储，并自动迁移
  if (!key) {
    try {
      const settingsKey = loadSettings().sauceNaoApiKey
      if (settingsKey && settingsKey.trim()) {
        key = settingsKey.trim()
        saveSauceNaoApiKey(key)
      }
    } catch {}
  }

  cachedSauceNaoKey = (key || "").trim()
  return cachedSauceNaoKey
}

/**
 * 保存 SauceNAO API Key（双写 iCloud 钥匙串与本地钥匙串）
 */
export function saveSauceNaoApiKey(rawKey: string): void {
  const trimmed = (rawKey || "").trim()
  cachedSauceNaoKey = trimmed

  if (!trimmed) {
    clearSauceNaoApiKey()
    return
  }

  try {
    // 1. 写入 iCloud 同步钥匙串
    Keychain.set(KEYCHAIN_SAUCENAO_KEY, trimmed, {
      synchronizable: true,
      accessibility: "first_unlock",
    })
  } catch (e) {
    console.log("Failed to save SauceNAO key to iCloud Keychain:", e)
  }

  try {
    // 2. 始终写入本地钥匙串备份
    Keychain.set(KEYCHAIN_SAUCENAO_KEY, trimmed, {
      synchronizable: false,
      accessibility: "first_unlock_this_device",
    })
  } catch (e) {
    console.log("Failed to save SauceNAO key to local Keychain:", e)
  }

  try {
    updateSettings({ sauceNaoApiKey: trimmed })
  } catch {}

  notifySauceNaoKeyListeners(trimmed)
}

/**
 * 一键彻底清除本地与 iCloud 钥匙串中的 SauceNAO API Key
 */
export function clearSauceNaoApiKey(): void {
  cachedSauceNaoKey = ""

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

  notifySauceNaoKeyListeners("")
}

/**
 * 监听 SauceNAO 密钥变更事件
 */
export function onSauceNaoKeyChanged(listener: (key: string) => void): () => void {
  sauceNaoKeyListeners.push(listener)
  return () => {
    const idx = sauceNaoKeyListeners.indexOf(listener)
    if (idx >= 0) {
      sauceNaoKeyListeners.splice(idx, 1)
    }
  }
}

function notifySauceNaoKeyListeners(key: string) {
  for (const fn of sauceNaoKeyListeners) {
    try {
      fn(key)
    } catch {}
  }
}
