import {
  Button,
  HStack,
  Image,
  Text,
  VStack,
  useMemo,
  useState,
} from "scripting"
import { LinkedDescription } from "./LinkedDescription"
import { estimateVisualLines, htmlToPlainText } from "./formatUtils"
export function ExpandableIntroduction(props: {
  commentHtml?: string
  rawComment?: string
  caption?: string
  title?: string
  routeDestination: (route: string) => any
}) {
  const { commentHtml, rawComment, caption, title, routeDestination } = props
  const rawHtmlOrText = caption ?? commentHtml ?? rawComment ?? ""
  const [expanded, setExpanded] = useState(false)
  const plainText = useMemo(
    () => htmlToPlainText(rawComment || caption || commentHtml || "").trim(),
    [rawComment, caption, commentHtml]
  )

  const visualLines = useMemo(() => estimateVisualLines(plainText), [plainText])
  const exceedsFiveLines = visualLines > 5

  if (!plainText) return null

  return (
    <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
      {title ? (
        <Text
          font="subheadline"
          fontWeight="semibold"
          foregroundStyle="secondaryLabel"
        >
          {title}
        </Text>
      ) : null}
      <VStack
        alignment="leading"
        spacing={8}
        padding={{ top: 12, horizontal: 12, bottom: exceedsFiveLines ? 10 : 12 }}
        glassEffect={{ type: "rect", cornerRadius: 14 }}
        frame={{ maxWidth: "infinity" }}
        contentShape="rect"
        onTapGesture={
          exceedsFiveLines
            ? () => {
                setExpanded((prev) => !prev)
              }
            : undefined
        }
      >
        <LinkedDescription
          html={rawHtmlOrText}
          routeDestination={routeDestination}
          lineLimit={!expanded && exceedsFiveLines ? 5 : undefined}
        />

        {exceedsFiveLines ? (
          <HStack
            alignment="center"
            spacing={4}
            frame={{ maxWidth: "infinity", alignment: "center" }}
            padding={{ top: 4, bottom: 2 }}
          >
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {expanded ? "点击收起" : "点击展开"}
            </Text>
            <Image
              systemName={expanded ? "chevron.up" : "chevron.down"}
              font="caption2"
              foregroundStyle="secondaryLabel"
            />
          </HStack>
        ) : null}
      </VStack>
    </VStack>
  )
}

