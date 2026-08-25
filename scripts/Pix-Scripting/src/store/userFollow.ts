type UserFollowListener = (userID: number, followed: boolean) => void

const listeners = new Set<UserFollowListener>()
const followedUserCache = new Map<number, boolean>()

export function onUserFollowChanged(listener: UserFollowListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyUserFollowChanged(userID: number, followed: boolean): void {
  followedUserCache.set(userID, followed)
  for (const listener of listeners) {
    try {
      listener(userID, followed)
    } catch {}
  }
}

export function isUserFollowed(userID: number): boolean | undefined {
  return followedUserCache.get(userID)
}

export function recordUserFollowed(userID: number, followed: boolean): void {
  if (typeof userID === "number" && userID > 0) {
    followedUserCache.set(userID, followed)
  }
}

export function clearFollowMemoryCache(): void {
  followedUserCache.clear()
}
