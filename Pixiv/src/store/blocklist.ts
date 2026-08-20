import type { PixivUser } from "../types"
import { pixivBlocklistDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

export interface BlockedUser {
  id: number
  name: string
  account: string
  avatarURL?: string
}

export interface BlocklistData {
  blockedTags: string[]
  blockedUsers: BlockedUser[]
}

const DEFAULT_BLOCKLIST: BlocklistData = {
  blockedTags: [],
  blockedUsers: [],
}

const KEY = "pixiv_blocklist_v1"
const BLOCKLIST_FILE_NAME = "blocklist.json"

let cachedBlocklist: BlocklistData | null = null
const listeners = new Set<() => void>()

function blocklistFilePath(): string {
  return `${pixivBlocklistDirectory()}/${BLOCKLIST_FILE_NAME}`
}

export async function prepareBlocklistStorage(): Promise<void> {
  if (!FileManager.isiCloudEnabled) return
  const path = blocklistFilePath()
  if (
    !FileManager.existsSync(path) ||
    !FileManager.isFileStoredIniCloud(path) ||
    FileManager.isiCloudFileDownloaded(path)
  ) {
    return
  }
  try {
    await FileManager.downloadFileFromiCloud(path)
  } catch {
    // 云端文件暂不可下载时在下次启动或刷新时重试。
  }
}

function parseBlocklist(stored: Partial<BlocklistData> & Record<string, unknown>): BlocklistData {
  return {
    blockedTags: Array.isArray(stored?.blockedTags)
      ? stored.blockedTags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
      : DEFAULT_BLOCKLIST.blockedTags,
    blockedUsers: Array.isArray(stored?.blockedUsers)
      ? (stored.blockedUsers as unknown[])
          .filter((user): user is Record<string, unknown> => typeof user === "object" && user != null)
          .map((user): BlockedUser => ({
            id: typeof user.id === "number" ? user.id : 0,
            name: typeof user.name === "string" ? user.name : "",
            account: typeof user.account === "string" ? user.account : "",
            avatarURL: typeof user.avatarURL === "string" ? user.avatarURL : undefined,
          }))
          .filter((user) => user.id > 0 && user.name.length > 0)
      : DEFAULT_BLOCKLIST.blockedUsers,
  }
}

function persistBlocklist(blocklist: BlocklistData): boolean {
  try {
    writeTextSafely(blocklistFilePath(), JSON.stringify(blocklist, null, 2), (raw) => {
      const parsed = JSON.parse(raw)
      if (typeof parsed !== "object" || parsed === null) throw new Error("黑名单格式错误")
    })
  } catch (error: any) {
    console.log("blocklist persist error:", error?.message ?? error)
  }
  Storage.set(KEY, blocklist)
  return true
}

export function loadBlocklist(): BlocklistData {
  if (cachedBlocklist) return cachedBlocklist
  const path = blocklistFilePath()
  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const raw = FileManager.readAsStringSync(path, "utf-8")
      const parsed = JSON.parse(raw)
      cachedBlocklist = parseBlocklist(parsed)
      Storage.set(KEY, cachedBlocklist)
      return cachedBlocklist
    }
  } catch {
    // 文件解析异常时尝试读取缓存
  }

  const stored = Storage.get(KEY)
  if (stored && typeof stored === "object") {
    cachedBlocklist = parseBlocklist(stored as Partial<BlocklistData>)
    persistBlocklist(cachedBlocklist)
    return cachedBlocklist
  }

  cachedBlocklist = { ...DEFAULT_BLOCKLIST }
  persistBlocklist(cachedBlocklist)
  return cachedBlocklist
}

export function getBlocklist(): BlocklistData {
  return loadBlocklist()
}

function emitChanged(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // 单个监听器异常不影响其他
    }
  }
}

export function updateBlocklist(patch: Partial<BlocklistData>): BlocklistData {
  const current = loadBlocklist()
  const next: BlocklistData = {
    ...current,
    ...patch,
  }
  persistBlocklist(next)
  cachedBlocklist = next
  emitChanged()
  return next
}

export function onBlocklistChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export async function refreshBlocklistFromCloud(): Promise<void> {
  await prepareBlocklistStorage()
  cachedBlocklist = null
  loadBlocklist()
  emitChanged()
}

export function isTagBlocked(tag: string, blockedTags = loadBlocklist().blockedTags): boolean {
  return blockedTags.includes(tag)
}

export function blockTag(tag: string): BlocklistData {
  const name = tag.trim()
  if (!name) return loadBlocklist()
  const current = loadBlocklist()
  if (current.blockedTags.includes(name)) return current
  return updateBlocklist({ blockedTags: [...current.blockedTags, name] })
}

export function unblockTag(tag: string): BlocklistData {
  const current = loadBlocklist()
  return updateBlocklist({ blockedTags: current.blockedTags.filter((item) => item !== tag) })
}

export function isUserBlocked(userID: number, blockedUsers = loadBlocklist().blockedUsers): boolean {
  return blockedUsers.some((user) => user.id === userID)
}

export function blockUser(
  user:
    | PixivUser
    | BlockedUser
    | { id: number; name: string; account?: string; avatarURL?: string; profile_image_urls?: { medium?: string } }
): BlocklistData {
  const current = loadBlocklist()
  if (current.blockedUsers.some((item) => item.id === user.id)) return current
  const avatarURL =
    "avatarURL" in user && typeof user.avatarURL === "string"
      ? user.avatarURL
      : "profile_image_urls" in user && user.profile_image_urls
        ? typeof user.profile_image_urls === "string"
          ? user.profile_image_urls
          : user.profile_image_urls.medium
        : undefined
  return updateBlocklist({
    blockedUsers: [
      ...current.blockedUsers,
      {
        id: user.id,
        name: user.name,
        account: "account" in user && typeof user.account === "string" ? user.account : "",
        avatarURL,
      },
    ],
  })
}

export function unblockUser(userID: number): BlocklistData {
  const current = loadBlocklist()
  return updateBlocklist({ blockedUsers: current.blockedUsers.filter((user) => user.id !== userID) })
}

export function clearBlockedTags(): BlocklistData {
  return updateBlocklist({ blockedTags: [] })
}

export function clearBlockedUsers(): BlocklistData {
  return updateBlocklist({ blockedUsers: [] })
}
