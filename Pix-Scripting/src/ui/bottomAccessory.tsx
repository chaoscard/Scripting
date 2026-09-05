import {
  Button,
  HStack,
  Spacer,
  Text,
  useEffect,
  useState,
} from "scripting"

type ObservableLike<T> = { value: T }
type AccessoryNode = any

const accessoryRegistry = new Map<string, AccessoryNode>()
const listeners = new Set<() => void>()

export function subscribeBottomAccessory(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyBottomAccessory() {
  for (const fn of listeners) {
    try {
      fn()
    } catch {}
  }
}

export function registerBottomAccessory(key: string, node: AccessoryNode) {
  if (accessoryRegistry.get(key) === node) return
  accessoryRegistry.set(key, node)
  notifyBottomAccessory()
}

export function unregisterBottomAccessory(key: string) {
  if (accessoryRegistry.has(key)) {
    accessoryRegistry.delete(key)
    notifyBottomAccessory()
  }
}

export function useRegisterBottomAccessory(
  key: string,
  node: AccessoryNode,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled || !node) {
      unregisterBottomAccessory(key)
      return
    }
    registerBottomAccessory(key, node)
    return () => {
      unregisterBottomAccessory(key)
    }
  }, [key, node, enabled])
}

export function getActiveAccessoryKey(
  activeTab: string,
  activePath: string[]
): string | null {
  if (activePath.length === 0) {
    if (activeTab === "discovery") return "discovery"
    if (activeTab === "ranking") return "ranking"
    if (activeTab === "following") return "following"
    if (activeTab === "search") return "search"
    return null
  }

  const top = activePath[activePath.length - 1]
  if (top === "library") return "library"
  if (top === "history") return "history"
  if (top.startsWith("userBookmarks:")) return "userBookmarks"
  if (top.startsWith("user:") || top === "myWorks") return "userWorks"
  return null
}

export function getActiveAccessory(
  activeTab: string,
  activePath: string[]
): any | null {
  const key = getActiveAccessoryKey(activeTab, activePath)
  if (!key) return null
  return accessoryRegistry.get(key) ?? null
}

export interface DockSegmentedItem<T extends string = string> {
  tag: T
  label: string
}

export function DockSegmentedBar<T extends string = string>(props: {
  items: ReadonlyArray<DockSegmentedItem<T>>
  value: T
  onChanged: (val: T) => void
  scrollable?: boolean
}) {
  // 限制榜单数量上限为 3 个后，全 App 统一采用全宽 1:1 均分布局：
  // 1. 未收起状态：在宽胶囊中等分铺满，绝对居中对称，两端不留白；
  // 2. 收起状态：在中央胶囊（180pt）内 3 个选项完整展示，选中的红字项与未选中的蓝字项 100% 清晰可见，绝不遮挡。
  return (
    <HStack
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      padding={{ horizontal: 6 }}
    >
      {props.items.map((item) => {
        const isSelected = item.tag === props.value
        return (
          <Button
            key={item.tag}
            buttonStyle="plain"
            frame={{ maxWidth: "infinity" }}
            action={() => {
              if (item.tag !== props.value) {
                props.onChanged(item.tag)
              }
            }}
          >
            <HStack
              alignment="center"
              frame={{ maxWidth: "infinity" }}
              padding={{ vertical: 6 }}
            >
              <Text
                font="subheadline"
                fontWeight={isSelected ? "bold" : "regular"}
                foregroundStyle={isSelected ? "#EE2F49" : "#3172EB"}
                lineLimit={1}
                fixedSize={{ horizontal: true, vertical: false }}
              >
                {item.label}
              </Text>
            </HStack>
          </Button>
        )
      })}
    </HStack>
  )
}

export function CapsuleAccessoryContainer(props: { children: any }) {
  return (
    <HStack
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      padding={{ horizontal: 8, top: 1, bottom: 2 }}
    >
      {props.children}
    </HStack>
  )
}
