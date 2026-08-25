const DATA_DIR_NAME = "Pix-Scripting"

function ensureDirectory(dir: string): string {
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
  return dir
}

// Pix-Scripting 设备本地持久数据的根目录，缓存等不应同步到 iCloud。
export function pixivDataDirectory(): string {
  return ensureDirectory(`${FileManager.documentsDirectory}/${DATA_DIR_NAME}`)
}

export function pixivDataPath(...parts: string[]): string {
  return [pixivDataDirectory(), ...parts].join("/")
}

// 浏览记录、设置与黑名单保存在 iCloud Documents，以便同一脚本在多设备间同步。
// iCloud 不可用时回退到设备本地目录。
function pixivCloudDirectory(subDir: string): string {
  if (FileManager.isiCloudEnabled) {
    try {
      return ensureDirectory(
        `${FileManager.iCloudDocumentsDirectory}/${DATA_DIR_NAME}/${subDir}`
      )
    } catch {
      // iCloud 初始化失败时使用本地回退目录。
    }
  }
  return pixivDataPath(subDir)
}

export function pixivHistoryDirectory(userId?: string | number | null): string {
  const uid = userId != null && String(userId).trim().length > 0 ? String(userId).trim() : "anonymous"
  return pixivCloudDirectory(`History/users/${uid}`)
}

// 系列目录与话数映射保存在 iCloud Documents，按账号隔离支持跨设备同步。
export function pixivSeriesCacheDirectory(userId?: string | number | null): string {
  const uid = userId != null && String(userId).trim().length > 0 ? String(userId).trim() : "anonymous"
  return pixivCloudDirectory(`Series/users/${uid}`)
}

// 应用设置保存在 iCloud Documents，以便多设备间同步配置。
export function pixivSettingsDirectory(): string {
  return pixivCloudDirectory("Settings")
}

// 黑名单保存在 iCloud Documents，按账号隔离支持跨设备同步。
export function pixivBlocklistDirectory(userId?: string | number | null): string {
  const uid = userId != null && String(userId).trim().length > 0 ? String(userId).trim() : "anonymous"
  return pixivCloudDirectory(`Blocklist/users/${uid}`)
}
