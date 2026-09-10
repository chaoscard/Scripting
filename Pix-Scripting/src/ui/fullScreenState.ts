import { useEffect, useState } from "scripting"

let isFullScreenState = true
const listeners = new Set<() => void>()

export function isFullScreen(): boolean {
  return isFullScreenState
}

export function toggleFullScreen() {
  isFullScreenState = !isFullScreenState
  listeners.forEach((l) => l())
}

export function setFullScreen(value: boolean) {
  if (isFullScreenState === value) return
  isFullScreenState = value
  listeners.forEach((l) => l())
}

export function useIsFullScreen(): boolean {
  const [value, setValue] = useState(isFullScreenState)
  useEffect(() => {
    const listener = () => setValue(isFullScreenState)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return value
}
