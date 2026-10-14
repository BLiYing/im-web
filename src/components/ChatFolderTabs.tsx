// 会话列表顶部固定头（搜索框 + 文件夹 Tab 条）与「列表为空」提示（设计 CHAT_FOLDERS_DESIGN §4.1–§4.2）。
// 抽成独立组件而不往 App.tsx 里内联：App.tsx 已顶在体量红线上（check-file-size.sh），且头部状态
// （Tab 右键菜单、当前选中项）都能自持，经 ChatFoldersContext 取数。
//
// Tab 条：首位恒为「全部」，其后是各文件夹；每个 Tab 带未读消息总数角标（蓝=有提醒，灰=只有静音会话有未读）。
// 样式沿用 `.detail-tabs`（选中=主色实心）。右键某个文件夹 Tab → 在该 Tab 正下方弹编辑 / 删除（「全部」不触发）。
// 没有任何文件夹时不画 Tab 条，搜索框与此前完全一致。
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { Conversation } from "../sdk/protocol";
import { folderBadge, type ChatFolder } from "../chatFolders";
import { useChatFoldersCtx } from "../ChatFoldersContext";
import { useAppServices } from "../AppServicesContext";
import { unreadBadgeText } from "../unreadBadge";
import { useT } from "../i18n";
import { AnchoredMenu } from "./AnchoredMenu";

export function ConvListHead({ query, setQuery, conversations, onEditFolder }: {
  query: string;
  setQuery: (q: string) => void;
  conversations: Conversation[];
  /** 右键「编辑」：交给外壳打开聊天文件夹面板并直达该文件夹。 */
  onEditFolder: (folderId: string) => void;
}) {
  const t = useT();
  const folders = useChatFoldersCtx();
  const { setToast, askConfirm } = useAppServices();
  const [menu, setMenu] = useState<{ x: number; y: number; f: ChatFolder } | null>(null);
  const list = folders.snapshot.folders;
  const now = Date.now();
  const tabs: Array<{ folder: ChatFolder | null; label: string }> = [
    { folder: null, label: t("folder.tab.all") },
    ...list.map((f) => ({ folder: f, label: f.name })),
  ];
  // 点空白 / 滚动 / Esc 关闭（与会话、消息右键菜单一致）。不用全屏遮罩：遮罩 z-index 曾高于 .ctx-menu，吞掉了菜单项的点击。
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    // 菜单开着时在别处右键：只关菜单，不再叠出浏览器原生菜单（原全屏遮罩的 preventDefault 行为）。
    const onCtx = (e: MouseEvent) => { e.preventDefault(); close(); };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", onCtx);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", onCtx);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  const stripRef = useRef<HTMLDivElement>(null);
  // Tab 多到放不下时横向滚动：选中项（含左右横滑切换）自动滚进可视区，鼠标滚轮竖向滚动映射为横向。
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>(".folder-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [folders.selectedId, list.length]);
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaX === 0 && e.currentTarget.scrollWidth > e.currentTarget.clientWidth) e.currentTarget.scrollLeft += e.deltaY;
  };
  return (
    <div className="convlist-head">
      {/* 首页全局搜索框（SEARCH_DESIGN §3/§04）：输入即出「会话 / 联系人 / 聊天记录」三分组。 */}
      <div className="home-search">
        <Search size={15} className="home-search-lead" />
        <input className="home-search-input" value={query} placeholder={t("search.global.placeholder")}
          onChange={(e) => setQuery(e.target.value)} />
        {query && <button className="home-search-clear" title={t("common.clear")} onClick={() => setQuery("")}><X size={14} /></button>}
      </div>
      {list.length > 0 && !query.trim() && (
        <div className="folder-tabs" role="tablist" ref={stripRef} onWheel={onWheel}>
          {tabs.map(({ folder, label }) => {
            const id = folder?.id ?? null;
            const b = folderBadge(conversations, folder, now);
            return (
              <button key={id ?? "all"} role="tab" aria-selected={id === folders.selectedId}
                className={`folder-tab${id === folders.selectedId ? " active" : ""}`}
                onClick={() => folders.setSelectedId(id)}
                onContextMenu={folder ? (e) => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, f: folder }); } : undefined}>
                <span className="folder-tab-label">{label}</span>
                {b.count > 0 && <span className={`folder-tab-badge${b.muted ? " muted" : ""}`}>{unreadBadgeText(b.count)}</span>}
              </button>
            );
          })}
        </div>
      )}
      {menu && (
        <AnchoredMenu x={menu.x} y={menu.y} className="ctx-menu">
          <button onClick={() => { const f = menu.f; setMenu(null); onEditFolder(f.id); }}>{t("folder.tab.menu_edit")}</button>
          <button className="danger" onClick={async () => {
            const f = menu.f; setMenu(null);
            if (!(await askConfirm(t("folder.edit.delete_confirm", { name: f.name }), { okText: t("common.delete"), danger: true }))) return;
            try { await folders.remove(f.id); } catch (e) { setToast(e instanceof Error && e.message ? e.message : t("folder.toast.failed")); }
          }}>{t("folder.tab.menu_delete")}</button>
        </AnchoredMenu>
      )}
    </div>
  );
}

/** 列表为空时的提示：「全部」里是「去通讯录找人」，选中某个文件夹但其中没有会话时说明怎么放进来。 */
export function ConvListEmpty({ conversations }: { conversations: Conversation[] }) {
  const t = useT();
  const folders = useChatFoldersCtx();
  if (folders.selectedFolder) {
    const has = conversations.some((c) => folders.selectedFolder!.conv_ids.includes(c.conv_id));
    return has ? null : <div className="folder-list-empty">{t("folder.list.empty")}</div>;
  }
  return conversations.length === 0 ? <div className="empty">{t("conv.list.empty_find_contacts")}</div> : null;
}
