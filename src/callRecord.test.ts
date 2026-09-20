// 通话记录纯函数：读三端共用向量（testing/callRecord.vectors.json，源 IMServer docs/conformance/call_record.json）。
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import vectors from "./testing/callRecord.vectors.json";
import {
  buildCallRecord, callRecordPreview, formatCallDuration, isMissedCall, parseCallRecord, renderCallRecord,
} from "./callRecord";

interface Case {
  name: string;
  content: Record<string, unknown>;
  viewerIsSender: boolean;
  isGroup: boolean;
  senderName?: string;
  expect: { text: string; tone: string; tappable: boolean; preview: string };
}

describe("call_record 共用向量", () => {
  for (const c of (vectors as { cases: Case[] }).cases) {
    it(c.name, () => {
      const v = { viewerIsSender: c.viewerIsSender, isGroup: c.isGroup, senderName: c.senderName };
      const r = renderCallRecord(JSON.stringify(c.content), v);
      expect(r).not.toBeNull();
      expect(r!.text).toBe(c.expect.text);
      expect(r!.tone).toBe(c.expect.tone);
      expect(r!.tappable).toBe(c.expect.tappable);
      expect(r!.preview).toBe(c.expect.preview);
    });
  }

  it("本地副本与源向量一致（源在本机时才比）", () => {
    const src = "IMServer/docs/conformance/call_record.json";
    const abs = new URL(`../../${src}`, import.meta.url);
    if (!existsSync(abs)) return;
    expect(JSON.parse(readFileSync(abs, "utf8"))).toEqual(vectors);
  });
});

describe("parseCallRecord / buildCallRecord", () => {
  it("非法输入 → null，不漏 JSON", () => {
    for (const s of ["", "not json", "[]", '{"m":"audio"}', '{"cid":" ","m":"audio"}', '{"cid":"a","m":"text"}']) {
      expect(parseCallRecord(s)).toBeNull();
      expect(callRecordPreview(s, { viewerIsSender: true, isGroup: false })).toBe("[音视频通话]");
    }
    expect(renderCallRecord("x", { viewerIsSender: true, isGroup: false })).toBeNull();
  });
  it("d 非法/负数按 0，超大截断", () => {
    expect(parseCallRecord('{"cid":"a","m":"audio","r":"hangup","d":-3}')!.durationSec).toBe(0);
    expect(parseCallRecord('{"cid":"a","m":"audio","r":"hangup","d":"9"}')!.durationSec).toBe(0);
    expect(parseCallRecord('{"cid":"a","m":"audio","r":"hangup","d":999999999}')!.durationSec).toBe(86400 * 3);
  });
  it("build：字段齐、群带 g、空 callId → null", () => {
    const s = { callId: "call-1", mediaType: "video" as const, reason: "hangup", durationSec: 201, isGroup: false };
    expect(JSON.parse(buildCallRecord(s)!)).toEqual({ cid: "call-1", m: "video", r: "hangup", d: 201 });
    expect(JSON.parse(buildCallRecord({ ...s, isGroup: true })!).g).toBe(1);
    expect(buildCallRecord({ ...s, callId: "  " })).toBeNull();
    expect(buildCallRecord({ ...s, callId: "x".repeat(65) })).toBeNull();
  });
  it("build 的产物能被 parse 回来", () => {
    const c = buildCallRecord({ callId: "c", mediaType: "audio", reason: "no_answer", durationSec: 0, isGroup: false })!;
    expect(parseCallRecord(c)).toEqual({ callId: "c", media: "audio", reason: "no_answer", durationSec: 0 });
  });
});

describe("时长格式 / 红色判定", () => {
  it("mm:ss 与 h:mm:ss", () => {
    expect(formatCallDuration(7)).toBe("00:07");
    expect(formatCallDuration(201)).toBe("03:21");
    expect(formatCallDuration(3801)).toBe("1:03:21");
  });
  it("只有被叫侧未接才红", () => {
    const c = '{"cid":"a","m":"audio","r":"no_answer","d":0}';
    expect(isMissedCall(c, { viewerIsSender: false, isGroup: false })).toBe(true);
    expect(isMissedCall(c, { viewerIsSender: true, isGroup: false })).toBe(false);
    expect(isMissedCall('{"cid":"a","m":"audio","r":"reject","d":0}', { viewerIsSender: false, isGroup: false })).toBe(false);
  });
});
