import { Navigation, Script } from "scripting"
import { session } from "./src/api/session"
import { prepareHistoryStorage } from "./src/store/history"
import { prepareSettingsStorage } from "./src/store/settings"
import { prepareWatchlistStorage } from "./src/store/watchlist"
import { pixivDataDirectory } from "./src/store/dataDirectory"
import { RootView } from "./src/ui/root"

async function run() {
  // 初始化 Pixiv 专属的 Documents 数据根目录。
  pixivDataDirectory()

  // 云端浏览历史、应用设置与追更列表若仍是占位文件，先请求下载再渲染界面。
  await Promise.all([
    prepareHistoryStorage(),
    prepareSettingsStorage(),
    prepareWatchlistStorage(),
  ])

  // 恢复本地登录态
  session.restore()

  // 禁用下拉最小化，避免与列表下拉刷新手势冲突；使用左上角按钮收起
  Script.enableMinimize(false)

  // 全屏模态展示（与 Scripting Music 一致）
  await Navigation.present({
    element: <RootView />,
    modalPresentationStyle: "overFullScreen",
  })
  // 左上角按钮触发 Script.minimize() 后保持存活
  Script.exit()
}

run()
