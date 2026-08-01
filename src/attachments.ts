export type AttachmentPickMode = "media" | "file";

/** 文件入口永远保持文件语义；媒体入口采用服务端识别出的 image/video 类型。 */
export function attachmentContentType(mode: AttachmentPickMode, uploadedContentType: string): string {
  return mode === "file" ? "file" : uploadedContentType;
}

export function shouldSendAsMediaBatch(mode: AttachmentPickMode): boolean {
  return mode === "media";
}
