import { getAuthorDownloadDirectory, getCategoryDirectory, getDownloadRootDirectory, sanitizeFileName } from "./directoryResolver"
import { yieldIfExceeded } from "./downloadHelper"

export type DownloadFileCategory = "all" | "illustrations" | "ugoira" | "manga" | "novels" | "creators"

export type DownloadFilesChangeListener = () => void

// ============================================================================
// 内存缓存与脏标记 (Dirty Flag / Storage Version) 管理引擎
// ============================================================================

let currentStorageVersion = 1

// 1. 存储概况内存缓存
let cachedOverview: StorageOverview | null = null
let cachedOverviewVersion = 0

// 2. 分类文件列表内存缓存 (按 raw 分类未过滤、未排序缓存)
const cachedCategoryFiles = new Map<DownloadFileCategory, { version: number; files: ManagedFileItem[] }>()

// 3. 创作者目录列表内存缓存 (raw 未过滤、未排序缓存)
let cachedCreatorDirs: { version: number; list: CreatorFolderItem[] } | null = null

// 4. 单个创作者文件列表内存缓存 (key: creatorFolder, value: { version, files })
const cachedCreatorFiles = new Map<string, { version: number; files: ManagedFileItem[] }>()

/**
 * 标记存储缓存为脏，递增版本号并清空所有内存缓存
 */
export function invalidateDownloadCache(): void {
  currentStorageVersion++
  cachedOverview = null
  cachedOverviewVersion = 0
  cachedCategoryFiles.clear()
  cachedCreatorDirs = null
  cachedCreatorFiles.clear()
}

/**
 * 获取当前存储版本号
 */
export function getStorageVersion(): number {
  return currentStorageVersion
}

const fileChangeListeners = new Set<DownloadFilesChangeListener>()
let notifyTimer: any = null

/**
 * 注册下载/文件系统变动监听器
 * 当发生文件下载、导出、重命名、删除或清理时，自动触发回调
 */
export function addDownloadFilesChangeListener(listener: DownloadFilesChangeListener): () => void {
  fileChangeListeners.add(listener)
  return () => {
    fileChangeListeners.delete(listener)
  }
}

/**
 * 通知所有监听器文件已更新（自动将缓存置脏，并带 100ms 防抖避免批量操作时频繁触发）
 */
export function notifyDownloadFilesChanged(): void {
  // 任何外部或内部写操作发生时，立即将缓存置脏
  invalidateDownloadCache()

  if (notifyTimer) {
    clearTimeout(notifyTimer)
  }
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    for (const listener of Array.from(fileChangeListeners)) {
      try {
        listener()
      } catch (e) {
        console.log("notifyDownloadFilesChanged listener error:", e)
      }
    }
  }, 100)
}

export type SortMode =
  | "date_desc"
  | "date_asc"
  | "size_desc"
  | "size_asc"
  | "name_asc"
  | "name_desc"

export interface ManagedFileItem {
  id: string
  name: string
  path: string
  size: number
  formattedSize: string
  modifiedTime: number
  formattedTime: string
  extension: string
  category: "illustrations" | "ugoira" | "manga" | "novels" | "other"
  creatorFolder?: string
  artworkId?: number
  title?: string
  author?: string
}

export interface CreatorFolderItem {
  id: string
  name: string
  path: string
  totalSize: number
  formattedSize: string
  fileCount: number
  subCounts: {
    illustrations: number
    ugoira: number
    manga: number
    novels: number
  }
  authorName: string
  authorId?: number
}

export interface StorageOverview {
  totalSize: number
  formattedTotalSize: string
  totalFilesCount: number
  illustrationsSize: number
  illustrationsCount: number
  ugoiraSize: number
  ugoiraCount: number
  mangaSize: number
  mangaCount: number
  novelsSize: number
  novelsCount: number
  creatorsSize: number
  creatorsCount: number
  tempSize: number
  formattedTempSize: string
}

/**
 * 格式化字节大小为易读字符串 (KB, MB, GB)
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return "0 B"
  const k = 1000
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const idx = Math.min(sizes.length - 1, Math.max(0, i))
  const val = bytes / Math.pow(k, idx)
  return `${val.toFixed(val >= 100 || idx === 0 ? 0 : 1)} ${sizes[idx]}`
}

/**
 * 格式化时间戳为易读日期时间
 */
export function formatFileTime(ms: number): string {
  if (!ms || ms <= 0) return ""
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  const year = d.getFullYear()
  const month = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hour = pad(d.getHours())
  const min = pad(d.getMinutes())
  return `${year}-${month}-${day} ${hour}:${min}`
}

/**
 * 从文件名中提取可能的作品 ID、画师名与标题
 */
export function extractFileMeta(fileName: string): { artworkId?: number; title: string; author?: string } {
  const clean = fileName.replace(/\.[^/.]+$/, "") // 去除后缀

  // 1. 尝试匹配作品 ID (6~10 位数字)
  let artworkId: number | undefined
  const idMatch = clean.match(/(?:_|\(|\s|^)(\d{6,10})(?:_|\)|\s|$)/)
  if (idMatch) {
    const parsed = Number(idMatch[1])
    if (Number.isFinite(parsed) && parsed > 0) artworkId = parsed
  }

  // 2. 尝试提取作者名 [作者] 或 (UID)
  let author: string | undefined
  const authorMatch = clean.match(/^\[([^\]]+)\]/)
  if (authorMatch) {
    author = authorMatch[1].trim()
  }

  return { artworkId, title: clean, author }
}

/**
 * 判定文件所属分类
 */
export function detectCategory(
  fullPath: string,
  ext: string
): "illustrations" | "ugoira" | "manga" | "novels" | "other" {
  const lowerExt = ext.toLowerCase()
  const lowerPath = fullPath.toLowerCase()

  // 动图判定：mp4 / gif / 路径包含 ugoira 或文件名带 ugoira
  if (
    lowerExt === "mp4" ||
    lowerExt === "gif" ||
    lowerPath.includes("/ugoira/") ||
    lowerPath.includes("_ugoira")
  ) {
    return "ugoira"
  }

  // 漫画判定：cbz / 路径包含 manga
  if (lowerExt === "cbz" || lowerPath.includes("/manga/")) {
    return "manga"
  }

  // 小说判定：txt / 路径包含 novels / 包含 novel
  if (lowerExt === "txt" || lowerPath.includes("/novels/") || lowerPath.includes("/novel/")) {
    return "novels"
  }

  // 插画判定：jpg / png / 路径包含 illustrations
  if (
    lowerExt === "jpg" ||
    lowerExt === "jpeg" ||
    lowerExt === "png" ||
    lowerPath.includes("/illustrations/")
  ) {
    return "illustrations"
  }

  // epub 文件若不在小说目录下，可根据路径或默认归入小说
  if (lowerExt === "epub") {
    if (lowerPath.includes("/manga/")) return "manga"
    return "novels"
  }

  // zip 压缩包按路径分配
  if (lowerExt === "zip") {
    if (lowerPath.includes("/ugoira/")) return "ugoira"
    if (lowerPath.includes("/manga/")) return "manga"
    if (lowerPath.includes("/novels/")) return "novels"
    return "illustrations"
  }

  return "other"
}

/**
 * 安全获取单个文件的 FileItem 结构
 */
function buildManagedItem(
  dir: string,
  fileName: string,
  creatorFolder?: string
): ManagedFileItem | null {
  const fullPath = `${dir}/${fileName}`
  if (!FileManager.existsSync(fullPath)) return null
  try {
    if (FileManager.isDirectorySync(fullPath)) return null
    const stat = FileManager.statSync(fullPath)
    const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : ""
    const meta = extractFileMeta(fileName)
    const category = detectCategory(fullPath, ext)
    const modTime = (stat as any)?.modificationDate
      ? new Date((stat as any).modificationDate).getTime()
      : (stat as any)?.mtimeMs || Date.now()

    return {
      id: fullPath,
      name: fileName,
      path: fullPath,
      size: stat.size || 0,
      formattedSize: formatBytes(stat.size || 0),
      modifiedTime: modTime,
      formattedTime: formatFileTime(modTime),
      extension: ext,
      category,
      creatorFolder,
      artworkId: meta.artworkId,
      title: meta.title,
      author: meta.author,
    }
  } catch {
    return null
  }
}

/**
 * 遍历指定目录下的所有文件并返回列表（支持协程让出主线程）
 */
async function scanDirectoryFiles(dir: string, creatorFolder?: string): Promise<ManagedFileItem[]> {
  if (!FileManager.existsSync(dir)) return []
  const items: ManagedFileItem[] = []
  try {
    const list = FileManager.readDirectorySync(dir, false)
    let timeBudget = Date.now()
    for (const name of list) {
      const full = `${dir}/${name}`
      try {
        if (FileManager.isFileSync(full)) {
          const fileItem = buildManagedItem(dir, name, creatorFolder)
          if (fileItem) items.push(fileItem)
        }
      } catch {}
      timeBudget = await yieldIfExceeded(timeBudget, 10)
    }
  } catch (e: any) {
    console.log("scanDirectoryFiles error in:", dir, e?.message ?? e)
  }
  return items
}

/**
 * 递归计算某个目录的总大小与文件数
 */
export function calculateDirStats(dir: string): { totalSize: number; fileCount: number } {
  if (!FileManager.existsSync(dir)) return { totalSize: 0, fileCount: 0 }
  let totalSize = 0
  let fileCount = 0
  try {
    const list = FileManager.readDirectorySync(dir, true)
    for (const sub of list) {
      const full = `${dir}/${sub}`
      try {
        if (FileManager.isFileSync(full)) {
          const s = FileManager.statSync(full).size
          if (s > 0) totalSize += s
          fileCount++
        }
      } catch {}
    }
  } catch {}
  return { totalSize, fileCount }
}

/**
 * 穿透聚合指定分类的总统计：包含根分类目录，以及所有创作者专属目录下的对应分类子目录
 */
function calculateCategoryAggregatedStats(
  root: string,
  category: "Illustrations" | "Ugoira" | "Manga" | "Novels"
): { totalSize: number; fileCount: number } {
  let totalSize = 0
  let fileCount = 0

  // 1. 扫描根分类目录
  const rootDir = `${root}/${category}`
  const rootStats = calculateDirStats(rootDir)
  totalSize += rootStats.totalSize
  fileCount += rootStats.fileCount

  // 2. 深入遍历每个创作者专属目录下的对应分类子目录
  const creatorsDir = `${root}/Creators`
  if (FileManager.existsSync(creatorsDir)) {
    try {
      const creatorFolders = FileManager.readDirectorySync(creatorsDir, false)
      for (const cf of creatorFolders) {
        const cfSub = `${creatorsDir}/${cf}/${category}`
        if (FileManager.existsSync(cfSub)) {
          const subStats = calculateDirStats(cfSub)
          totalSize += subStats.totalSize
          fileCount += subStats.fileCount
        }
      }
    } catch {}
  }

  return { totalSize, fileCount }
}

/**
 * 获取全局存储概览（各分类统计、占用大小与文件数，支持脏标记缓存命中）
 */
export async function getStorageOverview(forceRefresh = false): Promise<StorageOverview> {
  if (!forceRefresh && cachedOverview && cachedOverviewVersion === currentStorageVersion) {
    return cachedOverview
  }

  const root = getDownloadRootDirectory()
  const illDir = `${root}/Illustrations`
  const ugDir = `${root}/Ugoira`
  const mangaDir = `${root}/Manga`
  const novelDir = `${root}/Novels`
  const creatorsDir = `${root}/Creators`
  const tempDir = getCategoryDirectory("temp")

  // 1. 物理目录实际占用统计（防重复累加物理存储）
  const illPhysicalStats = calculateDirStats(illDir)
  const ugPhysicalStats = calculateDirStats(ugDir)
  const mangaPhysicalStats = calculateDirStats(mangaDir)
  const novelPhysicalStats = calculateDirStats(novelDir)
  const creatorsStats = calculateDirStats(creatorsDir)
  const tempStats = calculateDirStats(tempDir)

  const totalSize =
    illPhysicalStats.totalSize +
    ugPhysicalStats.totalSize +
    mangaPhysicalStats.totalSize +
    novelPhysicalStats.totalSize +
    creatorsStats.totalSize

  const totalFilesCount =
    illPhysicalStats.fileCount +
    ugPhysicalStats.fileCount +
    mangaPhysicalStats.fileCount +
    novelPhysicalStats.fileCount +
    creatorsStats.fileCount

  // 2. 穿透聚合各分类统计（根目录 + 所有画师对应分类子目录，保证内外口径一致）
  const illStats = calculateCategoryAggregatedStats(root, "Illustrations")
  const ugStats = calculateCategoryAggregatedStats(root, "Ugoira")
  const mangaStats = calculateCategoryAggregatedStats(root, "Manga")
  const novelStats = calculateCategoryAggregatedStats(root, "Novels")

  let creatorFolderCount = 0
  if (FileManager.existsSync(creatorsDir)) {
    try {
      const list = FileManager.readDirectorySync(creatorsDir, false)
      for (const name of list) {
        if (FileManager.isDirectorySync(`${creatorsDir}/${name}`)) {
          creatorFolderCount++
        }
      }
    } catch {}
  }

  const result: StorageOverview = {
    totalSize,
    formattedTotalSize: formatBytes(totalSize),
    totalFilesCount,
    illustrationsSize: illStats.totalSize,
    illustrationsCount: illStats.fileCount,
    ugoiraSize: ugStats.totalSize,
    ugoiraCount: ugStats.fileCount,
    mangaSize: mangaStats.totalSize,
    mangaCount: mangaStats.fileCount,
    novelsSize: novelStats.totalSize,
    novelsCount: novelStats.fileCount,
    creatorsSize: creatorsStats.totalSize,
    creatorsCount: creatorFolderCount,
    tempSize: tempStats.totalSize,
    formattedTempSize: formatBytes(tempStats.totalSize),
  }

  cachedOverview = result
  cachedOverviewVersion = currentStorageVersion
  return result
}

/**
 * 排序文件列表
 */
export function sortFiles(items: ManagedFileItem[], mode: SortMode = "date_desc"): ManagedFileItem[] {
  const list = [...items]
  return list.sort((a, b) => {
    switch (mode) {
      case "date_desc":
        return b.modifiedTime - a.modifiedTime
      case "date_asc":
        return a.modifiedTime - b.modifiedTime
      case "size_desc":
        return b.size - a.size
      case "size_asc":
        return a.size - b.size
      case "name_asc":
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      case "name_desc":
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" })
      default:
        return b.modifiedTime - a.modifiedTime
    }
  })
}

/**
 * 扫描指定分类的文件列表（包含单篇导出与画师目录下的对应文件，支持脏标记缓存命中）
 */
export async function scanCategoryFiles(
  category: DownloadFileCategory,
  sortMode: SortMode = "date_desc",
  searchQuery?: string,
  forceRefresh = false
): Promise<ManagedFileItem[]> {
  let rawFiles: ManagedFileItem[] = []

  const cached = cachedCategoryFiles.get(category)
  if (!forceRefresh && cached && cached.version === currentStorageVersion) {
    rawFiles = cached.files
  } else {
    const root = getDownloadRootDirectory()
    const results: ManagedFileItem[] = []

    if (category === "all") {
      // 扫描所有目录
      const subDirs = ["Illustrations", "Ugoira", "Manga", "Novels"]
      for (const sub of subDirs) {
        const items = await scanDirectoryFiles(`${root}/${sub}`)
        results.push(...items)
      }

      // 扫描 Creators 子目录下的所有文件
      const creatorsDir = `${root}/Creators`
      if (FileManager.existsSync(creatorsDir)) {
        try {
          const creatorFolders = FileManager.readDirectorySync(creatorsDir, false)
          for (const cf of creatorFolders) {
            const cfPath = `${creatorsDir}/${cf}`
            if (FileManager.isDirectorySync(cfPath)) {
              // 扫描画师根与各子分类
              const cfItems = await scanDirectoryFiles(cfPath, cf)
              results.push(...cfItems)
              for (const sub of subDirs) {
                const subItems = await scanDirectoryFiles(`${cfPath}/${sub}`, cf)
                results.push(...subItems)
              }
            }
          }
        } catch {}
      }
    } else if (category === "creators") {
      // 归属于创作者专区
      return []
    } else {
      let subName = "Illustrations"
      if (category === "ugoira") subName = "Ugoira"
      else if (category === "manga") subName = "Manga"
      else if (category === "novels") subName = "Novels"

      // 1. 扫描对应根子目录
      const rootItems = await scanDirectoryFiles(`${root}/${subName}`)
      results.push(...rootItems)

      // 2. 兼容历史遗留：如果扫描动图，检查 Illustrations 目录下的 mp4/gif/zip_ugoira
      if (category === "ugoira") {
        const illItems = await scanDirectoryFiles(`${root}/Illustrations`)
        const legacyUgoiras = illItems.filter((it) => it.category === "ugoira")
        results.push(...legacyUgoiras)
      }

      // 3. 扫描各创作者下的对应子目录
      const creatorsDir = `${root}/Creators`
      if (FileManager.existsSync(creatorsDir)) {
        try {
          const creatorFolders = FileManager.readDirectorySync(creatorsDir, false)
          for (const cf of creatorFolders) {
            const cfSubPath = `${creatorsDir}/${cf}/${subName}`
            if (FileManager.existsSync(cfSubPath)) {
              const cfItems = await scanDirectoryFiles(cfSubPath, cf)
              results.push(...cfItems)
            }
          }
        } catch {}
      }
    }

    rawFiles = results
    cachedCategoryFiles.set(category, {
      version: currentStorageVersion,
      files: rawFiles,
    })
  }

  // 搜索过滤
  let filtered = rawFiles
  if (searchQuery && searchQuery.trim().length > 0) {
    const q = searchQuery.trim().toLowerCase()
    filtered = rawFiles.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.title && it.title.toLowerCase().includes(q)) ||
        (it.author && it.author.toLowerCase().includes(q)) ||
        (it.creatorFolder && it.creatorFolder.toLowerCase().includes(q)) ||
        (it.artworkId && String(it.artworkId).includes(q))
    )
  }

  return sortFiles(filtered, sortMode)
}

/**
 * 扫描创作者目录列表（支持脏标记缓存命中）
 */
export async function scanCreatorDirectories(
  sortMode: SortMode = "date_desc",
  searchQuery?: string,
  forceRefresh = false
): Promise<CreatorFolderItem[]> {
  let rawList: CreatorFolderItem[] = []

  if (!forceRefresh && cachedCreatorDirs && cachedCreatorDirs.version === currentStorageVersion) {
    rawList = cachedCreatorDirs.list
  } else {
    const root = getDownloadRootDirectory()
    const creatorsDir = `${root}/Creators`
    if (!FileManager.existsSync(creatorsDir)) return []

    const list: CreatorFolderItem[] = []
    try {
      const folderNames = FileManager.readDirectorySync(creatorsDir, false)
      let timeBudget = Date.now()

      for (const folderName of folderNames) {
        const fullPath = `${creatorsDir}/${folderName}`
        try {
          if (FileManager.isDirectorySync(fullPath)) {
            const dirStats = calculateDirStats(fullPath)

            // 统计各子分类数量
            const illStats = calculateDirStats(`${fullPath}/Illustrations`)
            const ugStats = calculateDirStats(`${fullPath}/Ugoira`)
            const mangaStats = calculateDirStats(`${fullPath}/Manga`)
            const novelStats = calculateDirStats(`${fullPath}/Novels`)

            // 提取画师名和 UID
            let authorName = folderName
            let authorId: number | undefined
            const idMatch = folderName.match(/\((\d+)\)$/)
            if (idMatch) {
              authorId = Number(idMatch[1])
              authorName = folderName.replace(/\s*\(\d+\)$/, "").trim()
            }

            list.push({
              id: folderName,
              name: folderName,
              path: fullPath,
              totalSize: dirStats.totalSize,
              formattedSize: formatBytes(dirStats.totalSize),
              fileCount: dirStats.fileCount,
              subCounts: {
                illustrations: illStats.fileCount,
                ugoira: ugStats.fileCount,
                manga: mangaStats.fileCount,
                novels: novelStats.fileCount,
              },
              authorName,
              authorId,
            })
          }
        } catch {}
        timeBudget = await yieldIfExceeded(timeBudget, 10)
      }
    } catch (e: any) {
      console.log("scanCreatorDirectories error:", e?.message ?? e)
    }

    rawList = list
    cachedCreatorDirs = {
      version: currentStorageVersion,
      list: rawList,
    }
  }

  // 搜索过滤
  let filtered = rawList
  if (searchQuery && searchQuery.trim().length > 0) {
    const q = searchQuery.trim().toLowerCase()
    filtered = rawList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q) ||
        (c.authorId && String(c.authorId).includes(q))
    )
  }

  // 排序
  return filtered.sort((a, b) => {
    switch (sortMode) {
      case "size_desc":
        return b.totalSize - a.totalSize
      case "size_asc":
        return a.totalSize - b.totalSize
      case "name_asc":
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      case "name_desc":
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" })
      default:
        return b.totalSize - a.totalSize
    }
  })
}

/**
 * 扫描指定创作者文件夹下的全部文件（支持脏标记缓存命中）
 */
export async function scanCreatorFiles(
  creatorFolderName: string,
  categoryFilter: "all" | "illustrations" | "ugoira" | "manga" | "novels" = "all",
  sortMode: SortMode = "date_desc",
  searchQuery?: string,
  forceRefresh = false
): Promise<ManagedFileItem[]> {
  let allCreatorFiles: ManagedFileItem[] = []

  const cached = cachedCreatorFiles.get(creatorFolderName)
  if (!forceRefresh && cached && cached.version === currentStorageVersion) {
    allCreatorFiles = cached.files
  } else {
    const root = getDownloadRootDirectory()
    const creatorPath = `${root}/Creators/${creatorFolderName}`
    if (!FileManager.existsSync(creatorPath)) return []

    const results: ManagedFileItem[] = []
    const subDirs = ["Illustrations", "Ugoira", "Manga", "Novels"]

    // 1. 扫描根目录文件
    const rootFiles = await scanDirectoryFiles(creatorPath, creatorFolderName)
    results.push(...rootFiles)

    // 2. 扫描各子目录
    for (const sub of subDirs) {
      const subPath = `${creatorPath}/${sub}`
      if (FileManager.existsSync(subPath)) {
        const items = await scanDirectoryFiles(subPath, creatorFolderName)
        results.push(...items)
      }
    }

    allCreatorFiles = results
    cachedCreatorFiles.set(creatorFolderName, {
      version: currentStorageVersion,
      files: allCreatorFiles,
    })
  }

  // 过滤子分类
  let filtered = allCreatorFiles
  if (categoryFilter !== "all") {
    filtered = filtered.filter((it) => it.category === categoryFilter)
  }

  // 搜索过滤
  if (searchQuery && searchQuery.trim().length > 0) {
    const q = searchQuery.trim().toLowerCase()
    filtered = filtered.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.title && it.title.toLowerCase().includes(q)) ||
        (it.author && it.author.toLowerCase().includes(q)) ||
        (it.artworkId && String(it.artworkId).includes(q))
    )
  }

  return sortFiles(filtered, sortMode)
}

/**
 * 删除单个文件
 */
export async function deleteManagedFile(filePath: string): Promise<boolean> {
  if (!FileManager.existsSync(filePath)) return true
  try {
    FileManager.removeSync(filePath)
    notifyDownloadFilesChanged()
    return true
  } catch (e: any) {
    console.log("deleteManagedFile error:", e?.message ?? e)
    return false
  }
}

/**
 * 批量删除文件
 */
export async function deleteManagedFiles(
  filePaths: string[]
): Promise<{ successCount: number; failedCount: number }> {
  let successCount = 0
  let failedCount = 0
  for (const p of filePaths) {
    const ok = await deleteManagedFile(p)
    if (ok) successCount++
    else failedCount++
  }
  return { successCount, failedCount }
}

/**
 * 删除整个创作者目录
 */
export async function deleteCreatorDirectory(folderPath: string): Promise<boolean> {
  if (!FileManager.existsSync(folderPath)) return true
  try {
    FileManager.removeSync(folderPath)
    notifyDownloadFilesChanged()
    return true
  } catch (e: any) {
    console.log("deleteCreatorDirectory error:", e?.message ?? e)
    return false
  }
}

/**
 * 重命名文件
 */
export async function renameManagedFile(
  oldPath: string,
  newFileName: string
): Promise<{ success: boolean; newPath?: string; error?: string }> {
  if (!FileManager.existsSync(oldPath)) {
    return { success: false, error: "原文件不存在" }
  }
  const cleanName = sanitizeFileName(newFileName)
  if (!cleanName) {
    return { success: false, error: "文件名不能为空" }
  }

  const dir = oldPath.substring(0, oldPath.lastIndexOf("/"))
  const oldExt = oldPath.includes(".") ? oldPath.split(".").pop()! : ""
  let targetName = cleanName
  if (oldExt && !cleanName.toLowerCase().endsWith(`.${oldExt.toLowerCase()}`)) {
    targetName = `${cleanName}.${oldExt}`
  }

  const targetPath = `${dir}/${targetName}`
  if (FileManager.existsSync(targetPath) && targetPath !== oldPath) {
    return { success: false, error: "已存在同名文件" }
  }

  try {
    FileManager.renameSync(oldPath, targetPath)
    notifyDownloadFilesChanged()
    return { success: true, newPath: targetPath }
  } catch (e: any) {
    return { success: false, error: e?.message ?? "重命名失败" }
  }
}

/**
 * 清理打包导出的临时目录与缓存
 */
export async function cleanTempCache(): Promise<number> {
  const tempDir = getCategoryDirectory("temp")
  const stats = calculateDirStats(tempDir)
  try {
    if (FileManager.existsSync(tempDir)) {
      FileManager.removeSync(tempDir)
      FileManager.createDirectorySync(tempDir, true)
    }
    notifyDownloadFilesChanged()
  } catch (e: any) {
    console.log("cleanTempCache error:", e?.message ?? e)
  }
  return stats.totalSize
}

/**
 * 外部优先打开文件：调用 iOS 原生 QuickLook 快速全屏预览（支持图片、音视频、PDF、ZIP、EPUB、文档等各类文件）
 */
export async function openFileExternal(item: ManagedFileItem): Promise<boolean> {
  if (!FileManager.existsSync(item.path)) return false
  try {
    if (typeof QuickLook !== "undefined" && typeof QuickLook.previewURLs === "function") {
      await QuickLook.previewURLs([item.path], true)
      return true
    }
  } catch (e: any) {
    console.log("openFileExternal QuickLook error:", e?.message ?? e)
  }
  return false
}

/**
 * 显式调用 QuickLook 快速预览
 */
export async function previewFileQuickLook(filePath: string): Promise<void> {
  if (!FileManager.existsSync(filePath)) return
  try {
    if (typeof QuickLook !== "undefined" && typeof QuickLook.previewURLs === "function") {
      await QuickLook.previewURLs([filePath], true)
    }
  } catch (e: any) {
    console.log("previewFileQuickLook error:", e?.message ?? e)
  }
}

/**
 * 显式调用 ShareSheet 系统分享
 */
export async function shareFilesSystem(filePaths: string[]): Promise<boolean> {
  const validPaths = filePaths.filter((p) => FileManager.existsSync(p))
  if (validPaths.length === 0) return false
  try {
    if (typeof ShareSheet !== "undefined" && typeof ShareSheet.present === "function") {
      return await ShareSheet.present(validPaths)
    }
  } catch (e: any) {
    console.log("shareFilesSystem error:", e?.message ?? e)
  }
  return false
}
