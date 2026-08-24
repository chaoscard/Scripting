import {
  Button,
  Group,
  HStack,
  Image,
  NavigationLink,
  ProgressView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useState,
} from "scripting"
import { AvatarImage, CachedImage } from "./CachedImage"
import { formatNumber } from "./formatUtils"
import {
  downloadEntireMangaSeries,
  downloadEntireNovelSeries,
} from "../../downloader"
import { recordWorkSeriesAssociation } from "../../store/seriesCache"
import type { PixivWatchlistSeries } from "../../types"
function formatWatchlistDate(dateStr?: string | null): string {
  if (!dateStr) return ""
  try {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear()
      const month = d.getMonth() + 1
      const day = d.getDate()
      return `${year}年${month}月${day}日`
    }
  } catch {
    // ignore
  }
  const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) {
    const [, y, m, day] = match
    return `${Number(y)}年${Number(m)}月${Number(day)}日`
  }
  return dateStr.slice(0, 10)
}

// 追更列表标准卡片：漫画与小说统一采用液态玻璃规范
export function WatchlistSeriesCard(props: {
  item: PixivWatchlistSeries
  kind?: "manga" | "novel"
  priority?: number
  onAppear?: () => void
}) {
  const { item, kind = "manga", priority, onAppear } = props
  const isNovel = kind === "novel"
  if (item.latest_content_id) {
    recordWorkSeriesAssociation(
      item.latest_content_id,
      kind,
      item.id,
      item.title,
      item.published_content_count
    )
  }
  const seriesRoute = isNovel ? `novelSeries:${item.id}` : `mangaSeries:${item.id}`
  const targetRoute = item.latest_content_id != null
    ? (isNovel ? `novel:${item.latest_content_id}` : `illust:${item.latest_content_id}`)
    : seriesRoute
  const formattedDate = formatWatchlistDate(item.last_published_content_datetime)

  async function handleExportSeries() {
    void Haptics.transient()
    if (isNovel) {
      const confirmed = await Dialog.confirm({
        title: "下载整本小说",
        message: `确认下载《${item.title || "系列"}》整本 EPUB 小说？`,
        confirmLabel: "开始下载",
        cancelLabel: "取消",
      })
      if (!confirmed) return
      const filePath = await downloadEntireNovelSeries(item.id, item.title)
      if (filePath) {
        void Haptics.transient()
        await ShareSheet.present([filePath])
      }
    } else {
      const choice = await Dialog.actionSheet({
        title: `下载整套漫画《${item.title || "系列"}》`,
        actions: [
          { label: "CBZ 漫画包" },
          { label: "EPUB 电子书" },
        ],
      })
      if (choice !== 0 && choice !== 1) return
      const format: "cbz" | "epub" = choice === 0 ? "cbz" : "epub"
      const filePath = await downloadEntireMangaSeries(item.id, item.title, format)
      if (filePath) {
        void Haptics.transient()
        await ShareSheet.present([filePath])
      }
    }
  }

  if (item.mask_text) {
    return (
      <VStack
        alignment="leading"
        spacing={4}
        padding={14}
        glassEffect={{ type: "rect", cornerRadius: 14 }}
        shadow={{ color: "#0000000F", radius: 18, y: 8 }}
        frame={{ maxWidth: "infinity" }}
      >
        <Text foregroundStyle="secondaryLabel">{item.mask_text}</Text>
      </VStack>
    )
  }

  return (
    <ZStack alignment="bottomTrailing" frame={{ maxWidth: "infinity" }}>
      <NavigationLink
        value={seriesRoute}
        contextMenu={{
          menuItems: (
            <Group>
              <Button
                title={isNovel ? "下载整本小说 (EPUB)" : "下载整套漫画 (CBZ/EPUB)"}
                systemImage="square.and.arrow.down"
                action={() => void handleExportSeries()}
              />
              <Button
                title="分享系列链接"
                systemImage="square.and.arrow.up"
                action={() => {
                  void Haptics.transient()
                  const shareUrl = isNovel
                    ? `https://www.pixiv.net/novel/series/${item.id}`
                    : `https://www.pixiv.net/user_series/${item.id}`
                  void ShareSheet.present([shareUrl])
                }}
              />
            </Group>
          ),
        }}
      >
        <HStack
          spacing={10}
          padding={10}
          onAppear={onAppear}
          alignment="top"
          glassEffect={{ type: "rect", cornerRadius: 14 }}
          shadow={{ color: "#0000000F", radius: 18, y: 8 }}
          frame={{ maxWidth: "infinity" }}
        >
          <ZStack
            frame={{ width: 68, height: 96 }}
            clipShape={{ type: "rect", cornerRadius: 8 }}
          >
            <CachedImage
              url={item.url ?? null}
              aspectRatioValue={0.71}
              centerCropAspect={0.71}
              cornerRadius={0}
              contentMode="fill"
              frame={{ width: 68, height: 96 }}
              priority={priority}
            />
          </ZStack>
          <VStack
            alignment="leading"
            spacing={4}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          >
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {isNovel ? "小说系列" : "系列作品"}
            </Text>
            <Text
              font="subheadline"
              fontWeight="semibold"
              multilineTextAlignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {item.title || "未命名系列"}
            </Text>
            <Spacer />
            {item.user?.name ? (
              <HStack frame={{ maxWidth: "infinity" }}>
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {item.user.name}
                </Text>
                <Spacer />
              </HStack>
            ) : null}
            <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
              <Text font="caption2" foregroundStyle="secondaryLabel">
                {`共 ${item.published_content_count} 话`}
              </Text>
              {formattedDate ? (
                <Text font="caption2" foregroundStyle="secondaryLabel">
                  {formattedDate}
                </Text>
              ) : null}
              <Spacer />
            </HStack>
          </VStack>
        </HStack>
      </NavigationLink>
      <NavigationLink value={targetRoute} buttonStyle="plain">
        <ZStack
          alignment="center"
          frame={{ width: 34, height: 34 }}
          glassEffect="circle"
          contentShape="circle"
          offset={{ x: -8, y: -8 }}
          zIndex={2}
          shadow={{ color: "#0000000F", radius: 6, y: 2 }}
        >
          <Image
            systemName={isNovel ? "book" : "photo.on.rectangle"}
            font="subheadline"
            foregroundStyle="label"
          />
        </ZStack>
      </NavigationLink>
    </ZStack>
  )
}

