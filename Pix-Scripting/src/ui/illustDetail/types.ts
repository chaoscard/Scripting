import type { VirtualNode } from "scripting"
import type { PixivIllustration } from "../../types"
import type { IllustAmbientPalette } from "../../image/colorExtractor"
import type { FollowRestrict } from "../../store/userFollow"
import type { IllustAIMode } from "../aiSheet"

export interface IllustDetailState {
  illustID: number
  illust: PixivIllustration | null
  loading: boolean
  error: string | null
  isDark: boolean
  ambientEnabled: boolean
  ambientPalette: IllustAmbientPalette | null
  ambientBackgroundNode: VirtualNode | null
  pageLayout: string
  isAppleMusic: boolean
  bookmarked: boolean
  bookmarkLoading: boolean
  bookmarkLongPressLocked: boolean
  showBookmarkDetail: boolean
  followed: boolean
  followRestrict: FollowRestrict | null
  followLoading: boolean
  showRelatedUsers: boolean
  showComments: boolean
  showAISheet: boolean
  aiMode: IllustAIMode
  quality: "medium" | "large" | "original"
  mediaReady: boolean
  downloading: boolean
  ugoiraExportFormat: string
  quickActionEnabled: boolean
  quickActionType: string
  quickActionPos: string
  resolvedSeriesID: number | null
  resolvedSeriesTitle: string | null
  resolvedEpisodeNumber: number | null
  pageCount: number
  pageURLs: (string | null)[]
  pageAspect: number
}

export interface IllustDetailActions {
  load: (clear?: boolean) => Promise<void>
  toggleBookmark: () => Promise<void>
  bookmarkAndFollow: () => Promise<void>
  handleBookmarkLongPress: () => void
  handleDownloadUgoira: () => Promise<void>
  handleDownloadUgoiraZip: () => Promise<void>
  handleDownloadIllustToAlbum: () => Promise<void>
  handleDownloadIllustToZip: () => Promise<void>
  handleDownloadManga: (format: "cbz" | "epub") => Promise<void>
  followWithVisibility: (restrict: "public" | "private") => Promise<void>
  toggleFollow: () => Promise<void>
  shareIllust: () => Promise<void>
  openGallery: (pageIndex?: number) => void
  handleMainImageLoaded: () => void
  setBookmarkLongPressLocked: (locked: boolean) => void
  setShowBookmarkDetail: (show: boolean) => void
  setShowComments: (show: boolean) => void
  setShowAISheet: (show: boolean) => void
  setAIMode: (mode: IllustAIMode) => void
  setShowRelatedUsers: (show: boolean) => void
  setBookmarked: (bookmarked: boolean) => void
}
