import { Text, VStack, type StyledText } from "scripting"

export default function ProbeStyledAttr() {
  const s1: StyledText = {
    content: [
      "前缀 ",
      {
        content: "变蓝加粗文字",
        foregroundColor: "systemBlue",
        bold: true,
        fontWeight: "bold",
      },
      " 后缀",
    ],
  }

  const s2: StyledText = {
    content: [
      "前缀 ",
      {
        content: "苹方Bold",
        font: { name: "PingFangSC-Semibold", size: 20 },
      },
      " 后缀",
    ],
  }

  const s3: StyledText = {
    content: [
      "前缀 ",
      {
        content: "底色黄色",
        backgroundColor: "systemYellow",
        underlineStyle: "single",
      },
      " 后缀",
    ],
  }

  return (
    <VStack padding={20} spacing={15}>
      <Text styledText={s1} />
      <Text styledText={s2} />
      <Text styledText={s3} />
    </VStack>
  )
}
