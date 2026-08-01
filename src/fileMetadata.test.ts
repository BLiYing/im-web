import { describe, expect, it } from "vitest";
import { formatFileSize } from "./fileMetadata";

describe("formatFileSize", () => {
  it("按 KB/MB/GB 格式化原始字节数", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 ** 2)).toBe("5 MB");
    expect(formatFileSize(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });

  it("没有有效元数据时不展示伪造大小", () => {
    expect(formatFileSize()).toBe("");
    expect(formatFileSize(0)).toBe("0 KB");
  });
});
