type UserFollowListener = (userID: number, followed: boolean) => void

const listeners = new Set<UserFollowListener>()

export function onUserFollowChanged(listener: UserFollowListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyUserFollowChanged(userID: number, followed: boolean): void {
  for (const listener of listeners) {
    try {
      listener(userID, followed)
    } catch {
    }
  }
}
