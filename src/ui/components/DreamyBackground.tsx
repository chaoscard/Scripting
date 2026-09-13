import { Circle, Device, Rectangle, ZStack, useEffect, useMemo, useState } from "scripting"

/**
 * 梦幻流体光晕背景 (Dreamy Fluid Gradient Background)
 * 纯代码原生渲染，零图片资源依赖，零侵权风险。
 * 融合 Pixiv 标志性深邃蓝、梦幻紫、天青与暖霞光斑，配合大半径高斯弥散，打造 iOS 原生通透质感。
 * 具备绝对自包含与零外部复杂 hook 依赖，保证在冷启动顶层第 0 毫秒同步极速渲染。
 */
export function DreamyFluidBackground(props?: {
  children?: any
}) {
  const [screenSize, setScreenSize] = useState(() => ({
    width: typeof Device !== "undefined" && Device.screen?.width ? Device.screen.width : 393,
    height: typeof Device !== "undefined" && Device.screen?.height ? Device.screen.height : 852,
  }))

  useEffect(() => {
    if (typeof Device === "undefined" || typeof Device.addOrientationListener !== "function") return
    const update = () => {
      setScreenSize({
        width: Device.screen.width,
        height: Device.screen.height,
      })
    }
    Device.addOrientationListener(update)
    return () => {
      Device.removeOrientationListener(update)
    }
  }, [])

  const blobs = useMemo(() => {
    const w = screenSize.width > 0 ? screenSize.width : 393
    const h = screenSize.height > 0 ? screenSize.height : 852
    const minDim = Math.min(w, h)
    const maxDim = Math.max(w, h)
    const isPad = typeof Device !== "undefined" && Device.isiPad

    return {
      // 1. 右上：Pixiv 标志性明亮蓝
      blue: {
        size: Math.round(isPad ? maxDim * 0.45 : Math.max(280, maxDim * 0.42)),
        x: Math.round(w * 0.28),
        y: Math.round(-h * 0.26),
      },
      // 2. 左下：梦幻洋红紫
      purple: {
        size: Math.round(isPad ? maxDim * 0.50 : Math.max(320, maxDim * 0.46)),
        x: Math.round(-w * 0.28),
        y: Math.round(h * 0.22),
      },
      // 3. 左上：天青流光蓝
      cyan: {
        size: Math.round(isPad ? maxDim * 0.40 : Math.max(240, maxDim * 0.38)),
        x: Math.round(-w * 0.24),
        y: Math.round(-h * 0.17),
      },
      // 4. 右下：晚霞珊瑚暖橙
      orange: {
        size: Math.round(isPad ? maxDim * 0.42 : Math.max(260, maxDim * 0.40)),
        x: Math.round(w * 0.29),
        y: Math.round(h * 0.27),
      },
      // 5. 正中：柔和极光青
      mint: {
        size: Math.round(isPad ? maxDim * 0.35 : Math.max(200, maxDim * 0.32)),
        x: Math.round(w * 0.04),
        y: Math.round(-h * 0.02),
      },
      // 动态高斯模糊弥散半径
      blurRadius: isPad ? Math.max(54, Math.round(minDim * 0.085)) : 54,
    }
  }, [screenSize.width, screenSize.height])

  return (
    <ZStack
      alignment="center"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
      clipped={true}
      background="#070D1E"
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

      {/* 2. 弥散彩色流动光斑层 (由 ZStack 裁剪并在内部进行高斯模糊) */}
      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        ignoresSafeArea={true}
        clipped={true}
        blur={blobs.blurRadius}
      >
        {/* 光斑 1: Pixiv 标志性明亮蓝 (右上) */}
        <Circle
          fill="rgba(0, 150, 250, 0.70)"
          frame={{ width: blobs.blue.size, height: blobs.blue.size }}
          offset={{ x: blobs.blue.x, y: blobs.blue.y }}
        />

        {/* 光斑 2: 梦幻洋红紫 (左下) */}
        <Circle
          fill="rgba(138, 43, 226, 0.60)"
          frame={{ width: blobs.purple.size, height: blobs.purple.size }}
          offset={{ x: blobs.purple.x, y: blobs.purple.y }}
        />

        {/* 光斑 3: 天青流光蓝 (左上至中) */}
        <Circle
          fill="rgba(0, 210, 255, 0.50)"
          frame={{ width: blobs.cyan.size, height: blobs.cyan.size }}
          offset={{ x: blobs.cyan.x, y: blobs.cyan.y }}
        />

        {/* 光斑 4: 晚霞珊瑚暖橙 (右下) */}
        <Circle
          fill="rgba(255, 64, 128, 0.45)"
          frame={{ width: blobs.orange.size, height: blobs.orange.size }}
          offset={{ x: blobs.orange.x, y: blobs.orange.y }}
        />

        {/* 光斑 5: 柔和极光青 (正中微光) */}
        <Circle
          fill="rgba(0, 245, 212, 0.30)"
          frame={{ width: blobs.mint.size, height: blobs.mint.size }}
          offset={{ x: blobs.mint.x, y: blobs.mint.y }}
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
