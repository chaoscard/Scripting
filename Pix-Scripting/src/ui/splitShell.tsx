import {
  HStack,
  Image,
  List,
  NavigationSplitView,
  NavigationStack,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useCallback,
  useMemo,
  useObservable,
  useRef,
  useState,
  type NavigationSplitViewVisibility,
} from "scripting"
import { ResponsiveContainer, useLayoutMetrics, type LayoutMetrics } from "./hooks"
import {
  TAB_CONTENT_DEFS,
  pathObservableForTab,
  useTabNavigation,
  type TabPaths,
} from "./tabShellShared"
import {
  DetailPaneContent,
  DualRouteContext,
  useDualRouteState,
} from "./DualRouteContext"
import {
  FloatingGlassCapsuleContainer,
  GlobalBottomAccessoryHost,
} from "./bottomAccessory"
import { loadSettings, onSettingsChanged } from "../store/settings"
import {
  ImmersiveReadContext,
  type ImmersiveReadContextValue,
} from "./immersiveRead"

/**
 * iPad 三栏外壳（B1 方案）
 *
 * = 把外壳从「iPhone 全屏 TabView」换成系统原生 NavigationSplitView：
 *
 *   sidebar  五个 Tab（自绘列表，取代系统 Tab 栏）
 *   content  当前 Tab 的浏览流（保留原有 NavigationStack 与全部路由行为）
 *   detail   详情内胆（复用 DetailPaneContent：key=route 替换根视图 + 自绘返回箭头）
 *
 * 【三条铁律】
 *
 * 1. **每栏必须各自包一层 ResponsiveContainer，且消费方必须是它的子节点**。
 *    NavigationSplitView 不会写入本项目的 ContainerLayoutContext，而 useLayoutMetrics()
 *    在拿不到容器宽度时会回落到 Device.screen.width（物理整屏宽，分屏/台前调度下必然算错）。
 *    漏掉这一层，界面会变整齐，但底层所有按宽度做的判断依旧错。
 *
 * 2. **必须用实测宽高「显式」撑满，不能只写 maxWidth/maxHeight: "infinity"**。
 *    后者只约束上限、不强制撑满；结果是 ZStack 塌成内容高度 → 栏内页面拿不到空间
 *    （瀑布流空白、底部浮层跑到画面中间）。本项目既有外壳一直用的是显式
 *    `frame={{ width, height }}`，此处与之一致。
 *
 * 3. **苹果音乐胶囊必须挂在自己那一栏的 NavigationStack 之外（兄弟位置）**。
 *    挂进去会随路由切换被替换掉；详情栏胶囊只在「本栏有内容」时出现（已定决策）。
 */

/**
 * 启用 iPad 分栏外壳的最小窗口宽度。
 *
 * 取 640 而不是 860：在 640~860 这段区间里，宁可继续用分栏外壳、
 * **让系统中自己折叠栏位**（已实测：折叠不会销毁栏内实例，滚动位置与状态都保留），
 * 也好过整体换成 TabView 外壳（那会重建 NavigationStack，滚动位置必丢）。
 */
export const SPLIT_SHELL_MIN_WIDTH = 640

/**
 * 侧边栏：五个 Tab 的入口（替代系统 Tab 栏）
 *
 * 关闭入口不在这里：分栏外壳下的 × 统一放在**中栏顶栏**（AppToolbar），
 * 右栏则是内胆自绘的返回箭头。侧边栏保持纯导航（2026-09-17 定稿）。
 */
function TabSidebar(props: { selection: Observable<string | null> }) {
  return (
    <List
      selection={props.selection}
      navigationTitle=""
      navigationSplitViewColumnWidth={{ min: 190, ideal: 220, max: 280 }}
    >
      {TAB_CONTENT_DEFS.map((def) => (
        <HStack
          key={def.id}
          tag={def.id}
          spacing={10}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <Image
            systemName={def.systemImage}
            font="body"
            frame={{ width: 24, alignment: "center" }}
          />
          <Text>{def.title}</Text>
          <Spacer />
        </HStack>
      ))}
    </List>
  )
}

/** 临时诊断开关：确认外壳几何正确后改回 false */
const SHELL_DEBUG = false

/** 临时诊断读数：显示在内容栏底部（位置本身就是「栏高是否撑满」的证据） */
function ShellDebugReadout(props: { metrics: LayoutMetrics; tab: string; appeared: boolean }) {
  return (
    <VStack
      alignment="leading"
      spacing={2}
      padding={{ horizontal: 10, vertical: 8 }}
      frame={{ maxWidth: "infinity" }}
      background="systemPink"
    >
      <Text font="caption2" foregroundStyle="white">{`[B2] tab=${props.tab}`}</Text>
      <Text font="caption2" foregroundStyle="white">
        {`content=${Math.round(props.metrics.width)}x${Math.round(props.metrics.height)}`}
      </Text>
      <Text font="caption2" foregroundStyle="white">
        {`narrow=${props.metrics.isNarrow} compact=${props.metrics.isCompact} land=${props.metrics.isLandscape} hasC=${props.metrics.hasContainerMetrics}`}
      </Text>
      <Text font="caption2" foregroundStyle="white">
        {`onAppear=${props.appeared ? "已触发" : "未触发"}`}
      </Text>
    </VStack>
  )
}

/** 内容栏主体：必须位于 ResponsiveContainer 内部才能拿到本栏实宽实高 */
function ContentColumnBody(props: {
  tab: string
  onClose: () => void
  capsule: any
  paths: TabPaths
}) {
  const metrics = useLayoutMetrics()
  const [appeared, setAppeared] = useState(false)
  const def =
    TAB_CONTENT_DEFS.find((item) => item.id === props.tab) ?? TAB_CONTENT_DEFS[0]

  return (
    /*
      ⚠️ 这里的容器**不能 clipped**（2026-09-17 修，与右栏内胆同一个道理）：
      本容器用的是 ResponsiveContainer 实测的**栏内安全区尺寸**，而页面自带的
      环境光背景层是显式 ignoresSafeArea 的（discovery 直接把它放在根视图的 background 上），
      它必须溢出到状态栏后面才能追色；一裁剪，顶部那条就永远上不了色。
      内容层不必担心溢出：页面内的 ScrollView 自身会裁剪其滚动内容。
    */
    <ZStack
      alignment="bottom"
      frame={{ width: metrics.width, height: metrics.height }}
      onAppear={() => setAppeared(true)}
    >
      <NavigationStack path={pathObservableForTab(def.id, props.paths)}>
        {def.renderRoot({ onClose: props.onClose })}
      </NavigationStack>
      {SHELL_DEBUG ? (
        <ShellDebugReadout metrics={metrics} tab={def.id} appeared={appeared} />
      ) : (
        props.capsule
      )}
    </ZStack>
  )
}

/** 详情栏主体：同上，必须位于 ResponsiveContainer 内部 */
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

export function SplitShell(props: { onClose: () => void }) {
  const [settings, setSettings] = useState(() => loadSettings())
  const initialTab = useRef(settings.launchPage).current
  const selection = useObservable<string | null>(initialTab)
  const paths = useTabNavigation(selection)
  const dual = useDualRouteState(settings.splitViewEnabled !== false, true)

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  const isAppleMusic = settings.pageLayout === "appleMusic"
  const activeTab = selection.value ?? initialTab

  /* 沉浸阅读：columnVisibility 是外壳级状态，右栏内的页面经 context 请求 */
  const [visibility, setVisibility] = useState<NavigationSplitViewVisibility>("all")
  const [immersive, setImmersive] = useState(false)

  const handleVisibilityChanged = useCallback((value: NavigationSplitViewVisibility) => {
    setVisibility(value)
    // 用户手动展开栏位 → 视为退出沉浸（否则受控值会与系统状态打架）
    if (value !== "detailOnly") setImmersive(false)
  }, [])

  const immersiveValue = useMemo<ImmersiveReadContextValue>(
    () => ({
      isImmersive: immersive,
      supportsColumnImmersive: true,
      setImmersive: (value: boolean) => {
        setImmersive(value)
        setVisibility(value ? "detailOnly" : "all")
      },
    }),
    [immersive]
  )

  // 详情被关闭时自动退出沉浸，避免停在一个没有内容的满宽空态
  useEffect(() => {
    if (immersive && dual.detailStack.length === 0) {
      setImmersive(false)
      setVisibility("all")
    }
  }, [immersive, dual.detailStack.length])

  /* 内容栏胶囊：常驻（仅苹果音乐布局） */
  const contentCapsule = isAppleMusic ? (
    <FloatingGlassCapsuleContainer>
      <GlobalBottomAccessoryHost selection={selection} {...paths} />
    </FloatingGlassCapsuleContainer>
  ) : null

  return (
    <ImmersiveReadContext.Provider value={immersiveValue}>
      <DualRouteContext.Provider value={dual.value}>
        <NavigationSplitView
          columnVisibility={{ value: visibility, onChanged: handleVisibilityChanged }}
          sidebar={<TabSidebar selection={selection} />}
        content={
          <ResponsiveContainer>
            <ContentColumnBody
              tab={activeTab}
              onClose={props.onClose}
              capsule={contentCapsule}
              paths={paths}
            />
          </ResponsiveContainer>
        }
      >
        {/* 详情栏：内胆自带「仅有内容时才出现」的胶囊 */}
        <ResponsiveContainer>
          <DetailColumnBody
            detailStack={dual.detailStack}
            onBack={dual.popDetailRoute}
            onClose={dual.closeDetail}
          />
        </ResponsiveContainer>
      </NavigationSplitView>
      </DualRouteContext.Provider>
    </ImmersiveReadContext.Provider>
  )
}
