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
import {
  PAGE_TOOLBAR_BACKGROUND,
  PAGE_TOOLBAR_BACKGROUND_VISIBILITY,
} from "./components/pageChrome"
import { ContainerLayoutContext, useLayoutMetrics } from "./hooks"
import { useExperimentalAmbientPalette } from "./ambient/useIllustAmbient"
import { useLastActiveAmbientImageUrl } from "./ambient/tracker"
import {
  normalizeRoute,
  renderDetailDestination,
  requestPixivRoute,
  setDualRouteDispatcher,
  useIsCurrentTab,
} from "../store/routeNavigation"
import { session } from "../api/session"
import { DetailBottomAccessoryHost } from "./bottomAccessory"
import { loadSettings, onSettingsChanged } from "../store/settings"

export const SPLIT_VIEW_MIN_WIDTH = 860
export const MASTER_PANE_WIDTH = 440

/**
 * 右栏（作品与工具区）认领的路由白名单。
 *
 * 【设计意图】右栏 = 看内容 / 管工具；中栏 = 逛。
 * 判断标准是「点它之后，我还想不想继续保有左边的列表」：
 *  · 作品详情（插画 / 小说 / 特辑）→ 右栏大屏阅读；
 *  · 工具型页面（下载管理 / 设置 / 关于）→ 右栏，因为它们是「离开浏览语境的操作」，不打断中栏；
 *  · 其余一切（收藏库 / 浏览记录 / 小说书签 / 关注·好友·粉丝 / 作品列表 / 通知 /
 *    系列 / 标签 / 相关作品…）→ 中栏，因为它们本质是「另一种列表」，
 *    放中栏才能形成「列表 → 点作品 → 右栏大屏」的连续动线。
 *
 * ⇒ 以后新增页面时，靠这段判断它该去哪一栏，不必每次重新讨论。
 */
const PANE_ROUTE_PREFIXES = [
  // 作品详情
  "illust:",
  "illustDetail:",
  "novel:",
  "novelDetail:",
  "pixivision:",
  // 工具型页面（带参数的形式）
  "downloadDetail:",
  "downloadCreator:",
  "rankingCustomPicker:",
  "historyAnalytics:",
] as const

const PANE_ROUTE_EXACT = [
  // 工具型页面（无参数）
  "downloadManager",
  "downloadTasks",
  "downloadCreators",
  "settings",
  "customAISettings",
  "blockedSettings",
  "about",
  "historyAnalytics",
] as const

/** 该路由是否属于右栏（作品与工具区） */
export function isPaneRoute(route: string): boolean {
  const normalized = normalizeRoute(route)
  if (!normalized) return false
  if (PANE_ROUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true
  return (PANE_ROUTE_EXACT as readonly string[]).includes(normalized)
}

export interface DualRouteContextValue {
  isSplitViewActive: boolean
  /**
   * 当前是否位于**分栏外壳的右栏（详情栏）内部**。
   *
   * 与 isSplitViewActive 的区别：后者在中栏与右栏都是 true，本字段只在右栏为 true。
   * 用途：右栏内的详情页据此把作品标题写进导航栏（中栏 / iPhone 保持空标题）。
   */
  isDetailPane: boolean
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
    isDetailPane: false,
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
 *
 * 三种分流：
 *  1. 单栏 / 手机 → 原生 NavigationLink 深度入栈（维持现状）
 *  2. 分栏 + 路由属于右栏 → openDetailRoute（右栏内容；右栏内部会被重定向为「入栈」以保留返回箭头）
 *  3. 分栏 + 其余路由 → requestPixivRoute（全局分发器不认领 → 落到当前 Tab 的导航栈，即中栏）
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
    const paneRoute = isPaneRoute(targetRoute)
    return (
      <Button
        buttonStyle={props.buttonStyle ?? "plain"}
        action={() => {
          if (paneRoute) {
            openDetailRoute(targetRoute)
          } else {
            // 不直接 push：交给全局分发器统一裁决（dispatcher 不认领时自动落到中栏栈）
            requestPixivRoute(targetRoute)
          }
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
 *
 * 沉浸色复用：Tracker 里存的是「最近一次在前台生效的环境光封面」，
 * 中栏当前浏览页每换一次首图就会更新它。这里订阅同一份参数并交给同一个渲染器，
 * 于是右栏空态与中栏是同一套色调（中栏换图时跟着变），而不是一块死板的系统灰。
 */
export function DetailEmptyPlaceholder() {
  const userAvatarUrl = session.user?.profile_image_urls?.px_170x170 ?? null
  const lastActiveUrl = useLastActiveAmbientImageUrl()
  const ambientUrl = lastActiveUrl || userAvatarUrl
  const { ambientBackground } = useExperimentalAmbientPalette(ambientUrl, true)

  return (
    <ZStack
      alignment="center"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="systemGroupedBackground"
      ignoresSafeArea={true}
    >
      {ambientBackground}
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
        </VStack>
      </VStack>
    </ZStack>
  )
}

/**
 * 右侧详情单个路由视图（导航栏左侧挂载返回箭头）
 *
 * ⚠️ 本视图**绝不能** ignoresSafeArea（2026-09-17 修）：
 *    它所在的内胆容器（DetailPaneContent）给的是**栏内安全区尺寸**，
 *    这里再忽略安全区会把整页内容向上顶出一个安全区高度 —— 顶部被导航栏与状态栏压住。
 *    页面自己的环境光背景层各自显式 ignoresSafeArea，不需要本层代劳。
 */
function DetailPaneRouteView(props: {
  route: string
  canGoBack: boolean
  onBack: () => void
  onClose: () => void
  isAppleMusic?: boolean
}) {
  const content = renderDetailDestination(props.route)

  return (
    <ZStack
      alignment="bottom"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      toolbarBackground={PAGE_TOOLBAR_BACKGROUND}
      toolbarBackgroundVisibility={PAGE_TOOLBAR_BACKGROUND_VISIBILITY}
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

      {/* 苹果音乐样式底栏配件（位于 NavigationStack 内部，由系统 Safe Area 管道自动避让抬高） */}
      {props.isAppleMusic ? (
        <DetailBottomAccessoryHost route={props.route} />
      ) : null}
    </ZStack>
  )
}

/**
 * 右侧详情栏**内胆**（不含宽度来源）：导航栈 + 苹果音乐浮动胶囊。
 *
 * 两种外壳共用：
 *  · 旧的自行分栏（DetailPaneHost）：外层给定 width/height + ContainerLayoutContext
 *  · iPad 三分栏外壳（SplitShell）：宽度由系统分配，外层套 ResponsiveContainer
 *
 * ⚠️ 胶囊必须是 NavigationStack 的**兄弟节点**，不能放进去：
 *    根视图在切换路由时会被整体替换，放里面会导致胶囊随详情切换而消失。
 */
export function DetailPaneContent(props: {
  detailStack: string[]
  onBack: () => void
  onClose: () => void
  width?: number
  height?: number
  /**
   * 是否让内容延伸进安全区。
   * · 旧外壳（自研 HStack）传 true：它给的宽度/高度是**整窗尺寸（含安全区）**，必须开启才铺满；
   * · iPad 分栏外壳传 false：它用的是 ResponsiveContainer 实测的**栏内尺寸（已排除安全区）**，
   *   再开 ignoresSafeArea 会在顶部多撑一截、导致**底部被裁掉**。
   */
  ignoreSafeArea?: boolean
}) {
  const currentRoute =
    props.detailStack.length > 0
      ? props.detailStack[props.detailStack.length - 1]
      : null

  const canGoBack = props.detailStack.length > 1
  const [settings, setSettings] = useState(() => loadSettings())

  // 右栏内部：把「打开作品」重定向为「入栈」，从而在右栏里继续点相关作品时保留返回箭头；
  // 中栏的点击走外层上下文，仍是「替换」语义。
  const parentRoute = useDualRoute()
  const paneRouteValue = useMemo<DualRouteContextValue>(
    () => ({
      ...parentRoute,
      openDetailRoute: parentRoute.pushDetailRoute,
      isDetailPane: true,
    }),
    [parentRoute]
  )

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  const isAppleMusic = settings.pageLayout === "appleMusic"

  return (
    <DualRouteContext.Provider value={paneRouteValue}>
      {/*
        ⚠️ 这里**不能 clipped**（2026-09-17 修）：
        本容器给的是栏内安全区尺寸，而页面自带的环境光背景层是显式 ignoresSafeArea 的
        （见 ambient/renderAmbientBackground、ambient/useUserAmbient），
        它们必须溢出到状态栏后面才能实现追色沉浸；一旦裁剪，溢出部分被吃掉，
        状态栏那一条永远上不了色。
        内容层不必担心溢出：ScrollView 自身会裁剪其滚动内容。
      */}
      <ZStack
        alignment="bottom"
        frame={
          props.width != null && props.height != null
            ? { width: props.width, height: props.height }
            : { maxWidth: "infinity", maxHeight: "infinity" }
        }
        ignoresSafeArea={props.ignoreSafeArea !== false}
      >
        <NavigationStack>
          {currentRoute ? (
            <DetailPaneRouteView
              key={currentRoute}
              route={currentRoute}
              canGoBack={canGoBack}
              onBack={props.onBack}
              onClose={props.onClose}
              isAppleMusic={isAppleMusic}
            />
          ) : (
            <DetailEmptyPlaceholder />
          )}
        </NavigationStack>
      </ZStack>
    </DualRouteContext.Provider>
  )
}

/**
 * 旧的自研分栏专用：给内胆注入「本栏实宽」，使内部 useLayoutMetrics() 拿到栏宽而非整屏宽。
 */
export function DetailPaneHost(props: {
  width: number
  height: number
  detailStack: string[]
  onBack: () => void
  onClose: () => void
}) {
  return (
    <ContainerLayoutContext.Provider
      value={{
        width: props.width,
        height: props.height,
      }}
    >
      <DetailPaneContent
        width={props.width}
        height={props.height}
        detailStack={props.detailStack}
        onBack={props.onBack}
        onClose={props.onClose}
      />
    </ContainerLayoutContext.Provider>
  )
}

export interface DualRouteState {
  /** 是否处于双栏（平行视界）模式 */
  canSplit: boolean
  /** 供 DualRouteContext.Provider 使用的上下文值 */
  value: DualRouteContextValue
  detailStack: string[]
  openDetailRoute: (route: string) => void
  pushDetailRoute: (route: string) => void
  popDetailRoute: () => void
  closeDetail: () => void
}

/**
 * 平行视界状态机（**外壳无关**）：详情栈 + 全局路由拦截 + 上下文值。
 *
 * 两种外壳共用同一份逻辑，保证「点卡片 → 进右栏」的行为完全一致：
 *  · 旧的自研 HStack 分栏：SplitViewContainer
 *  · iPad 三分栏外壳：SplitShell
 */
export function useDualRouteState(
  splitViewEnabled: boolean,
  /**
   * 强制启用双栏路由（iPad 分栏外壳专用）。
   * 分栏外壳下即使窗口缩到 860pt 以下，也仍然由系统折叠栏位、而不是整体换外壳；
   * 此时「点卡片 → 进右栏」必须继续生效，所以不能再用 860 门槛卡它。
   */
  forceActive = false
): DualRouteState {
  const metrics = useLayoutMetrics()
  const isLargeScreen = Device.isiPad || (Device as any).isiOSAppOnMac
  const canSplit =
    splitViewEnabled !== false &&
    (forceActive || (Boolean(isLargeScreen) && metrics.width >= SPLIT_VIEW_MIN_WIDTH))

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
    setDetailStack((prev) => (prev.length > 1 ? prev.slice(0, prev.length - 1) : prev))
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
      setDualRouteDispatcher(null)
      return
    }
    return setDualRouteDispatcher((route: string) => {
      // 只认领右栏路由；其余返回 false → 由路由系统落到「当前 Tab 的导航栈」（中栏）
      if (!isPaneRoute(route)) return false
      pushDetailRoute(route)
      return true
    })
  }, [canSplit, pushDetailRoute])

  const value: DualRouteContextValue = useMemo(
    () => ({
      isSplitViewActive: canSplit,
      // 外壳层（中栏 / 右栏的公共祖先）永远不是「右栏内部」，右栏由 DetailPaneContent 覆写
      isDetailPane: false,
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

  return {
    canSplit,
    value,
    detailStack,
    openDetailRoute,
    pushDetailRoute,
    popDetailRoute,
    closeDetail,
  }
}

/**
 * 平行视界双栏容器组件（**旧外壳**；iPad 上已由 SplitShell 接管，保留供兼容）
 * 自动感知设备尺寸、窗口宽度与用户设置，智能切换单栏与双栏
 */
export function SplitViewContainer(props: {
  children: any
  splitViewEnabled: boolean
}) {
  const metrics = useLayoutMetrics()
  const state = useDualRouteState(props.splitViewEnabled)
  const canSplit = state.canSplit

  const masterWidth = canSplit ? MASTER_PANE_WIDTH : metrics.width
  const detailWidth = Math.max(metrics.width - masterWidth, 400)

  return (
    <DualRouteContext.Provider value={state.value}>
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
            detailStack={state.detailStack}
            onBack={state.popDetailRoute}
            onClose={state.closeDetail}
          />
        ) : null}
      </HStack>
    </DualRouteContext.Provider>
  )
}
