import { Circle, Rectangle, ZStack } from "scripting"

/**
 * 梦幻流体光晕背景 (Dreamy Fluid Gradient Background)
 * 纯代码原生渲染，零图片资源依赖，零侵权风险。
 * 融合 Pixiv 标志性深邃蓝、梦幻紫、天青与暖霞光斑，配合大半径高斯弥散，打造 iOS 原生通透质感。
 */
export function DreamyFluidBackground(props?: {
  children?: any
}) {
  return (
    <ZStack
      alignment="center"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
      clipped={true}
    >
      {/* 1. 深邃基底色块 */}
      <Rectangle
        fill={{
          colors: ["#070D1E", "#0B1528", "#080E1A"],
          startPoint: "topLeading",
          endPoint: "bottomTrailing",
        }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        ignoresSafeArea={true}
      />

      {/* 2. 弥散彩色流动光斑层 (由 ZStack 裁剪并在内部进行大半径高斯模糊) */}
      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        ignoresSafeArea={true}
        clipped={true}
        blur={54}
      >
        {/* 光斑 1: Pixiv 标志性明亮蓝 (右上) */}
        <Circle
          fill="rgba(0, 150, 250, 0.65)"
          frame={{ width: 280, height: 280 }}
          offset={{ x: 100, y: -200 }}
        />

        {/* 光斑 2: 梦幻洋红紫 (左下) */}
        <Circle
          fill="rgba(138, 43, 226, 0.55)"
          frame={{ width: 320, height: 320 }}
          offset={{ x: -110, y: 160 }}
        />

        {/* 光斑 3: 天青流光蓝 (左上至中) */}
        <Circle
          fill="rgba(0, 210, 255, 0.45)"
          frame={{ width: 240, height: 240 }}
          offset={{ x: -90, y: -120 }}
        />

        {/* 光斑 4: 晚霞珊瑚暖橙 (右下) */}
        <Circle
          fill="rgba(255, 64, 128, 0.40)"
          frame={{ width: 260, height: 260 }}
          offset={{ x: 120, y: 220 }}
        />

        {/* 光斑 5: 柔和极光青 (正中微光) */}
        <Circle
          fill="rgba(0, 245, 212, 0.25)"
          frame={{ width: 200, height: 200 }}
          offset={{ x: 20, y: -10 }}
        />
      </ZStack>

      {/* 3. 轻微暗色通透渐变蒙层：确保顶层白色文字与 Loading 指示器拥有极致对比度 */}
      <Rectangle
        fill={{
          colors: [
            "rgba(0, 0, 0, 0.04)",
            "rgba(0, 0, 0, 0.10)",
            "rgba(0, 0, 0, 0.20)",
          ],
          startPoint: "top",
          endPoint: "bottom",
        }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        ignoresSafeArea={true}
      />

      {props?.children ?? null}
    </ZStack>
  )
}

export default DreamyFluidBackground
