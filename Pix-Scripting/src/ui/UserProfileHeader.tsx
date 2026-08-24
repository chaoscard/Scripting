import {
  Button,
  Group,
  HStack,
  Image,
  Text,
  VStack,
  ZStack,
  useMemo,
} from "scripting"
import type { PixivUserDetail, PixivWebUserDetail } from "../types"
import type { UserAmbientPalette } from "../image/colorExtractor"
import { AvatarImage, CachedImage, ExpandableIntroduction } from "./components"
import { renderDestination } from "./routes"

interface SocialLinkItem {
  id: string
  name: string
  url: string
  systemImage: string
}

function extractSocialLinks(
  detail: PixivUserDetail,
  webDetail: PixivWebUserDetail | null
): SocialLinkItem[] {
  const links: SocialLinkItem[] = []
  const seenUrls = new Set<string>()

  function addLink(
    id: string,
    name: string,
    rawUrl: string | undefined | null,
    systemImage: string
  ) {
    if (!rawUrl) return
    const trimmed = rawUrl.trim()
    if (
      !trimmed ||
      (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))
    ) {
      return
    }
    if (seenUrls.has(trimmed)) return
    seenUrls.add(trimmed)
    links.push({ id, name, url: trimmed, systemImage })
  }

  // 1. 从网页端提取 social 对象 / 列表
  if (webDetail?.social) {
    if (Array.isArray(webDetail.social)) {
      webDetail.social.forEach((item, index) => {
        if (item?.url) {
          const meta = inferSocialMeta(item.url, `social_${index}`)
          addLink(meta.id, meta.name, item.url, meta.systemImage)
        }
      })
    } else if (typeof webDetail.social === "object") {
      for (const [key, item] of Object.entries(webDetail.social)) {
        if (item?.url) {
          const meta = socialMetaForKey(key, item.url)
          addLink(meta.id, meta.name, item.url, meta.systemImage)
        }
      }
    }
  }

  // 2. 从网页端提取 webpage（个人主页）
  if (webDetail?.webpage) {
    addLink("webpage", "主页", webDetail.webpage, "globe")
  }

  // 3. Fallback: App API twitter
  if (detail.profile.twitter_url) {
    addLink("twitter_app", "X", detail.profile.twitter_url, "xmark")
  }

  // 4. Fallback: App API webpage
  if (detail.profile.webpage) {
    addLink("webpage_app", "主页", detail.profile.webpage, "globe")
  }

  return links
}

function socialMetaForKey(
  key: string,
  url: string
): { id: string; name: string; systemImage: string } {
  const lowerKey = key.toLowerCase()
  if (lowerKey === "twitter" || lowerKey === "x") {
    return { id: "twitter", name: "X", systemImage: "xmark" }
  }
  if (lowerKey === "pawoo") {
    return {
      id: "pawoo",
      name: "Pawoo",
      systemImage: "antenna.radiowaves.left.and.right",
    }
  }
  if (lowerKey === "circlems") {
    return {
      id: "circlems",
      name: "Circle.ms",
      systemImage: "circle.grid.2x2.fill",
    }
  }
  if (lowerKey === "instagram") {
    return { id: "instagram", name: "Instagram", systemImage: "camera.fill" }
  }
  if (lowerKey === "bluesky") {
    return { id: "bluesky", name: "Bluesky", systemImage: "cloud.fill" }
  }
  return inferSocialMeta(url, key)
}

function inferSocialMeta(
  url: string,
  defaultId: string
): { id: string; name: string; systemImage: string } {
  const lower = url.toLowerCase()
  if (lower.includes("twitter.com") || lower.includes("x.com")) {
    return { id: "twitter", name: "X", systemImage: "xmark" }
  }
  if (lower.includes("pawoo.net")) {
    return {
      id: "pawoo",
      name: "Pawoo",
      systemImage: "antenna.radiowaves.left.and.right",
    }
  }
  if (lower.includes("circle.ms")) {
    return {
      id: "circlems",
      name: "Circle.ms",
      systemImage: "circle.grid.2x2.fill",
    }
  }
  if (lower.includes("instagram.com")) {
    return { id: "instagram", name: "Instagram", systemImage: "camera.fill" }
  }
  if (lower.includes("bsky.app") || lower.includes("bluesky")) {
    return { id: "bluesky", name: "Bluesky", systemImage: "cloud.fill" }
  }
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    return {
      id: "youtube",
      name: "YouTube",
      systemImage: "play.rectangle.fill",
    }
  }
  if (lower.includes("github.com")) {
    return { id: "github", name: "GitHub", systemImage: "curlybraces" }
  }
  if (lower.includes("weibo.com") || lower.includes("weibo.cn")) {
    return { id: "weibo", name: "微博", systemImage: "eye.fill" }
  }
  return { id: defaultId, name: "主页", systemImage: "link" }
}

function UserSocialBar(props: { socials: SocialLinkItem[] }) {
  if (props.socials.length === 0) return null
  return (
    <HStack
      alignment="center"
      spacing={10}
      frame={{ maxWidth: "infinity", alignment: "center" }}
      padding={{ vertical: 2 }}
    >
      {props.socials.map((item) => (
        <Button
          key={item.id}
          buttonStyle="plain"
          action={() => {
            void Safari.present(item.url, false)
          }}
          contextMenu={{
            menuItems: (
              <Group>
                <Button
                  title={`在浏览器中打开 ${item.name}`}
                  systemImage="safari"
                  action={() => void Safari.openURL(item.url)}
                />
                <Button
                  title="复制链接"
                  systemImage="doc.on.doc"
                  action={() => void Pasteboard.setString(item.url)}
                />
              </Group>
            ),
          }}
        >
          <ZStack
            alignment="center"
            frame={{ width: 30, height: 30 }}
            glassEffect="circle"
          >
            <Image
              systemName={item.systemImage}
              font="subheadline"
              frame={{ alignment: "center" }}
            />
          </ZStack>
        </Button>
      ))}
    </HStack>
  )
}

function buildAboutFields(
  detail: PixivUserDetail,
  webDetail: PixivWebUserDetail | null
): Array<[string, string]> {
  const fields: Array<[string, string]> = []

  // 地区
  const region =
    webDetail?.region?.name?.trim() || detail.profile.region?.trim()
  if (region) {
    fields.push(["地区", region])
  }

  // 年龄
  const age = webDetail?.age?.name?.trim()
  if (age) {
    fields.push(["年龄", age])
  }

  // 生日
  const birth =
    webDetail?.birthDay?.name?.trim() || detail.profile.birth?.trim()
  if (birth) {
    fields.push(["生日", birth])
  }

  // 性别
  const gender =
    webDetail?.gender?.name?.trim() || detail.profile.gender?.trim()
  if (gender) {
    fields.push(["性别", gender])
  }

  // 职业
  const job = webDetail?.job?.name?.trim() || detail.profile.job?.trim()
  if (job) {
    fields.push(["职业", job])
  }

  // 创作环境（Workspace）
  const ws = webDetail?.workspace
  if (ws && typeof ws === "object") {
    if (ws.userWorkspacePc?.trim()) {
      fields.push(["电脑", ws.userWorkspacePc.trim()])
    }
    if (ws.userWorkspaceMonitor?.trim()) {
      fields.push(["显示器", ws.userWorkspaceMonitor.trim()])
    }
    if (ws.userWorkspaceTool?.trim()) {
      fields.push(["软件", ws.userWorkspaceTool.trim()])
    }
    if (ws.userWorkspaceTablet?.trim()) {
      fields.push(["数位板", ws.userWorkspaceTablet.trim()])
    }
    if (ws.userWorkspaceMouse?.trim()) {
      fields.push(["鼠标", ws.userWorkspaceMouse.trim()])
    }
    if (ws.userWorkspaceScanner?.trim()) {
      fields.push(["扫描仪", ws.userWorkspaceScanner.trim()])
    }
    if (ws.userWorkspacePrinter?.trim()) {
      fields.push(["打印机", ws.userWorkspacePrinter.trim()])
    }
    if (ws.userWorkspaceDesktop?.trim()) {
      fields.push(["桌面物品", ws.userWorkspaceDesktop.trim()])
    }
    if (ws.userWorkspaceMusic?.trim()) {
      fields.push(["绘图音乐", ws.userWorkspaceMusic.trim()])
    }
    if (ws.userWorkspaceDesk?.trim()) {
      fields.push(["桌子", ws.userWorkspaceDesk.trim()])
    }
    if (ws.userWorkspaceChair?.trim()) {
      fields.push(["椅子", ws.userWorkspaceChair.trim()])
    }
    if (ws.userWorkspaceComment?.trim()) {
      fields.push(["其他", ws.userWorkspaceComment.trim()])
    }
  } else if (detail.workspace) {
    const appWs = detail.workspace
    if (appWs.pc?.trim()) fields.push(["电脑", appWs.pc.trim()])
    if (appWs.monitor?.trim()) fields.push(["显示器", appWs.monitor.trim()])
    if (appWs.tool?.trim()) fields.push(["软件", appWs.tool.trim()])
    if (appWs.tablet?.trim()) fields.push(["数位板", appWs.tablet.trim()])
    if (appWs.music?.trim()) fields.push(["绘图音乐", appWs.music.trim()])
    if (appWs.desk?.trim()) fields.push(["桌子", appWs.desk.trim()])
    if (appWs.chair?.trim()) fields.push(["椅子", appWs.chair.trim()])
    if (appWs.comment?.trim()) fields.push(["创作环境", appWs.comment.trim()])
  }

  return fields
}

export function UserProfileHeader(props: {
  detail: PixivUserDetail
  webDetail: PixivWebUserDetail | null
  ambientPalette?: UserAmbientPalette | null
}) {
  const { detail, webDetail, ambientPalette } = props
  const { user, profile } = detail

  const socialLinks = useMemo(
    () => extractSocialLinks(detail, webDetail),
    [detail, webDetail]
  )
  const aboutFields = useMemo(
    () => buildAboutFields(detail, webDetail),
    [detail, webDetail]
  )

  const commentHtml =
    webDetail?.commentHtml || webDetail?.comment || user.comment || ""
  const rawComment = webDetail?.comment || user.comment || ""

  const avatarSize = 74
  const ringSize = avatarSize + 4

  return (
    <VStack
      alignment="leading"
      spacing={0}
      frame={{ maxWidth: "infinity" }}
    >
      {/* 沉浸式顶部背景图与居中悬浮头像 */}
      <ZStack alignment="bottom" frame={{ maxWidth: "infinity" }}>
        {profile.background_image_url ? (
          <CachedImage
            url={profile.background_image_url}
            useIntrinsicAspectRatio={true}
            aspectRatioValue={2.4}
            contentMode="fill"
            cornerRadius={0}
            priority={0}
            frame={{ maxWidth: "infinity" }}
          />
        ) : (
          <VStack
            frame={{ maxWidth: "infinity", height: 160 }}
            background={{
              colors: ["rgba(0, 150, 250, 0.18)", "rgba(0, 150, 250, 0.04)"],
              startPoint: "topLeading",
              endPoint: "bottomTrailing",
            }}
          />
        )}

        {/* 居中头像：垂直中心线对齐背景图底边 */}
        <ZStack
          alignment="center"
          frame={{ width: ringSize, height: ringSize }}
          background="systemBackground"
          clipShape={{ type: "rect", cornerRadius: ringSize / 2 }}
          shadow={{ color: "#00000028", radius: 8, y: 4 }}
          offset={{ x: 0, y: ringSize / 2 }}
        >
          <AvatarImage
            url={user.profile_image_urls?.medium ?? null}
            size={avatarSize}
            priority={1}
          />
        </ZStack>
      </ZStack>

      <VStack
        alignment="leading"
        spacing={12}
        padding={{ top: ringSize / 2 + 14, horizontal: 16, bottom: 8 }}
        frame={{ maxWidth: "infinity" }}
      >
        {/* 社媒图标栏：居中展示，距离头像有段呼吸空间 */}
        <UserSocialBar socials={socialLinks} />

        {/* 简介：从网页端取，默认展示五行，超过五行点击文本框下拉展示 */}
        <ExpandableIntroduction
          title="简介"
          commentHtml={commentHtml}
          rawComment={rawComment}
          routeDestination={renderDestination}
        />

        {/* 关于信息：地区，年龄，生日，性别，职业，创作环境各字段 */}
        {aboutFields.length > 0 ? (
          <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
            <Text
              font="subheadline"
              fontWeight="semibold"
              foregroundStyle="secondaryLabel"
            >
              关于
            </Text>
            <VStack
              alignment="leading"
              spacing={8}
              padding={12}
              glassEffect={{ type: "rect", cornerRadius: 14 }}
              frame={{ maxWidth: "infinity" }}
            >
              {aboutFields.map(([label, value]) => (
                <HStack key={label} alignment="top" spacing={10}>
                  <Text
                    font="footnote"
                    foregroundStyle="secondaryLabel"
                    frame={{ width: 58, alignment: "leading" }}
                  >
                    {label}
                  </Text>
                  <Text
                    font="footnote"
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    {value}
                  </Text>
                </HStack>
              ))}
            </VStack>
          </VStack>
        ) : null}
      </VStack>
    </VStack>
  )
}
