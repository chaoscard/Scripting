export type FollowRestrict = "public" | "private"

export interface UserFollowState {
  followed: boolean
  restrict?: FollowRestrict
}

export type UserFollowListener = (
  userID: number,
  followed: boolean,
  restrict?: FollowRestrict
) => void

const listeners = new Set<UserFollowListener>()
const followedUserCache = new Map<number, UserFollowState>()

export function onUserFollowChanged(listener: UserFollowListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyUserFollowChanged(
  userID: number,
  followed: boolean,
  restrict?: FollowRestrict
): void {
  if (typeof userID !== "number" || userID <= 0) return
  const nextRestrict = followed ? (restrict ?? "public") : undefined
  const nextState: UserFollowState = {
    followed,
    restrict: nextRestrict,
  }
  followedUserCache.set(userID, nextState)
  for (const listener of listeners) {
    try {
      listener(userID, followed, nextRestrict)
    } catch {}
  }
}

export function isUserFollowed(userID: number): boolean | undefined {
  return followedUserCache.get(userID)?.followed
}

export function getUserFollowRestrict(userID: number): FollowRestrict | undefined {
  return followedUserCache.get(userID)?.restrict
}

export function getUserFollowState(userID: number): UserFollowState | undefined {
  return followedUserCache.get(userID)
}

/**
 * 补录服务端列表/作品接口附带的创作者快照（Cache-First 语义）：
 * 仅当本地内存尚无该创作者记录时才录入初值并广播；若本地已有记录，严禁被附带快照覆盖。
 */
export function recordUserFollowed(
  userID: number,
  followed: boolean,
  restrict?: FollowRestrict
): void {
  if (typeof userID !== "number" || userID <= 0) return
  // Cache-First：若已有记录，保持本地真源不动，不被附带快照覆盖
  if (!followedUserCache.has(userID)) {
    const nextRestrict = followed ? (restrict ?? "public") : undefined
    followedUserCache.set(userID, { followed, restrict: nextRestrict })
    for (const listener of listeners) {
      try {
        listener(userID, followed, nextRestrict)
      } catch {}
    }
  }
}

/**
 * 仲裁当前创作者的实际生效关注状态：
 * 优先取本地缓存，无缓存时回退至传入的服务端快照。
 */
export function getEffectiveFollowState(
  userID: number,
  fallbackFollowed = false,
  fallbackRestrict: FollowRestrict | null = null
): { followed: boolean; restrict: FollowRestrict | null } {
  const cached = followedUserCache.get(userID)
  if (cached) {
    return {
      followed: cached.followed,
      restrict: cached.followed ? (cached.restrict ?? "public") : null,
    }
  }
  return {
    followed: fallbackFollowed,
    restrict: fallbackFollowed ? (fallbackRestrict ?? "public") : null,
  }
}

export function clearFollowMemoryCache(): void {
  followedUserCache.clear()
}

export type OpenRelatedUsersListener = (userID: number, userName?: string) => void
const relatedUsersListeners = new Set<OpenRelatedUsersListener>()

export function onOpenRelatedUsers(listener: OpenRelatedUsersListener): () => void {
  relatedUsersListeners.add(listener)
  return () => relatedUsersListeners.delete(listener)
}

export function notifyOpenRelatedUsers(userID: number, userName?: string): void {
  for (const listener of relatedUsersListeners) {
    try {
      listener(userID, userName)
    } catch {}
  }
}
