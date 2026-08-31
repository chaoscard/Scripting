import { useLatest } from "../hooks"
import {
  HStack,
  Image,
  ProgressView,
  Rectangle,
  ScrollView,
  ScrollViewReader,
  Spacer,
  Text,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ScrollViewProxy,
} from "scripting"
import { loadSettings } from "../../store/settings"
const REFRESH_TOP_KEY = "__refresh_top"

export function RefreshableScrollView(props: {
  refreshable: () => Promise<void>
  navigationTitle?: string
  navigationBarTitleDisplayMode?: "automatic" | "inline" | "large"
  navigationDestination?: any
  searchable?: {
    value: string
    onChanged: (value: string) => void
    placement?:
      | "automatic"
      | "navigationBarDrawer"
      | "sidebar"
      | "toolbar"
      | "navigationBarDrawerAlwaysDisplay"
      | "navigationBarDrawerAutomaticDisplay"
    prompt?: string
    presented?: {
      value: boolean
      onChanged: (value: boolean) => void
    }
  }
  searchSuggestions?: any
  onSubmit?: any
  submitLabel?: "join" | "continue" | "return" | "send" | "go" | "search" | "done" | "next" | "route"
  ignoresSafeArea?: any
  toolbarBackground?: any
  toolbarBackgroundVisibility?: any
  background?: any
  children?: any
}) {
  // toolbar 等通用 View 属性由 Scripting 自动应用到自定义组件根视图；
  // 不要再传给内部 ScrollView，否则导航栏会合并出重复按钮。
  const proxyRef = useRef<ScrollViewProxy | null>(null)
  const refreshRef = useLatest(props.refreshable)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    // 无论刷新成功还是失败，都要让刷新指示器收起并回弹
    try {
      await refreshRef.current()
    } catch {
      // 刷新失败同样需要收起指示器
    }
    // 等新列表渲染完成、系统开始收起刷新指示器后，再主动滚回顶部
    if (timerRef.current != null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const proxy = proxyRef.current
      if (proxy) {
        withAnimation(() => {
          proxy.scrollTo(REFRESH_TOP_KEY, "top")
        })
      }
    }, 120)
  }, [])

  return (
    <ZStack>
      <Rectangle
        fill={props.background ?? "clear"}
        ignoresSafeArea={true}
      />
      <ScrollViewReader>
        {(proxy) => {
          proxyRef.current = proxy
          return (
            <ScrollView
              navigationTitle={props.navigationTitle}
              navigationBarTitleDisplayMode={props.navigationBarTitleDisplayMode}
              refreshable={handleRefresh}
              navigationDestination={props.navigationDestination}
              searchable={props.searchable}
              searchSuggestions={props.searchSuggestions}
              onSubmit={props.onSubmit}
              submitLabel={props.submitLabel}
              ignoresSafeArea={props.ignoresSafeArea}
              toolbarBackground={props.toolbarBackground}
              toolbarBackgroundVisibility={props.toolbarBackgroundVisibility}
            >
              <VStack
                key={REFRESH_TOP_KEY}
                alignment="leading"
                frame={{ maxWidth: "infinity" }}
              >
                {props.children}
              </VStack>
            </ScrollView>
          )
        }}
      </ScrollViewReader>
    </ZStack>
  )
}

// 异步图片加载状态（CachedImage / AvatarImage 共用）：


export function LoadMoreTrigger(props: {
  anchor: number | string
  onLoadMore: (anchor: number | string) => void
  hasMore: boolean
  isLoading?: boolean
}) {
  if (!props.hasMore) return null
  return (
    <VStack
      key={`load-more:${props.anchor}`}
      spacing={0}
      frame={{ height: 44, maxWidth: "infinity" }}
      onAppear={() => props.onLoadMore(props.anchor)}
    >
      {props.isLoading ? (
        <HStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <Spacer />
          <ProgressView progressViewStyle="circular" />
          <Spacer />
        </HStack>
      ) : null}
    </VStack>
  )
}

export function FilteredContentNotice(props: {
  isNovel?: boolean
  padding?: any
}) {
  const text = props.isNovel
    ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
    : "当前页面部分作品被内容显示设置过滤，暂时无法显示"
  return (
    <HStack
      spacing={6}
      padding={props.padding ?? { horizontal: 14, vertical: 4 }}
      frame={{ maxWidth: "infinity" }}
    >
      <Spacer />
      <Image systemName="eye.slash" font="caption" foregroundStyle="secondaryLabel" />
      <Text font="caption" foregroundStyle="secondaryLabel">
        {text}
      </Text>
      <Spacer />
    </HStack>
  )
}
