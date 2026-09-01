import {
  Button,
  Device,
  Group,
  HStack,
  Image,
  LazyVStack,
  LongPressGesture,
  Menu,
  NavigationLink,
  ProgressView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"
import { CachedImage, PageCountBadge } from "./CachedImage"
import { BookmarkButton, BookmarkDetailSheet } from "./BookmarkDetailSheet"
import { BlockWorkSheet } from "./BlockWorkSheet"
import { FilteredContentNotice, LoadMoreTrigger } from "./RefreshableScrollView"
import { CORNER_ICON_SIZE, formatNumber } from "./formatUtils"
import { useIllustBookmark, useLatest, useUserFollow } from "../hooks"
import { cacheIllust, cacheIllusts } from "../../store/illustCache"
import { recordWorkSeriesAssociation } from "../../store/seriesCache"
import { loadSettings, getDownloadImageQuality, onSettingsChanged } from "../../store/settings"
import { blockTag, blockUser } from "../../store/blocklist"
import { downloadIllustToAlbum, exportUgoiraToAlbum } from "../../downloader"
import { addBookmark, bookmarkDetail, bookmarkTags, followUser, removeBookmark } from "../../api/pixiv"
import { session } from "../../api/session"
import { cardThumbUrlOf, heroCardThumbUrlOf } from "../../image/imageLoader"
import type { PixivIllustration } from "../../types"
const FLOW_HORIZONTAL_PADDING = 12
const FLOW_COLUMN_SPACING = 12
const FLOW_ROW_SPACING = 4
const FLOW_CARD_WIDTH = Math.floor(
  (Device.screen.width - FLOW_HORIZONTAL_PADDING * 2 - FLOW_COLUMN_SPACING) / 2
)
const HERO_CARD_WIDTH = Math.floor(
  Device.screen.width - FLOW_HORIZONTAL_PADDING * 2
)
// 流式布局允许最长 1:4 的竖图保留原始比例；更极端的图片仍受此下限保护。
const MIN_FLOW_IMAGE_RATIO = 1 / 4
const MAX_FLOW_IMAGE_RATIO = 2.5


export interface IllustCardAction {
  title: string
  systemImage: string
  tint?: any
  foregroundStyle?: any
  action: () => void
}

export function IllustCard(props: {
  illust: PixivIllustration
  onAppear?: () => void
  flow?: boolean
  hero?: boolean
  compact?: boolean
  priority?: number
  cornerBadge?: any
  footerText?: string
  topTrailingAction?: IllustCardAction
  contextMenu?: any
}) {
  const {
    illust,
    onAppear,
    flow = false,
    hero = false,
    compact,
    priority,
    cornerBadge,
    footerText,
    topTrailingAction,
    contextMenu,
  } = props
  cacheIllust(illust)
  const [bookmarked, setBookmarked] = useIllustBookmark(illust.id, illust.is_bookmarked)
  const [followed, setFollowed] = useUserFollow(illust.user?.id ?? 0, illust.user?.is_followed ?? false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  const [showBlockSheet, setShowBlockSheet] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [compactSetting, setCompactSetting] = useState(() => loadSettings().compactIllustCard)

  useEffect(() => {
    return onSettingsChanged(() => {
      setCompactSetting(loadSettings().compactIllustCard)
    })
  }, [])

  const isCompact = compact ?? compactSetting
  // 流式或Hero卡片只在进入原生可见区后请求图片；骨架尺寸仍由作品元数据提前固定。
  const [imageVisible, setImageVisible] = useState(!flow && !hero)
  const rawRatio = illust.width > 0 && illust.height > 0 ? illust.width / illust.height : 0.75

  let imageRatio = 1
  let imageFrame: { width?: number; height?: number } | undefined = undefined
  let cardFrame: { width?: number; maxWidth?: string } = { maxWidth: "infinity" }

  if (hero) {
    cardFrame = { width: HERO_CARD_WIDTH }
    imageRatio = Math.min(Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO), MAX_FLOW_IMAGE_RATIO)
    imageFrame = { width: HERO_CARD_WIDTH, height: HERO_CARD_WIDTH / imageRatio }
  } else if (flow) {
    cardFrame = { width: FLOW_CARD_WIDTH }
    imageRatio = Math.min(Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO), MAX_FLOW_IMAGE_RATIO)
    imageFrame = { width: FLOW_CARD_WIDTH, height: FLOW_CARD_WIDTH / imageRatio }
  }

  function handleAppear() {
    if (!imageVisible) setImageVisible(true)
    onAppear?.()
  }

  async function toggleBookmark() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeBookmark(illust.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) => addBookmark(illust.id, "public", [], token))
        setBookmarked(true)
      }
    } catch {
      // 收藏失败时保持原状态
    } finally {
      setBookmarkBusy(false)
    }
  }

  async function bookmarkAndFollow() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addBookmark(illust.id, "public", [], token))
        setBookmarked(true)
      }
      await session.call((token) => followUser(illust.user.id, "public", token))
    } catch {
      // 保持卡片可继续操作
    } finally {
      setBookmarkBusy(false)
    }
  }

  function handleBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    void Haptics.transient()
    if (action === "follow") {
      void bookmarkAndFollow()
    } else {
      setShowBookmarkDetail(true)
    }
  }

  const handleDownload = useCallback(async () => {
    if (downloading) return
    void Haptics.transient()
    setDownloading(true)
    try {
      if (illust.type === "ugoira") {
        const res = await exportUgoiraToAlbum(illust)
        if (res.success) {
          void Haptics.transient()
        }
      } else {
        const quality = getDownloadImageQuality()
        const ok = await downloadIllustToAlbum(illust, quality)
        if (ok) {
          void Haptics.transient()
        }
      }
    } catch (err: any) {
      console.log("IllustCard download error:", err?.message ?? err)
    } finally {
      setDownloading(false)
    }
  }, [illust, downloading])

  const isOwnUser = Boolean(
    session.userID && illust.user && String(illust.user.id) === String(session.userID)
  )

  const handleFollowUser = useCallback(async () => {
    if (!illust.user || followed || followBusy) return
    setFollowBusy(true)
    void Haptics.transient()
    try {
      await session.call((token) => followUser(illust.user.id, "public", token))
      setFollowed(true)
      void Haptics.transient()
    } catch (err: any) {
      console.log("IllustCard followUser error:", err?.message ?? err)
    } finally {
      setFollowBusy(false)
    }
  }, [illust.user, followed, followBusy, setFollowed])

  const resolvedContextMenu = useMemo(
    () =>
      renderIllustContextMenu(
        illust,
        downloading,
        handleDownload,
        followed,
        isOwnUser,
        followBusy,
        handleFollowUser,
        () => setShowBlockSheet(true),
        contextMenu
      ),
    [
      illust,
      downloading,
      handleDownload,
      followed,
      isOwnUser,
      followBusy,
      handleFollowUser,
      contextMenu,
    ]
  )

  return (
    <ZStack
      alignment="topTrailing"
      frame={cardFrame}
      sheet={
        showBlockSheet
          ? {
              content: (
                <BlockWorkSheet
                  user={illust.user}
                  tags={illust.tags ?? []}
                  onClose={() => setShowBlockSheet(false)}
                />
              ),
              isPresented: showBlockSheet,
              onChanged: setShowBlockSheet,
            }
          : undefined
      }
    >
      <VStack
        alignment="leading"
        spacing={isCompact ? 0 : (hero ? 4 : 2)}
        frame={cardFrame}
        onAppear={handleAppear}
        padding={hero ? 6 : 4}
        glassEffect={{ type: "rect", cornerRadius: hero ? 16 : 14 }}
        shadow={{ color: "#0000000F", radius: hero ? 20 : 18, y: hero ? 10 : 8 }}
      >
        <ZStack alignment="bottomTrailing" frame={cardFrame}>
          <NavigationLink
            value={`illust:${illust.id}`}
            frame={cardFrame}
            contextMenu={resolvedContextMenu}
          >
            <ZStack alignment="topLeading" frame={cardFrame}>
              <ZStack
                alignment="bottomLeading"
                aspectRatio={flow || hero ? undefined : { value: 1, contentMode: "fill" }}
                frame={imageFrame ?? { maxWidth: "infinity" }}
                clipShape={{ type: "rect", cornerRadius: hero ? 12 : 10 }}
                clipped={true}
              >
                <CachedImage
                  url={
                    imageVisible
                      ? hero
                        ? heroCardThumbUrlOf(illust)
                        : cardThumbUrlOf(illust)
                      : null
                  }
                  previewUrl={hero ? cardThumbUrlOf(illust, "medium") : undefined}
                  aspectRatioValue={flow || hero ? imageRatio : 1}
                  contentMode={flow || hero ? "fit" : "fill"}
                  centerCropSquare={!flow && !hero}
                  cornerRadius={hero ? 12 : 10}
                  frame={imageFrame}
                  priority={priority}
                />
                {illust.page_count > 1 ? (
                  <PageCountBadge count={illust.page_count} hero={hero} />
                ) : null}
              </ZStack>
              {cornerBadge ?? null}
            </ZStack>
          </NavigationLink>
          <BookmarkButton
            hero={hero}
            bookmarked={bookmarked}
            disabled={bookmarkBusy}
            onTap={toggleBookmark}
            onLongPress={handleBookmarkLongPress}
            sheetContent={
              <BookmarkDetailSheet
                item={illust}
                bookmarked={bookmarked}
                loadDetail={(token) => bookmarkDetail(illust.id, token)}
                loadTags={(restrict, token) => bookmarkTags(session.userID ?? 0, restrict, token)}
                save={(restrict, tags, token) =>
                  addBookmark(illust.id, restrict, tags, token)
                }
                onSaved={() => setBookmarked(true)}
                onClose={() => setShowBookmarkDetail(false)}
              />
            }
            sheetPresented={showBookmarkDetail}
            onSheetChanged={setShowBookmarkDetail}
          />
        </ZStack>
        {!isCompact ? (
          <>
            <NavigationLink
              value={`illust:${illust.id}`}
              contextMenu={resolvedContextMenu}
            >
              <Text
                font={hero ? "headline" : "caption"}
                fontWeight={hero ? "bold" : "medium"}
                lineLimit={hero ? 2 : 1}
                padding={{ horizontal: hero ? 6 : 4, top: hero ? 4 : 2 }}
              >
                {illust.title}
              </Text>
            </NavigationLink>
            <HStack
              spacing={hero ? 8 : 5}
              padding={{ horizontal: hero ? 6 : 4, bottom: footerText ? 0 : (hero ? 6 : 4) }}
              frame={{ maxWidth: "infinity" }}
            >
              <NavigationLink
                value={`illust:${illust.id}`}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                contextMenu={resolvedContextMenu}
              >
                <Text
                  font={hero ? "subheadline" : "caption2"}
                  foregroundStyle="secondaryLabel"
                  lineLimit={1}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  {illust.user.name}
                </Text>
              </NavigationLink>
              <HStack
                spacing={hero ? 8 : 5}
                fixedSize={{ horizontal: true, vertical: false }}
                layoutPriority={1}
                frame={{ alignment: "trailing" }}
              >
                <HStack spacing={hero ? 3 : 2} fixedSize={{ horizontal: true, vertical: false }}>
                  <Image
                    systemName="eye"
                    font={hero ? "subheadline" : "caption2"}
                    foregroundStyle="secondaryLabel"
                  />
                  <Text
                    font={hero ? "subheadline" : "caption2"}
                    foregroundStyle="secondaryLabel"
                    lineLimit={1}
                    fixedSize={{ horizontal: true, vertical: false }}
                  >
                    {formatNumber(illust.total_view)}
                  </Text>
                </HStack>
                <HStack spacing={hero ? 3 : 2} fixedSize={{ horizontal: true, vertical: false }}>
                  <Image
                    systemName="heart"
                    font={hero ? "subheadline" : "caption2"}
                    foregroundStyle="secondaryLabel"
                  />
                  <Text
                    font={hero ? "subheadline" : "caption2"}
                    foregroundStyle="secondaryLabel"
                    lineLimit={1}
                    fixedSize={{ horizontal: true, vertical: false }}
                  >
                    {formatNumber(illust.total_bookmarks)}
                  </Text>
                </HStack>
              </HStack>
            </HStack>
            {footerText ? (
              <Text
                font={hero ? "footnote" : "caption2"}
                foregroundStyle="secondaryLabel"
                lineLimit={1}
                padding={{ horizontal: hero ? 6 : 4, bottom: hero ? 6 : 4 }}
              >
                {footerText}
              </Text>
            ) : null}
          </>
        ) : null}
      </VStack>
      {topTrailingAction ? (
        <Button
          buttonStyle="plain"
          action={topTrailingAction.action}
          frame={{
            width: hero ? 30 : CORNER_ICON_SIZE,
            height: hero ? 30 : CORNER_ICON_SIZE,
          }}
          glassEffect="circle"
          contentShape="circle"
          zIndex={1}
          offset={hero ? { x: -5, y: 5 } : { x: -4, y: 4 }}
        >
          <Image
            systemName={topTrailingAction.systemImage}
            font={hero ? "title3" : "body"}
            tint={topTrailingAction.tint}
            foregroundStyle={topTrailingAction.foregroundStyle}
          />
        </Button>
      ) : null}
    </ZStack>
  )
}


// Two explicit-width columns keep image geometry stable before decoding.
type IllustFlowItem = {
  illust: PixivIllustration
  index: number
}


export function IllustFlowFeed(props: {
  items: PixivIllustration[]
  onLoadMore: (anchor: number | string) => void
  hasMore?: boolean
  isLoading?: boolean
  enableHeroFirst?: boolean
  cornerBadgeOf?: (illust: PixivIllustration, index: number) => any
  footerTextOf?: (illust: PixivIllustration, index: number) => string | undefined
  topTrailingActionOf?: (
    illust: PixivIllustration,
    index: number,
  ) => IllustCardAction | undefined
  contextMenuOf?: (
    illust: PixivIllustration,
    index: number,
  ) => any
}) {
  cacheIllusts(props.items)
  const isHeroActive = Boolean(props.enableHeroFirst && props.items.length > 0)
  const heroItem = isHeroActive ? props.items[0] : null
  const waterfallItems = isHeroActive ? props.items.slice(1) : props.items
  const startIndex = isHeroActive ? 1 : 0

  const [leading, trailing] = useMemo(
    () => distributeFlowItems(waterfallItems, startIndex),
    [waterfallItems, startIndex]
  )
  const lastItem = props.items[props.items.length - 1]
  const lastId = lastItem ? lastItem.id : null
  const triggerAnchor = lastId != null ? String(lastId) : ""

  const columnViews = useMemo(
    () => {
      const renderItem = ({ illust, index }: IllustFlowItem) => (
        <IllustCard
          key={illust.id}
          illust={illust}
          flow={true}
          priority={index}
          cornerBadge={props.cornerBadgeOf?.(illust, index)}
          footerText={props.footerTextOf?.(illust, index)}
          topTrailingAction={props.topTrailingActionOf?.(illust, index)}
          contextMenu={props.contextMenuOf?.(illust, index)}
        />
      )
      const triggerView = props.hasMore && triggerAnchor ? (
        <VStack
          key={`trigger:${triggerAnchor}`}
          frame={{ width: FLOW_CARD_WIDTH, height: 1 }}
          onAppear={() => props.onLoadMore(triggerAnchor)}
        />
      ) : null
      return [
        <LazyVStack
          key="leading"
          alignment="leading"
          spacing={FLOW_ROW_SPACING}
          frame={{ width: FLOW_CARD_WIDTH }}
        >
          {leading.map(renderItem)}
          {triggerView}
        </LazyVStack>,
        <LazyVStack
          key="trailing"
          alignment="leading"
          spacing={FLOW_ROW_SPACING}
          frame={{ width: FLOW_CARD_WIDTH }}
        >
          {trailing.map(renderItem)}
          {triggerView}
        </LazyVStack>,
      ]
    },
    [
      leading,
      trailing,
      triggerAnchor,
      props.hasMore,
      props.onLoadMore,
      props.cornerBadgeOf,
      props.footerTextOf,
      props.topTrailingActionOf,
      props.contextMenuOf,
    ]
  )

  const heroView = useMemo(() => {
    if (!heroItem) return null
    return (
      <VStack
        key={`hero:${heroItem.id}`}
        padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
        frame={{ width: Device.screen.width }}
      >
        <IllustCard
          key={heroItem.id}
          illust={heroItem}
          hero={true}
          priority={0}
          cornerBadge={props.cornerBadgeOf?.(heroItem, 0)}
          footerText={props.footerTextOf?.(heroItem, 0)}
          topTrailingAction={props.topTrailingActionOf?.(heroItem, 0)}
          contextMenu={props.contextMenuOf?.(heroItem, 0)}
        />
      </VStack>
    )
  }, [
    heroItem,
    props.cornerBadgeOf,
    props.footerTextOf,
    props.topTrailingActionOf,
    props.contextMenuOf,
  ])

  return (
    <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
      {heroView}
      {waterfallItems.length > 0 ? (
        <HStack
          alignment="top"
          spacing={FLOW_COLUMN_SPACING}
          padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
          frame={{ width: Device.screen.width }}
        >
          {columnViews}
        </HStack>
      ) : props.hasMore && triggerAnchor ? (
        <VStack
          key={`hero-trigger:${triggerAnchor}`}
          frame={{ width: FLOW_CARD_WIDTH, height: 1 }}
          onAppear={() => props.onLoadMore(triggerAnchor)}
        />
      ) : null}
      {props.hasMore ? (
        <VStack
          key="flow-footer"
          spacing={0}
          frame={{ height: 44, maxWidth: "infinity" }}
        >
          {props.isLoading ? (
            <HStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
              <Spacer />
              <ProgressView progressViewStyle="circular" />
              <Spacer />
            </HStack>
          ) : null}
        </VStack>
      ) : null}
    </VStack>
  )
}

function distributeFlowItems(
  items: PixivIllustration[],
  startIndex = 0
): [IllustFlowItem[], IllustFlowItem[]] {
  const columns: [IllustFlowItem[], IllustFlowItem[]] = [[], []]
  const heights = [0, 0]
  for (let i = 0; i < items.length; i++) {
    const illust = items[i]
    const index = startIndex + i
    const rawRatio = illust.width > 0 && illust.height > 0
      ? illust.width / illust.height
      : 0.75
    const ratio = Math.min(Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO), MAX_FLOW_IMAGE_RATIO)
    const imageHeight = FLOW_CARD_WIDTH / ratio
    const textHeight = 62
    const footerHeight = 10
    const column = heights[0] <= heights[1] ? 0 : 1
    columns[column].push({ illust, index })
    heights[column] += imageHeight + textHeight + footerHeight
  }
  return columns
}

function renderIllustContextMenu(
  illust: PixivIllustration,
  downloading: boolean,
  onDownload: () => void,
  followed: boolean,
  isOwnUser: boolean,
  followBusy: boolean,
  onFollowUser: () => void,
  onOpenBlockSheet: () => void,
  customContextMenu?: any
) {
  const pageCount = illust.page_count ?? 1
  const ugoiraFormat = loadSettings().ugoiraExportFormat ?? "mp4"
  const downloadTitle =
    illust.type === "ugoira"
      ? `下载动图 (${ugoiraFormat.toUpperCase()})`
      : pageCount > 1
        ? `下载全部图片 (共 ${pageCount} 张)`
        : "下载图片"

  const downloadIcon =
    illust.type === "ugoira"
      ? ugoiraFormat === "gif"
        ? "photo.stack"
        : "film"
      : "arrow.down.circle"

  const defaultMenuItems = (
    <Group>
      <Button
        title={downloading ? "下载中…" : downloadTitle}
        systemImage={downloadIcon}
        disabled={downloading}
        action={onDownload}
      />
      {!followed && !isOwnUser && illust.user ? (
        <Button
          title={followBusy ? "关注中…" : "关注作者"}
          systemImage="person.badge.plus"
          disabled={followBusy}
          action={onFollowUser}
        />
      ) : null}
      <NavigationLink value={`relatedIllust:${illust.id}`}>
        <Button
          title="相关作品"
          systemImage="sparkles"
          action={() => {}}
        />
      </NavigationLink>
      <Button
        title="屏蔽设置"
        systemImage="nosign"
        role="destructive"
        action={onOpenBlockSheet}
      />
    </Group>
  )

  if (!customContextMenu) {
    return { menuItems: defaultMenuItems }
  }

  const customItems = customContextMenu.menuItems ?? customContextMenu
  if (customContextMenu.override) {
    return {
      ...customContextMenu,
      menuItems: customItems,
    }
  }

  return {
    ...customContextMenu,
    menuItems: (
      <Group>
        {customItems}
        {defaultMenuItems}
      </Group>
    ),
  }
}
