import {
  Button,
  FlowLayout,
  Group,
  HStack,
  Image,
  LazyVStack,
  LongPressGesture,
  NavigationStack,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "scripting"
import {
  addBookmark,
  addNovelBookmark,
  bookmarkDetail,
  bookmarkTags,
  followUser,
  novelBookmarkDetail,
  novelBookmarkTags,
  removeBookmark,
  removeNovelBookmark,
} from "../../api/pixiv"
import { session } from "../../api/session"
import { loadSettings } from "../../store/settings"
import { useIllustBookmark, useLatest, useNovelBookmark } from "../hooks"
import { TagChip } from "./TagChip"
import { CachedImage } from "./CachedImage"
import { LoadingView } from "./StatusViews"
import { CORNER_ICON_SIZE } from "./formatUtils"
import type {
  PixivBookmarkDetail,
  PixivBookmarkTag,
  PixivIllustration,
  PixivNovel,
  PixivPage,
} from "../../types"

export function BookmarkDetailSheet(props: {
  item: { id: number; title: string }
  bookmarked: boolean
  loadDetail: (token: string) => Promise<PixivBookmarkDetail>
  loadTags: (restrict: "public" | "private", token: string) => Promise<PixivPage<PixivBookmarkTag>>
  save: (restrict: "public" | "private", tags: string[], token: string) => Promise<void>
  onSaved: () => void
  onClose: () => void
}) {
  const [availableTags, setAvailableTags] = useState<PixivBookmarkTag[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState("")
  const [showCustomTagInput, setShowCustomTagInput] = useState(false)
  const [inputSeq, setInputSeq] = useState(0)
  const [restrict, setRestrict] = useState<"public" | "private">("public")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [interactive, setInteractive] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setInteractive(true)
    }, 400)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadDetail() {
      setCustomTag("")
      setShowCustomTagInput(false)
      const userID = session.userID
      if (!userID) {
        setLoading(false)
        return
      }
      try {
        const [detail, publicTags, privateTags] = await Promise.all([
          session.call(props.loadDetail),
          session.call((token) => props.loadTags("public", token)),
          session.call((token) => props.loadTags("private", token)),
        ])
        if (cancelled) return
        setSelectedTags(
          detail.is_bookmarked
            ? (detail.tags ?? [])
                .filter((tag) => tag.is_registered)
                .map((tag) => tag.name)
            : []
        )
        setRestrict(detail.restrict === "private" ? "private" : "public")
        const merged = new Map<string, PixivBookmarkTag>()
        for (const tag of detail.tags ?? []) {
          merged.set(tag.name, { name: tag.name, count: 0 })
        }
        for (const tag of [...publicTags.items, ...privateTags.items]) {
          if (!merged.has(tag.name)) merged.set(tag.name, tag)
        }
        setAvailableTags(Array.from(merged.values()).slice(0, 40))
      } catch {
        if (!cancelled) setError("收藏信息加载失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [props.item.id])

  function toggleTag(name: string) {
    if (!interactive) return
    setSelectedTags((current) =>
      current.includes(name)
        ? current.filter((tag) => tag !== name)
        : current.length >= 10
          ? current
          : [...current, name]
    )
  }

  function openCustomTagInput() {
    if (!interactive) return
    withAnimation(() => {
      setShowCustomTagInput(true)
      setInputSeq(Date.now())
    })
  }

  function addCustomTag() {
    const name = customTag.trim()
    if (!name || selectedTags.includes(name) || selectedTags.length >= 10) return
    setAvailableTags((current) =>
      current.some((tag) => tag.name === name)
        ? current
        : [{ name, count: 0 }, ...current]
    )
    setSelectedTags((current) => [...current, name])
    setCustomTag("")
    withAnimation(() => {
      setShowCustomTagInput(false)
    })
  }

  function close() {
    setCustomTag("")
    setShowCustomTagInput(false)
    props.onClose()
  }

  async function save() {
    if (saving) return
    void Haptics.transient()
    setSaving(true)
    setError(null)
    try {
      await session.call((token) =>
        props.save(restrict, selectedTags, token)
      )
      props.onSaved()
      close()
    } catch {
      setError("收藏保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }

  return (
    <NavigationStack
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
    >
      <VStack
        alignment="leading"
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        navigationTitle="收藏"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button
              action={close}
            >
              <Image systemName="xmark" />
            </Button>
          ),
          principal: (
            <Text font="headline" fontWeight="semibold">
              收藏
            </Text>
          ),
          topBarTrailing: (
            <Button
              disabled={saving || loading}
              action={() => void save()}
            >
              <Image
                systemName={props.bookmarked ? "heart.fill" : "heart"}
                foregroundStyle={props.bookmarked && !saving ? "#FF375F" : undefined}
              />
            </Button>
          ),
        }}
      >
        {error ? (
          <Text
            font="footnote"
            foregroundStyle="systemRed"
            padding={{ horizontal: 16, top: 4, bottom: 6 }}
          >
            {error}
          </Text>
        ) : null}

        {/* 中间主体内容区 */}
        {loading ? (
          <LoadingView />
        ) : (
          <ScrollView
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            presentationContentInteraction="scrolls"
            safeAreaInset={
              showCustomTagInput
                ? {
                    bottom: {
                      content: (
                        <VStack
                          padding={{ horizontal: 16, top: 6, bottom: 8 }}
                          frame={{ maxWidth: "infinity" }}
                        >
                          <HStack
                            spacing={8}
                            alignment="center"
                            padding={{ horizontal: 14, vertical: 6 }}
                            glassEffect="capsule"
                            glassEffectTransition="materialize"
                            frame={{ maxWidth: "infinity" }}
                          >
                            <Image
                              systemName="tag.fill"
                              font="footnote"
                              foregroundStyle="#0096FA"
                            />
                            <TextField
                              key={`custom-tag-${inputSeq}`}
                              title="自定义标签"
                              prompt="输入自定义标签名称…"
                              value={customTag}
                              onChanged={setCustomTag}
                              onSubmit={addCustomTag}
                              submitLabel="done"
                              textFieldStyle="plain"
                              autofocus={true}
                              frame={{ maxWidth: "infinity" }}
                            />
                            <Button
                              buttonStyle="glassProminent"
                              tint="#0096FA"
                              controlSize="small"
                              disabled={!customTag.trim() || selectedTags.length >= 10}
                              action={addCustomTag}
                            >
                              <Image systemName="plus" font="body" />
                            </Button>
                          </HStack>
                        </VStack>
                      ),
                    },
                  }
                : undefined
            }
          >
            <VStack
              alignment="leading"
              spacing={14}
              padding={{ horizontal: 16, top: 8, bottom: showCustomTagInput ? 12 : 24 }}
              frame={{ maxWidth: "infinity" }}
              onTapGesture={() => {
                if (showCustomTagInput) {
                  setShowCustomTagInput(false)
                  setCustomTag("")
                }
              }}
            >
              {/* 私密收藏设置卡片 */}
              <HStack
                spacing={10}
                alignment="center"
                padding={{ horizontal: 12, vertical: 10 }}
                glassEffect={{ type: "rect", cornerRadius: 14 }}
                frame={{ maxWidth: "infinity" }}
              >
                <Image
                  systemName={restrict === "private" ? "lock.fill" : "lock.open"}
                  font="body"
                  foregroundStyle={restrict === "private" ? "#FF9500" : "secondaryLabel"}
                />
                <VStack alignment="leading" spacing={2}>
                  <Text font="subheadline" fontWeight="medium">
                    私密收藏
                  </Text>
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {restrict === "private" ? "仅自己可见，不公开展示" : "公开展示在个人主页收藏列表"}
                  </Text>
                </VStack>
                <Spacer />
                <Toggle
                  title=""
                  value={restrict === "private"}
                  onChanged={(value) => setRestrict(value ? "private" : "public")}
                />
              </HStack>

              {/* 标签选择区 */}
              <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
                <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Text font="subheadline" fontWeight="semibold">
                    选择标签
                  </Text>
                  <Spacer />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {selectedTags.length} / 10
                  </Text>
                </HStack>

                <FlowLayout spacing={8}>
                  {availableTags.map((tag) => {
                    const selected = selectedTags.includes(tag.name)
                    return (
                      <Button
                        key={tag.name}
                        title={`${selected ? "✓ " : ""}#${tag.name}`}
                        buttonStyle={selected ? "glassProminent" : "glass"}
                        tint={selected ? "#0096FA" : undefined}
                        controlSize="small"
                        action={() => toggleTag(tag.name)}
                      />
                    )
                  })}
                  <Button
                    title="自定义标签"
                    systemImage="plus"
                    buttonStyle="glass"
                    tint="#0096FA"
                    controlSize="small"
                    disabled={selectedTags.length >= 10}
                    action={openCustomTagInput}
                  />
                </FlowLayout>
              </VStack>
            </VStack>
          </ScrollView>
        )}
      </VStack>
    </NavigationStack>
  )
}

export function BookmarkButton(props: {
  bookmarked: boolean
  disabled: boolean
  onTap: () => void
  onLongPress: () => void
  sheetContent?: any
  sheetPresented?: boolean
  onSheetChanged?: (presented: boolean) => void
  size?: number
  hero?: boolean
}) {
  const [longPressLocked, setLongPressLocked] = useState(false)
  const size = props.size ?? (props.hero ? 30 : CORNER_ICON_SIZE)
  const offset = props.hero ? { x: -5, y: -5 } : { x: -4, y: -4 }

  return (
    <ZStack
      frame={{ width: size, height: size }}
      contentShape="rect"
      zIndex={2}
      offset={offset}
      allowsHitTesting={!props.disabled && !longPressLocked}
      sheet={
        props.sheetContent && props.onSheetChanged
          ? {
              content: props.sheetContent,
              isPresented: props.sheetPresented ?? false,
              onChanged: props.onSheetChanged,
            }
          : undefined
      }
    >
      <Button
        action={() => {
          void Haptics.transient()
          props.onTap()
        }}
        buttonStyle="plain"
        frame={{ width: size, height: size }}
        glassEffect="circle"
        contentShape="circle"
        disabled={props.disabled || longPressLocked}
        simultaneousGesture={
          LongPressGesture({ minDuration: 500 }).onEnded(() => {
            setLongPressLocked(true)
            props.onLongPress()
            setTimeout(() => setLongPressLocked(false), 1500)
          })
        }
      >
        <Image
          systemName={props.bookmarked ? "heart.fill" : "heart"}
          font={props.hero ? "title3" : "body"}
          foregroundStyle={props.bookmarked ? "#FF375F" : undefined}
        />
      </Button>
    </ZStack>
  )
}
