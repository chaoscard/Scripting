import {
  ScrollView,
  VStack,
  ZStack,
} from "scripting"
import { addBookmark, bookmarkDetail, bookmarkTags } from "../../api/pixiv"
import { session } from "../../api/session"
import { updateHistoryBookmark } from "../../store/history"
import { BookmarkDetailSheet, ErrorView, LoadingView, RelatedUsersSheet } from "../components"
import { CommentsSheet } from "../comments"
import { IllustAISheet } from "../aiSheet"
import { useIllustDetailState } from "./useIllustDetailState"
import { IllustMediaViewport } from "./IllustMediaViewport"
import { IllustMetaSection } from "./IllustMetaSection"
import { IllustToolbarActionsProps, renderIllustToolbarActions } from "./IllustToolbarActions"
import { IllustQuickActionButton } from "./IllustQuickActionButton"
import { IllustRelatedSection } from "./IllustRelatedSection"

export function IllustDetailView(props: { illustID: number }) {
  const { state, actions } = useIllustDetailState(props.illustID)
  const {
    illust,
    loading,
    error,
    ambientBackgroundNode,
    quickActionPos,
    isAppleMusic,
    pageCount,
    pageURLs,
    pageAspect,
    quality,
    bookmarked,
    bookmarkLoading,
    bookmarkLongPressLocked,
    followed,
    followRestrict,
    followLoading,
    downloading,
    ugoiraExportFormat,
    resolvedSeriesID,
    resolvedSeriesTitle,
    resolvedEpisodeNumber,
    quickActionEnabled,
    quickActionType,
    showComments,
    showAISheet,
    aiMode,
    showBookmarkDetail,
    showRelatedUsers,
    mediaReady,
  } = state

  if (loading && !illust) {
    return (
      <ZStack
        toolbarBackground="clear"
        toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      >
        {ambientBackgroundNode}
        <ScrollView
          navigationTitle=""
          navigationBarTitleDisplayMode="inline"
          toolbarBackground="clear"
          toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
          scrollContentBackground="hidden"
        >
          <LoadingView />
        </ScrollView>
      </ZStack>
    )
  }

  if (error && !illust) {
    return (
      <ZStack
        toolbarBackground="clear"
        toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      >
        {ambientBackgroundNode}
        <ScrollView
          navigationTitle=""
          navigationBarTitleDisplayMode="inline"
          toolbarBackground="clear"
          toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
          scrollContentBackground="hidden"
        >
          <ErrorView message={error} onRetry={() => actions.load(true)} />
        </ScrollView>
      </ZStack>
    )
  }

  if (!illust) {
    return (
      <ZStack
        toolbarBackground="clear"
        toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      >
        {ambientBackgroundNode}
        <ScrollView
          navigationTitle=""
          navigationBarTitleDisplayMode="inline"
          toolbarBackground="clear"
          toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
          scrollContentBackground="hidden"
        >
          <ErrorView message="作品不存在" onRetry={() => actions.load(true)} />
        </ScrollView>
      </ZStack>
    )
  }

  const current = illust

  const toolbarProps: IllustToolbarActionsProps = {
    illust: current,
    isAppleMusic,
    bookmarked,
    bookmarkLoading,
    bookmarkLongPressLocked,
    followed,
    followRestrict,
    followLoading,
    downloading,
    ugoiraExportFormat,
    pageCount,
    resolvedSeriesID,
    resolvedSeriesTitle,
    onToggleBookmark: actions.toggleBookmark,
    onBookmarkLongPress: actions.handleBookmarkLongPress,
    onSetBookmarkLongPressLocked: actions.setBookmarkLongPressLocked,
    onToggleFollow: () => void actions.toggleFollow(),
    onFollowWithVisibility: (restrict) => void actions.followWithVisibility(restrict),
    onShareIllust: () => void actions.shareIllust(),
    onDownloadUgoira: () => void actions.handleDownloadUgoira(),
    onDownloadUgoiraZip: () => void actions.handleDownloadUgoiraZip(),
    onDownloadIllustToAlbum: () => void actions.handleDownloadIllustToAlbum(),
    onDownloadIllustToZip: () => void actions.handleDownloadIllustToZip(),
    onDownloadManga: (format) => void actions.handleDownloadManga(format),
    onShowComments: () => actions.setShowComments(true),
    onOpenAI: (mode) => {
      actions.setAIMode(mode)
      actions.setShowAISheet(true)
    },
  }

  return (
    <ZStack
      alignment={quickActionPos === "leading" ? "bottomLeading" : "bottomTrailing"}
      toolbarBackground="clear"
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
    >
      {/* 1. 独立全屏底层：铺满屏幕（含顶部状态栏与灵动岛背后），实现状态栏追色沉浸 */}
      {ambientBackgroundNode}

      {/* 2. 滚动内容层：受顶部安全区保护，插画图片与主要内容从安全区下方正常排版，绝不被灵动岛遮挡 */}
      <ScrollView
        navigationTitle=""
        navigationBarTitleDisplayMode="inline"
        ignoresSafeArea={{ edges: "bottom" }}
        toolbarBackground="clear"
        toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
        scrollContentBackground="hidden"
        toolbar={{
          topBarTrailing: renderIllustToolbarActions(toolbarProps),
        }}
      >
        <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          {/* 大图区：动图走播放器；图片无限向下滚动展示全部页 */}
          <IllustMediaViewport
            illust={current}
            quality={quality}
            pageCount={pageCount}
            pageURLs={pageURLs}
            pageAspect={pageAspect}
            onMediaReady={() => actions.handleMainImageLoaded()}
            onMainImageLoaded={actions.handleMainImageLoaded}
            onOpenGallery={actions.openGallery}
          />

          {/* 元数据区：标题、指标、简介、标签、漫画话数翻页器 */}
          <IllustMetaSection
            illust={current}
            pageCount={pageCount}
            resolvedSeriesID={resolvedSeriesID}
            resolvedSeriesTitle={resolvedSeriesTitle}
            resolvedEpisodeNumber={resolvedEpisodeNumber}
          />

          {/* 关联推荐作品流 */}
          <IllustRelatedSection
            illustID={current.id}
            enabled={mediaReady}
          />
        </VStack>

        {/* 评论半屏弹窗 */}
        <VStack
          sheet={{
            content: (
              <CommentsSheet
                illustID={current.id}
                onClose={() => actions.setShowComments(false)}
              />
            ),
            isPresented: showComments,
            onChanged: actions.setShowComments,
          }}
        />

        {/* AI 助手面板 */}
        <VStack
          sheet={{
            content: (
              <IllustAISheet
                illust={current}
                mode={aiMode}
                isPresented={showAISheet}
                onChanged={actions.setShowAISheet}
              />
            ),
            isPresented: showAISheet,
            onChanged: actions.setShowAISheet,
          }}
        />

        {/* 收藏详情面板 */}
        <VStack
          sheet={{
            content: (
              <BookmarkDetailSheet
                item={current}
                bookmarked={bookmarked}
                loadDetail={(token) => bookmarkDetail(current.id, token)}
                loadTags={(restrict, token) =>
                  bookmarkTags(session.userID ?? 0, restrict, token)
                }
                save={(restrict, tags, token) =>
                  addBookmark(current.id, restrict, tags, token)
                }
                onSaved={() => {
                  actions.setBookmarked(true)
                  updateHistoryBookmark(current.id, true)
                }}
                onClose={() => actions.setShowBookmarkDetail(false)}
              />
            ),
            isPresented: showBookmarkDetail,
            onChanged: actions.setShowBookmarkDetail,
          }}
        />

        {/* 相关用户面板 */}
        <VStack
          sheet={{
            content: (
              <RelatedUsersSheet
                seedUserID={current.user.id}
                seedUserName={current.user.name}
                onClose={() => actions.setShowRelatedUsers(false)}
              />
            ),
            isPresented: showRelatedUsers,
            onChanged: actions.setShowRelatedUsers,
          }}
        />
      </ScrollView>

      {/* 3. 悬浮快捷球 */}
      <IllustQuickActionButton
        illust={current}
        isAppleMusic={isAppleMusic}
        quickActionEnabled={quickActionEnabled}
        quickActionType={quickActionType}
        quickActionPos={quickActionPos}
        bookmarked={bookmarked}
        bookmarkLoading={bookmarkLoading}
        bookmarkLongPressLocked={bookmarkLongPressLocked}
        followed={followed}
        followRestrict={followRestrict}
        followLoading={followLoading}
        downloading={downloading}
        pageCount={pageCount}
        onToggleBookmark={() => void actions.toggleBookmark()}
        onBookmarkLongPress={actions.handleBookmarkLongPress}
        onSetBookmarkLongPressLocked={actions.setBookmarkLongPressLocked}
        onToggleFollow={() => void actions.toggleFollow()}
        onFollowWithVisibility={(restrict) => void actions.followWithVisibility(restrict)}
        onDownloadUgoira={() => void actions.handleDownloadUgoira()}
        onDownloadUgoiraZip={() => void actions.handleDownloadUgoiraZip()}
        onDownloadIllustToAlbum={() => void actions.handleDownloadIllustToAlbum()}
        onDownloadIllustToZip={() => void actions.handleDownloadIllustToZip()}
        onDownloadManga={(format) => void actions.handleDownloadManga(format)}
      />
    </ZStack>
  )
}

export * from "./types"
export * from "./useIllustDetailState"
export * from "./IllustMediaViewport"
export * from "./IllustMetaSection"
export * from "./IllustToolbarActions"
export * from "./IllustQuickActionButton"
export * from "./IllustRelatedSection"
