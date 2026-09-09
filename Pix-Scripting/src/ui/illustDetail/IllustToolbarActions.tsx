import {
  Button,
  Device,
  Divider,
  Group,
  Image,
  LongPressGesture,
  Menu,
  NavigationLink,
  type VirtualNode,
} from "scripting"
import type { PixivIllustration } from "../../types"
import type { FollowRestrict } from "../../store/userFollow"
import { cleanHtmlCaption } from "../../api/aiService"
import { AvatarImage } from "../components/CachedImage"
import { requestPixivRoute } from "../routeNavigation"
import type { IllustAIMode } from "../aiSheet"

declare const Pasteboard: any

export interface IllustToolbarActionsProps {
  illust: PixivIllustration
  isAppleMusic: boolean
  bookmarked: boolean
  bookmarkLoading: boolean
  bookmarkLongPressLocked: boolean
  followed: boolean
  followRestrict: FollowRestrict | null
  followLoading: boolean
  downloading: boolean
  ugoiraExportFormat: string
  pageCount: number
  resolvedSeriesID: number | null
  resolvedSeriesTitle: string | null
  onToggleBookmark: () => void
  onBookmarkLongPress: () => void
  onSetBookmarkLongPressLocked: (locked: boolean) => void
  onToggleFollow: () => void
  onFollowWithVisibility: (restrict: "public" | "private") => void
  onShareIllust: () => void
  onDownloadUgoira: () => void
  onDownloadUgoiraZip: () => void
  onDownloadIllustToAlbum: () => void
  onDownloadIllustToZip: () => void
  onDownloadManga: (format: "cbz" | "epub") => void
  onShowComments: () => void
  onOpenAI: (mode: IllustAIMode) => void
}

export function renderIllustToolbarActions(props: IllustToolbarActionsProps): VirtualNode[] {
  const {
    illust,
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
    onToggleBookmark,
    onBookmarkLongPress,
    onSetBookmarkLongPressLocked,
    onToggleFollow,
    onFollowWithVisibility,
    onShareIllust,
    onDownloadUgoira,
    onDownloadUgoiraZip,
    onDownloadIllustToAlbum,
    onDownloadIllustToZip,
    onDownloadManga,
    onShowComments,
    onOpenAI,
  } = props

  return [
    ...(isAppleMusic
      ? [
          <Button action={onShowComments}>
            <Image systemName="bubble.left" />
          </Button>,
        ]
      : [
          <Button
            disabled={bookmarkLoading || bookmarkLongPressLocked}
            action={onToggleBookmark}
            simultaneousGesture={
              LongPressGesture({ minDuration: 500 }).onEnded(() => {
                onSetBookmarkLongPressLocked(true)
                onBookmarkLongPress()
                setTimeout(() => onSetBookmarkLongPressLocked(false), 1500)
              })
            }
          >
            <Image
              systemName={bookmarked ? "heart.fill" : "heart"}
              foregroundStyle={bookmarked ? "#FF375F" : undefined}
            />
          </Button>,
          <Button
            disabled={followLoading}
            action={onToggleFollow}
            contextMenu={{
              menuItems: (
                <Group>
                  {followed ? (
                    followRestrict === "private" ? (
                      <Button
                        title="设为公开关注"
                        systemImage="globe"
                        disabled={followLoading}
                        action={() => void onFollowWithVisibility("public")}
                      />
                    ) : (
                      <Button
                        title="设为私密关注"
                        systemImage="lock"
                        disabled={followLoading}
                        action={() => void onFollowWithVisibility("private")}
                      />
                    )
                  ) : (
                    <Button
                      title="私密关注"
                      systemImage="lock"
                      disabled={followLoading}
                      action={() => void onFollowWithVisibility("private")}
                    />
                  )}
                </Group>
              ),
            }}
          >
            <Image
              systemName={
                followed
                  ? (followRestrict === "private"
                      ? "person.badge.shield.checkmark"
                      : "person.fill.checkmark")
                  : "person.badge.plus"
              }
            />
          </Button>,
        ]),
    <Menu label={<Image systemName="ellipsis.circle" />}>
      {!isAppleMusic && Device.isiPad ? (
        <Button
          title="主页"
          systemImage="person.crop.circle"
          action={() => {
            if (illust.user?.id) {
              void requestPixivRoute(`user:${illust.user.id}`)
            }
          }}
        />
      ) : null}
      {!isAppleMusic ? (
        <Button
          title="评论"
          systemImage="bubble.left"
          action={onShowComments}
        />
      ) : null}
      <Menu title="助手" systemImage="sparkles">
        {Boolean(illust?.caption && cleanHtmlCaption(illust.caption)) && (
          <Button
            title="翻译简介"
            systemImage="text.quote"
            action={() => onOpenAI("caption")}
          />
        )}
        <Button
          title="翻译图片（OCR）"
          systemImage="text.viewfinder"
          action={() => onOpenAI("ocr")}
        />
        <Button
          title="翻译图片（生图）"
          systemImage="wand.and.stars"
          action={() => onOpenAI("vision")}
        />
      </Menu>
      <Button
        title="分享"
        systemImage="square.and.arrow.up"
        action={onShareIllust}
      />
      {illust.type === "ugoira" ? (
        <Menu title={downloading ? "下载中…" : "下载"} systemImage="square.and.arrow.down">
          <Button
            title={`下载动图 (${ugoiraExportFormat.toUpperCase()})`}
            systemImage={ugoiraExportFormat === "gif" ? "photo.stack" : "film"}
            disabled={downloading}
            action={onDownloadUgoira}
          />
          <Button
            title="下载原始 ZIP 帧包"
            systemImage="doc.zipper"
            disabled={downloading}
            action={onDownloadUgoiraZip}
          />
        </Menu>
      ) : illust.type === "manga" ? (
        <Menu title={downloading ? "下载中…" : "下载"} systemImage="square.and.arrow.down">
          {pageCount > 1 ? (
            <Button
              title="下载全部至相簿"
              systemImage="photo.on.rectangle.angled"
              disabled={downloading}
              action={onDownloadIllustToAlbum}
            />
          ) : (
            <Button
              title="下载至相簿"
              systemImage="photo"
              disabled={downloading}
              action={onDownloadIllustToAlbum}
            />
          )}
          {pageCount > 1 && (
            <Button
              title="打包为 ZIP 归档"
              systemImage="doc.zipper"
              disabled={downloading}
              action={onDownloadIllustToZip}
            />
          )}
          <Button
            title="下载为 CBZ 漫画包"
            systemImage="doc.zipper"
            disabled={downloading}
            action={() => void onDownloadManga("cbz")}
          />
          <Button
            title="下载为 EPUB 电子书"
            systemImage="book"
            disabled={downloading}
            action={() => void onDownloadManga("epub")}
          />
        </Menu>
      ) : pageCount > 1 ? (
        <Menu title={downloading ? "下载中…" : "下载"} systemImage="square.and.arrow.down">
          <Button
            title="下载全部至相簿"
            systemImage="photo.on.rectangle.angled"
            disabled={downloading}
            action={onDownloadIllustToAlbum}
          />
          <Button
            title="打包为 ZIP 归档"
            systemImage="doc.zipper"
            disabled={downloading}
            action={onDownloadIllustToZip}
          />
        </Menu>
      ) : (
        <Button
          title={downloading ? "下载中…" : "下载"}
          systemImage="square.and.arrow.down"
          disabled={downloading}
          action={onDownloadIllustToAlbum}
        />
      )}
      <Divider />
      <Menu title="信息" systemImage="info.circle">
        <Button
          title={`作者：${illust.user?.name ?? "未知"}`}
          action={() => Pasteboard.setString(illust.user?.name ?? "")}
        />
        <Button
          title={`UID：${illust.user?.id ?? 0}`}
          action={() => Pasteboard.setString(String(illust.user?.id ?? ""))}
        />
        <Button
          title={`标题：${illust.title ?? "未命名"}`}
          action={() => Pasteboard.setString(illust.title ?? "")}
        />
        <Button
          title={`PID：${illust.id}`}
          action={() => Pasteboard.setString(String(illust.id))}
        />
        {Boolean(resolvedSeriesID) && (
          <Button
            title={`系列：${resolvedSeriesTitle || "未命名系列"}`}
            action={() => Pasteboard.setString(resolvedSeriesTitle ?? "")}
          />
        )}
        {Boolean(resolvedSeriesID) && (
          <Button
            title={`SID：${resolvedSeriesID}`}
            action={() => Pasteboard.setString(String(resolvedSeriesID))}
          />
        )}
        {pageCount > 1 && (
          <Button
            title={`页数：${pageCount}页`}
            action={() => Pasteboard.setString(`页数：${pageCount}页`)}
          />
        )}
        {Boolean(illust.width && illust.height) && (
          <Button
            title={`分辨率：${illust.width}×${illust.height}`}
            action={() => Pasteboard.setString(`分辨率：${illust.width}×${illust.height}`)}
          />
        )}
      </Menu>
    </Menu>,
    ...(Device.isiPad && !isAppleMusic
      ? []
      : [
          <NavigationLink value={`user:${illust.user?.id ?? 0}`}>
            <AvatarImage
              url={illust.user?.profile_image_urls?.medium ?? null}
              size={28}
            />
          </NavigationLink>,
        ]),
  ]
}
