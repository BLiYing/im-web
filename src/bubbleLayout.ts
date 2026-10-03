/** 文本气泡：时间/勾在文字下方、靠右（与 Android BubbleTimeMeta 同版式，2026-10-03）。
 *  仅 text 类型；图/视频/语音/文件/名片/合并转发/通话各自维持原版式。 */
export function bubbleLayoutClass(contentType: string | undefined): string {
  return contentType === "text" ? " text-stack" : "";
}
