// useFileDrop：把文件从系统拖进聊天列 = 粘贴同一条路（进输入栏上方的预览条，点发送才发）。
//
// **监听挂在 window 上，不挂在某个元素上**，两个理由：
//   ① 拖到聊天列**以外**松手也必须 preventDefault——浏览器的默认行为是「打开这个文件」，
//      网页里等于离开应用；桌面端（Electron）更糟：整个窗口被导航到 file://，应用状态全丢。
//      所以「拦住默认行为」的范围必须是整个窗口，不能只是接收区。
//   ② 聊天列容器 `.chat` 在 App.tsx 里，而 App.tsx 行数已顶到预算（check-file-size.sh）——
//      判「落点在不在聊天列」用 `closest(".chat")` 就够，不必往 App 里再挂 ref 和 handler。
//
// **只管文件拖拽**（dataTransfer.types 含 "Files"）：页面内拖文字 / 链接 / 图片元素不归它管，
// 否则输入框里拖选文字这类原生行为会被一起拦掉。
//
// **为什么落到预览条而不是直接发**：拖拽比点选容易误操作（拖错窗口、手滑松开），发出去就收不回了。
// 走粘贴那条路，也就沿用粘贴「一次只留一个」的规则（2026-08-19 拍板，见 useMediaSend#addPastedFiles）。
import { useEffect, useRef } from "react";

/** 接收区：聊天列。落在它外面的文件拖拽只拦不收。 */
export const DROP_ZONE_SELECTOR = ".chat";

/** ignore = 不是文件拖拽，不碰；block = 拦住默认行为但不收；accept = 收。 */
export type DropDecision = "ignore" | "block" | "accept";

export function dropDecision(o: { hasFiles: boolean; inZone: boolean; enabled: boolean }): DropDecision {
  if (!o.hasFiles) return "ignore";
  return o.inZone && o.enabled ? "accept" : "block";
}

function carriesFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types ?? []).includes("Files");
}

function inDropZone(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(DROP_ZONE_SELECTOR) !== null;
}

export interface FileDropOptions {
  /** 此刻能不能收：有打开的会话、不在多选态、没被禁言。不能收时仍然拦住默认行为。 */
  enabled: boolean;
  onFiles: (files: File[]) => void;
}

export function useFileDrop(opts: FileDropOptions): void {
  // 监听只装一次，回调里读最新的 enabled / onFiles——放进依赖会让它随每次按键重装。
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    const decide = (e: DragEvent): DropDecision => dropDecision({
      hasFiles: carriesFiles(e.dataTransfer), inZone: inDropZone(e.target), enabled: latest.current.enabled,
    });
    // dragenter 也要拦：只拦 dragover 的话，个别浏览器（Safari）仍不把这里当可放置区。
    const onDragOver = (e: DragEvent): void => {
      const d = decide(e);
      if (d === "ignore") return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = d === "accept" ? "copy" : "none";
    };
    const onDrop = (e: DragEvent): void => {
      const d = decide(e);
      if (d === "ignore") return;
      e.preventDefault();
      if (d !== "accept") return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) latest.current.onFiles(files);
    };
    window.addEventListener("dragenter", onDragOver);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragOver);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
}
