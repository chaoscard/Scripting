// 可恢复的文件提交：先写同目录临时文件并校验，再通过 backup 交换正式文件。
// FileManager.renameSync 不支持覆盖已有目标，因此保留 .bak 作为崩溃恢复点。

let tempSequence = 0

function tempPathFor(targetPath: string): string {
  return `${targetPath}.tmp.${Date.now()}.${++tempSequence}`
}

export function backupPathFor(targetPath: string): string {
  return `${targetPath}.bak`
}

export function recoverFile(targetPath: string): void {
  const backup = backupPathFor(targetPath)
  if (!FileManager.existsSync(targetPath) && FileManager.existsSync(backup)) {
    try {
      FileManager.renameSync(backup, targetPath)
    } catch {
      // 保留 backup，下一次读取时继续恢复。
    }
  }
}

function commitPreparedFile(tempPath: string, targetPath: string): void {
  const backup = backupPathFor(targetPath)
  recoverFile(targetPath)
  if (FileManager.existsSync(backup)) {
    FileManager.removeSync(backup)
  }
  const hadTarget = FileManager.existsSync(targetPath)
  if (hadTarget) {
    FileManager.renameSync(targetPath, backup)
  }
  try {
    FileManager.renameSync(tempPath, targetPath)
  } catch (error) {
    if (!FileManager.existsSync(targetPath) && FileManager.existsSync(backup)) {
      try {
        FileManager.renameSync(backup, targetPath)
      } catch {
        // backup 仍保留，recoverFile 可在下次读取时恢复。
      }
    }
    throw error
  }
  if (FileManager.existsSync(backup)) {
    try {
      FileManager.removeSync(backup)
    } catch {
      // 主提交已经完成，旧备份残留不影响读取。
    }
  }
}

export function writeTextSafely(
  targetPath: string,
  contents: string,
  validate?: (contents: string) => void
): void {
  const tempPath = tempPathFor(targetPath)
  try {
    FileManager.writeAsStringSync(tempPath, contents)
    const prepared = FileManager.readAsStringSync(tempPath, "utf-8")
    validate?.(prepared)
    commitPreparedFile(tempPath, targetPath)
  } finally {
    if (FileManager.existsSync(tempPath)) {
      try {
        FileManager.removeSync(tempPath)
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

export function writeDataSafely(
  targetPath: string,
  data: Data,
  validate?: (tempPath: string) => void
): void {
  const tempPath = tempPathFor(targetPath)
  try {
    FileManager.writeAsDataSync(tempPath, data)
    const stat = FileManager.statSync(tempPath)
    // 真机 FileStat.type 返回 NSFileTypeRegular，而类型声明写的是 file；
    // 此处以已存在且 size > 0 判断普通缓存文件，避免平台值差异误判。
    if (stat.size <= 0) {
      throw new Error("临时文件写入不完整")
    }
    validate?.(tempPath)
    commitPreparedFile(tempPath, targetPath)
  } finally {
    if (FileManager.existsSync(tempPath)) {
      try {
        FileManager.removeSync(tempPath)
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

export function publishPreparedFile(
  sourcePath: string,
  targetPath: string,
  validate?: (tempPath: string) => void
): void {
  const tempPath = tempPathFor(targetPath)
  try {
    FileManager.copyFileSync(sourcePath, tempPath)
    const stat = FileManager.statSync(tempPath)
    if (stat.size <= 0) {
      throw new Error("待发布文件不完整")
    }
    validate?.(tempPath)
    commitPreparedFile(tempPath, targetPath)
  } finally {
    if (FileManager.existsSync(tempPath)) {
      try {
        FileManager.removeSync(tempPath)
      } catch {
        // ignore cleanup failure
      }
    }
  }
}
