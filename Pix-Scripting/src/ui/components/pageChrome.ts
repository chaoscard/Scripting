import { Device, type CommonViewProps } from "scripting"
import { loadSettings, type TopBarEffect } from "../../store/settings"

/**
 * 页面顶部（导航栏）通用外观 —— 集中一处，全库只此一份，调观感只改这里。
 *
 * 【iOS 26 → iOS 27 的观感漂移】
 * 顶部要分两段看：
 *   A 段 = 系统状态栏（时间 / 电量那条）
 *   B 段 = App 标题栏 / 导航栏（返回、标题、工具按钮）
 * 本项目的导航栏一直是「背景 clear + 可见性 hidden」，即栏自己不画材质，顶部那层雾
 * 完全由系统的滚动边缘效果提供，所以系统一改默认值就直接影响观感。
 *
 * 实测（iOS 26 / iOS 27，内容都仍从栏下穿过）：
 *   soft · iOS 26：A = 奶白磨砂，B = 奶白磨砂
 *   soft · iOS 27：A = 奶白磨砂（与 26 一致），B = 全透明   ← 唯一的跨版本差异
 *   none · 两系统：A = 全透明，B = 全透明（一致）
 *   hard · 两系统：A = 近不透明的线性边界，B = 同上（一致）
 *
 * ⇒ 一句话：iOS 26 的软雾铺满 A+B，iOS 27 只剩 A，B 段裸露——升级后「顶部模糊没了」
 *   指的就是 B 段那层。变的是覆盖范围，不是强度。
 * ⇒ 只有 soft 会随系统版本漂移，且只漂 B 段；none 与 hard 两系统都一致。
 *
 * 【已实证的弯路：不要给栏补材质】
 * 试过 barMaterial / ultraThinMaterial（配 visible / automatic）：只要栏有了背景，
 * iOS 27 就会把滚动内容内缩到栏下方，内容不再从栏下穿过，栏里只剩页面背景色，还会多出
 * 一条硬分界，沉浸感直接消失。⇒「栏有背景」与「内容穿栏」在 iOS 27 互斥，导航栏必须
 * 保持无材质，顶部观感只能靠滚动边缘效果（想要更浓的雾只能页面层自绘）。
 *
 * 【设置项】
 * 「我的 → 设置 → 外观布局 → 顶栏过渡」，与设置项「玻璃效果」**共用同一套强度轴命名**：
 *   系统（system）/ 透明（clear）/ 柔和（soft）/ 色调（tinted）
 * 实际映射：system→automatic、clear→关闭边缘效果、soft→soft、tinted→hard。
 * ⚠️ 这里的 soft 就是系统 scrollEdgeEffectStyle 的 soft；「玻璃效果」那边的 soft 映射到的是
 *   UIGlass.regular()（**同名不同源**，别当成同一个常量）。
 * 默认取 soft：iOS 26 上等于系统原生观感；iOS 27 上 A 段（可读性最要紧的那段）
 * 同样是奶白磨砂，只丢 B 段，属可接受的取舍。
 * ⚠️ 「系统」档 = automatic，在 iOS 27 上就是当初那句「B 段没有过渡」的默认行为，
 *   特意保留给「完全交还系统裁量」的用户。
 * 存储值是 TopBarEffect（system | clear | soft | tinted）。非法/陈旧取值会在归一化时直接回退默认值。
 *
 * ⚠️ 下面两个常量是一组，改动前请先读完上面这段。
 */

/** 导航栏背景：透明（材质交给滚动边缘效果，绝不要让它自己画） */
export const PAGE_TOOLBAR_BACKGROUND = "clear"

/** 导航栏背景可见性：隐藏（只作用于导航栏本身，不影响顶栏内容与按钮） */
export const PAGE_TOOLBAR_BACKGROUND_VISIBILITY: CommonViewProps["toolbarBackgroundVisibility"] =
  {
    visibility: "hidden",
    bars: ["navigationBar"],
  }

/**
 * 按当前设置解析「顶栏过渡」所需的两个属性 —— 由页面根（src/ui/appRoot.tsx）统一挂载。
 *
 * 只作用于 top 边：写成 all 会波及层级内所有滚动视图的四条边（例如横向标签行、
 * 嵌套 List 的左右两侧），副作用面过大。
 */
/** 设置项键名 → 系统 scrollEdgeEffectStyle 取值（「透明」不走本表，见下方分支） */
const TOP_BAR_STYLE_MAP = {
  system: "automatic",
  soft: "soft",
  tinted: "hard",
} as const
export function topBarScrollEdge(effect: TopBarEffect): {
  scrollEdgeEffectStyle: CommonViewProps["scrollEdgeEffectStyle"]
  scrollEdgeEffectHidden: CommonViewProps["scrollEdgeEffectHidden"]
} {
  if (effect === "clear") {
    // 「透明」：显式关闭顶部滚动边缘效果 —— A / B 两段都没有雾
    return {
      scrollEdgeEffectStyle: undefined,
      scrollEdgeEffectHidden: { edges: "top", hidden: true },
    }
  }
  // 「系统」→ automatic（交还系统裁量）/「柔和」→ soft /「色调」→ hard
  // 注意 soft 在 iOS 27 上只作用于 A 段（状态栏），B 段（App 标题栏）无过渡
  return {
    scrollEdgeEffectStyle: { style: TOP_BAR_STYLE_MAP[effect], edges: "top" },
    scrollEdgeEffectHidden: undefined,
  }
}

/**
 * 统一导航栏外观标准配置（全场景通用：整页 / 模态 Sheet / 分栏独立视口）
 * 栏保持 clear + hidden（内容穿栏沉浸），顶部滚动边缘模糊过渡由用户设置（topBarEffect）驱动。
 *
 * 【为什么 sheet 与分栏独立栈必须显式挂】
 * 整页靠 appRoot 那一处全局挂载；sheet 与右栏是独立的呈现层，全局值到不了（iOS 27 实测：sheet 顶部
 * 保持系统默认、不跟随设置档位，于是出现「全页一套、sheet 另一套」）。因此独立呈现栈根节点统一挂载。
 *
 * 【为什么不需要实时生效机制】
 * 「玻璃效果」那种实时生效做不到，是因为已有页面不会重建；而 sheet 每次打开都是全新挂载，
 * 调用时读一次设置即可 —— 天然就是「下次打开即新档位」。
 *
 * 用法：`<VStack navigationTitle=... toolbar=... {...unifiedTopBar()}>`
 * 挂在**声明 navigationTitle / toolbar 的那个节点**上。
 *
 * 【已知限制：sheet 上四档实际只有两态（已接受，别再试）】
 * iOS 27 的 `soft` 只剩状态栏段（A 段）有雾，而 sheet **没有 A 段**（它顶部就是自己的圆角边），
 * 于是 soft 在 sheet 里与 hidden 完全等价 ⇒ 「系统 / 色调」都表现为 hard，「柔和 / 透明」都表现为
 * 全透明。这是 iOS 26→27 的系统行为，不是映射写错（iOS 26 上 soft 在 B 段也有雾，四档能区分）。
 *
 * 已试并**否决**的补救（2026-09-15 真机）：让「柔和」档不设 clear+hidden、改用系统栏自身材质
 * 当那层雾 —— 真机上**毫无变化**（sheet 栏本来就没画可见材质），已回退。⇒ 想让 sheet 的
 * 「柔和」也有雾，只剩「页面层自绘」一条路，成本高，暂不做。
 */
export function unifiedTopBar(): {
  toolbarBackground: CommonViewProps["toolbarBackground"]
  toolbarBackgroundVisibility: CommonViewProps["toolbarBackgroundVisibility"]
  scrollEdgeEffectStyle: CommonViewProps["scrollEdgeEffectStyle"]
  scrollEdgeEffectHidden: CommonViewProps["scrollEdgeEffectHidden"]
} {
  return {
    toolbarBackground: PAGE_TOOLBAR_BACKGROUND,
    toolbarBackgroundVisibility: PAGE_TOOLBAR_BACKGROUND_VISIBILITY,
    ...topBarScrollEdge(loadSettings().topBarEffect),
  }
}

/** 语义别名：兼容既有 Sheet 挂载点（全项目 16 处） */
export const sheetTopBar = unifiedTopBar

/**
 * 半模态 Sheet 跨端自适应档位策略：
 * · iPad 上统一直接展开为最大 ["large"]，卡片舒展充裕，彻底杜绝半高矮盒截断信息流；
 * · iPhone 上保留原本的半拉单手交互（默认 ["medium", "large"]，亦支持传入自定义比例如 [0.65, "large"]）。
 *
 * 用法：`<NavigationStack presentationDetents={sheetDetents()} ...>`
 */
export function sheetDetents(phoneDetents: any[] = ["medium", "large"]): any[] {
  return Device.isiPad ? ["large"] : phoneDetents
}
