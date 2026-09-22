/**
 * StageProgressPipeline - 统一三阶段平滑加权流式进度管道
 *
 * 核心目标：
 * 1. 阶段解耦：将 [阶段一: 准备/元数据扫描]、[阶段二: 高清大图/二进制资源下载]、[阶段三: 打包压缩/归档落盘] 规范化映射为全局单调递增的流式进度；
 * 2. 杜绝 100% 假死：彻底消除“仅拉取完目录话数信息就透支打满 100%”以及“最后下载几百张大图时进度回调丢失”的架构缺陷；
 * 3. 严格单调性保证：进度百分比只能稳步推进，阶段切换与并发回调时绝不倒退或抖动。
 */

export interface StageWeights {
  /** 准备/元数据扫描阶段权重 (默认 0.05，即 0% ~ 5%) */
  prepare?: number
  /** 资源主体并发下载阶段权重 (默认 0.90，即 5% ~ 95%) */
  download?: number
  /** 文件打包/转码/归档落盘阶段权重 (默认 0.05，即 95% ~ 100%) */
  pack?: number
}

export interface ProgressTarget {
  updateProgress: (options: {
    current: number
    total?: number
    statusText: string
    isPaused?: boolean
  }) => void
}

export class StageProgressPipeline {
  private lastProgress = 0.0
  private prepareWeight: number
  private downloadWeight: number
  private packWeight: number
  private isCompleted = false

  constructor(
    private readonly target: ProgressTarget,
    weights?: StageWeights
  ) {
    const rawPrepare = Math.max(0, weights?.prepare ?? 0.05)
    const rawDownload = Math.max(0, weights?.download ?? 0.90)
    const rawPack = Math.max(0, weights?.pack ?? 0.05)
    const sum = rawPrepare + rawDownload + rawPack || 1.0

    this.prepareWeight = rawPrepare / sum
    this.downloadWeight = rawDownload / sum
    this.packWeight = rawPack / sum
  }

  /**
   * 获取当前归一化流式进度 (0.0 ~ 1.0)
   */
  get progress(): number {
    return this.lastProgress
  }

  /**
   * 1. 汇报准备阶段进度 (如拉取系列目录、解析各话页面列表等)
   */
  reportPrepare(current: number, total: number, statusText: string): void {
    if (this.isCompleted) return
    const fraction = total > 0 ? Math.min(1.0, Math.max(0, current / total)) : 0
    const rawProgress = fraction * this.prepareWeight
    this.dispatch(rawProgress, statusText)
  }

  /**
   * 2. 汇报主体下载阶段进度 (如并发下载插画、漫画原图、小说插图、动图原始帧等)
   */
  reportDownload(current: number, total: number, statusText: string): void {
    if (this.isCompleted) return
    const fraction = total > 0 ? Math.min(1.0, Math.max(0, current / total)) : 0
    const rawProgress = this.prepareWeight + fraction * this.downloadWeight
    this.dispatch(rawProgress, statusText)
  }

  /**
   * 3. 汇报打包/归档/落盘阶段进度 (如 CBZ/EPUB/ZIP 压缩生成、相册连续写入等)
   */
  reportPack(current: number, total: number, statusText: string): void {
    if (this.isCompleted) return
    const fraction = total > 0 ? Math.min(1.0, Math.max(0, current / total)) : 0
    const rawProgress = this.prepareWeight + this.downloadWeight + fraction * this.packWeight
    this.dispatch(rawProgress, statusText)
  }

  /**
   * 4. 任务全部完成终态汇报
   */
  reportComplete(statusText = "下载完成"): void {
    this.isCompleted = true
    this.dispatch(1.0, statusText)
  }

  /**
   * 核心流式分发器：确保全局单调递增，映射为高精度虚拟刻度向系统与 UI 层汇报
   */
  private dispatch(rawProgress: number, statusText: string): void {
    const clamped = Math.max(this.lastProgress, Math.min(1.0, rawProgress))
    this.lastProgress = clamped

    // 采用 1000 虚拟刻度分母，保证百分比计算和系统 ProgressView 具有 0.1% 级高精平滑度
    const virtualTotal = 1000
    const virtualCurrent = Math.round(clamped * virtualTotal)

    this.target.updateProgress({
      current: virtualCurrent,
      total: virtualTotal,
      statusText,
    })
  }
}
