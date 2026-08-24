import {
  Button,
  FlowLayout,
  Image,
  NavigationLink,
  Text,
  VStack,
  useMemo,
  type StyledText,
} from "scripting"
import {
  decodeDescriptionLink,
  decodeHtmlEntities,
  formatTextWithBreakOpportunities,
  htmlFragmentToPlainText,
  htmlToPlainText,
  presentExternalURL,
  routeForDescriptionLink,
} from "./formatUtils"
import { requestPixivRoute } from "../routeNavigation"
export function LinkedDescription(props: {
  html: string
  routeDestination?: (route: string) => any
  nativePlainText?: boolean
  foregroundStyle?: any
  lineLimit?: number
  font?: any
}) {
  const segments = useMemo(() => descriptionSegments(props.html), [props.html])

  const styledText = useMemo<StyledText>(() => {
    const items: (string | StyledText)[] = []

    for (const segment of segments) {
      const target =
        routeForDescriptionLink(segment.href) ??
        routeForDescriptionLink(segment.label)

      if (target) {
        if (target.startsWith("http")) {
          items.push({
            content: formatTextWithBreakOpportunities(segment.label, true),
            foregroundColor: "#007AFF",
            underlineStyle: "single",
            onTapGesture: () => {
              void presentExternalURL(target)
            },
          })
        } else {
          items.push({
            content: formatTextWithBreakOpportunities(segment.label, true),
            foregroundColor: "#007AFF",
            underlineStyle: "single",
            onTapGesture: () => {
              requestPixivRoute(target)
            },
          })
        }
      } else {
        items.push(formatTextWithBreakOpportunities(segment.label, false))
      }
    }

    return {
      font: props.font ?? "footnote",
      foregroundColor: props.foregroundStyle,
      paragraphStyle: {
        alignment: "left",
        lineBreakMode: "byCharWrapping",
        lineSpacing: 4,
      },
      content: items,
    }
  }, [segments, props.routeDestination, props.foregroundStyle, props.font])

  return (
    <Text
      styledText={styledText}
      textSelection={true}
      allowsTightening={true}
      lineLimit={props.lineLimit}
      multilineTextAlignment="leading"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    />
  )
}


type DescriptionSegment = { label: string; href: string }

function descriptionSegments(html: string): DescriptionSegment[] {
  const prepared = html
    .replace(/\r\n|\r/g, "\n")
    .replace(/<(?:\s*\/?\s*)br(?:\s*\/?\s*|\s+[^>]*)>(?:\r?\n)?/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
    .replace(
      /\n\s*\/\s*(?=[A-Za-z0-9\u4e00-\u9fa5\uac00-\ud7af\u3040-\u30ff])/g,
      "\n"
    )
    // 清除换行后的前导空白（半角空格、制表符、全角空格），确保换行后首个字符严格靠左对齐
    .replace(/\n[ \t\u3000]+/g, "\n")
    .replace(/^[ \t\u3000]+/g, "")
  const segments: DescriptionSegment[] = []
  const anchorPatten = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = anchorPatten.exec(prepared)) != null) {
    appendDescriptionTextSegments(
      segments,
      htmlFragmentToPlainText(prepared.slice(cursor, match.index))
    )
    const href = decodeDescriptionLink(match[2])
    const label = htmlToPlainText(match[3]) || href
    segments.push({ label, href })
    cursor = match.index + match[0].length
  }
  appendDescriptionTextSegments(segments, htmlFragmentToPlainText(prepared.slice(cursor)))
  return segments.filter((segment) => segment.label.length > 0)
}

function appendDescriptionTextSegments(
  segments: DescriptionSegment[],
  text: string
) {
  const lines = text.split(/(\n+)/)
  for (const line of lines) {
    if (!line) continue
    const normalized = line.startsWith("\n") ? line : line.replace(/^[ \t\u3000]+/, "")
    if (!normalized) continue
    appendInlineDescriptionSegments(segments, normalized)
  }
}

function appendInlineDescriptionSegments(
  segments: DescriptionSegment[],
  text: string
) {
  const urlChar = "[a-zA-Z0-9\\-._~:/?#\\[\\]@!$&'()*+,;%=]"
  const patten = new RegExp(
    "(?:https?:\\/\\/|www\\.)" + urlChar + "+|" +
    "(?:https?:\\/\\/)?(?:www\\.)?pixiv\\.net\\/(?:users?|user|artworks|novels?|novel|manga|illusts?|illust)" + urlChar + "*|" +
    "\\/?(?:users?|user|artworks|novels?|novel|manga|illusts?|illust)\\/" + urlChar + "+|" +
    "(?:pixiv\\.net\\/|\\/)?novel\\/show\\.php\\?id=\\d+|" +
    "\\b(?:uid|pid|nid)\\s*[:：#=]?\\s*\\d+\\b|" +
    "pixiv:\\/\\/" + urlChar + "+",
    "gi"
  )
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = patten.exec(text)) != null) {
    appendPlainDescriptionSegment(segments, text.slice(cursor, match.index))
    const raw = match[0]
    const link = raw.replace(/[),.，。！!？?;；）】》」』]+$/, "")
    if (link) segments.push({ label: link, href: link })
    if (raw.length > link.length) {
      appendPlainDescriptionSegment(segments, raw.slice(link.length))
    }
    cursor = match.index + raw.length
  }
  appendPlainDescriptionSegment(segments, text.slice(cursor))
}

function appendPlainDescriptionSegment(segments: DescriptionSegment[], text: string) {
  if (!text) return
  const previous = segments[segments.length - 1]
  if (previous && previous.href === "") {
    previous.label += text
  } else {
    segments.push({ label: text, href: "" })
  }
}
