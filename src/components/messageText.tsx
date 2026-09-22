// 文本消息的渲染一族：@提及高亮 / URL 可点 / 搜索命中高亮 / 长文本三档。
//
// **从 App.tsx 整块平移出来（D4-2 收尾，2026-09-08）**，逐字不改行为。原本它们是 App 里的
// 六个闭包，互相调用、共用九个 App 局部量；这里把那九个收敛成一份显式依赖注入，
// 于是这段渲染逻辑第一次可以脱离 App 单独读、单独测。
//
// 对外只出两个（原本也只有这两个被 App 之外用到：MessageList 的 props 与 TextReader 的 renderBody），
// 其余四个 —— msgTextKey / mentionEntriesFor / highlightSearch / renderLinkifiedText —— 是内部实现。
import { Fragment, type ReactNode } from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import { MENTION_ALL_LABEL, segmentMentions, segmentMentionsBySpans } from "../mention";
import { highlightText } from "../searchHighlight";
import { splitTextByURL } from "../messageContent";
import { charCountLabel, textTier } from "../longtext";
import type { ChatMessage } from "../sdk/protocol";
import { t } from "../i18n";

export interface MessageTextDeps {
  /** 群成员在本群的昵称。用于把 mentions 里的 uid 还原成 `@昵称`。 */
  memberNick: (convId: string, uid: string) => string;
  searchOpen: boolean;
  searchQuery: string;
  /** 多选态：长文本不接管点击，让事件冒泡到行去切换勾选（与 iOS `self.selecting` 早返回一致）。 */
  selectMode: boolean;
  expandedTexts: Set<string>;
  setExpandedTexts: (fn: (prev: Set<string>) => Set<string>) => void;
  /** 打开全屏阅读器（原 App 里是 setTextReader(m) + setReaderFontStep(0) 两句）。 */
  onOpenReader: (m: ChatMessage) => void;
  /** 点 @某人 跳资料页（原 App 里是 setTextReader(null) + openPeerDetail(uid) 两句）。 */
  onOpenPeer: (uid: string) => void;
}

export interface MessageTextRenderers {
  renderMentionText: (m: ChatMessage, text: string) => ReactNode;
  renderMessageText: (m: ChatMessage) => ReactNode;
}

export function makeMessageTextRenderers(d: MessageTextDeps): MessageTextRenderers {
  const msgTextKey = (m: ChatMessage): string =>
    `${m.convId}:${m.clientMsgId ? `c-${m.clientMsgId}` : m.convSeq > 0 ? `seq-${m.convSeq}` : ""}`;

  const toggleTextExpand = (key: string): void => {
    d.setExpandedTexts((prev) => { const nx = new Set(prev); if (nx.has(key)) nx.delete(key); else nx.add(key); return nx; });
  };

  // 被 @ 者条目（气泡内 @昵称 高亮 + 点击跳资料）：mentions 是服务端过滤后的 uid，回本地群成员表取昵称；
  // mention_all 追加「所有人」（uid 空＝仅高亮不可点）。单聊无 mentions，返回空。
  // 无昵称成员：发送侧回填的 token 就是 `@<uid>`（displayName = nickname || user_id），
  // 故这里同样回退 uid 才能匹配上——否则 `@1002` 这类既不高亮也点不动（修复用户反馈）。
  const mentionEntriesFor = (m: ChatMessage): { name: string; uid: string }[] => {
    const out: { name: string; uid: string }[] = [];
    if (m.mentionAll) out.push({ name: MENTION_ALL_LABEL, uid: "" });
    for (const uid of m.mentions ?? []) {
      out.push({ name: d.memberNick(m.convId, uid) || uid, uid });
    }
    return out;
  };

  // 命中词高亮 highlightText 在 ../searchHighlight（纯函数，与首页聊天记录摘要共用）。
  const highlightSearch = (text: string, keyBase: string): ReactNode =>
    d.searchOpen ? highlightText(text, d.searchQuery, keyBase) : text;

  // 一段"非提及"文本里的 URL 切成蓝色下划线可点 <a>；无 URL 直接走搜索高亮（原行为）。
  // 搜索态命中词高亮**不进入** URL 子串（避免 <a> 里嵌 <mark> 的选中/复制怪异）——搜索是临时态，可接受。
  const renderLinkifiedText = (text: string, keyBase: string): ReactNode => {
    const parts = splitTextByURL(text);
    if (parts.length === 1 && parts[0].kind === "t") return highlightSearch(text, keyBase);
    return parts.map((p, i) => p.kind === "u"
      ? <a key={`${keyBase}-u${i}`} href={p.text} target="_blank" rel="noopener noreferrer"
           className="msg-link" onClick={(e) => e.stopPropagation()}>{p.text}</a>
      : <Fragment key={`${keyBase}-t${i}`}>{highlightSearch(p.text, `${keyBase}-h${i}`)}</Fragment>);
  };

  // 把一段文本渲染为高亮 @提及的节点：命中的 `@昵称` token 上色；有 uid 且非多选态时可点 → 跳该成员资料页。
  // @所有人 无 uid 只高亮不可点。无提及时叠加会话内搜索命中词高亮 + URL 高亮（http(s) → 蓝色下划线可点）。
  const renderMentionText = (m: ChatMessage, text: string): ReactNode => {
    const entries = mentionEntriesFor(m);
    // **有片段就走片段**（mention_spans，见 PROTOCOL §4.1）：位置由发送方给出，不查任何成员表——
    // 超级群不下发成员表，老路（拿昵称扫文本）在那里对普通成员必然失效。
    // 片段与本文对不上（编辑过的老消息 / 脏数据）时 segmentMentionsBySpans 会逐段跳过，
    // 全跳完就退化成单段普通文本，因此下面仍保留老路作为兜底。
    const spans = m.mentionSpans ?? [];
    const bySpan = spans.length > 0 ? segmentMentionsBySpans(text, spans) : null;
    if (bySpan && bySpan.some((s) => s.mention)) {
      return bySpan.map((s, i) => {
        if (!s.mention) return <Fragment key={i}>{renderLinkifiedText(s.text, `sh${i}`)}</Fragment>;
        if (d.selectMode || !s.uid) return <span key={i} className="mention-hl">{s.text}</span>;
        const uid = s.uid;
        return <span key={i} className="mention-hl mention-tap"
                     onClick={(e) => { e.stopPropagation(); d.onOpenPeer(uid); }}>{s.text}</span>;
      });
    }
    if (entries.length === 0) return renderLinkifiedText(text, "sh");
    const uidByName = new Map(entries.map((e) => [e.name, e.uid]));
    return segmentMentions(text, entries.map((e) => e.name)).map((s, i) => {
      if (!s.mention) return <Fragment key={i}>{renderLinkifiedText(s.text, `sh${i}`)}</Fragment>;
      const uid = uidByName.get(s.text.slice(1)); // 去掉 @ 取昵称查 uid
      if (d.selectMode || !uid) return <span key={i} className="mention-hl">{s.text}</span>;
      return <span key={i} className="mention-hl mention-tap"
                   onClick={(e) => { e.stopPropagation(); d.onOpenPeer(uid); }}>{s.text}</span>;
    });
  };

  // 文本消息内容的三档渲染（阈值见 longtext.ts，与 iOS 统一）：
  //   short 全显；long 折叠 8 行 + 就地展开；huge 摘要卡 → 全屏阅读器。均对 @昵称 高亮。
  const renderMessageText = (m: ChatMessage): ReactNode => {
    const tier = textTier(m.content);
    if (tier === "short") return <span className="btext">{renderMentionText(m, m.content)}</span>;
    // 多选态：整行点击=勾选（见 .row onClick）。此时长文本不接管点击——摘要卡不开阅读器、
    // 折叠切换也不吞事件，让点击冒泡到行去切换选中（与 iOS `self.selecting` 早返回一致）。
    if (tier === "huge") {
      return (
        <span className="btext longtext-card" onClick={d.selectMode ? undefined : () => { if (window.getSelection()?.toString()) return; d.onOpenReader(m); }} title={d.selectMode ? undefined : t("chat.text.view_full")}>
          <span className="lt-card-head">
            <span className="lt-card-icon"><FileText size={16} /></span>
            <span className="lt-card-meta">
              <span className="lt-card-title">{t("chat.text.long_title", { count: charCountLabel(m.content) })}</span>
              <span className="lt-card-sub">{t("chat.text.tap_view_full")}</span>
            </span>
          </span>
          {/* 预览只切前 200 字：卡片仅 3 行可见，全文塞进 DOM 会让每次列表重渲染 diff 数十 KB 文本节点（全文留给阅读器）。 */}
          <span className="lt-card-preview">{m.content.slice(0, 200)}</span>
        </span>
      );
    }
    // long：折叠/展开就地切换。
    const key = msgTextKey(m);
    const expanded = d.expandedTexts.has(key);
    return (
      <span className="btext">
        <span className={expanded ? "lt-body" : "lt-body collapsed"}>{renderMentionText(m, m.content)}</span>
        <span className="lt-toggle" onClick={(e) => { if (d.selectMode) return; e.stopPropagation(); toggleTextExpand(key); }}>
          {expanded ? <>{t("chat.text.collapse")} <ChevronUp size={13} /></> : <>{t("chat.text.expand")} <ChevronDown size={13} /></>}
        </span>
      </span>
    );
  };

  return { renderMentionText, renderMessageText };
}
