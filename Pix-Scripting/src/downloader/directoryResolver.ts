import { loadSettings } from "../store/settings"

export type DownloadCategory = "novels" | "manga" | "illustrations" | "temp"

/**
 * 过滤文件名中的非法字符，防止文件系统路径错误
 */
export function sanitizeFileName(name: string, fallback = "download"): string {
  if (!name) return fallback
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 120) : fallback
}

/**
 * 获取下载的根目录路径（支持自定义安全书签、iCloud 模式、默认 Documents 沙盒）
 */
export function getDownloadRootDirectory(): string {
  const settings = loadSettings()

  if (settings.downloadStorageMode === "icloud") {
    if (FileManager.isiCloudEnabled) {
      const root = `${FileManager.iCloudDocumentsDirectory}/Pix-Scripting`
      if (!FileManager.existsSync(root)) {
        try {
          FileManager.createDirectorySync(root, true)
        } catch {}
      }
      return root
    }
  }

  // 检查是否有自定义本地文件夹 Bookmark
  if (settings.downloadCustomDirectoryBookmark) {
    try {
      const bookmarked = FileManager.bookmarkedPath(settings.downloadCustomDirectoryBookmark)
      if (bookmarked && FileManager.existsSync(bookmarked)) {
        return bookmarked
      }
    } catch (e: any) {
      console.log("resolve bookmarkedPath error:", e?.message ?? e)
    }
  }

  // 默认沙盒目录
  const defaultRoot = `${FileManager.documentsDirectory}/Pix-Scripting`
  if (!FileManager.existsSync(defaultRoot)) {
    try {
      FileManager.createDirectorySync(defaultRoot, true)
    } catch {}
  }
  return defaultRoot
}

/**
 * 获取并确保特定内容类别的存储子目录
 */
export function getCategoryDirectory(category: DownloadCategory): string {
  if (category === "temp") {
    const tempDir = `${FileManager.temporaryDirectory}/pix_downloader_temp`
    if (!FileManager.existsSync(tempDir)) {
      try {
        FileManager.createDirectorySync(tempDir, true)
      } catch {}
    }
    return tempDir
  }

  const root = getDownloadRootDirectory()
  let subName = "Others"
  if (category === "novels") subName = "Novels"
  else if (category === "manga") subName = "Manga"
  else if (category === "illustrations") subName = "Illustrations"

  const targetPath = `${root}/${subName}`
  if (!FileManager.existsSync(targetPath)) {
    try {
      FileManager.createDirectorySync(targetPath, true)
    } catch {}
  }
  return targetPath
}

/**
 * 获取并确保特定创作者的存储子目录（例如：/Pix-Scripting/画师名 (UID)/插画）
 */
export function getAuthorDownloadDirectory(
  authorName: string,
  authorId: number,
  subCategory?: "illustrations" | "manga" | "novels"
): string {
  const root = getDownloadRootDirectory()
  const authorFolder = sanitizeFileName(`${authorName || "Artist"} (${authorId})`)
  let dirPath = `${root}/${authorFolder}`

  if (subCategory) {
    let subName = "插画"
    if (subCategory === "manga") subName = "漫画"
    else if (subCategory === "novels") subName = "小说"
    dirPath = `${dirPath}/${subName}`
  }

  if (!FileManager.existsSync(dirPath)) {
    try {
      FileManager.createDirectorySync(dirPath, true)
    } catch {}
  }
  return dirPath
}

/**
 * 清理指定临时目录或文件
 */
export function cleanTemporaryPath(path: string): void {
  try {
    if (FileManager.existsSync(path)) {
      FileManager.removeSync(path)
    }
  } catch (e: any) {
    console.log("cleanTemporaryPath error:", e?.message ?? e)
  }
}
