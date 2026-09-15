import type { Color, CommonViewProps, Shape } from "scripting"
import { loadSettings } from "../../store/settings"

/**
 * App「自绘玻璃」（Liquid Glass）的统一入口 —— 全库唯一真源，调玻璃观感只改这里。
 * 与 ui/components/pageChrome.ts 同构：那边管顶栏，这边管材质。
 *
 * 【背景】
 * 项目里的卡片 / 胶囊 / 面板 / 圆形按钮统一用 `glassEffect` 铺液态玻璃。原先只传形状
 * （如 `{{ type: "rect", cornerRadius: 14 }}`），材质由系统默认决定，因此观感完全跟随
 * 系统「设置 → 显示与亮度 → Liquid Glass」那张滑块（真机实测：扫该滑块时自绘玻璃会变、
 * 但顶部滚动边缘效果不会变）。
 *
 * 【本模块做什么】
 * 把「材质」那一半收敛到设置项「玻璃效果」的四档（存储值见 store/settings.ts）：
 *   system  —— 原样返回（不注入材质）＝ 改造前的行为，也是默认档、随时可退回；
 *   clear   —— UIGlass.clear()
 *   soft    —— UIGlass.regular()（系统 API 叫 regular，观感即“柔和”）
 *   tinted  —— UIGlass.regular().tint(用户选的颜色 × 用户定的浓度)
 *
 * ⚠️ 选了非 system 档，这些自绘玻璃就**不再跟随系统滑块**（我们显式指定了材质）。
 *   这是刻意设计：手动覆盖优先；把设置拨回「系统」即整体恢复跟随，无需回滚代码。
 *
 * ⚠️ 覆盖范围仅限 App 自绘玻璃。系统自绘的部分（TabView 底栏、buttonStyle="glass"
 *   按钮、系统菜单、Sheet 栏）没有强度接口，永远跟随系统 —— 属于已确认的例外。
 *
 * ⚠️ `interactive(...)` 开关（由设置项「玻璃交互」驱动，**默认关**）：
 *   - 开 = 可交互玻璃 —— 玻璃本身支持点击高亮与弹性形变（观感更“活”，渲染开销更高）；
 *   - 关 = 静态玻璃 —— 与改造前一致。
 *   注意：它管的是“玻璃材质是否可交互”，与按钮自己的按压反馈无关；且「系统」档不走本模块、
 *   没有可附着的 UIGlass（想在系统档挂交互就必须先交出材质，也就不再跟随系统滑块了，
 *   二者在 API 层互斥），故该开关**仅在「玻璃效果」非系统档时显示**（设置页条件渲染）。
 *   Apple 文档称 interactive 默认 true，但真机构造出的实测为静态，因此**两个方向都显式声明**。
 *
 * 【用法】
 *   glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}   // 形状形态（绝大多数）
 *   glassEffect={appGlass("capsule")}
 *   glassEffect={appGlassFlag()}                                  // 布尔形态（原 glassEffect={true}）
 */

type GlassEffectValue = NonNullable<CommonViewProps["glassEffect"]>

/** 色调默认颜色（系统灰）与默认浓度（%），与 store/settings.ts 的默认值保持一致 */
export const DEFAULT_GLASS_TINT_COLOR = "#8e8e93"
export const DEFAULT_GLASS_TINT_STRENGTH = 35

// 按「档位 + 最终配方」缓存实例：同档位必须复用同一个对象引用，
// 否则每次渲染新建 UIGlass 会导致玻璃身份跳变、morph 过渡（glassEffectTransition）重放。
let cachedGlassKey: string | null = null
let cachedGlass: UIGlass | null = null

/** 当前设置解析出的玻璃材质；「系统」档返回 null（表示不注入） */
function currentGlass(): UIGlass | null {
  const settings = loadSettings()
  const strength = settings.glassStrength
  if (strength === "system") return null

  const interactive = settings.glassInteractive === true
  const key =
    (strength === "tinted"
      ? `tinted|${settings.glassTintColor}|${settings.glassTintStrength}`
      : strength) + (interactive ? "|interactive" : "|static")
  if (key === cachedGlassKey && cachedGlass) return cachedGlass

  let glass: UIGlass
  if (strength === "clear") {
    glass = UIGlass.clear()
  } else if (strength === "soft") {
    glass = UIGlass.regular()
  } else {
    glass = UIGlass
      .regular()
      .tint(tintRGBA(settings.glassTintColor, settings.glassTintStrength))
  }

  glass = glass.interactive(interactive)

  cachedGlassKey = key
  cachedGlass = glass
  return glass
}

/** 形状形态：把形状原样透传，只决定材质那一半 */
export function appGlass(shape: Shape): GlassEffectValue {
  const glass = currentGlass()
  return glass ? { glass, shape } : shape
}

/** 布尔形态：原写法 `glassEffect={true}` 的等价入口 */
export function appGlassFlag(fallback: boolean = true): GlassEffectValue {
  return currentGlass() ?? fallback
}

/** 「颜色 + 浓度(%)」合成带 alpha 的 rgba 字符串（注意不能带空格，Color 模板字面量类型不允许） */
function tintRGBA(color: string, strength: number): Color {
  const [r, g, b] =
    parseRGB(color) ?? parseRGB(DEFAULT_GLASS_TINT_COLOR) ?? [142, 142, 147]
  const alpha = Math.round(clampPercent(strength) * 100) / 10000
  return `rgba(${r},${g},${b},${alpha})` as Color
}

function clampPercent(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0
  return Math.min(100, Math.max(0, num))
}

/** 解析 `#rrggbb` / `#rgb` / `rgb()` / `rgba()` 形式的颜色，取出 RGB 三元组 */
function parseRGB(value: string): [number, number, number] | null {
  const text = (value ?? "").trim()

  const hex6 = /^#([0-9a-fA-F]{6})$/.exec(text)
  if (hex6) {
    const v = hex6[1]
    return [
      parseInt(v.slice(0, 2), 16),
      parseInt(v.slice(2, 4), 16),
      parseInt(v.slice(4, 6), 16),
    ]
  }

  const hex3 = /^#([0-9a-fA-F]{3})$/.exec(text)
  if (hex3) {
    const v = hex3[1]
    return [
      parseInt(v[0] + v[0], 16),
      parseInt(v[1] + v[1], 16),
      parseInt(v[2] + v[2], 16),
    ]
  }

  const css = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(text)
  if (css) {
    return [Math.round(Number(css[1])), Math.round(Number(css[2])), Math.round(Number(css[3]))]
  }

  return null
}
