import {
  Button,
  createContext,
  Device,
  HStack,
  Image,
  NavigationLink,
  NavigationStack,
  Rectangle,
  RoundedRectangle,
  Spacer,
  Text,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { normalizeRoute, renderDestination } from "./routes"
import { ContainerLayoutContext, useLayoutMetrics } from "./hooks"
import { setDualRouteDispatcher } from "./routeNavigation"
import { DetailBottomAccessoryHost } from "./bottomAccessory"
import { loadSettings, onSettingsChanged } from "../store/settings"

export const SPLIT_VIEW_MIN_WIDTH = 860
export const MASTER_PANE_WIDTH = 440

export interface DualRouteContextValue {
  isSplitViewActive: boolean
  activeDetailRoute: string | null
  detailStack: string[]
  openDetailRoute: (route: string) => void
  pushDetailRoute: (route: string) => void
  popDetailRoute: () => void
  closeDetail: () => void
  isRouteActive: (route: string) => boolean
  isItemActive: (
    type: "illust" | "novel" | "user" | "pixivision" | "mangaSeries" | "novelSeries" | "tag" | "other",
    id: number | string
  ) => boolean
}

export const DualRouteContext = createContext<DualRouteContextValue | null>()

export function useDualRoute(): DualRouteContextValue {
  const ctx = useContext(DualRouteContext)
  if (ctx) return ctx
  return {
    isSplitViewActive: false,
    activeDetailRoute: null,
    detailStack: [],
    openDetailRoute: () => {},
    pushDetailRoute: () => {},
    popDetailRoute: () => {},
    closeDetail: () => {},
    isRouteActive: () => false,
    isItemActive: () => false,
  }
}

/**
 * 统一卡片与列表项路由跳转组件
 * - 在 iPad 横屏双栏（平行视界）下拦截为右侧详情加载
 * - 在单栏 / 手机模式下保持原生 NavigationLink 深度入栈
 */
export function AppNavigationLink(props: {
  value: string
  children: any
  frame?: any
  contextMenu?: any
  buttonStyle?: any
  onTap?: () => void
}) {
  const { isSplitViewActive, openDetailRoute } = useDualRoute()
  const targetRoute = useMemo(() => normalizeRoute(props.value), [props.value])

  if (isSplitViewActive && targetRoute) {
    return (
      <Button
        buttonStyle={props.buttonStyle ?? "plain"}
        action={() => {
          openDetailRoute(targetRoute)
          props.onTap?.()
        }}
        contextMenu={props.contextMenu}
        frame={props.frame}
      >
        {props.children}
      </Button>
    )
  }

  return (
    <NavigationLink
      value={props.value}
      contextMenu={props.contextMenu}
      frame={props.frame}
    >
      {props.children}
    </NavigationLink>
  )
}

/**
 * 右侧详情栏空状态占位视图 (Telegram / iPadOS 风格)
 */
export function DetailEmptyPlaceholder() {
  return (
    <ZStack
      alignment="center"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="systemGroupedBackground"
      ignoresSafeArea={true}
    >
      <VStack alignment="center" spacing={16} padding={32}>
        <ZStack alignment="center" frame={{ width: 88, height: 88 }}>
          <RoundedRectangle
            fill="tertiarySystemFill"
            cornerRadius={24}
            frame={{ width: 88, height: 88 }}
          />
          <Image
            systemName="photo.on.rectangle.angled"
            font="largeTitle"
            foregroundStyle="secondaryLabel"
          />
        </ZStack>
        <VStack alignment="center" spacing={6}>
          <Text font="title3" fontWeight="bold" foregroundStyle="label">
            选择作品开始浏览
          </Text>
          <Text
            font="subheadline"
            foregroundStyle="secondaryLabel"
            multilineTextAlignment="center"
            frame={{ maxWidth: 320 }}
          >
            在左侧选择插画、小说、画师或特辑，在此处沉浸查看超清大图与详细内容
          </Text>
        </VStack>
      </VStack>
    </ZStack>
  )
}

/**
 * 右侧详情单个路由视图（导航栏左侧挂载返回箭头）
 */
function DetailPaneRouteView(props: {
  route: string
  canGoBack: boolean
  onBack: () => void
  onClose: () => void
}) {
  const content = renderDestination(props.route)

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
      toolbarBackground="clear"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      toolbar={{
        topBarLeading: (
          <Button
            buttonStyle="plain"
            action={props.canGoBack ? props.onBack : props.onClose}
          >
            <Image
              systemName="chevron.backward"
              font="body"
              fontWeight="semibold"
              foregroundStyle="label"
            />
          </Button>
        ),
      }}
    >
      {content}
    </ZStack>
  )
}

/**
 * 右侧详情宿主容器（含二级下钻导航栏、苹果音乐底栏与内容呈现）
 */
export function DetailPaneHost(props: {
  width: number
  height: number
  detailStack: string[]
  onBack: () => void
  onClose: () => void
}) {
  const currentRoute =
    props.detailStack.length > 0
      ? props.detailStack[props.detailStack.length - 1]
      : null

  const canGoBack = props.detailStack.length > 1
  const [settings, setSettings] = useState(() => loadSettings())

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  const isAppleMusic = settings.pageLayout === "appleMusic"

  return (
    <ContainerLayoutContext.Provider
      value={{
        width: props.width,
        height: props.height,
      }}
    >
      <ZStack
        alignment="bottom"
        frame={{ width: props.width, height: props.height }}
        ignoresSafeArea={true}
        clipped={true}
      >
        <NavigationStack>
          {currentRoute ? (
            <DetailPaneRouteView
              key={currentRoute}
              route={currentRoute}
              canGoBack={canGoBack}
              onBack={props.onBack}
              onClose={props.onClose}
            />
          ) : (
            <DetailEmptyPlaceholder />
          )}
        </NavigationStack>

        {/* 苹果音乐样式底栏配件（若开启苹果音乐布局，在右侧底部浮动呈现当前作品操作台） */}
        {isAppleMusic && currentRoute ? (
          <DetailBottomAccessoryHost route={currentRoute} />
        ) : null}
      </ZStack>
    </ContainerLayoutContext.Provider>
  )
}

/**
 * 平行视界双栏容器组件
 * 自动感知设备尺寸、窗口宽度与用户设置，智能切换单栏与双栏
 */
export function SplitViewContainer(props: {
  children: any
  splitViewEnabled: boolean
}) {
  const metrics = useLayoutMetrics()
  const isLargeScreen = Device.isiPad || (Device as any).isiOSAppOnMac
  const canSplit =
    Boolean(isLargeScreen) &&
    props.splitViewEnabled !== false &&
    metrics.width >= SPLIT_VIEW_MIN_WIDTH

  const [detailStack, setDetailStack] = useState<string[]>([])

  const activeDetailRoute =
    detailStack.length > 0 ? detailStack[detailStack.length - 1] : null

  const openDetailRoute = useCallback((route: string) => {
    const normalized = normalizeRoute(route)
    if (!normalized) return
    setDetailStack([normalized])
  }, [])

  const pushDetailRoute = useCallback((route: string) => {
    const normalized = normalizeRoute(route)
    if (!normalized) return
    setDetailStack((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === normalized) return prev
      return [...prev, normalized]
    })
  }, [])

  const popDetailRoute = useCallback(() => {
    setDetailStack((prev) =>
      prev.length > 1 ? prev.slice(0, prev.length - 1) : prev
    )
  }, [])

  const closeDetail = useCallback(() => {
    setDetailStack([])
  }, [])

  const isRouteActive = useCallback(
    (route: string) => {
      if (!canSplit || !activeDetailRoute) return false
      return normalizeRoute(route) === activeDetailRoute
    },
    [canSplit, activeDetailRoute]
  )

  const isItemActive = useCallback(
    (
      type: "illust" | "novel" | "user" | "pixivision" | "mangaSeries" | "novelSeries" | "tag" | "other",
      id: number | string
    ) => {
      if (!canSplit || !activeDetailRoute) return false
      const prefix = `${type}:`
      if (activeDetailRoute.startsWith(prefix)) {
        return activeDetailRoute === `${prefix}${id}`
      }
      return false
    },
    [canSplit, activeDetailRoute]
  )

  // 注册全局双栏路由分发器：当处于双栏模式且请求了详情类路由时拦截到右侧
  useEffect(() => {
    if (!canSplit) {
      return setDualRouteDispatcher(null)
    }
    return setDualRouteDispatcher((route: string) => {
      pushDetailRoute(route)
      return true
    })
  }, [canSplit, pushDetailRoute])

  const contextValue: DualRouteContextValue = useMemo(
    () => ({
      isSplitViewActive: canSplit,
      activeDetailRoute,
      detailStack,
      openDetailRoute,
      pushDetailRoute,
      popDetailRoute,
      closeDetail,
      isRouteActive,
      isItemActive,
    }),
    [
      canSplit,
      activeDetailRoute,
      detailStack,
      openDetailRoute,
      pushDetailRoute,
      popDetailRoute,
      closeDetail,
      isRouteActive,
      isItemActive,
    ]
  )

  const masterWidth = canSplit ? MASTER_PANE_WIDTH : metrics.width
  const detailWidth = Math.max(metrics.width - masterWidth, 400)

  return (
    <DualRouteContext.Provider value={contextValue}>
      <HStack spacing={0} frame={{ width: metrics.width, height: metrics.height }} clipped={true}>
        {/* 左侧 Master 浏览流（双栏模式下锁定为 440pt，单栏模式下为屏幕全宽） */}
        <ContainerLayoutContext.Provider
          value={{
            width: masterWidth,
            height: metrics.height,
          }}
        >
          <VStack
            frame={{ width: masterWidth, height: metrics.height }}
            background="systemBackground"
            clipped={true}
          >
            {props.children}
          </VStack>
        </ContainerLayoutContext.Provider>

        {/* 中间高品质分割线（仅双栏平行视界激活时展示） */}
        {canSplit ? (
          <Rectangle
            fill="separator"
            frame={{ width: 0.5, height: metrics.height }}
          />
        ) : null}

        {/* 右侧 Detail 详情大屏宿主（仅双栏平行视界激活时展示） */}
        {canSplit ? (
          <DetailPaneHost
            width={detailWidth}
            height={metrics.height}
            detailStack={detailStack}
            onBack={popDetailRoute}
            onClose={closeDetail}
          />
        ) : null}
      </HStack>
    </DualRouteContext.Provider>
  )
}
