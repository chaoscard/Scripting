import type { CommonViewProps } from "scripting"
import type { TopBarEffect } from "../../store/settings"

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
 * 「我的 → 设置 → 外观布局 → 顶栏过渡」，选项命名对齐 iOS 系统液态玻璃的强度轴：
 *   透明（none） / 默认（soft） / 色调（hard）
 * 默认取 soft：iOS 26 上等于系统原生观感；iOS 27 上 A 段（可读性最要紧的那段）同样是
 * 奶白磨砂，只丢 B 段，属可接受的取舍。
 * 存储值是 TopBarEffect（none | soft | hard），映射见 ui/settings.tsx。
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
export function topBarScrollEdge(effect: TopBarEffect): {
  scrollEdgeEffectStyle: CommonViewProps["scrollEdgeEffectStyle"]
  scrollEdgeEffectHidden: CommonViewProps["scrollEdgeEffectHidden"]
} {
  if (effect === "none") {
    // 「透明」：显式关闭顶部滚动边缘效果 —— A / B 两段都没有雾
    return {
      scrollEdgeEffectStyle: undefined,
      scrollEdgeEffectHidden: { edges: "top", hidden: true },
    }
  }
  // 「默认」/「色调」：交给对应系统样式；注意 soft 在 iOS 27 上只作用于 A 段
  return {
    scrollEdgeEffectStyle: { style: effect, edges: "top" },
    scrollEdgeEffectHidden: undefined,
  }
}
