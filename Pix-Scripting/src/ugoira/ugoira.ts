import { downloadBinary } from "../api/client"
import { ugoiraMetadata } from "../api/pixiv"
import { session } from "../api/session"
import { loadSettings } from "../store/settings"
import { pixivDataPath } from "../store/dataDirectory"
import { publishPreparedFile, recoverFile, writeTextSafely } from "../store/safeFile"
import type { UgoiraFrame } from "../types"
import { exportFramesToGif, exportFramesToMp4 } from "./ffmpegExporter"

export interface UgoiraFramesResult {
  illustID: number
  framesDir: string
  frames: UgoiraFrame[]
  totalDurationMs: number
  width?: number
  height?: number
  zipPath?: string
}

export interface UgoiraResult {
  mp4Path: string
  duration: number
}

interface UgoiraCacheEntry {
  frames: UgoiraFrame[]
  totalDurationMs: number
  width?: number
  height?: number
  lastAccess: number
  size?: number
}

interface UgoiraCacheMeta {
  [illustID: string]: UgoiraCacheEntry
}

const UGOIRA_DIR_NAME = "UgoiraCache"
const CACHE_META_KEY = "pixiv_ugoira_cache_v2"

let baseDir: string | null = null
let cacheGeneration = 0
let taskSequence = 0
let ugoiraMetaSaveTimer: number | null = null
const inflightTasks = new Map<number, Promise<UgoiraFramesResult>>()
const memoryFramesCache = new Map<number, UgoiraFramesResult>()

function joinPath(...parts: string[]): string {
  return parts.join("/")
}

function ensureBaseDir(): string {
  const dir = baseDir ?? pixivDataPath(UGOIRA_DIR_NAME)
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
  baseDir = dir
  return dir
}

function cacheMetaPath(): string {
  return joinPath(ensureBaseDir(), CACHE_META_KEY)
}

function loadMeta(): UgoiraCacheMeta {
  const path = cacheMetaPath()
  recoverFile(path)
  if (!FileManager.existsSync(path)) return {}
  try {
    const parsed = JSON.parse(FileManager.readAsStringSync(path, "utf-8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as UgoiraCacheMeta)
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

function calculateDirSize(dir: string): number {
  if (!FileManager.existsSync(dir)) return 0
  let total = 0
  try {
    for (const name of FileManager.readDirectorySync(dir, true)) {
      try {
        const full = joinPath(dir, name)
        if (FileManager.isFileSync(full)) {
          const s = FileManager.statSync(full).size
          if (s > 0) total += s
        }
      } catch {}
    }
  } catch {}
  return total
}

const pendingTouches = new Map<string, { lastAccess: number; size?: number }>()

function flushPendingTouches(): void {
  if (pendingTouches.size === 0) return
  const touches = new Map(pendingTouches)
  pendingTouches.clear()
  try {
    const meta = loadMeta()
    let changed = false
    for (const [id, touch] of touches) {
      const entry = meta[id]
      if (entry) {
        entry.lastAccess = Math.max(entry.lastAccess || 0, touch.lastAccess)
        if (touch.size != null && touch.size > 0) {
          entry.size = touch.size
        }
        changed = true
      }
    }
    if (changed) {
      saveMeta(meta)
    }
  } catch {}
}

function touchUgoira(id: string, workDir?: string): void {
  let dirSize: number | undefined
  if (workDir && FileManager.existsSync(workDir)) {
    try {
      dirSize = calculateDirSize(workDir)
    } catch {}
  }
  pendingTouches.set(id, {
    lastAccess: Date.now(),
    size: dirSize,
  })

  if (ugoiraMetaSaveTimer != null) clearTimeout(ugoiraMetaSaveTimer)
  ugoiraMetaSaveTimer = setTimeout(() => {
    ugoiraMetaSaveTimer = null
    flushPendingTouches()
  }, 3000)
}

function ugoiraWorkDir(illustID: number): string {
  return joinPath(ensureBaseDir(), String(illustID))
}

/**
 * 检查动图序列帧是否已在缓存中完好就绪
 */
export function cachedUgoiraFrames(illustID: number): UgoiraFramesResult | null {
  const mem = memoryFramesCache.get(illustID)
  if (mem && FileManager.existsSync(mem.framesDir)) {
    return mem
  }

  const idStr = String(illustID)
  const meta = loadMeta()
  const entry = meta[idStr]
  const workDir = ugoiraWorkDir(illustID)
  const framesDir = joinPath(workDir, "frames")
  const zipPath = joinPath(workDir, "frames.zip")

  if (entry && Array.isArray(entry.frames) && entry.frames.length > 0 && FileManager.existsSync(framesDir)) {
    // 校验首帧和尾帧存在
    const firstPath = joinPath(framesDir, entry.frames[0].file)
    const lastPath = joinPath(framesDir, entry.frames[entry.frames.length - 1].file)
    if (isUsableFile(firstPath) && isUsableFile(lastPath)) {
      touchUgoira(idStr, workDir)
      const res: UgoiraFramesResult = {
        illustID,
        framesDir,
        frames: entry.frames,
        totalDurationMs: entry.totalDurationMs || entry.frames.reduce((sum, f) => sum + (f.delay || 0), 0),
        width: entry.width,
        height: entry.height,
        zipPath: FileManager.existsSync(zipPath) ? zipPath : undefined,
      }
      memoryFramesCache.set(illustID, res)
      return res
    }
  }

  // 缓存损坏则清理元数据
  memoryFramesCache.delete(illustID)
  if (entry) {
    delete meta[idStr]
    pendingTouches.delete(idStr)
    try { saveMeta(meta) } catch {}
  }
  return null
}

/**
 * 准备动图序列帧（下载 zip、解压并缓存），支持多请求并发合并
 */
export function prepareUgoira(illustID: number): Promise<UgoiraFramesResult> {
  const cached = cachedUgoiraFrames(illustID)
  if (cached) return Promise.resolve(cached)

  const active = inflightTasks.get(illustID)
  if (active) return active

  let task: Promise<UgoiraFramesResult>
  task = performPrepare(illustID).finally(() => {
    if (inflightTasks.get(illustID) === task) {
      inflightTasks.delete(illustID)
    }
  })
  inflightTasks.set(illustID, task)
  return task
}

async function performPrepare(illustID: number): Promise<UgoiraFramesResult> {
  const generation = cacheGeneration
  const taskID = `${illustID}_${Date.now()}_${++taskSequence}`
  const taskDir = joinPath(FileManager.temporaryDirectory, `PixivUgoiraPrep_${taskID}`)
  const tempZipPath = joinPath(taskDir, "frames.zip")
  const tempFramesDir = joinPath(taskDir, "frames")
  FileManager.createDirectorySync(tempFramesDir, true)

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
    FileManager.writeAsDataSync(tempZipPath, zipData)
    await extractZipEntries(tempZipPath, tempFramesDir)
    validateFrames(tempFramesDir, frames)

    const totalDurationMs = frames.reduce((acc, f) => acc + (f.delay || 0), 0)
    let width = 0
    let height = 0
    try {
      const firstImg = UIImage.fromFile(joinPath(tempFramesDir, frames[0].file))
      if (firstImg) {
        width = firstImg.width
        height = firstImg.height
      }
    } catch {}

    if (generation !== cacheGeneration) throw new Error("动图缓存已清空，请重试")

    // 发布到稳定存储目录
    const workDir = ugoiraWorkDir(illustID)
    if (FileManager.existsSync(workDir)) {
      try { FileManager.removeSync(workDir) } catch {}
    }
    FileManager.createDirectorySync(workDir, true)
    const finalFramesDir = joinPath(workDir, "frames")
    const finalZipPath = joinPath(workDir, "frames.zip")

    // 移动/发布临时帧文件与 zip
    publishPreparedFile(tempZipPath, finalZipPath)
    publishPreparedFile(tempFramesDir, finalFramesDir)

    const dirSize = calculateDirSize(workDir)
    const meta = loadMeta()
    meta[String(illustID)] = {
      frames,
      totalDurationMs,
      width,
      height,
      lastAccess: Date.now(),
      size: dirSize,
    }
    saveMeta(meta)
    enforceUgoiraCacheLimit()

    const result: UgoiraFramesResult = {
      illustID,
      framesDir: finalFramesDir,
      frames,
      totalDurationMs,
      width,
      height,
      zipPath: finalZipPath,
    }
    memoryFramesCache.set(illustID, result)
    return result
  } finally {
    try {
      if (FileManager.existsSync(taskDir)) FileManager.removeSync(taskDir)
    } catch {}
  }
}

/**
 * 将动图序列帧通过 FFmpeg 合成指定格式并返回本地输出路径（供导出使用）
 */
export async function buildUgoira(
  illustID: number,
  format: "mp4" | "gif" = "mp4"
): Promise<UgoiraResult> {
  const prep = await prepareUgoira(illustID)
  const workDir = ugoiraWorkDir(illustID)
  const duration = Math.max(0.1, prep.totalDurationMs / 1000)

  if (format === "gif") {
    const gifPath = joinPath(workDir, `ugoira_${illustID}.gif`)
    if (isUsableFile(gifPath)) {
      touchUgoira(String(illustID), workDir)
      return { mp4Path: gifPath, duration }
    }
    await exportFramesToGif(prep.framesDir, prep.frames, gifPath)
    touchUgoira(String(illustID), workDir)
    return { mp4Path: gifPath, duration }
  } else {
    const mp4Path = joinPath(workDir, `ugoira_${illustID}.mp4`)
    if (isUsableFile(mp4Path)) {
      touchUgoira(String(illustID), workDir)
      return { mp4Path, duration }
    }
    await exportFramesToMp4(prep.framesDir, prep.frames, mp4Path)
    touchUgoira(String(illustID), workDir)
    return { mp4Path, duration }
  }
}

/**
 * 兼容旧版的 cachedUgoira 查询（若已有 MP4 直接返回）
 */
export function cachedUgoira(illustID: number): UgoiraResult | null {
  const workDir = ugoiraWorkDir(illustID)
  const mp4Path = joinPath(workDir, `ugoira_${illustID}.mp4`)
  if (isUsableFile(mp4Path)) {
    const prep = cachedUgoiraFrames(illustID)
    const duration = prep ? prep.totalDurationMs / 1000 : 1
    return { mp4Path, duration }
  }
  return null
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

async function extractZipEntries(zipPath: string, destDir: string): Promise<void> {
  const archive = Archive.openForMode(zipPath, "read")
  const entries = archive.getEntryPaths()
  for (const entry of entries) {
    const name = entry.split("/").pop()
    if (!name || name === "." || name === "..") continue
    archive.extractToSync(entry, joinPath(destDir, name))
  }
}

/**
 * 按 LRU 清理超出上限的动图缓存
 */
export function enforceUgoiraCacheLimit(): void {
  const settings = loadSettings()
  if (settings.cacheLimitMB == null) return
  const limitBytes = Math.round(settings.cacheLimitMB * 1024 * 1024 * 0.15)
  const meta = loadMeta()
  const entries = Object.entries(meta)

  for (const [id, v] of entries) {
    const workDir = ugoiraWorkDir(Number(id))
    if (v.size == null && FileManager.existsSync(workDir)) {
      try {
        v.size = calculateDirSize(workDir)
      } catch {}
    }
    if (v.lastAccess == null) {
      v.lastAccess = Date.now()
    }
  }

  let total = entries.reduce((sum, [, v]) => sum + (v.size || 0), 0)
  if (total <= limitBytes) return

  const sorted = entries.sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0))
  for (const [id, v] of sorted) {
    if (total <= limitBytes) break
    const workDir = ugoiraWorkDir(Number(id))
    try {
      if (FileManager.existsSync(workDir)) {
        FileManager.removeSync(workDir)
      }
    } catch {}
    delete meta[id]
    total -= v.size || 0
  }
  try {
    saveMeta(meta)
  } catch {}
}

/**
 * 动图缓存占用（字节）
 */
export function ugoiraCacheUsageBytes(): number {
  const dir = ensureBaseDir()
  return calculateDirSize(dir)
}

/**
 * 清空动图缓存
 */
export function clearUgoiraCache(): void {
  cacheGeneration += 1
  pendingTouches.clear()
  memoryFramesCache.clear()
  if (ugoiraMetaSaveTimer != null) {
    clearTimeout(ugoiraMetaSaveTimer)
    ugoiraMetaSaveTimer = null
  }
  const dir = ensureBaseDir()
  try {
    if (FileManager.existsSync(dir)) FileManager.removeSync(dir)
    FileManager.createDirectorySync(dir, true)
  } catch {}
  baseDir = null
}
