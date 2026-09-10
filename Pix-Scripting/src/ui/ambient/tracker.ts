let globalLastActiveAmbientImageUrl: string | null = null

/**
 * 记录最近一次在前台活跃生效的环境光封面图片 URL
 */
export function recordActiveAmbientImageUrl(url: string | null | undefined): void {
  if (url && typeof url === "string" && url.trim().length > 0) {
    globalLastActiveAmbientImageUrl = url.trim()
  }
}

/**
 * 获取最近一次在前台活跃生效的环境光封面图片 URL（用于二级页面 Push 转场与加载期间垫底预热）
 */
export function getLastActiveAmbientImageUrl(): string | null {
  return globalLastActiveAmbientImageUrl
}
