import {
  HStack,
  Rectangle,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import {
  ContainerLayoutContext,
  ResponsiveContainer,
  useLayoutMetrics,
} from "./hooks"
import {
  MainTabView,
} from "./tabShellShared"
import {
  DetailPaneContent,
  DualRouteContext,
  useDualRouteState,
} from "./DualRouteContext"
import {
  ImmersiveReadContext,
  type ImmersiveReadContextValue,
} from "./immersiveRead"
import { loadSettings, onSettingsChanged } from "../store/settings"

/**
 * 启用 iPad 分栏外壳的最小窗口宽度。
 */
export const SPLIT_SHELL_MIN_WIDTH = 640

/** 详情栏主体：必须位于 ResponsiveContainer 内部拿到本栏实宽 */
function DetailColumnBody(props: {
  detailStack: string[]
  onBack: () => void
  onClose: () => void
}) {
  const metrics = useLayoutMetrics()

  return (
    <DetailPaneContent
      width={metrics.width}
      height={metrics.height}
      ignoreSafeArea={false}
      detailStack={props.detailStack}
      onBack={props.onBack}
      onClose={props.onClose}
    />
  )
}

/**
 * iPad 双栏外壳（平行视界）
 *
 * - 左栏（Master）：完全对齐 iPhone 原生页面的主浏览流（MainTabView）
 *   · 顶栏左上角：标准关闭按钮（×），彻底移除无意义的系统侧边栏按钮
 *   · 顶栏中央：各页面的原生 navigationTitle 标题
 *   · 顶栏右上角：各页面的更多菜单（模式选择、筛选等）
 *   · 底栏：原生 Tab 栏（带探索、排行、关注、我的、搜索），向下滚动自动收缩为「左当前页+右搜索」胶囊
 *   · 切换 Tab：原生 TabView 调度，0 重载、滚动位置 100% 保持
 * - 右栏（Detail）：详情大屏宿主（DetailPaneContent）
 *   · 点左栏作品卡片直接在右栏打开，右栏顶栏带返回箭头与操作项
 *   · 支持小说全屏沉浸阅读（收起左栏，右栏占满全屏）
 */
export function SplitShell(props: { onClose: () => void }) {
  const metrics = useLayoutMetrics()
  const [settings, setSettings] = useState(() => loadSettings())
  const dual = useDualRouteState(settings.splitViewEnabled !== false, true)

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  /* 沉浸阅读支持：收起左栏，让右栏小说阅读占满整屏 */
  const [immersive, setImmersive] = useState(false)
  const immersiveValue = useMemo<ImmersiveReadContextValue>(
    () => ({
      isImmersive: immersive,
      supportsColumnImmersive: true,
      setImmersive: (value: boolean) => setImmersive(value),
    }),
    [immersive]
  )

  // 详情被关闭时自动退出沉浸，恢复双栏
  useEffect(() => {
    if (immersive && dual.detailStack.length === 0) {
      setImmersive(false)
    }
  }, [immersive, dual.detailStack.length])

  // 动态读取横竖屏设置比例：横屏使用 splitRatioLandscape，竖屏使用 splitRatioPortrait
  const ratioPercent = metrics.isLandscape
    ? (settings.splitRatioLandscape ?? 35)
    : (settings.splitRatioPortrait ?? 45)
  const masterWidth = Math.round(metrics.width * (ratioPercent / 100))
  const detailWidth = Math.max(metrics.width - masterWidth, 0)

  return (
    <ImmersiveReadContext.Provider value={immersiveValue}>
      <DualRouteContext.Provider value={dual.value}>
        <HStack
          spacing={0}
          frame={{ width: metrics.width, height: metrics.height }}
          clipped={true}
        >
          {/* 左栏：完全对齐 iPhone 的主浏览流（顶栏关闭+居中标题+更多菜单，底栏滚动收起小胶囊） */}
          {!immersive ? (
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
                <MainTabView
                  onClose={props.onClose}
                  tabViewStyle="tabBarOnly"
                />
              </VStack>
            </ContainerLayoutContext.Provider>
          ) : null}

          {/* 中间高品质分割线 */}
          {!immersive ? (
            <Rectangle
              fill="separator"
              frame={{ width: 0.5, height: metrics.height }}
            />
          ) : null}

          {/* 右栏：详情大屏宿主（沉浸阅读时占满全屏，平时填满右侧） */}
          <ContainerLayoutContext.Provider
            value={{
              width: immersive ? metrics.width : detailWidth,
              height: metrics.height,
            }}
          >
            <ResponsiveContainer>
              <DetailColumnBody
                detailStack={dual.detailStack}
                onBack={dual.popDetailRoute}
                onClose={dual.closeDetail}
              />
            </ResponsiveContainer>
          </ContainerLayoutContext.Provider>
        </HStack>
      </DualRouteContext.Provider>
    </ImmersiveReadContext.Provider>
  )
}
