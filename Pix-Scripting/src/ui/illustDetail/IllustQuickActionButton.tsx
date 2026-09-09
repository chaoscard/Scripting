import {
  Button,
  Group,
  Image,
  LongPressGesture,
  VStack,
  ZStack,
} from "scripting"
import type { PixivIllustration } from "../../types"
import type { FollowRestrict } from "../../store/userFollow"
import { requestPixivRoute } from "../routeNavigation"

export interface IllustQuickActionButtonProps {
  illust: PixivIllustration | null
  isAppleMusic: boolean
  quickActionEnabled: boolean
  quickActionType: string
  quickActionPos: string
  bookmarked: boolean
  bookmarkLoading: boolean
  bookmarkLongPressLocked: boolean
  followed: boolean
  followRestrict: FollowRestrict | null
  followLoading: boolean
  downloading: boolean
  pageCount: number
  onToggleBookmark: () => void
  onBookmarkLongPress: () => void
  onSetBookmarkLongPressLocked: (locked: boolean) => void
  onToggleFollow: () => void
  onFollowWithVisibility: (restrict: "public" | "private") => void
  onDownloadUgoira: () => void
  onDownloadUgoiraZip: () => void
  onDownloadIllustToAlbum: () => void
  onDownloadIllustToZip: () => void
  onDownloadManga: (format: "cbz" | "epub") => void
}

export function IllustQuickActionButton(props: IllustQuickActionButtonProps) {
  const {
    illust,
    isAppleMusic,
    quickActionEnabled,
    quickActionType,
    quickActionPos,
    bookmarked,
    bookmarkLoading,
    bookmarkLongPressLocked,
    followed,
    followRestrict,
    followLoading,
    downloading,
    pageCount,
    onToggleBookmark,
    onBookmarkLongPress,
    onSetBookmarkLongPressLocked,
    onToggleFollow,
    onFollowWithVisibility,
    onDownloadUgoira,
    onDownloadUgoiraZip,
    onDownloadIllustToAlbum,
    onDownloadIllustToZip,
    onDownloadManga,
  } = props

  if (isAppleMusic || !quickActionEnabled || !illust) return null

  let iconName = "heart"
  let iconColor: any = "label"
  let disabled = false
  let action = () => {}
  let contextMenu: any = undefined
  let gesture: any = undefined

  if (quickActionType === "bookmark") {
    iconName = bookmarked ? "heart.fill" : "heart"
    iconColor = bookmarked ? "#FF375F" : "label"
    disabled = bookmarkLoading || bookmarkLongPressLocked
    action = onToggleBookmark
    gesture = LongPressGesture({ minDuration: 500 }).onEnded(() => {
      onSetBookmarkLongPressLocked(true)
      onBookmarkLongPress()
      setTimeout(() => onSetBookmarkLongPressLocked(false), 1500)
    })
  } else if (quickActionType === "follow") {
    iconName = followed
      ? followRestrict === "private"
        ? "person.badge.shield.checkmark"
        : "person.fill.checkmark"
      : "person.badge.plus"
    iconColor = followed ? "#007AFF" : "label"
    disabled = followLoading
    action = () => void onToggleFollow()
    contextMenu = {
      menuItems: (
        <Group>
          {illust.user?.id ? (
            <Button
              title="查看主页"
              systemImage="person.crop.circle"
              action={() => void requestPixivRoute(`user:${illust.user?.id}`)}
            />
          ) : null}
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
    }
  } else if (quickActionType === "download") {
    iconName = downloading ? "arrow.down.circle.fill" : "arrow.down.circle"
    iconColor = downloading ? "secondaryLabel" : "label"
    disabled = downloading
    action = () => {
      if (illust.type === "ugoira") {
        void onDownloadUgoira()
      } else {
        void onDownloadIllustToAlbum()
      }
    }
    if (illust.type === "ugoira") {
      contextMenu = {
        menuItems: (
          <Group>
            <Button
              title="下载原始 ZIP 帧包"
              systemImage="doc.zipper"
              disabled={downloading}
              action={onDownloadUgoiraZip}
            />
          </Group>
        ),
      }
    } else if (illust.type === "manga") {
      contextMenu = {
        menuItems: (
          <Group>
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
          </Group>
        ),
      }
    } else if (pageCount > 1) {
      contextMenu = {
        menuItems: (
          <Group>
            <Button
              title="打包为 ZIP 归档"
              systemImage="doc.zipper"
              disabled={downloading}
              action={onDownloadIllustToZip}
            />
          </Group>
        ),
      }
    } else {
      contextMenu = undefined
    }
  }

  return (
    <VStack
      padding={{
        bottom: 24,
        leading: quickActionPos === "leading" ? 18 : 0,
        trailing: quickActionPos === "trailing" ? 18 : 0,
      }}
    >
      <Button
        buttonStyle="plain"
        disabled={disabled}
        action={action}
        contextMenu={contextMenu}
        simultaneousGesture={gesture}
      >
        <ZStack
          alignment="center"
          frame={{ width: 46, height: 46 }}
          glassEffect="circle"
          contentShape="circle"
          shadow={{ color: "#0000002E", radius: 8, y: 2 }}
        >
          <Image
            systemName={iconName}
            font="title2"
            fontWeight="medium"
            foregroundStyle={iconColor}
          />
        </ZStack>
      </Button>
    </VStack>
  )
}
