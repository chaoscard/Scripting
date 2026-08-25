import {
  Button,
  Circle,
  Device,
  HStack,
  Image,
  NavigationLink,
  Spacer,
  Text,
  useEffect,
  useMemo,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { session } from "../../api/session"
import { followUser, unfollowUser } from "../../api/pixiv"
import { loadSettings, onSettingsChanged } from "../../store/settings"
import { loadBlocklist, onBlocklistChanged } from "../../store/blocklist"
import { isIllustContentVisible, isNovelContentVisible } from "../../store/contentFilter"
import { isUserFollowed } from "../../store/userFollow"
import { novelThumbUrlOf, thumbUrlOf } from "../../image/imageLoader"
import { useUserFollow } from "../hooks"
import { AvatarImage, CachedImage } from "./CachedImage"
import type { PixivIllustration, PixivNovel, PixivUserPreview } from "../../types"

export const CONNECTION_PREVIEW_GAP = 6
export const NOVEL_PREVIEW_COVER_RATIO = 0.71
export const CONNECTION_LIST_HORIZONTAL_PADDING = 10
export const CONNECTION_CARD_HORIZONTAL_PADDING = 10

export type PreviewWorkItem =
  | { kind: "illust"; item: PixivIllustration }
  | { kind: "novel"; item: PixivNovel }

export function getVisiblePreviewItems(
  preview: PixivUserPreview,
  hideNovels: boolean,
  isFollowed: boolean
): PreviewWorkItem[] {
  const settings = loadSettings()
  const blocklist = loadBlocklist()
  const isExempt =
    settings.exemptFilterForPersonal &&
    (isFollowed || isUserFollowed(preview.user.id) === true || preview.user.is_followed === true)

  const visibleIllusts: PreviewWorkItem[] = (preview.illusts ?? [])
    .filter((illustration) =>
      isIllustContentVisible(illustration, settings, blocklist, {
        exemptRestrictions: isExempt,
      })
    )
    .map((illustration) => ({
      kind: "illust" as const,
      item: illustration,
    }))

  const visibleNovels: PreviewWorkItem[] = hideNovels
    ? []
    : (preview.novels ?? [])
        .filter((novel) =>
          isNovelContentVisible(novel, settings, blocklist, {
            exemptRestrictions: isExempt,
          })
        )
        .map((novel) => ({
          kind: "novel" as const,
          item: novel,
        }))

  return [...visibleIllusts, ...visibleNovels].slice(0, 3)
}

export function connectionPreviewImageURLs(preview: PixivUserPreview): (string | null)[] {
  const hideNovels = loadSettings().hideNovels
  const items = getVisiblePreviewItems(preview, hideNovels, preview.user.is_followed ?? false)
  return items.map((it) =>
    it.kind === "illust" ? thumbUrlOf(it.item) : novelThumbUrlOf(it.item)
  )
}

export function ConnectionRow(props: {
  preview: PixivUserPreview
  showFollowControl?: boolean
  previewSide?: number
  hideNovels?: boolean
}) {
  const { preview, hideNovels = false, showFollowControl = true } = props
  const [followed, setFollowed] = useUserFollow(preview.user.id, preview.user.is_followed ?? true)
  const [followBusy, setFollowBusy] = useState(false)
  const [filterVersion, setFilterVersion] = useState(0)

  const defaultSide = Math.max(
    0,
    Math.floor(
      (Device.screen.width -
        (CONNECTION_LIST_HORIZONTAL_PADDING + CONNECTION_CARD_HORIZONTAL_PADDING) * 2 -
        CONNECTION_PREVIEW_GAP * 2) /
        3
    )
  )
  const previewSide = props.previewSide ?? defaultSide

  useEffect(() => {
    const unsubSettings = onSettingsChanged(() => setFilterVersion((v) => v + 1))
    const unsubBlocklist = onBlocklistChanged(() => setFilterVersion((v) => v + 1))
    return () => {
      unsubSettings()
      unsubBlocklist()
    }
  }, [])

  const previewItems = useMemo(() => {
    void filterVersion
    return getVisiblePreviewItems(preview, hideNovels, followed)
  }, [preview, hideNovels, followed, filterVersion])

  async function toggleFollow() {
    if (followBusy) return
    setFollowBusy(true)
    const nextFollowed = !followed
    setFollowed(nextFollowed)
    try {
      if (nextFollowed) {
        await session.call((token) => followUser(preview.user.id, "public", token))
      } else {
        await session.call((token) => unfollowUser(preview.user.id, token))
      }
    } catch {
      setFollowed(!nextFollowed)
    } finally {
      setFollowBusy(false)
    }
  }

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={10}
      glassEffect={{ type: "rect", cornerRadius: 8 }}
      glassEffectTransition="materialize"
      frame={{ maxWidth: "infinity" }}
    >
      <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
        <NavigationLink value={`user:${preview.user.id}`}>
          <HStack spacing={8}>
            <ZStack frame={{ width: 38, height: 38 }}>
              <Circle
                fill="rgba(255, 255, 255, 0.16)"
                glassEffect={true}
                frame={{ width: 38, height: 38 }}
              />
              <AvatarImage url={preview.user.profile_image_urls?.medium ?? null} size={32} />
            </ZStack>
            <VStack alignment="leading" spacing={2}>
              <Text font="body" fontWeight="semibold" lineLimit={1}>
                {preview.user.name}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                @{preview.user.account}
              </Text>
            </VStack>
          </HStack>
        </NavigationLink>
        <Spacer />
        {showFollowControl ? (
          <Button
            buttonStyle="glass"
            disabled={followBusy}
            frame={{ width: 38, height: 38 }}
            clipShape={{ type: "rect", cornerRadius: 19 }}
            contentShape="rect"
            action={toggleFollow}
          >
            <Image
              systemName={followed ? "person.fill.checkmark" : "person.badge.plus"}
              font="body"
              foregroundStyle={followed ? "secondaryLabel" : "#007AFF"}
              frame={{ width: 38, height: 38 }}
            />
          </Button>
        ) : null}
      </HStack>
      {previewItems.length > 0 ? (
        <HStack spacing={CONNECTION_PREVIEW_GAP}>
          {previewItems.map((item) =>
            item.kind === "illust" ? (
              <ConnectionIllustThumbnail
                key={`illust:${item.item.id}`}
                illustration={item.item}
                side={previewSide}
              />
            ) : (
              <ConnectionNovelThumbnail
                key={`novel:${item.item.id}`}
                novel={item.item}
                side={previewSide}
              />
            )
          )}
        </HStack>
      ) : null}
    </VStack>
  )
}

export function ConnectionIllustThumbnail(props: {
  illustration: PixivIllustration
  side: number
}) {
  return (
    <NavigationLink
      value={`illust:${props.illustration.id}`}
      frame={{ width: props.side, height: props.side }}
    >
      <CachedImage
        url={thumbUrlOf(props.illustration)}
        aspectRatioValue={1}
        useIntrinsicAspectRatio={false}
        cornerRadius={6}
        frame={{ width: props.side, height: props.side }}
      />
    </NavigationLink>
  )
}

export function ConnectionNovelThumbnail(props: {
  novel: PixivNovel
  side: number
}) {
  const coverWidth = props.side * NOVEL_PREVIEW_COVER_RATIO

  return (
    <NavigationLink
      value={`novel:${props.novel.id}`}
      frame={{ width: props.side, height: props.side }}
    >
      <ZStack
        alignment="bottom"
        background="systemGray6"
        clipShape={{ type: "rect", cornerRadius: 6 }}
        frame={{ width: props.side, height: props.side }}
      >
        <CachedImage
          url={novelThumbUrlOf(props.novel)}
          aspectRatioValue={NOVEL_PREVIEW_COVER_RATIO}
          centerCropAspect={NOVEL_PREVIEW_COVER_RATIO}
          useIntrinsicAspectRatio={false}
          contentMode="fill"
          cornerRadius={0}
          frame={{ width: coverWidth, height: props.side }}
        />
        <Text
          font="caption2"
          fontWeight="semibold"
          foregroundStyle="white"
          multilineTextAlignment="leading"
          lineLimit={4}
          padding={{ horizontal: 5, vertical: 3 }}
          frame={{ width: props.side, alignment: "leading" }}
          background="rgba(0, 0, 0, 0.58)"
        >
          {props.novel.title}
        </Text>
      </ZStack>
    </NavigationLink>
  )
}
