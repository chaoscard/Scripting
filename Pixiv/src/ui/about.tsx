import { SCRIPT_VERSION } from "../config"
import { Image, List, Section, Text, VStack } from "scripting"

export function AboutView() {
  return (
    <List navigationTitle="关于" navigationBarTitleDisplayMode="inline">
      <Section>
        <VStack alignment="center" spacing={10} padding={{ vertical: 18 }} frame={{ maxWidth: "infinity" }}>
          <Image
            systemName="paintpalette.fill"
            font="largeTitle"
            foregroundStyle="#0096FA"
          />
          <Text font="headline" fontWeight="semibold">
            Pixiv
          </Text>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            版本 {SCRIPT_VERSION}
          </Text>
        </VStack>
      </Section>
      <Section header={<Text>说明</Text>}>
        <Text font="body">液态玻璃风格 Pixiv 客户端</Text>
      </Section>
    </List>
  )
}
