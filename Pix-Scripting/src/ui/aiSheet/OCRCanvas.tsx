import type { OCRBubble } from "../../api/aiService"

function estimateCharWidth(ch: string, fontSize: number): number {
  return ch.charCodeAt(0) > 255 ? fontSize * 0.98 : fontSize * 0.55
}

function layoutTextLines(
  text: string,
  fontSize: number,
  maxTextWidth: number
): string[] {
  const lines: string[] = []
  let currentLine = ""
  let currentLineWidth = 0

  for (const char of text) {
    if (char === "\n") {
      if (currentLine) lines.push(currentLine)
      currentLine = ""
      currentLineWidth = 0
      continue
    }
    const charW = estimateCharWidth(char, fontSize)
    if (currentLineWidth + charW > maxTextWidth && currentLine.length > 0) {
      lines.push(currentLine)
      currentLine = char
      currentLineWidth = charW
    } else {
      currentLine += char
      currentLineWidth += charW
    }
  }
  if (currentLine) {
    lines.push(currentLine)
  }
  return lines
}

export function drawOCROverlay(
  ctx: any,
  size: { width: number; height: number },
  filePath: string,
  bubbles: OCRBubble[],
  showOverlay: boolean,
  hiddenIndices?: Set<number>
) {
  // 1. 绘制底层原始漫画/插画
  try {
    ctx.drawImage({ filePath }, 0, 0, size.width, size.height)
  } catch (e) {
    // 容错处理
  }

  if (!showOverlay || !bubbles || bubbles.length === 0) {
    return
  }

  // 2. 逐一绘制识别到的气泡遮罩与汉化文字（跳过用户单点隐藏的气泡）
  for (let idx = 0; idx < bubbles.length; idx++) {
    if (hiddenIndices && hiddenIndices.has(idx)) {
      continue
    }

    const bubble = bubbles[idx]
    const { box_2d, translation, shape: rawShape } = bubble
    if (!box_2d || box_2d.length !== 4 || !translation || !translation.trim()) continue

    const [ymin, xmin, ymax, xmax] = box_2d
    // 将 0~1000 归一化坐标转换为当前 Canvas 实际像素
    const rawX = (Math.max(0, Math.min(xmin, 1000)) / 1000) * size.width
    const rawY = (Math.max(0, Math.min(ymin, 1000)) / 1000) * size.height
    const rawW = ((Math.max(0, Math.min(xmax, 1000)) - Math.max(0, Math.min(xmin, 1000))) / 1000) * size.width
    const rawH = ((Math.max(0, Math.min(ymax, 1000)) - Math.max(0, Math.min(ymin, 1000))) / 1000) * size.height

    // 边缘轻微内缩 1.5% 防相邻紧邻气泡粘连
    const shrinkX = Math.min(1.5, rawW * 0.015)
    const shrinkY = Math.min(1.5, rawH * 0.015)
    const x = rawX + shrinkX
    const y = rawY + shrinkY
    const w = Math.max(4, rawW - shrinkX * 2)
    const h = Math.max(4, rawH - shrinkY * 2)

    if (w < 6 || h < 6) continue

    const aspect = w / h
    // 智能判定气泡形状（绝大多数日漫对话气泡为椭圆/大圆角胶囊形）
    const effectiveShape =
      rawShape ||
      (aspect >= 0.35 && aspect <= 2.8 ? "ellipse" : "round_rect")

    ctx.save()

    const isTransparent = effectiveShape === "transparent"

    if (!isTransparent) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.98)"
      ctx.strokeStyle = "rgba(0, 0, 0, 0.28)"
      ctx.lineWidth = 0.85

      if (effectiveShape === "ellipse") {
        const cx = x + w / 2
        const cy = y + h / 2
        const rx = w / 2
        const ry = h / 2
        ctx.beginPath()
        if (ctx.ellipse) {
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        } else {
          const radius = Math.min(rx, ry)
          ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else if (effectiveShape === "round_rect") {
        const radius = Math.min(w / 2, h / 2, Math.max(8, Math.min(w, h) * 0.42))
        ctx.beginPath()
        ctx.moveTo(x + radius, y)
        ctx.lineTo(x + w - radius, y)
        ctx.arcTo(x + w, y, x + w, y + radius, radius)
        ctx.lineTo(x + w, y + h - radius)
        ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
        ctx.lineTo(x + radius, y + h)
        ctx.arcTo(x, y + h, x, y + h - radius, radius)
        ctx.lineTo(x, y + radius)
        ctx.arcTo(x, y, x + radius, y, radius)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else {
        const radius = Math.min(3.5, Math.min(w, h) * 0.08)
        ctx.beginPath()
        ctx.moveTo(x + radius, y)
        ctx.lineTo(x + w - radius, y)
        ctx.arcTo(x + w, y, x + w, y + radius, radius)
        ctx.lineTo(x + w, y + h - radius)
        ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
        ctx.lineTo(x + radius, y + h)
        ctx.arcTo(x, y + h, x, y + h - radius, radius)
        ctx.lineTo(x, y + radius)
        ctx.arcTo(x, y, x + radius, y, radius)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }

      // 将文字裁剪严格锁在真实气泡内部
      ctx.clip()
    }

    // 文字排版安全边界（椭圆需要内缩约 28% 安全余量避免顶角溢出）
    const insetRatio = effectiveShape === "ellipse" ? 0.28 : 0.1
    const maxTextWidth = Math.max(6, w * (1 - insetRatio))
    const maxTextHeight = Math.max(6, h * (1 - insetRatio))

    // 精细化小字号自适应计算（初始范围 6.5~10.5pt）
    const cleanText = translation.trim()
    const charCount = Math.max(1, cleanText.length)
    let fontSize = Math.min(10.5, Math.max(6.5, Math.floor(Math.sqrt((maxTextWidth * maxTextHeight) / (charCount * 1.8)))))
    let lines: string[] = []
    let lineHeight = fontSize * 1.2

    // 优化 H3: 纯 JS 字符估算收敛字号，消除跨语言 bridge 调用风暴
    for (let step = 0; step < 8; step++) {
      lines = layoutTextLines(cleanText, fontSize, maxTextWidth)
      lineHeight = fontSize * 1.2
      const totalTextHeight = lines.length * lineHeight
      if (totalTextHeight <= maxTextHeight || fontSize <= 6.5) {
        break
      }
      fontSize = Math.max(6.5, fontSize - 0.6)
    }

    ctx.font = fontSize
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"

    const totalTextHeight = lines.length * lineHeight
    const startY = y + (h - totalTextHeight) / 2 + lineHeight / 2
    const centerX = x + w / 2

    // 优化 H4: 针对透明悬浮字使用 4 方向微偏移仿描边，确保在任何背景下高对比度清晰可读
    if (isTransparent) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)"
      const strokeOffsets = [
        [-1, -1], [1, -1], [-1, 1], [1, 1],
        [0, -1], [0, 1], [-1, 0], [1, 0]
      ]
      for (const [dx, dy] of strokeOffsets) {
        for (let i = 0; i < lines.length; i++) {
          const lineY = startY + i * lineHeight
          ctx.fillText(lines[i], centerX + dx, lineY + dy, maxTextWidth)
        }
      }
    }

    ctx.fillStyle = "#111111"
    for (let i = 0; i < lines.length; i++) {
      const lineY = startY + i * lineHeight
      ctx.fillText(lines[i], centerX, lineY, maxTextWidth)
    }

    ctx.restore()
  }
}
