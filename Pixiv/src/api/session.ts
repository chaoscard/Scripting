import type { AuthTokenResponse, AuthUser } from "../types"
import {
  buildCredentialsFromResponse,
  clearCredentials,
  loadCredentials,
  needsRefresh,
  refreshToken,
  saveCredentials,
  type StoredCredentials,
} from "./auth"
import { PixivError } from "./client"

// 每个刷新任务只属于启动时的会话代次，不能跨登录态复用。
type RefreshTask = {
  generation: number
  promise: Promise<string>
}

export type SessionDependencies = {
  refreshToken: typeof refreshToken
  saveCredentials: typeof saveCredentials
  loadCredentials: typeof loadCredentials
  clearCredentials: typeof clearCredentials
}

const defaultDependencies: SessionDependencies = {
  refreshToken,
  saveCredentials,
  loadCredentials,
  clearCredentials,
}

// 全局会话：负责 token 的获取、刷新与 401 重试
export class Session {
  private creds: StoredCredentials | null = null
  private generation = 0
  private refreshing: RefreshTask | null = null
  private listeners: (() => void)[] = []

  constructor(private readonly dependencies = defaultDependencies) {
    this.restore()
  }

  // 返回退订函数，供 useEffect cleanup 使用
  onAuthChanged(fn: () => void): () => void {
    this.listeners.push(fn)
    return () => {
      const idx = this.listeners.indexOf(fn)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  private emitAuthChanged(): void {
    for (const fn of this.listeners) {
      fn()
    }
  }

  get isAuthenticated(): boolean {
    return this.creds != null
  }

  get user(): AuthUser | null {
    return this.creds?.user ?? null
  }

  get userID(): number | null {
    const id = this.creds?.user?.id
    return id ? Number(id) : null
  }

  restore(): void {
    this.generation += 1
    this.refreshing = null
    this.creds = this.dependencies.loadCredentials()
  }

  applyResponse(response: AuthTokenResponse): void {
    this.generation += 1
    this.refreshing = null
    this.creds = buildCredentialsFromResponse(response)
    this.dependencies.saveCredentials(this.creds)
    this.emitAuthChanged()
  }

  async getValidToken(): Promise<string> {
    if (!this.creds) {
      throw new PixivError(401, "未登录")
    }
    if (!needsRefresh(this.creds)) {
      return this.creds.accessToken
    }
    return this.startRefresh()
  }

  // 401 表示服务端已拒绝本次实际使用的 token，不能再按本地 expiresAt
  // 判断是否刷新。若其他并发请求已经换出新 token，则直接复用新 token；
  // 否则强制进入同一会话代次的 single-flight 刷新。
  private async refreshAfterUnauthorized(failedToken: string): Promise<string> {
    if (!this.creds) {
      throw new PixivError(401, "未登录")
    }
    if (this.creds.accessToken !== failedToken) {
      return this.creds.accessToken
    }
    return this.startRefresh()
  }

  private startRefresh(): Promise<string> {
    if (!this.creds) {
      return Promise.reject(new PixivError(401, "未登录"))
    }
    // 同一会话代次内并发刷新互斥；旧代次任务不能被新会话复用。
    const generation = this.generation
    const activeTask = this.refreshing
    if (activeTask?.generation === generation) {
      return activeTask.promise
    }

    const refreshTokenValue = this.creds.refreshToken
    let task: RefreshTask
    const promise = this.doRefresh(generation, refreshTokenValue).finally(() => {
      // 旧任务结束时不能清除新会话已经安装的刷新任务。
      if (this.refreshing === task) {
        this.refreshing = null
      }
    })
    task = { generation, promise }
    this.refreshing = task
    return promise
  }

  private async doRefresh(
    generation: number,
    refreshTokenValue: string
  ): Promise<string> {
    let response: AuthTokenResponse
    try {
      response = await this.dependencies.refreshToken(refreshTokenValue)
    } catch (error) {
      if (this.generation !== generation) {
        throw new PixivError(401, "登录状态已变更")
      }
      // 只有 OAuth 明确拒绝 refresh token（400/401）时才清除凭证。
      // 超时、断网、429、5xx 和协议解析错误均保留当前会话，允许稍后重试。
      if (
        error instanceof PixivError &&
        (error.status === 400 || error.status === 401)
      ) {
        this.signOut()
        throw new PixivError(401, "登录已过期，请重新登录")
      }
      throw error
    }

    // 退出、恢复或重新登录都会推进代次；旧响应不得写回或返回旧 token。
    if (this.generation !== generation) {
      throw new PixivError(401, "登录状态已变更")
    }

    this.creds = buildCredentialsFromResponse(response)
    this.dependencies.saveCredentials(this.creds)
    this.emitAuthChanged()
    return response.access_token
  }

  signOut(): void {
    this.generation += 1
    this.refreshing = null
    this.creds = null
    this.dependencies.clearCredentials()
    this.emitAuthChanged()
  }

  // 包装 API 调用：自动带 token，401 时刷新重试一次
  async call<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.getValidToken()
    try {
      return await fn(token)
    } catch (err) {
      if (err instanceof PixivError && err.status === 401) {
        const newToken = await this.refreshAfterUnauthorized(token)
        return await fn(newToken)
      }
      throw err
    }
  }
}

export const session = new Session()
