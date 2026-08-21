// useProfileEdit：本人资料簇（阶段 8b，CODING_STYLE §7）。myInfo/profileDraft/profileBusy/cropReq 4 state +
// loadMyInfo/openProfile/saveProfile/onPickAvatar（选图→裁切→上传专用端点）。函数体逐字平移；依赖注入 clientRef/setToast。
import { useCallback, useState } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";

export interface ProfileEditDeps { clientRef: MutableRefObject<IMClient | null>; setToast: (msg: string | null) => void; }
export function useProfileEdit(d: ProfileEditDeps) {
  const { clientRef, setToast } = d;
  const [myInfo, setMyInfo] = useState<{ nickname: string; phone: string; avatar_url: string } | null>(null); // 设置页顶部资料展示
  const [profileDraft, setProfileDraft] = useState<{ nickname: string; avatar_url: string; phone: string; tags: string } | null>(null); // 编辑资料弹窗（null=关闭）
  const [profileBusy, setProfileBusy] = useState(false);
  const [cropReq, setCropReq] = useState<{ file: File; onDone: (blob: Blob) => void | Promise<void> } | null>(null);

  // 加载本人资料到 myInfo（左上角头像 / 设置页头部共用同一份数据）。失败静默回退首字母圈。
  const loadMyInfo = useCallback(async () => {
    try {
      const p = await clientRef.current?.fetchMyProfile();
      if (p) setMyInfo({ nickname: p.nickname ?? "", phone: p.phone ?? "", avatar_url: p.avatar_url ?? "" });
    } catch { /* 忽略：头像回退首字母圈 */ }
  }, []);

  // 打开"编辑资料"弹窗：拉本人资料填入草稿（tags 以空格连接成可编辑串）。
  const openProfile = useCallback(async () => {
    try {
      const p = await clientRef.current?.fetchMyProfile();
      // phone 后端是 omitempty：空时 JSON 无该键 → undefined，须兜底为 ""，否则 input 由非受控变受控告警。
      if (p) setProfileDraft({ nickname: p.nickname ?? "", avatar_url: p.avatar_url ?? "", phone: p.phone ?? "", tags: (p.tags ?? []).join(" ") });
    } catch (e) {
      setToast(`加载资料失败：${(e as Error).message}`);
    }
  }, []);

  // 保存资料：tags 按空格/逗号切分去空，PUT 整体替换。
  const saveProfile = useCallback(async () => {
    if (!profileDraft) return;
    setProfileBusy(true);
    try {
      const updated = await clientRef.current?.updateMyProfile({
        nickname: profileDraft.nickname.trim(),
        avatar_url: profileDraft.avatar_url.trim(),
        phone: profileDraft.phone.trim(),
        tags: profileDraft.tags.split(/[\s,]+/).filter(Boolean),
      });
      // 保存后刷新设置页顶部名片（否则头像/昵称仍显旧值）。
      if (updated) setMyInfo({ nickname: updated.nickname ?? "", phone: updated.phone ?? "", avatar_url: updated.avatar_url ?? "" });
      setProfileDraft(null);
    } catch (e) {
      setToast(`保存失败：${(e as Error).message}`);
    } finally {
      setProfileBusy(false);
    }
  }, [profileDraft]);

  // 选本机图片做头像：<input type=file> 浏览器自动用当前系统(Mac/Windows/Linux)的原生文件框，无需检测系统。
  // 个人头像（方案 C）：选图 → 圆形裁切 → 上传专用端点 → 存 /avatars/<hash>.jpg（不再 data URL）。
  const onPickAvatar = useCallback((file: File | undefined) => {
    if (!file) return;
    setCropReq({
      file,
      onDone: async (blob) => {
        try {
          setToast("上传中…");
          const { url } = await clientRef.current!.uploadAvatar(blob);
          setProfileDraft((d) => (d ? { ...d, avatar_url: url } : d));
          setToast("头像已更新");
        } catch (e) {
          setToast(`头像上传失败：${(e as Error).message}`);
        }
      },
    });
  }, []);

  return { myInfo, setMyInfo, profileDraft, setProfileDraft, profileBusy, cropReq, setCropReq, loadMyInfo, openProfile, saveProfile, onPickAvatar };
}
