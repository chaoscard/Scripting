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
  const nextState: UserFollowState = {
    followed,
    restrict: followed ? (restrict ?? "public") : undefined,
  }
  followedUserCache.set(userID, nextState)
  for (const listener of listeners) {
    try {
      listener(userID, followed, nextState.restrict)
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

export function recordUserFollowed(
  userID: number,
  followed: boolean,
  restrict?: FollowRestrict
): void {
  if (typeof userID === "number" && userID > 0) {
    const existing = followedUserCache.get(userID)
    followedUserCache.set(userID, {
      followed,
      restrict: followed ? (restrict ?? existing?.restrict) : undefined,
    })
  }
}

export function clearFollowMemoryCache(): void {
  followedUserCache.clear()
}
