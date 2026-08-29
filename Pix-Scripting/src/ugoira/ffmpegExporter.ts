import type { UgoiraFrame } from "../types"

/**
 * 校验并生成 FFmpeg concat demuxer 描述文件
 */
export function generateConcatScript(
  framesDir: string,
  frames: UgoiraFrame[]
): string {
  const lines: string[] = ["ffconcat version 1.0"]
  for (const f of frames) {
    // delay 单位为毫秒，转为秒
    const durSec = Math.max(0.01, f.delay / 1000).toFixed(4)
    lines.push(`file '${f.file}'`)
    lines.push(`duration ${durSec}`)
  }
  // FFmpeg concat 规范：尾帧需追加一条文件引用以保证最后一帧的时长被完整消费
  if (frames.length > 0) {
    lines.push(`file '${frames[frames.length - 1].file}'`)
  }
  return lines.join("\n") + "\n"
}

/**
 * 将动图序列帧通过 FFmpeg 合成为高质量 MP4 视频 (VideoToolbox 硬件加速)
 */
export async function exportFramesToMp4(
  framesDir: string,
  frames: UgoiraFrame[],
  outputPath: string
): Promise<boolean> {
  if (!frames || frames.length === 0) {
    throw new Error("动图帧数据为空")
  }
  const concatPath = `${framesDir}/concat_mp4.txt`
  const script = generateConcatScript(framesDir, frames)
  FileManager.writeAsStringSync(concatPath, script)

  try {
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" -c:v h264_videotoolbox -pix_fmt yuv420p -b:v 4000k "${outputPath}"`
    const res = await Shell.run(cmd, { cwd: framesDir, timeout: 120 })
    if (res.exitCode !== 0 || !FileManager.existsSync(outputPath)) {
      // 若硬件编码异常，尝试通用兼容参数回退
      const fallbackCmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" -pix_fmt yuv420p "${outputPath}"`
      const fallbackRes = await Shell.run(fallbackCmd, { cwd: framesDir, timeout: 120 })
      if (fallbackRes.exitCode !== 0 || !FileManager.existsSync(outputPath)) {
        throw new Error(res.output || fallbackRes.output || "FFmpeg MP4 导出失败")
      }
    }
    const stat = FileManager.statSync(outputPath)
    return stat.size > 0
  } finally {
    try {
      if (FileManager.existsSync(concatPath)) FileManager.removeSync(concatPath)
    } catch {}
  }
}

/**
 * 将动图序列帧通过 FFmpeg 合成为高质量 GIF 动图 (双遍调色板 palettegen + paletteuse)
 */
export async function exportFramesToGif(
  framesDir: string,
  frames: UgoiraFrame[],
  outputPath: string
): Promise<boolean> {
  if (!frames || frames.length === 0) {
    throw new Error("动图帧数据为空")
  }
  const concatPath = `${framesDir}/concat_gif.txt`
  const script = generateConcatScript(framesDir, frames)
  FileManager.writeAsStringSync(concatPath, script)

  try {
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -vf "split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" -loop 0 "${outputPath}"`
    const res = await Shell.run(cmd, { cwd: framesDir, timeout: 120 })
    if (res.exitCode !== 0 || !FileManager.existsSync(outputPath)) {
      throw new Error(res.output || "FFmpeg GIF 导出失败")
    }
    const stat = FileManager.statSync(outputPath)
    return stat.size > 0
  } finally {
    try {
      if (FileManager.existsSync(concatPath)) FileManager.removeSync(concatPath)
    } catch {}
  }
}
