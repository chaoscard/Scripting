import {
  Button,
  Device,
  FlowLayout,
  Group,
  HStack,
  Image,
  LazyVStack,
  Menu,
  Navigation,
  NavigationLink,
  Rectangle,
  ScrollView,
  ScrollViewProxy,
  ScrollViewReader,
  Spacer,
  Text,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type VirtualNode,
  VStack,
  ZStack,
} from "scripting"
import { fetchPublicWebIllustDetail, illustrationDetail, pixivisionDetail } from "../api/pixiv"
import { session } from "../api/session"
import { cacheIllust, getCachedIllust } from "../store/illustCache"
import { cachedFilePath, derivePixivThumbUrl, getPixivisionCoverUrl, loadImage } from "../image/imageLoader"
import { fetchImageBinaryWithRetry, saveImageToPixivAlbum } from "../downloader"
import { renderDestination } from "./routes"
import { useAsyncGuard, useExperimentalAmbientPalette } from "./hooks"
import { IllustGalleryView } from "./IllustGalleryView"
import type { PixivIllustration, PixivisionArticle, PixivisionArtwork, PixivisionBodyBlock, PixivisionDetail } from "../types"
import {
  ErrorView,
  ExpandableIntroduction,
  formatDate,
  IllustCard,
  LinkedDescription,
  LoadingView,
  PixivisionCard,
  presentExternalURL,
  routeForDescriptionLink,
  TagChip,
} from "./components"
import { AvatarImage, CachedImage } from "./components/CachedImage"
import { requestPixivRoute } from "./routeNavigation"

declare const Pasteboard: any

const FLOW_HORIZONTAL_PADDING = 12
const HERO_CARD_WIDTH = Math.floor(Device.screen.width - FLOW_HORIZONTAL_PADDING * 2)
const MIN_FLOW_IMAGE_RATIO = 1 / 4
const MAX_FLOW_IMAGE_RATIO = 2.5

function isVirtualNode(v: unknown): v is VirtualNode {
  return !!v && typeof v === "object" && ("render" in v || "isInternal" in v || "props" in v)
}

export function PixivisionDetailView(props: { articleID: number }) {
  const { articleID } = props
  const [detail, setDetail] = useState<PixivisionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hydratedMap, setHydratedMap] = useState<Record<number, PixivIllustration>>({})
  const [isTocExpanded, setIsTocExpanded] = useState(true)
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null)
  const guard = useAsyncGuard()
  const hydratingSetRef = useRef<Set<number>>(new Set())
  const proxyRef = useRef<ScrollViewProxy | null>(null)

  // 按照探索推荐页沉浸逻辑：从第一张图片提取色调，绝不侵入顶栏背景
  // 1. 优先取文章自身封面/首图
  // 2. 其次取正文中展示的第一幅插画作品大图
  // 3. 再次取正文第一个插图块
  // 4. 若上述均未就绪（如初次进入骨架屏时期），取点击卡片时缓存的封面图
  const firstImageUrl = useMemo(() => {
    if (detail?.thumbnailURL) return detail.thumbnailURL
    if (detail?.artworks?.[0]?.imageURL) return detail.artworks[0].imageURL
    const firstBlockImage = detail?.blocks?.find(
      (b): b is Extract<PixivisionBodyBlock, { type: "image" }> => b.type === "image"
    )
    if (firstBlockImage?.src) return firstBlockImage.src
    return getPixivisionCoverUrl(articleID)
  }, [detail, articleID])

  const { ambientBackground } = useExperimentalAmbientPalette(firstImageUrl)

  const handleShare = useCallback(async () => {
    await ShareSheet.present([`https://www.pixivision.net/zh/a/${articleID}`])
  }, [articleID])

  const scrollToTarget = useCallback((targetId: string) => {
    withAnimation(() => {
      setScrollTargetId(targetId)
      proxyRef.current?.scrollTo(targetId, "top")
    })
  }, [])

  const handlePixivisionLink = useCallback((rawUrl: string) => {
    const trimmed = rawUrl.trim()
    if (!trimmed) return
    const target = routeForDescriptionLink(trimmed)
    if (target) {
      if (target.startsWith("http")) {
        void presentExternalURL(target)
      } else {
        requestPixivRoute(target)
      }
    } else if (/^https?:\/\//i.test(trimmed)) {
      void presentExternalURL(trimmed)
    } else if (trimmed.startsWith("/")) {
      void presentExternalURL(`https://www.pixivision.net${trimmed}`)
    } else {
      requestPixivRoute(trimmed)
    }
  }, [])

  const hydrateArtwork = useCallback(async (id: number) => {
    if (hydratingSetRef.current.has(id)) return
    const cached = getCachedIllust(id)
    if (cached && cached.width > 0 && cached.height > 0) {
      setHydratedMap((prev) => (prev[id] ? prev : { ...prev, [id]: cached }))
      return
    }
    hydratingSetRef.current.add(id)
    try {
      let full: PixivIllustration | null = null
      if (session.userID) {
        try {
          full = await session.call((token) => illustrationDetail(id, token))
        } catch {
          // 回退到公开 Web 接口
        }
      }
      if (!full) {
        full = await fetchPublicWebIllustDetail(id)
      }
      if (full) {
        const art = detail?.artworks.find((a) => a.id === id)
        if (art?.draftImages && art.draftImages.length > 0) {
          const draftPages = art.draftImages.map((d) => {
            const dThumb = d.thumbURL || derivePixivThumbUrl(d.imageURL) || d.imageURL
            return {
              image_urls: {
                square_medium: dThumb,
                medium: dThumb,
                large: d.imageURL,
                original: d.imageURL,
              },
            }
          })
          full.meta_pages = [
            ...(full.meta_pages && full.meta_pages.length > 0 ? full.meta_pages : [{ image_urls: full.image_urls }]),
            ...draftPages,
          ]
          full.page_count = full.meta_pages.length
        }
        if (art?.imageURL) {
          full.extra_preview_url = art.imageURL
        }
        cacheIllust(full)
        setHydratedMap((prev) => ({ ...prev, [id]: full }))
      }
    } catch {
      // 容错：接口失败时保持骨架卡片展示
    } finally {
      hydratingSetRef.current.delete(id)
    }
  }, [detail])

  const openGalleryForBlock = useCallback(
    (block: Extract<PixivisionBodyBlock, { type: "image" }>) => {
      let targetIllust: PixivIllustration | null = null
      let targetPageIndex = 0

      if (block.associatedArtworkID && detail) {
        const artwork = detail.artworks.find((a) => a.id === block.associatedArtworkID)
        if (artwork) {
          const hydrated = hydratedMap[artwork.id]
          targetIllust = hydrated ?? buildArtworkSkeletonIllust(artwork)
          targetPageIndex = block.galleryPageIndex ?? 0
        }
      }

      if (!targetIllust) {
        const width = block.width && block.width > 0 ? block.width : 1200
        const height = block.height && block.height > 0 ? block.height : 800
        const thumb = block.thumbURL || derivePixivThumbUrl(block.src) || block.src
        targetIllust = {
          id: -Math.floor(Math.random() * 1000000) - 1,
          title: block.caption || detail?.title || "特辑图片",
          type: "illust",
          image_urls: {
            square_medium: thumb,
            medium: thumb,
            large: block.src,
            original: block.src,
          },
          caption: block.caption ?? "",
          user: {
            id: 0,
            name: detail?.title ?? "Pixivision",
            account: "",
            profile_image_urls: {
              medium: "",
            },
            is_followed: false,
          },
          tags: [],
          create_date: "",
          page_count: 1,
          width,
          height,
          x_restrict: 0,
          series: null,
          meta_single_page: {},
          meta_pages: [],
          total_view: 0,
          total_bookmarks: 0,
          is_bookmarked: false,
          is_muted: false,
          total_comments: 0,
          illust_ai_type: 0,
          comment_access_control: 0,
        }
        targetPageIndex = 0
      }

      void Navigation.present({
        element: <IllustGalleryView illust={targetIllust} initialPageIndex={targetPageIndex} />,
        modalPresentationStyle: "fullScreen",
      })
    },
    [detail, hydratedMap]
  )

  async function load() {
    const g = guard()
    setLoading(true)
    setError(null)
    try {
      const value = await pixivisionDetail(articleID)
      if (!g.isCurrent()) return

      // 1. 预先填充已有本地缓存的作品
      const initialMap: Record<number, PixivIllustration> = {}
      for (const item of value.artworks) {
        const cached = getCachedIllust(item.id)
        if (cached && cached.width > 0 && cached.height > 0) {
          initialMap[item.id] = cached
          item.width = cached.width
          item.height = cached.height
        }
      }

      // 2. 毫秒级缩略图推导与尺寸测算（插画作品、正文图片/草稿与特辑文章卡片并行测算，实现先画框后绘图）
      const unmeasuredArtworks = value.artworks.filter(
        (a) => !initialMap[a.id] && (!a.width || !a.height || a.width <= 0 || a.height <= 0)
      )

      const allArticles: PixivisionArticle[] = [
        ...value.embeddedArticles,
        ...(value.blocks?.filter((b): b is { type: "article_card"; article: PixivisionArticle } => b.type === "article_card").map((b) => b.article) ?? []),
        ...(value.relatedSections?.flatMap((s) => s.articles) ?? []),
      ]
      const unmeasuredArticles = allArticles.filter(
        (a) => (!a.width || !a.height || a.width <= 0 || a.height <= 0) && Boolean(a.imageURL)
      )

      const unmeasuredImageBlocks = (value.blocks ?? [])
        .filter((b): b is Extract<PixivisionBodyBlock, { type: "image" }> => b.type === "image")
        .filter((b) => (!b.width || !b.height || b.width <= 0 || b.height <= 0) && Boolean(b.src))

      const measurePromises: Promise<any>[] = []

      if (unmeasuredArtworks.length > 0) {
        measurePromises.push(
          Promise.allSettled(
            unmeasuredArtworks.map(async (art) => {
              const thumbUrl = art.thumbURL || derivePixivThumbUrl(art.imageURL)
              if (!thumbUrl) return
              const filePath = cachedFilePath(thumbUrl) ?? (await loadImage(thumbUrl, -1000))
              if (filePath) {
                try {
                  const img = UIImage.fromFile(filePath)
                  if (img && img.width > 0 && img.height > 0) {
                    art.width = img.width
                    art.height = img.height
                  }
                } catch {
                  // 忽略解码异常
                }
              }
            })
          )
        )
      }

      if (unmeasuredArticles.length > 0) {
        measurePromises.push(
          Promise.allSettled(
            unmeasuredArticles.map(async (art) => {
              const thumbUrl = art.thumbURL || derivePixivThumbUrl(art.imageURL) || art.imageURL
              if (!thumbUrl) return
              const filePath = cachedFilePath(thumbUrl) ?? (await loadImage(thumbUrl, -1000))
              if (filePath) {
                try {
                  const img = UIImage.fromFile(filePath)
                  if (img && img.width > 0 && img.height > 0) {
                    art.width = img.width
                    art.height = img.height
                  }
                } catch {
                  // 忽略解码异常
                }
              }
            })
          )
        )
      }

      if (unmeasuredImageBlocks.length > 0) {
        measurePromises.push(
          Promise.allSettled(
            unmeasuredImageBlocks.map(async (block) => {
              const thumbUrl = block.thumbURL || derivePixivThumbUrl(block.src) || block.src
              if (!thumbUrl) return
              const filePath = cachedFilePath(thumbUrl) ?? (await loadImage(thumbUrl, -1000))
              if (filePath) {
                try {
                  const img = UIImage.fromFile(filePath)
                  if (img && img.width > 0 && img.height > 0) {
                    block.width = img.width
                    block.height = img.height
                  }
                } catch {
                  // 忽略解码异常
                }
              }
            })
          )
        )
      }

      if (measurePromises.length > 0) {
        await Promise.allSettled(measurePromises)
      }

      if (!g.isCurrent()) return

      // 将测算出的图片尺寸同步至作品的 draftImages
      for (const art of value.artworks) {
        if (art.draftImages && art.draftImages.length > 0) {
          for (const d of art.draftImages) {
            const matched = unmeasuredImageBlocks.find((b) => b.src === d.imageURL)
            if (matched && matched.width && matched.height) {
              d.width = matched.width
              d.height = matched.height
            }
          }
        }
      }

      for (const item of value.artworks) {
        const cached = getCachedIllust(item.id)
        if (item.draftImages && item.draftImages.length > 0) {
          initialMap[item.id] = buildArtworkSkeletonIllust(item)
        } else if (cached && cached.width > 0 && cached.height > 0) {
          initialMap[item.id] = cached
          item.width = cached.width
          item.height = cached.height
        } else if (!initialMap[item.id]) {
          initialMap[item.id] = buildArtworkSkeletonIllust(item)
        }
      }
      setDetail(value)
    } catch (err: any) {
      if (g.isCurrent()) setError(err?.message ?? "加载失败")
    } finally {
      if (g.isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleID])

  if (loading) {
    return (
      <ZStack>
        {isVirtualNode(ambientBackground) ? (
          ambientBackground
        ) : (
          <Rectangle fill={ambientBackground ?? "clear"} ignoresSafeArea={true} />
        )}
        <ScrollView navigationTitle="特辑详情" navigationBarTitleDisplayMode="inline">
          <LoadingView />
        </ScrollView>
      </ZStack>
    )
  }

  if (error || !detail) {
    return (
      <ZStack>
        {isVirtualNode(ambientBackground) ? (
          ambientBackground
        ) : (
          <Rectangle fill={ambientBackground ?? "clear"} ignoresSafeArea={true} />
        )}
        <ScrollView navigationTitle="特辑详情" navigationBarTitleDisplayMode="inline">
          <ErrorView message={error ?? "特辑不存在或已下架"} onRetry={load} />
        </ScrollView>
      </ZStack>
    )
  }

  return (
    <ZStack>
      {isVirtualNode(ambientBackground) ? (
        ambientBackground
      ) : (
        <Rectangle fill={ambientBackground ?? "clear"} ignoresSafeArea={true} />
      )}
      <ScrollViewReader>
        {(proxy) => {
          proxyRef.current = proxy
          return (
            <ScrollView
            scrollPosition={{
              value: scrollTargetId,
              onChanged: (newId) => {
                if (newId !== scrollTargetId) {
                  setScrollTargetId(newId as string | null)
                }
              },
              anchor: "top",
            }}
            navigationTitle={detail.title}
            navigationBarTitleDisplayMode="inline"
            toolbar={{
              topBarTrailing: (
                <HStack spacing={12}>
                  {detail.tableOfContents && detail.tableOfContents.length > 0 ? (
                    <Menu key="toc-menu" label={<Image systemName="list.bullet" />}>
                      {detail.tableOfContents.map((item, idx) => (
                        <Button
                          key={item.id || `toc-${idx}`}
                          title={`${idx + 1}. ${item.title}`}
                          action={() => {
                            if (item.id) {
                              scrollToTarget(item.id)
                            }
                          }}
                        />
                      ))}
                    </Menu>
                  ) : null}
                  <Button key="share" action={handleShare}>
                    <Image systemName="square.and.arrow.up" />
                  </Button>
                </HStack>
              ),
            }}
          >
            <VStack
              alignment="leading"
              spacing={14}
              padding={{ top: 12, bottom: 32 }}
              scrollTargetLayout={true}
            >
              {/* 1. 头部信息 */}
              <VStack
                key="section-header"
                alignment="leading"
                spacing={8}
                padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
                frame={{ maxWidth: "infinity" }}
              >
                <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
                  <Text
                    font="subheadline"
                    fontWeight="semibold"
                    foregroundStyle="#0096FA"
                  >
                    {detail.category || "特辑"}
                  </Text>
                  <Spacer />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {formatPixivisionDate(detail.date)}
                  </Text>
                </HStack>

                <Text
                  font="title2"
                  fontWeight="bold"
                  multilineTextAlignment="leading"
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  {detail.title}
                </Text>
              </VStack>

              {/* 2. 简介 */}
              {detail.lead ? (
                <VStack key="section-lead" padding={{ horizontal: FLOW_HORIZONTAL_PADDING }} frame={{ maxWidth: "infinity" }}>
                  <ExpandableIntroduction
                    title="编辑导语"
                    caption={detail.lead}
                    routeDestination={renderDestination}
                  />
                </VStack>
              ) : null}

              {detail.description && detail.description !== detail.lead ? (
                <VStack key="section-desc" padding={{ horizontal: FLOW_HORIZONTAL_PADDING }} frame={{ maxWidth: "infinity" }}>
                  <ExpandableIntroduction
                    title="简介"
                    caption={detail.description}
                    routeDestination={renderDestination}
                  />
                </VStack>
              ) : null}

              {/* 3. 标签 */}
              {Array.isArray(detail.tags) && detail.tags.length > 0 ? (
                <VStack
                  key="section-tags"
                  alignment="leading"
                  spacing={6}
                  padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
                >
                  <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
                    标签
                  </Text>
                  <FlowLayout spacing={6}>
                    {detail.tags.map((tag) => {
                      const route = tag.id
                        ? `pixivision-tag:${tag.id}?name=${encodeURIComponent(tag.name)}`
                        : `pixivision-tag:${encodeURIComponent(tag.name)}`
                      return (
                        <TagChip
                          key={`${tag.id ?? tag.name}`}
                          name={tag.name}
                          tagName={tag.name}
                          value={route}
                          compact
                        />
                      )
                    })}
                  </FlowLayout>
                </VStack>
              ) : null}

              {/* 4. 目录卡片 */}
              {detail.tableOfContents && detail.tableOfContents.length > 0 ? (
                <VStack
                  key="section-toc"
                  padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
                  frame={{ maxWidth: "infinity" }}
                >
                  <VStack
                    alignment="leading"
                    spacing={10}
                    padding={12}
                    glassEffect={{ type: "rect", cornerRadius: 14 }}
                    frame={{ maxWidth: "infinity" }}
                  >
                    <HStack
                      spacing={6}
                      alignment="center"
                      frame={{ maxWidth: "infinity" }}
                      onTapGesture={() => setIsTocExpanded((prev) => !prev)}
                    >
                      <Image
                        systemName="list.bullet.indent"
                        font="headline"
                        foregroundStyle="#0096FA"
                      />
                      <Text font="headline" fontWeight="bold">
                        目录
                      </Text>
                      <Text font="caption" foregroundStyle="secondaryLabel">
                        （共 {detail.tableOfContents.length} 节）
                      </Text>
                      <Spacer />
                      <Image
                        systemName={isTocExpanded ? "chevron.up" : "chevron.down"}
                        font="caption"
                        foregroundStyle="secondaryLabel"
                      />
                    </HStack>

                    {isTocExpanded ? (
                      <VStack alignment="leading" spacing={8} padding={{ top: 4 }}>
                        {detail.tableOfContents.map((item, idx) => (
                          <HStack
                            key={`toc-item-${item.id}`}
                            spacing={8}
                            alignment="center"
                            frame={{ maxWidth: "infinity", alignment: "leading" }}
                            onTapGesture={() => {
                              scrollToTarget(item.id)
                            }}
                          >
                            <Text
                              font="caption"
                              fontWeight="bold"
                              foregroundStyle="#0096FA"
                              frame={{ width: 22 }}
                            >
                              {idx + 1}.
                            </Text>
                            <Text
                              font="subheadline"
                              lineLimit={1}
                            >
                              {item.title}
                            </Text>
                            <Spacer />
                            <Image
                              systemName="chevron.right"
                              font="caption2"
                              foregroundStyle="tertiaryLabel"
                            />
                          </HStack>
                        ))}
                      </VStack>
                    ) : null}
                  </VStack>
                </VStack>
              ) : null}

              {/* 5. 正文内容流渲染：作为外层 scrollTargetLayout 的直接子节点 */}
              {detail.blocks && detail.blocks.length > 0 ? (
                detail.blocks.map((block, idx) => {
                  switch (block.type) {
                    case "heading":
                      return (
                        <VStack
                          key={block.id ?? `h-${idx}`}
                          alignment="leading"
                          spacing={6}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, top: 18, bottom: 2 }}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                        >
                          <HStack spacing={8} alignment="center">
                            <VStack
                              frame={{ width: 4, height: 18 }}
                              background="#0096FA"
                              clipShape={{ type: "rect", cornerRadius: 2 }}
                            />
                            <Text font="title3" fontWeight="bold" multilineTextAlignment="leading">
                              {block.title}
                            </Text>
                          </HStack>
                        </VStack>
                      )
                    case "subheading":
                      return (
                        <VStack
                          key={`sub-${idx}`}
                          alignment="leading"
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, top: 8, bottom: 2 }}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                        >
                          <Text font="headline" fontWeight="semibold">
                            {block.title}
                          </Text>
                        </VStack>
                      )
                    case "paragraph":
                      return (
                        <VStack
                          key={`p-${idx}`}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, vertical: 2 }}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                        >
                          <LinkedDescription
                            html={block.text}
                            font="body"
                            lineSpacing={5}
                          />
                        </VStack>
                      )
                    case "quote":
                      return (
                        <VStack
                          key={`q-${idx}`}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, vertical: 4 }}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                        >
                          <HStack
                            spacing={10}
                            padding={12}
                            glassEffect={{ type: "rect", cornerRadius: 12 }}
                            frame={{ maxWidth: "infinity", alignment: "leading" }}
                          >
                            <VStack
                              frame={{ width: 4, minHeight: 24 }}
                              background="#FF9500"
                              clipShape={{ type: "rect", cornerRadius: 2 }}
                            />
                            <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
                              <LinkedDescription
                                html={block.text}
                                font="subheadline"
                                lineSpacing={4}
                              />
                              {block.source ? (
                                <Text font="caption" foregroundStyle="secondaryLabel">
                                  —— {block.source}
                                </Text>
                              ) : null}
                            </VStack>
                          </HStack>
                        </VStack>
                      )
                    case "comment":
                      return (
                        <VStack
                          key={`c-${idx}`}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, vertical: 4 }}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                        >
                          <VStack
                            alignment="leading"
                            spacing={6}
                            padding={12}
                            glassEffect={{ type: "rect", cornerRadius: 12 }}
                            frame={{ maxWidth: "infinity" }}
                          >
                            <HStack spacing={6} alignment="center">
                              <Image systemName="envelope.fill" font="caption" foregroundStyle="#0096FA" />
                              <Text font="caption" fontWeight="bold" foregroundStyle="#0096FA">
                                读者来信
                              </Text>
                            </HStack>
                            <LinkedDescription
                              html={block.text}
                              font="subheadline"
                              lineSpacing={4}
                            />
                          </VStack>
                        </VStack>
                      )
                    case "profile":
                      return (
                        <VStack
                          key={`prof-${idx}`}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, vertical: 6 }}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                        >
                          <VStack
                            alignment="leading"
                            spacing={10}
                            padding={14}
                            glassEffect={{ type: "rect", cornerRadius: 14 }}
                            frame={{ maxWidth: "infinity" }}
                          >
                            <HStack spacing={10} alignment="center">
                              <AvatarImage url={block.profile.avatarURL ?? null} size={44} />
                              <VStack alignment="leading" spacing={2}>
                                <Text font="headline" fontWeight="bold">
                                  {block.profile.name}
                                </Text>
                                <Text font="caption" foregroundStyle="secondaryLabel">
                                  特辑创作者 / 受访嘉宾
                                </Text>
                              </VStack>
                            </HStack>
                            <LinkedDescription
                              html={block.profile.description}
                              font="subheadline"
                              foregroundStyle="secondaryLabel"
                              lineSpacing={4}
                            />
                            {block.profile.links && block.profile.links.length > 0 ? (
                              <HStack spacing={8}>
                                {block.profile.links.map((link) => (
                                  <Button
                                    key={link.url}
                                    action={() => {
                                      handlePixivisionLink(link.url)
                                    }}
                                    buttonStyle="bordered"
                                    controlSize="small"
                                  >
                                    <HStack spacing={4} alignment="center">
                                      <Text font="caption">{link.title}</Text>
                                      <Image systemName="arrow.up.right" font="caption2" />
                                    </HStack>
                                  </Button>
                                ))}
                              </HStack>
                            ) : null}
                          </VStack>
                        </VStack>
                      )
                    case "qa":
                      return (
                        <VStack
                          key={`qa-${idx}`}
                          alignment="leading"
                          spacing={8}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, vertical: 6 }}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                        >
                          <HStack spacing={8} alignment="top">
                            <Text font="headline" fontWeight="bold" foregroundStyle="#0096FA">
                              Q:
                            </Text>
                            <Text
                              font="headline"
                              fontWeight="semibold"
                              lineSpacing={3}
                              multilineTextAlignment="leading"
                            >
                              {block.question.replace(/^────\s*/, "")}
                            </Text>
                          </HStack>
                          <HStack spacing={10} alignment="top">
                            <AvatarImage url={block.answerAvatarURL ?? null} size={32} />
                            <VStack alignment="leading" frame={{ maxWidth: "infinity" }}>
                              <LinkedDescription
                                html={block.answer}
                                font="body"
                                lineSpacing={5}
                              />
                            </VStack>
                          </HStack>
                        </VStack>
                      )
                    case "illust": {
                      const artwork = block.artwork
                      const hydrated = hydratedMap[artwork.id]
                      const illust = hydrated ?? buildArtworkSkeletonIllust(artwork)
                      return (
                        <VStack
                          key={`illust-${artwork.id}-${idx}`}
                          alignment="leading"
                          spacing={6}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
                          frame={{ width: Device.screen.width }}
                        >
                          <IllustCard
                            hero={true}
                            compact={true}
                            illust={illust}
                            priority={idx}
                            onAppear={() => {
                              if (!hydrated) {
                                void hydrateArtwork(artwork.id)
                              }
                            }}
                          />
                          {artwork.comment ? (
                            <VStack padding={{ horizontal: 6 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                              <LinkedDescription
                                html={artwork.comment}
                                font="caption"
                                foregroundStyle="secondaryLabel"
                                lineLimit={3}
                                lineSpacing={3}
                              />
                            </VStack>
                          ) : null}
                        </VStack>
                      )
                    }
                    case "article_card":
                      return (
                        <VStack
                          key={`card-${block.article.id}-${idx}`}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, vertical: 2 }}
                          frame={{ maxWidth: "infinity" }}
                        >
                          <PixivisionCard article={block.article} />
                        </VStack>
                      )
                    case "image": {
                      const rawRatio =
                        block.width && block.height && block.height > 0
                          ? block.width / block.height
                          : 1
                      const imageRatio = Math.min(Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO), MAX_FLOW_IMAGE_RATIO)
                      const cardFrame = { width: HERO_CARD_WIDTH }
                      const imageFrame = { width: HERO_CARD_WIDTH, height: HERO_CARD_WIDTH / imageRatio }

                      const handleImageTap = () => {
                        if (block.linkURL) {
                          handlePixivisionLink(block.linkURL)
                        } else {
                          openGalleryForBlock(block)
                        }
                      }

                      return (
                        <VStack
                          key={`img-${idx}`}
                          alignment="leading"
                          spacing={6}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
                          frame={{ width: Device.screen.width }}
                        >
                          <VStack
                            alignment="leading"
                            spacing={0}
                            frame={cardFrame}
                            padding={6}
                            glassEffect={{ type: "rect", cornerRadius: 16 }}
                            shadow={{ color: "#0000000F", radius: 20, y: 10 }}
                          >
                            <ZStack alignment="bottomTrailing" frame={cardFrame}>
                              <Button
                                action={handleImageTap}
                                buttonStyle="plain"
                                frame={cardFrame}
                                contextMenu={{
                                  menuItems: (
                                    <Group>
                                      <Button
                                        title="保存至相册"
                                        systemImage="square.and.arrow.down"
                                        action={async () => {
                                          const cached = cachedFilePath(block.src) || cachedFilePath(block.thumbURL ?? "")
                                          const fileName = `pixivision_${detail?.id ?? "image"}_${idx}.jpg`
                                          if (cached) {
                                            await saveImageToPixivAlbum(cached, fileName)
                                          } else {
                                            const data = await fetchImageBinaryWithRetry(block.src)
                                            if (data) {
                                              await saveImageToPixivAlbum(data, fileName)
                                            }
                                          }
                                        }}
                                      />
                                      <Button
                                        title="复制图片链接"
                                        systemImage="doc.on.doc"
                                        action={() => {
                                          void Pasteboard.setString(block.src)
                                        }}
                                      />
                                      {block.linkURL ? (
                                        <Button
                                          title="打开链接"
                                          systemImage="arrow.up.right"
                                          action={() => {
                                            handlePixivisionLink(block.linkURL!)
                                          }}
                                        />
                                      ) : null}
                                    </Group>
                                  ),
                                }}
                              >
                                <ZStack alignment="topLeading" frame={cardFrame}>
                                  <ZStack
                                    alignment="bottomLeading"
                                    frame={imageFrame}
                                    clipShape={{ type: "rect", cornerRadius: 12 }}
                                    clipped={true}
                                  >
                                    <CachedImage
                                      url={block.src}
                                      previewUrl={block.thumbURL}
                                      aspectRatioValue={imageRatio}
                                      contentMode="fit"
                                      cornerRadius={12}
                                      frame={imageFrame}
                                    />
                                  </ZStack>
                                </ZStack>
                              </Button>
                            </ZStack>
                          </VStack>
                          {block.caption ? (
                            <VStack padding={{ horizontal: 6 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3} lineSpacing={3}>
                                {block.caption}
                              </Text>
                            </VStack>
                          ) : null}
                        </VStack>
                      )
                    }
                    case "movie":
                      return (
                        <VStack
                          key={`mov-${idx}`}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, vertical: 6 }}
                          frame={{ maxWidth: "infinity" }}
                        >
                          <Button
                            action={() => {
                              handlePixivisionLink(block.videoURL)
                            }}
                            buttonStyle="plain"
                          >
                            <HStack
                              spacing={10}
                              padding={14}
                              glassEffect={{ type: "rect", cornerRadius: 12 }}
                              alignment="center"
                            >
                              <Image
                                systemName="play.circle.fill"
                                font="title2"
                                foregroundStyle="#FF3B30"
                              />
                              <VStack alignment="leading" spacing={2}>
                                <Text font="subheadline" fontWeight="bold">
                                  观看特辑视频
                                </Text>
                                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                                  {block.videoURL}
                                </Text>
                              </VStack>
                              <Spacer />
                              <Image
                                systemName="arrow.up.right"
                                font="caption"
                                foregroundStyle="tertiaryLabel"
                              />
                            </HStack>
                          </Button>
                        </VStack>
                      )
                    case "credit":
                      return (
                        <VStack
                          key={`cr-${idx}`}
                          alignment="trailing"
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, vertical: 6 }}
                          frame={{ maxWidth: "infinity", alignment: "trailing" }}
                        >
                          <Text font="caption" foregroundStyle="tertiaryLabel">
                            {block.text}
                          </Text>
                        </VStack>
                      )
                    case "caption":
                      return (
                        <VStack
                          key={`cap-${idx}`}
                          alignment="leading"
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING, vertical: 2 }}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                        >
                          <Text font="caption" foregroundStyle="secondaryLabel">
                            {block.text}
                          </Text>
                        </VStack>
                      )
                    default:
                      return null
                  }
                })
              ) : (
                // 降级回退模式
                <>
                  {detail.artworks.length > 0 ? (
                    detail.artworks.map((artwork, index) => {
                      const hydrated = hydratedMap[artwork.id]
                      const illust = hydrated ?? buildArtworkSkeletonIllust(artwork)
                      return (
                        <VStack
                          key={`fallback-art-${artwork.id}`}
                          alignment="leading"
                          spacing={6}
                          padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
                          frame={{ width: Device.screen.width }}
                        >
                          <IllustCard
                            hero={true}
                            compact={true}
                            illust={illust}
                            priority={index}
                            onAppear={() => {
                              if (!hydrated) {
                                void hydrateArtwork(artwork.id)
                              }
                            }}
                          />
                          {artwork.comment ? (
                            <VStack padding={{ horizontal: 6 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                              <LinkedDescription
                                html={artwork.comment}
                                font="caption"
                                foregroundStyle="secondaryLabel"
                                lineLimit={3}
                                lineSpacing={3}
                              />
                            </VStack>
                          ) : null}
                        </VStack>
                      )
                    })
                  ) : null}

                  {detail.embeddedArticles && detail.embeddedArticles.length > 0 ? (
                    <VStack key="fallback-embedded" alignment="leading" spacing={12} padding={{ horizontal: FLOW_HORIZONTAL_PADDING, top: 16 }}>
                      <HStack spacing={6} alignment="center">
                        <Image
                          systemName="doc.text.image"
                          font="headline"
                          foregroundStyle="#0096FA"
                        />
                        <Text font="headline" fontWeight="bold">
                          推荐阅读
                        </Text>
                      </HStack>
                      <LazyVStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
                        {detail.embeddedArticles.map((article) => (
                          <PixivisionCard key={`fallback-card-${article.id}`} article={article} />
                        ))}
                      </LazyVStack>
                    </VStack>
                  ) : null}
                </>
              )}

              {/* 6. 底部相关推荐分组 (Related Articles) */}
              {detail.relatedSections && detail.relatedSections.length > 0 ? (
                <VStack
                  key="section-related"
                  alignment="leading"
                  spacing={20}
                  padding={{ horizontal: FLOW_HORIZONTAL_PADDING, top: 16 }}
                >
                  {detail.relatedSections.map((section, sIdx) => {
                    const isLike = section.title.includes("喜欢") || section.title.includes("也喜欢")
                    const isRanking =
                      section.title.includes("排行") ||
                      section.title.includes("榜") ||
                      section.title.toLowerCase().includes("ranking")
                    const isCategoryLatest =
                      section.isCategoryLatest ||
                      sIdx === (detail.relatedSections?.length ?? 1) - 1 ||
                      section.title.includes("插画相关") ||
                      section.title.includes("漫画相关")
                    const iconName = isLike
                      ? "heart.fill"
                      : isRanking
                        ? "trophy.fill"
                        : "sparkles.rectangle.stack.fill"
                    const iconColor = isLike
                      ? "#FF453A"
                      : isRanking
                        ? "#FF9500"
                        : "#0096FA"

                    return (
                      <VStack
                        key={`${section.title}-${sIdx}`}
                        alignment="leading"
                        spacing={10}
                        frame={{ maxWidth: "infinity", alignment: "leading" }}
                      >
                        <HStack
                          spacing={6}
                          alignment="center"
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                        >
                          <Image
                            systemName={iconName}
                            font="headline"
                            foregroundStyle={iconColor}
                          />
                          <Text
                            font="headline"
                            fontWeight="bold"
                            multilineTextAlignment="leading"
                          >
                            {section.title}
                          </Text>
                          {section.moreRoute ? (
                            <>
                              <Spacer />
                              <NavigationLink value={section.moreRoute}>
                                <HStack spacing={2} alignment="center">
                                  <Text font="subheadline" foregroundStyle="secondaryLabel">
                                    查看更多
                                  </Text>
                                  <Image
                                    systemName="chevron.right"
                                    font="caption"
                                    foregroundStyle="tertiaryLabel"
                                  />
                                </HStack>
                              </NavigationLink>
                            </>
                          ) : null}
                        </HStack>
                        <LazyVStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
                          {section.articles.map((article) => (
                            <PixivisionCard key={`${section.title}-${article.id}`} article={article} />
                          ))}
                        </LazyVStack>
                      </VStack>
                    )
                  })}
                </VStack>
              ) : null}
            </VStack>
          </ScrollView>
        )
      }}
    </ScrollViewReader>
    </ZStack>
  )
}

function buildArtworkSkeletonIllust(artwork: PixivisionArtwork): PixivIllustration {
  const thumb = artwork.thumbURL || derivePixivThumbUrl(artwork.imageURL) || artwork.imageURL
  const hasDrafts = Boolean(artwork.draftImages && artwork.draftImages.length > 0)
  const metaPages = hasDrafts
    ? [
        {
          image_urls: {
            square_medium: thumb,
            medium: thumb,
            large: artwork.imageURL,
            original: artwork.imageURL,
          },
        },
        ...artwork.draftImages!.map((d) => {
          const dThumb = d.thumbURL || derivePixivThumbUrl(d.imageURL) || d.imageURL
          return {
            image_urls: {
              square_medium: dThumb,
              medium: dThumb,
              large: d.imageURL,
              original: d.imageURL,
            },
          }
        }),
      ]
    : []

  let artWidth = artwork.width ?? 0
  let artHeight = artwork.height ?? 0
  if (artWidth <= 0 || artHeight <= 0) {
    const cached = cachedFilePath(artwork.imageURL)
    if (cached) {
      try {
        const img = UIImage.fromFile(cached)
        if (img && img.width > 0 && img.height > 0) {
          artWidth = img.width
          artHeight = img.height
        }
      } catch {}
    }
  }

  const illust: PixivIllustration = {
    id: artwork.id,
    title: artwork.title,
    type: "illust",
    image_urls: {
      square_medium: thumb,
      medium: thumb,
      large: artwork.imageURL,
      original: artwork.imageURL,
    },
    caption: artwork.comment ?? "",
    user: {
      id: artwork.authorID ?? 0,
      name: artwork.authorName ?? "",
      account: "",
      profile_image_urls: {
        medium: "",
      },
      is_followed: false,
    },
    tags: [],
    create_date: "",
    page_count: hasDrafts ? 1 + artwork.draftImages!.length : 1,
    width: artWidth,
    height: artHeight,
    x_restrict: 0,
    series: null,
    meta_single_page: {},
    meta_pages: metaPages,
    total_view: 0,
    total_bookmarks: 0,
    is_bookmarked: false,
    is_muted: false,
    total_comments: 0,
    illust_ai_type: 0,
    comment_access_control: 0,
    extra_preview_url: artwork.imageURL,
  }
  cacheIllust(illust)
  return illust
}

function formatPixivisionDate(value: string): string {
  const parts = value.split("-")
  if (parts.length !== 3) return formatDate(value)
  return `${parts[0]}.${parts[1]}.${parts[2]}`
}
