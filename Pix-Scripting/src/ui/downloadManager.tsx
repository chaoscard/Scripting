import {
  Button,
  Group,
  HStack,
  Image,
  List,
  Menu,
  NavigationLink,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import {
  addDownloadFilesChangeListener,
  cleanTempCache,
  deleteCreatorDirectory,
  deleteManagedFile,
  deleteManagedFiles,
  formatBytes,
  getStorageOverview,
  openFileExternal,
  previewFileQuickLook,
  renameManagedFile,
  scanCategoryFiles,
  scanCreatorDirectories,
  scanCreatorFiles,
  shareFilesSystem,
  type CreatorFolderItem,
  type DownloadFileCategory,
  type ManagedFileItem,
  type SortMode,
  type StorageOverview,
} from "../downloader/downloadFileManager"
import { appToolbar } from "./components"
import { destinationElement } from "./routes"

// ============================================================================
// 1. 二级总览页：下载与本地文件管理 (DownloadManagerView)
// ============================================================================

export function DownloadManagerView(props: { onClose?: () => void }) {
  const [overview, setOverview] = useState<StorageOverview | null>(null)
  const [cleaning, setCleaning] = useState(false)

  async function loadOverviewData(forceRefresh = false) {
    try {
      const data = await getStorageOverview(forceRefresh)
      setOverview(data)
    } catch (e) {
      console.log("loadOverviewData error:", e)
    }
  }

  useEffect(() => {
    loadOverviewData(false)
    const unsubscribe = addDownloadFilesChangeListener(() => {
      void loadOverviewData(false)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  async function handleCleanTemp() {
    setCleaning(true)
    try {
      const freed = await cleanTempCache()
      await loadOverviewData()
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        void Dialog.alert({
          title: "清理完成",
          message:
            freed > 0
              ? `已清理临时导出缓存，释放了 ${formatBytes(freed)} 空间。`
              : "临时缓存已是最新，无冗余文件。",
        })
      }
    } catch (e: any) {
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        void Dialog.alert({
          title: "清理失败",
          message: e?.message ?? "清理临时缓存时发生错误",
        })
      }
    } finally {
      setCleaning(false)
    }
  }

  const cleanBtn = (
    <Button
      action={handleCleanTemp}
      disabled={cleaning}
      foregroundStyle="systemRed"
    >
      <Image systemName="trash" foregroundStyle="systemRed" />
    </Button>
  )

  return (
    <List
      navigationTitle="下载与文件管理"
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      onAppear={() => {
        void loadOverviewData(false)
      }}
      refreshable={async () => {
        await loadOverviewData(true)
      }}
      toolbar={
        props.onClose
          ? appToolbar(props.onClose, "下载与文件管理", cleanBtn)
          : { topBarTrailing: [cleanBtn] }
      }
    >
      {/* 存储统计卡片 */}
      <Section header={<Text>存储概况</Text>}>
        <VStack spacing={8} padding={{ vertical: 4 }}>
          <HStack alignment="center">
            <VStack alignment="leading" spacing={2}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                已下载文件总占用
              </Text>
              <Text font="title2" fontWeight="bold">
                {overview ? overview.formattedTotalSize : "..."}
              </Text>
            </VStack>
            <Spacer />
            <VStack alignment="trailing" spacing={2}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                文件总数
              </Text>
              <Text font="headline" fontWeight="medium" foregroundStyle="tintColor">
                {overview ? `${overview.totalFilesCount} 个` : "-"}
              </Text>
            </VStack>
          </HStack>

          {overview && overview.tempSize > 0 ? (
            <HStack alignment="center" spacing={6} padding={{ top: 4 }}>
              <Image systemName="clock.arrow.circlepath" font="caption" foregroundStyle="secondaryLabel" />
              <Text font="caption" foregroundStyle="secondaryLabel">
                临时导出缓存: {overview.formattedTempSize}
              </Text>
              <Spacer />
              <Button
                title="清空"
                controlSize="mini"
                buttonStyle="bordered"
                action={handleCleanTemp}
              />
            </HStack>
          ) : null}
        </VStack>
      </Section>

      {/* 五大独立分类入口 */}
      <Section header={<Text>分类浏览</Text>}>
        <NavigationLink value="downloadDetail:illustrations">
          <DownloadCategoryRow
            icon="photo.fill"
            iconColor="#0096FA"
            title="插画 (Illustrations)"
            subtitle={
              overview
                ? `${overview.illustrationsCount} 个文件 • ${formatBytes(overview.illustrationsSize)}`
                : "加载中…"
            }
          />
        </NavigationLink>

        <NavigationLink value="downloadDetail:ugoira">
          <DownloadCategoryRow
            icon="play.circle.fill"
            iconColor="#FF9500"
            title="动图 (Ugoira)"
            subtitle={
              overview
                ? `${overview.ugoiraCount} 个文件 • ${formatBytes(overview.ugoiraSize)}`
                : "加载中…"
            }
          />
        </NavigationLink>

        <NavigationLink value="downloadDetail:manga">
          <DownloadCategoryRow
            icon="photo.on.rectangle.fill"
            iconColor="#34C759"
            title="漫画 (Manga)"
            subtitle={
              overview
                ? `${overview.mangaCount} 个文件 • ${formatBytes(overview.mangaSize)}`
                : "加载中…"
            }
          />
        </NavigationLink>

        <NavigationLink value="downloadDetail:novels">
          <DownloadCategoryRow
            icon="book.fill"
            iconColor="#AF52DE"
            title="小说 (Novels)"
            subtitle={
              overview
                ? `${overview.novelsCount} 个文件 • ${formatBytes(overview.novelsSize)}`
                : "加载中…"
            }
          />
        </NavigationLink>

        <NavigationLink value="downloadCreators">
          <DownloadCategoryRow
            icon="person.2.fill"
            iconColor="#FF2D55"
            title="创作者归档 (Creators)"
            subtitle={
              overview
                ? `${overview.creatorsCount} 位创作者 • ${formatBytes(overview.creatorsSize)}`
                : "加载中…"
            }
          />
        </NavigationLink>
      </Section>

      {/* 全部文件入口 */}
      <Section header={<Text>全局索引</Text>}>
        <NavigationLink value="downloadDetail:all">
          <DownloadCategoryRow
            icon="folder.fill"
            iconColor="secondaryLabel"
            title="全部下载文件"
            subtitle={
              overview
                ? `共 ${overview.totalFilesCount} 个文件 • ${overview.formattedTotalSize}`
                : "加载中…"
            }
          />
        </NavigationLink>
      </Section>
    </List>
  )
}

function DownloadCategoryRow(props: {
  icon: string
  iconColor: string
  title: string
  subtitle: string
}) {
  return (
    <HStack alignment="center" spacing={12} padding={{ vertical: 4 }}>
      <Image
        systemName={props.icon}
        foregroundStyle={props.iconColor as any}
        font="title3"
        frame={{ width: 28 }}
      />
      <VStack alignment="leading" spacing={2}>
        <Text font="body" fontWeight="medium">
          {props.title}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          {props.subtitle}
        </Text>
      </VStack>
    </HStack>
  )
}

// ============================================================================
// 2. 三级文件列表页：详细文件列表 (DownloadDetailListView)
// ============================================================================

export function DownloadDetailListView(props: {
  category?: DownloadFileCategory
  title?: string
  creatorFolder?: string
}) {
  const category = props.category || "all"
  const creatorFolder = props.creatorFolder

  const [files, setFiles] = useState<ManagedFileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortMode, setSortMode] = useState<SortMode>("date_desc")
  const [isEditing, setIsEditing] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])

  const pageTitle = useMemo(() => {
    if (props.title) return props.title
    if (creatorFolder) return creatorFolder
    if (category === "illustrations") return "插画"
    if (category === "ugoira") return "动图"
    if (category === "manga") return "漫画"
    if (category === "novels") return "小说"
    return "全部下载文件"
  }, [props.title, creatorFolder, category])

  async function loadFileList(forceRefresh = false) {
    setLoading(true)
    try {
      let list: ManagedFileItem[] = []
      if (creatorFolder) {
        list = await scanCreatorFiles(creatorFolder, "all", sortMode, searchQuery, forceRefresh)
      } else {
        list = await scanCategoryFiles(category, sortMode, searchQuery, forceRefresh)
      }
      setFiles(list)
    } catch (e) {
      console.log("loadFileList error:", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFileList(false)
    const unsubscribe = addDownloadFilesChangeListener(() => {
      void loadFileList(false)
    })
    return () => {
      unsubscribe()
    }
  }, [category, creatorFolder, sortMode, searchQuery])

  function toggleSelect(path: string) {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }

  function handleToggleSelectAll() {
    if (selectedPaths.length === files.length) {
      setSelectedPaths([])
    } else {
      setSelectedPaths(files.map((f) => f.path))
    }
  }

  async function handleBatchDelete() {
    if (selectedPaths.length === 0) return
    if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
      const confirmed = await Dialog.confirm({
        title: "确认删除？",
        message: `确定要永久删除选中的 ${selectedPaths.length} 个文件吗？此操作无法撤销。`,
        confirmLabel: "删除",
        cancelLabel: "取消",
      })
      if (!confirmed) return
    }

    const { successCount } = await deleteManagedFiles(selectedPaths)
    setSelectedPaths([])
    setIsEditing(false)
    await loadFileList()
    if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
      void Dialog.alert({
        title: "删除完成",
        message: `已成功删除 ${successCount} 个文件。`,
      })
    }
  }

  async function handleBatchShare() {
    if (selectedPaths.length === 0) return
    await shareFilesSystem(selectedPaths)
  }

  async function handleRename(item: ManagedFileItem) {
    const rawNameWithoutExt = item.name.replace(/\.[^/.]+$/, "")
    if (typeof Dialog === "undefined" || typeof Dialog.prompt !== "function") return
    const newName = await Dialog.prompt({
      title: "重命名文件",
      message: "请输入新的文件名：",
      defaultValue: rawNameWithoutExt,
    })
    if (!newName || newName.trim() === "" || newName.trim() === rawNameWithoutExt) return

    const res = await renameManagedFile(item.path, newName.trim())
    if (res.success) {
      await loadFileList()
    } else {
      void Dialog.alert({
        title: "重命名失败",
        message: res.error || "无法重命名文件",
      })
    }
  }

  async function handleDeleteSingle(item: ManagedFileItem) {
    if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
      const confirmed = await Dialog.confirm({
        title: "删除文件",
        message: `确定要永久删除「${item.name}」吗？`,
        confirmLabel: "删除",
        cancelLabel: "取消",
      })
      if (!confirmed) return
    }

    const ok = await deleteManagedFile(item.path)
    if (ok) {
      setFiles((prev) => prev.filter((f) => f.path !== item.path))
    } else {
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        void Dialog.alert({ title: "删除失败", message: "无法删除该文件" })
      }
    }
  }

  async function handleItemTap(item: ManagedFileItem) {
    if (isEditing) {
      toggleSelect(item.path)
      return
    }
    await openFileExternal(item)
  }

  return (
    <List
      navigationTitle={pageTitle}
      navigationBarTitleDisplayMode="inline"
      onAppear={() => {
        void loadFileList(false)
      }}
      refreshable={async () => {
        await loadFileList(true)
      }}
      searchable={{
        value: searchQuery,
        onChanged: setSearchQuery,
        prompt: "搜索文件名、作品 ID 或创作者…",
      }}
      toolbar={{
        topBarTrailing: isEditing
          ? [
              <Button
                key="edit-btn"
                action={() => {
                  setSelectedPaths([])
                  setIsEditing(false)
                }}
              >
                <Image systemName="checkmark" fontWeight="bold" />
              </Button>,
            ]
          : [
              <Menu
                key="sort-menu"
                title="排序"
                systemImage="arrow.up.arrow.down"
              >
                <Button
                  title="修改时间（最新在前）"
                  systemImage={sortMode === "date_desc" ? "checkmark" : "clock"}
                  action={() => setSortMode("date_desc")}
                />
                <Button
                  title="修改时间（最旧在前）"
                  systemImage={sortMode === "date_asc" ? "checkmark" : "clock.arrow.circlepath"}
                  action={() => setSortMode("date_asc")}
                />
                <Button
                  title="文件大小（从大到小）"
                  systemImage={sortMode === "size_desc" ? "checkmark" : "arrow.down"}
                  action={() => setSortMode("size_desc")}
                />
                <Button
                  title="文件大小（从小到大）"
                  systemImage={sortMode === "size_asc" ? "checkmark" : "arrow.up"}
                  action={() => setSortMode("size_asc")}
                />
                <Button
                  title="文件名称（A → Z）"
                  systemImage={sortMode === "name_asc" ? "checkmark" : "textformat.abc"}
                  action={() => setSortMode("name_asc")}
                />
                <Button
                  title="文件名称（Z → A）"
                  systemImage={sortMode === "name_desc" ? "checkmark" : "textformat.abc"}
                  action={() => setSortMode("name_desc")}
                />
              </Menu>,
              <Button
                key="edit-btn"
                action={() => {
                  setIsEditing(true)
                }}
              >
                <Image systemName="checkmark.circle" />
              </Button>,
            ],
      }}
    >
      {/* 批量操作控制条（多选模式） */}
      {isEditing ? (
        <Section>
          <HStack alignment="center" spacing={14}>
            <Button
              title={selectedPaths.length === files.length ? "取消全选" : "全选"}
              buttonStyle="borderless"
              action={handleToggleSelectAll}
            />
            <Spacer />
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              已选 {selectedPaths.length} 项
            </Text>
            <Spacer />
            <HStack spacing={18}>
              <Button
                buttonStyle="borderless"
                action={handleBatchShare}
                disabled={selectedPaths.length === 0}
              >
                <Image
                  systemName="square.and.arrow.up"
                  foregroundStyle={selectedPaths.length === 0 ? "secondaryLabel" : "tintColor"}
                />
              </Button>
              <Button
                buttonStyle="borderless"
                action={handleBatchDelete}
                disabled={selectedPaths.length === 0}
              >
                <Image
                  systemName="trash"
                  foregroundStyle={selectedPaths.length === 0 ? "secondaryLabel" : "systemRed"}
                />
              </Button>
            </HStack>
          </HStack>
        </Section>
      ) : null}

      {/* 文件列表 */}
      <Section
        header={
          <HStack>
            <Text>共 {files.length} 个文件</Text>
            <Spacer />
            <Text>{loading ? "正在扫描…" : ""}</Text>
          </HStack>
        }
      >
        {files.length === 0 && !loading ? (
          <VStack alignment="center" spacing={8} padding={{ vertical: 24 }}>
            <Image systemName="folder.badge.questionmark" font="largeTitle" foregroundStyle="secondaryLabel" />
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {searchQuery ? "未找到匹配的文件" : "当前分类暂无已下载文件"}
            </Text>
          </VStack>
        ) : (
          files.map((file) => {
            const isSelected = selectedPaths.includes(file.path)
            return (
              <FileRowItem
                key={file.id}
                item={file}
                isEditing={isEditing}
                isSelected={isSelected}
                onTap={() => handleItemTap(file)}
                onRename={() => handleRename(file)}
                onDelete={() => handleDeleteSingle(file)}
              />
            )
          })
        )}
      </Section>
    </List>
  )
}

function FileRowItem(props: {
  item: ManagedFileItem
  isEditing: boolean
  isSelected: boolean
  onTap: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const { item, isEditing, isSelected, onTap, onRename, onDelete } = props

  const ext = item.extension.toLowerCase()
  let iconName = "doc.fill"
  let iconColor = "#8E8E93"

  if (ext === "epub") {
    iconName = "book.fill"
    iconColor = "#AF52DE"
  } else if (ext === "cbz") {
    iconName = "book.closed.fill"
    iconColor = "#34C759"
  } else if (ext === "zip") {
    iconName = "doc.zipper"
    iconColor = "#FF9500"
  } else if (ext === "mp4" || ext === "mov") {
    iconName = "film"
    iconColor = "#FF2D55"
  } else if (ext === "gif") {
    iconName = "photo.stack"
    iconColor = "#FF9500"
  } else if (ext === "jpg" || ext === "png" || ext === "jpeg") {
    iconName = "photo"
    iconColor = "#0096FA"
  } else if (ext === "txt") {
    iconName = "doc.text.fill"
    iconColor = "#5856D6"
  }

  return (
    <HStack
      alignment="center"
      spacing={12}
      padding={{ vertical: 4 }}
      trailingSwipeActions={{
        allowsFullSwipe: true,
        actions: [
          <Button
            key="del"
            title="删除"
            systemImage="trash"
            role="destructive"
            action={onDelete}
          />,
          <Button
            key="rename"
            title="重命名"
            systemImage="pencil"
            tint="systemBlue"
            action={onRename}
          />,
          <Button
            key="share"
            title="分享"
            systemImage="square.and.arrow.up"
            tint="systemGreen"
            action={() => {
              void shareFilesSystem([item.path])
            }}
          />,
        ],
      }}
      contextMenu={{
        menuItems: (
          <Group>
            <Button
              title="打开 / 导出 (外部优先)"
              systemImage="arrow.up.forward.app"
              action={() => {
                void openFileExternal(item)
              }}
            />
            <Button
              title="快速预览 (QuickLook)"
              systemImage="eye"
              action={() => {
                void previewFileQuickLook(item.path)
              }}
            />
            <Button
              title="系统分享"
              systemImage="square.and.arrow.up"
              action={() => {
                void shareFilesSystem([item.path])
              }}
            />
            <Button
              title="重命名"
              systemImage="pencil"
              action={onRename}
            />
            <Button
              title="删除文件"
              systemImage="trash"
              role="destructive"
              action={onDelete}
            />
          </Group>
        ),
      }}
    >
      {/* 行主体：点击触发主动作（查看/分享或多选切换） */}
      <Button
        buttonStyle="plain"
        action={onTap}
        frame={{ maxWidth: "infinity" }}
      >
        <HStack alignment="center" spacing={12} frame={{ maxWidth: "infinity" }}>
          {/* 多选勾选指示器 */}
          {isEditing ? (
            <Image
              systemName={isSelected ? "checkmark.circle.fill" : "circle"}
              foregroundStyle={isSelected ? "tintColor" : "secondaryLabel"}
              font="title3"
            />
          ) : null}

          {/* 格式图标 */}
          <Image
            systemName={iconName}
            foregroundStyle={iconColor as any}
            font="title3"
            frame={{ width: 28 }}
          />

          {/* 文件详情 */}
          <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
            <Text font="body" fontWeight="medium" lineLimit={2}>
              {item.name}
            </Text>
            <HStack alignment="center" spacing={6}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {item.formattedSize}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                •
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {item.formattedTime}
              </Text>
              {item.creatorFolder ? (
                <HStack alignment="center" spacing={2}>
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    •
                  </Text>
                  <Text font="caption" foregroundStyle="tintColor" lineLimit={1}>
                    {item.creatorFolder}
                  </Text>
                </HStack>
              ) : null}
            </HStack>
          </VStack>
        </HStack>
      </Button>
    </HStack>
  )
}

// ============================================================================
// 3. 创作者专区列表页 (DownloadCreatorsListView)
// ============================================================================

export function DownloadCreatorsListView(props: { onClose?: () => void }) {
  const [creators, setCreators] = useState<CreatorFolderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortMode, setSortMode] = useState<SortMode>("size_desc")

  async function loadCreators(forceRefresh = false) {
    setLoading(true)
    try {
      const list = await scanCreatorDirectories(sortMode, searchQuery, forceRefresh)
      setCreators(list)
    } catch (e) {
      console.log("loadCreators error:", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCreators(false)
    const unsubscribe = addDownloadFilesChangeListener(() => {
      void loadCreators(false)
    })
    return () => {
      unsubscribe()
    }
  }, [sortMode, searchQuery])

  async function handleDeleteCreator(creator: CreatorFolderItem) {
    if (typeof Dialog !== "undefined" && typeof Dialog.confirm === "function") {
      const confirmed = await Dialog.confirm({
        title: "删除创作者归档？",
        message: `确定要删除「${creator.name}」的所有已下载作品文件夹吗？总计 ${creator.fileCount} 个文件 (${creator.formattedSize}) 将被移除。`,
        confirmLabel: "删除全部",
        cancelLabel: "取消",
      })
      if (!confirmed) return
    }

    const ok = await deleteCreatorDirectory(creator.path)
    if (ok) {
      setCreators((prev) => prev.filter((c) => c.id !== creator.id))
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        void Dialog.alert({ title: "删除成功", message: `已移除创作者「${creator.name}」的文件归档。` })
      }
    } else {
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        void Dialog.alert({ title: "删除失败", message: "无法删除该创作者文件夹" })
      }
    }
  }

  return (
    <List
      navigationTitle="创作者归档"
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      onAppear={() => {
        void loadCreators(false)
      }}
      refreshable={async () => {
        await loadCreators(true)
      }}
      searchable={{
        value: searchQuery,
        onChanged: setSearchQuery,
        prompt: "搜索创作者名称或 UID…",
      }}
      toolbar={{
        topBarTrailing: [
          <Menu
            key="sort-menu"
            title="排序"
            systemImage="arrow.up.arrow.down"
          >
            <Button
              title="占用大小（从大到小）"
              systemImage={sortMode === "size_desc" ? "checkmark" : "arrow.down"}
              action={() => setSortMode("size_desc")}
            />
            <Button
              title="占用大小（从小到大）"
              systemImage={sortMode === "size_asc" ? "checkmark" : "arrow.up"}
              action={() => setSortMode("size_asc")}
            />
            <Button
              title="创作者名称（A → Z）"
              systemImage={sortMode === "name_asc" ? "checkmark" : "textformat.abc"}
              action={() => setSortMode("name_asc")}
            />
            <Button
              title="创作者名称（Z → A）"
              systemImage={sortMode === "name_desc" ? "checkmark" : "textformat.abc"}
              action={() => setSortMode("name_desc")}
            />
          </Menu>,
        ],
      }}
    >
      <Section
        header={
          <HStack>
            <Text>共 {creators.length} 位创作者</Text>
            <Spacer />
            <Text>{loading ? "正在扫描…" : ""}</Text>
          </HStack>
        }
      >
        {creators.length === 0 && !loading ? (
          <VStack alignment="center" spacing={8} padding={{ vertical: 24 }}>
            <Image systemName="person.crop.circle.badge.questionmark" font="largeTitle" foregroundStyle="secondaryLabel" />
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {searchQuery ? "未找到匹配的创作者" : "暂无创作者归档文件"}
            </Text>
          </VStack>
        ) : (
          creators.map((creator) => (
            <NavigationLink
              key={creator.id}
              value={`downloadCreator:${creator.id}`}
            >
              <HStack
                alignment="center"
                spacing={12}
                padding={{ vertical: 4 }}
                trailingSwipeActions={{
                  allowsFullSwipe: true,
                  actions: [
                    <Button
                      key="del"
                      title="删除归档"
                      systemImage="trash"
                      role="destructive"
                      action={() => handleDeleteCreator(creator)}
                    />,
                  ],
                }}
              >
                <Image
                  systemName="person.2.fill"
                  foregroundStyle="#FF2D55"
                  font="title3"
                  frame={{ width: 28 }}
                />

                <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
                  <Text font="body" fontWeight="medium" lineLimit={1}>
                    {creator.name}
                  </Text>
                  <HStack alignment="center" spacing={6}>
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      {creator.fileCount} 个文件
                    </Text>
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      •
                    </Text>
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      {creator.formattedSize}
                    </Text>
                  </HStack>
                </VStack>
              </HStack>
            </NavigationLink>
          ))
        )}
      </Section>
    </List>
  )
}
