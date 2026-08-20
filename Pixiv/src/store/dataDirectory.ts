const PIXIV_DATA_DIR_NAME = "Pixiv"

function ensureDirectory(dir: string): string {
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
  return dir
}

// Pixiv 设备本地持久数据的根目录，缓存等不应同步到 iCloud。
export function pixivDataDirectory(): string {
  return ensureDirectory(`${FileManager.documentsDirectory}/${PIXIV_DATA_DIR_NAME}`)
}

export function pixivDataPath(...parts: string[]): string {
  return [pixivDataDirectory(), ...parts].join("/")
}

// 浏览记录单独保存在 iCloud Documents，以便同一脚本在多设备间同步。
// iCloud 不可用时回退到设备本地目录，避免历史功能失效。
function pixivCloudDirectory(subDir: string): string {
  if (FileManager.isiCloudEnabled) {
    try {
      return ensureDirectory(
        `${FileManager.iCloudDocumentsDirectory}/${PIXIV_DATA_DIR_NAME}/${subDir}`
      )
    } catch {
      // iCloud 初始化失败时使用本地回退目录。
    }
  }
  return pixivDataPath(subDir)
}

export function pixivHistoryDirectory(): string {
  return pixivCloudDirectory("History")
}

// 应用设置保存在 iCloud Documents，以便多设备间同步配置。
export function pixivSettingsDirectory(): string {
  return pixivCloudDirectory("Settings")
}

// 黑名单独立保存在 iCloud Documents，支持跨设备同步。
export function pixivBlocklistDirectory(): string {
  return pixivCloudDirectory("Blocklist")
}

