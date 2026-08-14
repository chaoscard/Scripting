import { downloadBinary } from "../api/client"
import { ugoiraMetadata } from "../api/pixiv"
import { session } from "../api/session"
import { pixivDataPath } from "../store/dataDirectory"
import { publishPreparedFile, recoverFile, writeTextSafely } from "../store/safeFile"
import type { UgoiraFrame } from "../types"

// Ugoira 动图：下载 zip 帧 → 解压 → 合成 mp4 → 播放/保存

const UGOIRA_DIR_NAME = "UgoiraCache"
const CACHE_META_KEY = "pixiv_ugoira_cache_v1"

interface UgoiraCacheMeta {
  [illustID: string]: { mp4Path: string; duration: number }
}

let baseDir: string | null = null
let cacheGeneration = 0
let taskSequence = 0
const inflightBuilds = new Map<number, Promise<UgoiraResult>>()

function joinPath(...parts: string[]): string {
  return parts.join("/")
}

function ensureDir(): string {
  const dir = baseDir ?? pixivDataPath(UGOIRA_DIR_NAME)
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
  baseDir = dir
  return dir
}

function cacheMetaPath(): string {
  return joinPath(ensureDir(), CACHE_META_KEY)
}

function loadMeta(): UgoiraCacheMeta {
  const path = cacheMetaPath()
  recoverFile(path)
  if (!FileManager.existsSync(path)) return {}
  try {
    const parsed = JSON.parse(FileManager.readAsStringSync(path, "utf-8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as UgoiraCacheMeta
      : {}
  } catch {
    return {}
  }
}

function saveMeta(meta: UgoiraCacheMeta): void {
  writeTextSafely(cacheMetaPath(), JSON.stringify(meta), (raw) => {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("动图缓存元数据格式错误")
    }
  })
}

function isUsableFile(path: string): boolean {
  if (!FileManager.existsSync(path)) return false
  try {
    const stat = FileManager.statSync(path)
    return stat.size > 0
  } catch {
    return false
  }
}

export interface UgoiraResult {
  mp4Path: string
  duration: number
}

// 检查是否已合成
export function cachedUgoira(illustID: number): UgoiraResult | null {
  const meta = loadMeta()
  const entry = meta[String(illustID)]
  if (entry && Number.isFinite(entry.duration) && entry.duration > 0 && isUsableFile(entry.mp4Path)) {
    return entry
  }
  if (entry) {
    delete meta[String(illustID)]
    try { saveMeta(meta) } catch { /* ignore recoverable cache metadata failure */ }
  }
  return null
}

// 合成（或复用缓存）；同一作品的所有调用者共享一个构建 Promise。
export function buildUgoira(illustID: number): Promise<UgoiraResult> {
  const cached = cachedUgoira(illustID)
  if (cached) return Promise.resolve(cached)
  const active = inflightBuilds.get(illustID)
  if (active) return active

  let task: Promise<UgoiraResult>
  task = performBuild(illustID).finally(() => {
    if (inflightBuilds.get(illustID) === task) {
      inflightBuilds.delete(illustID)
    }
  })
  inflightBuilds.set(illustID, task)
  return task
}

async function performBuild(illustID: number): Promise<UgoiraResult> {
  const generation = cacheGeneration
  const taskID = `${illustID}_${Date.now()}_${++taskSequence}`
  const taskDir = joinPath(FileManager.temporaryDirectory, `PixivUgoira_${taskID}`)
  const zipPath = joinPath(taskDir, "frames.zip")
  const framesDir = joinPath(taskDir, "frames")
  const taskOutput = joinPath(taskDir, "output.mp4")
  FileManager.createDirectorySync(framesDir, true)

  try {
    const metadata = await session.call((token) => ugoiraMetadata(illustID, token))
    const zipUrl = metadata?.zip_urls?.medium
    if (!zipUrl) throw new Error("未找到动图资源")
    const frames: UgoiraFrame[] = metadata.frames ?? []
    if (frames.length === 0) throw new Error("动图帧数据为空")

    const zipData = await downloadBinary(zipUrl)
    if (!zipData || generation !== cacheGeneration) {
      throw new Error(generation !== cacheGeneration ? "动图缓存已清空，请重试" : "动图帧下载失败")
    }
    FileManager.writeAsDataSync(zipPath, zipData)
    await extractZipEntries(zipPath, framesDir)
    validateFrames(framesDir, frames)

    const firstFramePath = joinPath(framesDir, frames[0].file)
    let renderWidth = 640
    let renderHeight = 360
    try {
      const img = UIImage.fromFile(firstFramePath)
      if (img) {
        const maxW = 1280
        const scale = Math.min(1, maxW / Math.max(1, img.width))
        renderWidth = Math.round(img.width * scale)
        renderHeight = Math.round(img.height * scale)
      }
    } catch {
      // 保持默认
    }

    const videoItems = frames.map((frame) => ({
      imagePath: joinPath(framesDir, frame.file),
      duration: MediaTime.make({
        seconds: Math.max(0.05, frame.delay / 1000),
        preferredTimescale: 600,
      }),
    }))

    const result = await MediaComposer.composeAndExport({
      exportPath: taskOutput,
      timeline: { videoItems, audioClips: [] },
      exportOptions: {
        renderSize: { width: renderWidth, height: renderHeight },
        frameRate: 30,
        presetName: "MediumQuality",
      },
      overwrite: true,
    })

    const duration = result.duration.getSeconds()
    if (generation !== cacheGeneration) throw new Error("动图缓存已清空，请重试")
    if (!Number.isFinite(duration) || duration <= 0 || !isUsableFile(taskOutput)) {
      throw new Error("动图合成结果无效")
    }

    // 发布区间无 await：清缓存不能插入到 generation 检查与文件/meta 提交之间。
    const dir = ensureDir()
    const mp4Path = joinPath(dir, `ugoira_${illustID}.mp4`)
    publishPreparedFile(taskOutput, mp4Path)
    const meta = loadMeta()
    meta[String(illustID)] = { mp4Path, duration }
    saveMeta(meta)
    return { mp4Path, duration }
  } finally {
    try {
      if (FileManager.existsSync(taskDir)) FileManager.removeSync(taskDir)
    } catch {
      // ignore task-owned cleanup failure
    }
  }
}

function validateFrames(framesDir: string, frames: UgoiraFrame[]): void {
  for (const frame of frames) {
    const path = joinPath(framesDir, frame.file)
    if (!isUsableFile(path)) throw new Error(`动图帧缺失：${frame.file}`)
  }
  const first = UIImage.fromFile(joinPath(framesDir, frames[0].file))
  if (!first || first.width <= 0 || first.height <= 0) {
    throw new Error("动图首帧无法解码")
  }
}

// 用 Archive 逐条解压 zip 条目到目标目录（仅提取文件，忽略目录/路径穿越）
async function extractZipEntries(zipPath: string, destDir: string): Promise<void> {
  const archive = Archive.openForMode(zipPath, "read")
  const entries = archive.getEntryPaths()
  for (const entry of entries) {
    const name = entry.split("/").pop()
    if (!name || name === "." || name === "..") continue
    archive.extractToSync(entry, joinPath(destDir, name))
  }
}

// 清空动图缓存。构建任务在独立临时目录继续收尾，但旧代次不得发布。
export function clearUgoiraCache(): void {
  cacheGeneration += 1
  const dir = ensureDir()
  try {
    if (FileManager.existsSync(dir)) FileManager.removeSync(dir)
    FileManager.createDirectorySync(dir, true)
  } catch {
    // ignore
  }
  baseDir = null
}
