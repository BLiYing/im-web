import { describe, it, expect } from "vitest";
import * as QRCode from "qrcode";
import { userCardAction, groupCardAction, classifyUnknown, errorCode, describeRaw, decodeAllImageData } from "./qr";
import type { QRUserCard, QRGroupCard } from "./sdk/protocol";

const uc = (relation: QRUserCard["relation"]): QRUserCard => ({
  user_id: "u1", nickname: "小明", avatar_url: "", relation,
});
const gc = (o: Partial<QRGroupCard>): QRGroupCard => ({
  group_id: "g1", name: "群", avatar_url: "", member_count: 3, inviter_nickname: "群主",
  joined: false, joinable: true, reason: "", ...o,
});

describe("userCardAction", () => {
  it("stranger → 加好友", () => expect(userCardAction(uc("stranger")).kind).toBe("add"));
  it("friend → 发消息", () => expect(userCardAction(uc("friend")).kind).toBe("message"));
  it("self → 看自己资料，不出现加好友", () => expect(userCardAction(uc("self")).kind).toBe("self"));
  it("blocked → 不给加好友入口", () => expect(userCardAction(uc("blocked")).kind).toBe("blocked"));
});

describe("groupCardAction", () => {
  it("已在群 → 进入群聊", () => expect(groupCardAction(gc({ joined: true })).kind).toBe("enter"));
  it("可直接加入", () => expect(groupCardAction(gc({ reason: "" })).kind).toBe("join"));
  it("需审批 → 申请加入", () => {
    const a = groupCardAction(gc({ reason: "approval" }));
    expect(a.kind).toBe("apply");
    expect(a.note).toContain("审批");
  });
  it("群满 → 不可加入", () => {
    const a = groupCardAction(gc({ joinable: false, reason: "full" }));
    expect(a.kind).toBe("disabled");
    expect(a.label).toContain("满");
  });
  it("黑名单 → 不可加入", () => expect(groupCardAction(gc({ joinable: false, reason: "banned" })).kind).toBe("disabled"));
});

describe("classifyUnknown", () => {
  it("URL 抽域名", () => {
    const r = classifyUnknown("https://shop.unknown-site.cn/pay?order=88213");
    expect(r.isUrl).toBe(true);
    expect(r.domain).toBe("shop.unknown-site.cn");
  });
  it("纯文本非 URL", () => expect(classifyUnknown("just some text").isUrl).toBe(false));
  it("首尾空白容忍", () => expect(classifyUnknown("  https://a.com/x  ").domain).toBe("a.com"));
});

describe("errorCode", () => {
  it("读 Error.code", () => {
    const e = Object.assign(new Error("x"), { code: 300210 });
    expect(errorCode(e)).toBe(300210);
  });
  it("无 code → 0", () => expect(errorCode(new Error("x"))).toBe(0));
  it("非对象 → 0", () => expect(errorCode("nope")).toBe(0));
});

describe("describeRaw", () => {
  it("名片码 q/u", () => expect(describeRaw("http://h/q/u/abc")).toEqual({ kind: "user", label: "名片码" }));
  it("群码 q/g", () => expect(describeRaw("http://h/q/g/abc")).toEqual({ kind: "group", label: "群二维码" }));
  it("登录码 q/l", () => expect(describeRaw("http://h/q/l/abc")).toEqual({ kind: "login", label: "登录二维码" }));
  it("裸串 q/u 也识别", () => expect(describeRaw("q/u/abc").kind).toBe("user"));
  it("外来 URL → 域名标签", () => {
    const d = describeRaw("https://evil.example.com/pay");
    expect(d.kind).toBe("url");
    expect(d.label).toBe("evil.example.com");
  });
  it("纯文本 → text，超长截断", () => {
    const d = describeRaw("x".repeat(40));
    expect(d.kind).toBe("text");
    expect(d.label.endsWith("…")).toBe(true);
  });
});

// ---- 一图多码解码（用 qrcode 生成真实像素，验证多枚都解出）----

/** 把一段文本渲染成一张正方形二维码的 RGBA 像素（含 quiet zone 白边）。 */
function renderQR(text: string, scale: number, quiet: number): { data: Uint8ClampedArray; size: number } {
  // qrcode 的 create() 返回位矩阵；无第三方 canvas 依赖，Node 里可直接铺像素。
  const qr = (QRCode as unknown as { create(t: string, o: object): { modules: { size: number; data: Uint8Array } } })
    .create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const bits = qr.modules.data;
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255); // 全白（含 alpha）
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!bits[r * n + c]) continue; // 1=黑模块
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = (quiet + c) * scale + dx, y = (quiet + r) * scale + dy;
          const idx = (y * size + x) * 4;
          data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0;
        }
      }
    }
  }
  return { data, size };
}

/** 把若干正方形码水平拼进一张大图（各含自身 quiet zone + gap 白间隔），返回 ImageData 形状。 */
function hstack(tiles: { data: Uint8ClampedArray; size: number }[], gap: number): ImageData {
  const h = Math.max(...tiles.map((t) => t.size));
  const w = tiles.reduce((s, t) => s + t.size, 0) + gap * (tiles.length - 1);
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  let ox = 0;
  for (const t of tiles) {
    for (let y = 0; y < t.size; y++) {
      for (let x = 0; x < t.size; x++) {
        const s = (y * t.size + x) * 4, d = (y * w + (ox + x)) * 4;
        data[d] = t.data[s]; data[d + 1] = t.data[s + 1]; data[d + 2] = t.data[s + 2];
      }
    }
    ox += t.size + gap;
  }
  return { data, width: w, height: h } as unknown as ImageData;
}

describe("decodeAllImageData", () => {
  const A = "http://localhost:8080/q/u/AAA";
  const B = "http://localhost:8080/q/g/BBB";

  // 用假的 BarcodeDetector 顶替浏览器原生实现，验证多码取全 + 去重 + 上限的编排逻辑
  // （真机多码能力靠原生 BarcodeDetector；jsQR 兜底只保单码，多码是其固有局限）。
  function withFakeDetector(values: string[], fn: () => Promise<void>): Promise<void> {
    const g = globalThis as unknown as { BarcodeDetector?: unknown };
    const prev = g.BarcodeDetector;
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(["qr_code"]); }
      detect() { return Promise.resolve(values.map((v) => ({ rawValue: v }))); }
    };
    return fn().finally(() => { g.BarcodeDetector = prev; });
  }

  it("原生检测多码 → 取全并去重", () =>
    withFakeDetector([A, B, A], async () => {
      const blank = { data: new Uint8ClampedArray(16 * 16 * 4).fill(255), width: 16, height: 16 } as unknown as ImageData;
      const got = (await decodeAllImageData(blank)).sort();
      expect(got).toEqual([A, B].sort());
    }));

  it("原生检测尊重 max 上限", () =>
    withFakeDetector([A, B], async () => {
      const blank = { data: new Uint8ClampedArray(16 * 16 * 4).fill(255), width: 16, height: 16 } as unknown as ImageData;
      expect(await decodeAllImageData(blank, 1)).toHaveLength(1);
    }));

  it("无原生检测 → jsQR 兜底解单码", async () => {
    const img = hstack([renderQR(A, 5, 4)], 0);
    expect(await decodeAllImageData(img)).toEqual([A]);
  });

  it("无原生检测 + 无码空白图 → 空数组", async () => {
    const blank = { data: new Uint8ClampedArray(80 * 80 * 4).fill(255), width: 80, height: 80 } as unknown as ImageData;
    expect(await decodeAllImageData(blank)).toEqual([]);
  });
});
