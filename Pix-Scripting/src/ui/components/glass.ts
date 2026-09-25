import type { Color, CommonViewProps, Shape } from "scripting"
import { loadSettings } from "../../store/settings"

/**
 * App「自绘玻璃」（Liquid Glass）的统一入口 —— 全库唯一真源，调玻璃观感只改这里。
 * 与 ui/components/pageChrome.ts 同构：那边管顶栏，这边管材质。
 *
 * 【本模块做什么】
 * 把「材质」那一半收敛到设置项「液态玻璃」的物理三档与自定义色调开关（存储值见 store/settings.ts）：
 *   system  —— 原样返回（不注入材质）＝ 默认档，完全跟随系统 Liquid Glass 滑块；
 *   clear   —— UIGlass.clear()
 *   soft    —— UIGlass.regular()（系统 API 叫 regular，观感即「柔和」）
 *
 * 当开启「自定义玻璃色调」时，在选定材质基础上叠加用户自选的 tint 颜色与浓度。
 *
 * ⚠️ 选了非 system 档或开启了自定义色调，这些自绘玻璃就不再跟随系统滑块（我们显式指定了材质）。
 *
 * ⚠️ 覆盖范围仅限 App 自绘玻璃。系统自绘的部分（TabView 底栏、buttonStyle="glass"
 *   按钮、系统菜单、Sheet 栏）没有强度接口，永远跟随系统 —— 属于已确认的例外。
 *
 * ⚠️ `interactive(...)` 开关（由设置项「玻璃交互」驱动，默认关）：
 *   - 开 = 可交互玻璃 —— 玻璃本身支持点击高亮与弹性形变（观感更「活」，渲染开销更高）；
 *   - 关 = 静态玻璃 —— 与改造前一致。
 *   注意：「系统」档（未开启自定义色调时）不走本模块、没有可附着的 UIGlass，故该开关仅在有效材质下生效。
 *
 * 【用法】
 *   glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}   // 形状形态（绝大多数）
 *   glassEffect={appGlass("capsule")}
 *   glassEffect={appGlassFlag()}                                  // 布尔形态（原 glassEffect={true}）
 */

type GlassEffectValue = NonNullable<CommonViewProps["glassEffect"]>

/** 色调默认颜色（iOS 底栏默认蓝 #007aff）与默认浓度（%），与 store/settings.ts 的默认值保持一致 */
export const DEFAULT_GLASS_TINT_COLOR = "#007aff"
export const DEFAULT_GLASS_TINT_STRENGTH = 10

// 按「档位 + 配方 + 交互标志」缓存实例
let cachedGlassKey: string | null = null
let cachedGlass: UIGlass | null = null

/** 当前设置解析出的玻璃材质；「系统」档（未开启色调）返回 null（表示不注入）。
 *  ignoreTint=true 时退化为无色调形态。 */
function currentGlass(ignoreTint: boolean = false): UIGlass | null {
  const settings = loadSettings()
  const strength = settings.glassStrength
  const isTinted = settings.glassCustomTintEnabled === true && !ignoreTint

  if (strength === "system" && !isTinted) return null

  const interactive = settings.glassInteractive === true
  const key = `${strength}|${
    isTinted ? `tint|${settings.glassTintColor}|${settings.glassTintStrength}` : "notint"
  }|${interactive ? "interactive" : "static"}`

  if (key === cachedGlassKey && cachedGlass) return cachedGlass

  let glass: UIGlass
  if (strength === "clear") {
    glass = UIGlass.clear()
    if (isTinted) {
      glass = glass.tint(tintRGBA(settings.glassTintColor, settings.glassTintStrength))
    }
  } else if (isTinted) {
    glass = UIGlass.regular().tint(
      tintRGBA(settings.glassTintColor, settings.glassTintStrength)
    )
  } else {
    glass = UIGlass.regular()
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

/**
 * 形状形态（**不叠色调**）：与 appGlass 相同，强制退化为无色调形态。
 */
export function appGlassNoTint(shape: Shape): GlassEffectValue {
  const glass = currentGlass(true)
  return glass ? { glass, shape } : shape
}

/**
 * 获取当前激活的自定义主题色。
 * 若开启了「自定义玻璃色调」且配置了颜色，则返回该主题色；
 * 否则返回回退色（默认 #0096FA，即 Pixiv 经典蓝）。
 */
export function appThemeColor(fallback: string = "#0096FA"): Color {
  const settings = loadSettings()
  if (settings.glassCustomTintEnabled && settings.glassTintColor) {
    return settings.glassTintColor as Color
  }
  return fallback as Color
}

/** 「颜色 + 浓度(%)」合成带 alpha 的 rgba 字符串（注意不能带空格，Color 模板字面量类型不允许） */
function tintRGBA(color: string, strength: number): Color {
  const [r, g, b] =
    parseRGB(color) ?? parseRGB(DEFAULT_GLASS_TINT_COLOR) ?? [0, 122, 255]
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
