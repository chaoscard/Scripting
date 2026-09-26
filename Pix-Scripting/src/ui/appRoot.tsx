import {
  AppEvents,
  Device,
  Image,
  Navigation,
  NavigationStack,
  ProgressView,
  Rectangle,
  Script,
  Spacer,
  Tab,
  TabView,
  Text,
  VStack,
  ZStack,
  type Color,
  type ScenePhase,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
} from "scripting"
import { session } from "../api/session"
import { loadSettings, onSettingsChanged, updateSettings, type AppSettings } from "../store/settings"
import { ResponsiveContainer, useLayoutMetrics } from "./Hooks"
import { SPLIT_SHELL_MIN_WIDTH, SplitShell } from "./SplitShell"
import { SplitViewContainer } from "./DualRouteContext"
import { FeatureHighlightsSheet } from "./components/FeatureHighlightsSheet"
import { IpadSplitViewNoticeSheet } from "./components/IpadSplitViewNoticeSheet"
import { topBarScrollEdge } from "./components/pageChrome"
import {
  CapsuleAccessoryContainer,
  GlobalBottomAccessoryHost,
} from "./bottomAccessory"
import { getLatestCachedArtworkPath } from "../image/imageLoader"
import { DreamyFluidBackground } from "./components/DreamyBackground"
import { notifyLaunchReady, onLaunchReady } from "./LaunchCoordinator"
import { LoginView } from "./LoginView"
import {
  MainTabView,
  TAB_CONTENT_DEFS,
  useTabNavigation,
} from "./TabShellShared"
import "./routes"

function LaunchExperienceView() {
  const bgImage = useMemo(() => {
    try {
      const cachedPath = getLatestCachedArtworkPath()
      if (cachedPath) {
        const raw = UIImage.fromFile(cachedPath)
        if (raw) {
          return raw.blurred(1)
        }
      }
    } catch {}
    return null
  }, [])

  return (
    <ZStack
      alignment="center"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
      background="#070D1E"
    >
      {/* 1. 背景层：若有缓存插画则展示柔和高斯模糊图，若无则无缝展示梦幻流体光晕 */}
      {bgImage ? (
        <>
          <Rectangle
            fill="clear"
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            ignoresSafeArea={true}
            clipped={true}
            overlay={
              <Image
                image={bgImage}
                resizable={true}
                aspectRatio={{ contentMode: "fill" }}
                frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                clipped={true}
                ignoresSafeArea={true}
              />
            }
          />
          <Rectangle
            fill={{
              colors: [
                "rgba(0, 0, 0, 0.02)",
                "rgba(0, 0, 0, 0.08)",
                "rgba(0, 0, 0, 0.18)",
              ],
              startPoint: "top",
              endPoint: "bottom",
            }}
            ignoresSafeArea={true}
          />
        </>
      ) : (
        <DreamyFluidBackground />
      )}

      {/* 2. 居中品牌字与加载组件（严格与登录页保持一致的高质感排版） */}
      <VStack
        alignment="center"
        spacing={24}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}
        padding={32}
      >
        <Text
          font={38}
          fontWeight="heavy"
          foregroundStyle="white"
          shadow={{ color: "rgba(0, 0, 0, 0.32)", radius: 10, y: 3 }}
        >
          Pix-Scripting
        </Text>
        <VStack spacing={14} alignment="center" padding={{ top: 12 }}>
          <ProgressView progressViewStyle="circular" />
        </VStack>
      </VStack>
    </ZStack>
  )
}

type StartupSheetType = "none" | "highlights" | "splitView"

let hasAppLaunchedOnce = false

export function RootView() {
  const [loggedIn, setLoggedIn] = useState(session.isAuthenticated)
  const [isReady, setIsReady] = useState(() => hasAppLaunchedOnce)
  const [activeStartupSheet, setActiveStartupSheet] = useState<StartupSheetType>("none")
  const [settings, setSettings] = useState(() => loadSettings())

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  useEffect(() => {
    return session.onAuthChanged(() => {
      setLoggedIn(session.isAuthenticated)
    })
  }, [])

  useEffect(() => {
    if (hasAppLaunchedOnce) {
      setIsReady(true)
      return
    }
    let cancelled = false
    const startTime = Date.now()
    const hasStartupRoute = Boolean(
      Script.queryParameters?.route || Script.widgetParameter
    )
    const configuredDuration = loadSettings().launchAnimationDuration ?? 1500

    // 冷启动过渡体验：从小组件/外部直达特定作品时直接展现内容；若用户关闭启动动画（0ms）也直接进入
    if (hasStartupRoute || configuredDuration <= 0) {
      hasAppLaunchedOnce = true
      setIsReady(true)
      return
    }

    // 门禁就绪协调状态机（方案 A 精化模型）：
    // 1. 基准保证展示时长（guaranteedDuration = configuredDuration，保证动画完整与品牌视觉）；
    // 2. 顺延等待：若基准时长到达时首图尚未就绪，继续保持遮罩，并在首图就绪信号触发瞬间即刻揭幕；
    // 3. 最大看门狗超时（maxTimeout = guaranteedDuration + 1500ms，弱网与异常保底，绝不卡死）。
    const guaranteedDuration = configuredDuration
    const maxTimeout = guaranteedDuration + 1500

    let isImageReady = false
    let isGuaranteedElapsed = false
    let baseTimer: any = null
    let maxTimer: any = null

    const finishLaunch = () => {
      if (cancelled || hasAppLaunchedOnce) return
      hasAppLaunchedOnce = true
      setIsReady(true)
      if (baseTimer != null) clearTimeout(baseTimer)
      if (maxTimer != null) clearTimeout(maxTimer)
    }

    const unregister = onLaunchReady(() => {
      if (cancelled || hasAppLaunchedOnce) return
      isImageReady = true
      if (isGuaranteedElapsed) {
        // 基准展示时长已满，首图就绪瞬间立即揭幕
        finishLaunch()
      }
    })

    // 基准时长定时器
    baseTimer = setTimeout(() => {
      isGuaranteedElapsed = true
      if (isImageReady) {
        // 首图已在基准时间内就绪，准时优雅揭幕
        finishLaunch()
      }
      // 若尚未就绪，继续顺延等待首图信号或 maxTimer 触发
    }, guaranteedDuration)

    // 最大顺延看门狗保底
    maxTimer = setTimeout(() => {
      finishLaunch()
    }, maxTimeout)

    return () => {
      cancelled = true
      unregister()
      if (baseTimer != null) clearTimeout(baseTimer)
      if (maxTimer != null) clearTimeout(maxTimer)
    }
  }, [])

  useEffect(() => {
    if (!isReady || !loggedIn) return
    const hasStartupRoute = Boolean(
      Script.queryParameters?.route || Script.widgetParameter
    )
    if (hasStartupRoute) return

    const currentSettings = loadSettings()
    // 首次启动引导调度决策状态机：
    // 1. 若未在任何设备看过亮点展示：无论何种设备，优先弹出亮点展示
    if (!currentSettings.hasSeenFeatureHighlights) {
      const timer = setTimeout(() => {
        setActiveStartupSheet("highlights")
      }, 400)
      return () => clearTimeout(timer)
    }
    // 2. 若已看过亮点展示（如从 iPhone 同步配置的老用户），但当前在 iPad 且未看过平行视界提示：直接弹出平行视界引导
    if (Device.isiPad && !currentSettings.hasSeenIpadSplitViewNotice) {
      const timer = setTimeout(() => {
        setActiveStartupSheet("splitView")
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [isReady, loggedIn])

  const handleCloseHighlights = () => {
    setActiveStartupSheet("none")
    updateSettings({ hasSeenFeatureHighlights: true })

    // 若当前为 iPad 且尚未看过平行视界提示，等待前一个 Sheet 收起动画完成后优雅接力拉起
    const currentSettings = loadSettings()
    if (Device.isiPad && !currentSettings.hasSeenIpadSplitViewNotice) {
      setTimeout(() => {
        setActiveStartupSheet("splitView")
      }, 450)
    }
  }

  const handleCloseSplitView = () => {
    setActiveStartupSheet("none")
    updateSettings({ hasSeenIpadSplitViewNotice: true })
  }

  // 多任务隐私保护生命周期监听
  const [scenePhase, setScenePhase] = useState<ScenePhase>("active")
  useEffect(() => {
    const listener = (phase: ScenePhase) => {
      setScenePhase(phase)
    }
    AppEvents.scenePhase.addListener(listener)
    return () => {
      AppEvents.scenePhase.removeListener(listener)
    }
  }, [])

  const isPrivacyShieldActive =
    Script.env === "home_screen" &&
    settings.privacyShieldEnabled &&
    (scenePhase === "inactive" || scenePhase === "background")

  // 顶栏过渡：由设置驱动，随设置变更即时生效（上方已订阅 onSettingsChanged）
  const topBarEdge = topBarScrollEdge(settings.topBarEffect)

  const dismiss = Navigation.useDismiss()

  if (!loggedIn) {
    return (
      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background="clear"
        ignoresSafeArea={true}
        scrollEdgeEffectStyle={topBarEdge.scrollEdgeEffectStyle}
        scrollEdgeEffectHidden={topBarEdge.scrollEdgeEffectHidden}
      >
        <ResponsiveContainer>
          <NavigationStack>
            <LoginView
              onClose={dismiss}
              onSuccess={() => {
                setLoggedIn(true)
              }}
            />
          </NavigationStack>
        </ResponsiveContainer>

        {/* 隐私保护遮罩 */}
        {isPrivacyShieldActive ? (
          <Rectangle
            fill={settings.privacyShieldMaterial ?? "ultraThinMaterial"}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            ignoresSafeArea={true}
          />
        ) : null}
      </ZStack>
    )
  }

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="systemBackground"
      ignoresSafeArea={true}
      scrollEdgeEffectStyle={topBarEdge.scrollEdgeEffectStyle}
      scrollEdgeEffectHidden={topBarEdge.scrollEdgeEffectHidden}
      sheet={{
        isPresented: activeStartupSheet !== "none",
        onChanged: (val: boolean) => {
          if (!val) {
            if (activeStartupSheet === "highlights") {
              handleCloseHighlights()
            } else if (activeStartupSheet === "splitView") {
              handleCloseSplitView()
            } else {
              setActiveStartupSheet("none")
            }
          }
        },
        content:
          activeStartupSheet === "highlights" ? (
            <FeatureHighlightsSheet onClose={handleCloseHighlights} />
          ) : activeStartupSheet === "splitView" ? (
            <IpadSplitViewNoticeSheet onClose={handleCloseSplitView} />
          ) : (
            <VStack />
          ),
      }}
    >
      {/* 底层：主界面在第 0 毫秒即挂载并全力在后台请求数据与预载图片 */}
      <ResponsiveContainer>
        <ShellSwitcher settings={settings} onClose={dismiss} />
      </ResponsiveContainer>

      {/* 顶层：启动动画遮罩，根据调试设置自定义时长（默认 1500ms）平滑过渡 */}
      {!isReady ? (
        <LaunchExperienceView />
      ) : null}

      {/* 顶层：多任务隐私保护（纯净毛玻璃材质遮罩，不含任何多余图标文字） */}
      {isPrivacyShieldActive ? (
        <Rectangle
          fill={settings.privacyShieldMaterial ?? "ultraThinMaterial"}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          ignoresSafeArea={true}
        />
      ) : null}
    </ZStack>
  )
}

/**
 * 外壳选择器
 *
 * · iPad（含 Mac 上的 iOS App）+ 窗口达到 SPLIT_SHELL_MIN_WIDTH + 当前方向开启平行视界（横屏看 splitViewEnabledLandscape，竖屏看 splitViewEnabledPortrait）
 *   → 平行视界双栏外壳（SplitShell：左栏主流 + 右栏详情）
 * · 其余（iPhone / 窗口过窄 / 当前方向关闭）→ 原有 TabView 外壳，行为完全不变
 *
 * 两个外壳互斥挂载，因此 useTabNavigation 的注册不会重复。
 */
function ShellSwitcher(props: { onClose: () => void; settings: AppSettings }) {
  const metrics = useLayoutMetrics()
  const isLargeScreen = Device.isiPad || (Device as any).isiOSAppOnMac
  const isSplitActive = metrics.isLandscape
    ? props.settings.splitViewEnabledLandscape
    : props.settings.splitViewEnabledPortrait
  const useSplitShell =
    Boolean(isLargeScreen) &&
    isSplitActive &&
    metrics.width >= SPLIT_SHELL_MIN_WIDTH

  return useSplitShell ? (
    <SplitShell onClose={props.onClose} />
  ) : (
    <TabViewShell onClose={props.onClose} width={metrics.width} height={metrics.height} />
  )
}

/**
 * TabView 外壳容器
 *
 * 刻意**复用旧实现 `SplitViewContainer`**（传 splitViewEnabled=false）：
 * 未开启分栏时它就是「单栏 + 显式尺寸撑满 + 提供 DualRouteContext」那套早已验证过的行为，
 * 一行不改地保留下来，避免重写包裹层时静默丢掉上下文或尺寸。
 */
function TabViewShell(props: { onClose: () => void; width: number; height: number }) {
  return (
    <SplitViewContainer splitViewEnabled={false}>
      <MainTabView onClose={props.onClose} />
    </SplitViewContainer>
  )
}
