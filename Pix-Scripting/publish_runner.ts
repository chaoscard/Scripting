import { Script } from "scripting"

const subject = "release(ugoira): Pix-Scripting 0.8.116 - 重构动图为 Canvas 即时逐帧播放与 FFmpeg 双格式导出"

const body = `1. 基于 TimelineCanvas 的动图即时逐帧播放引擎 (Instant TimelineCanvas Ugoira Player) :
   - 彻底移除原先耗时数秒预合成 MP4 的旧机制，全面采用 Scripting 原生 <TimelineCanvas> 组件逐帧渲染；
   - 根据原画师定义的毫秒级 variable delay 数组预计算时序断点，在 ~60fps 主渲染循环中精准同步上屏；
   - 动图帧包解压即起播，首帧 0 延迟上屏，彻底摆脱 Pro 会员与 AVPlayer 视频框架限制，离开视图自动暂停 (paused)，极低 CPU/GPU 开销。

2. 双级内存秒开缓存体系与二次加载闪烁根除 (Dual-Level Memory & Disk Cache Architecture) :
   - 新增内存级 LRU 缓存 memoryFramesCache，已播放动图驻留内存，二次进入实现 0ms 纯内存同步直出；
   - 彻底消除已缓存动图重新进入时的加载菊花圈与海报遮罩闪烁，保持无缝平滑浏览体验。

3. FFmpeg 高清 MP4 与双遍高质量 GIF 导出 (FFmpeg High-Quality MP4 / GIF Transcoding Engine) :
   - 自动构造 ffconcat 变帧率时序描述文件；
   - MP4 导出：采用 iOS 芯片硬件加速 VideoToolbox (h264_videotoolbox) 配合尺寸偶数对齐保护，毫秒级快速导出高清 MP4 并保存至相簿；
   - GIF 导出：采用双遍调色板算法 (palettegen=stats_mode=diff + paletteuse=dither=bayer:bayer_scale=5)，生成细腻平滑无噪点的高画质 GIF 动图并保存至相册；
   - 原生 ZIP 导出：支持导出原始未处理的画师序列帧压缩包供收藏与二次创作。

4. 动图下载交互与设置偏好 (Ugoira Download Menu & Preferences) :
   - 在「设置 ➔ 下载与存储」中新增「动图导出格式」配置项 (MP4 视频 / GIF 动图)；
   - 作品详情页动图下载按钮展开为原生下拉菜单，清晰提供「下载动图 (MP4/GIF)」与「下载原生 ZIP 帧包」；
   - 卡片快捷下载与画师全量作品批量下载自动按用户设置格式调度 FFmpeg 后台转码。

5. 项目文档与更新日志体系 (Repository Documentation & Full Changelog) :
   - 建立结构化 CHANGELOG.md 与精美 README.md，同步维护至仓库根目录与项目源码。`

const run = async () => {
  const query = JSON.stringify({
    version: "0.8.116",
    subject,
    body,
  })
  console.log("Starting publish runner with structured commit body...")
  
  // 运行 publish.tsx
  const publishPath = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-agent/workspace/E34C6E40-297D-4BCC-AAE1-8A0967C04D73/publish.tsx"
  const res = await Shell.run(`scripting-ts run "${publishPath}" --queryparameters '${query}' --timeout 180`)
  console.log("Publish result exitCode:", res.exitCode)
  console.log("Publish output:\n", res.output)
  Script.exit(res.exitCode === 0 ? "SUCCESS" : "FAILED")
}

run().catch((e) => {
  console.log("Runner error:", e)
  Script.exit("ERROR")
})
