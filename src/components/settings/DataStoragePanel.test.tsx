// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataStoragePanel } from "./DataStoragePanel";
import { defaultDownloadSettings } from "../../download";

afterEach(cleanup);

const base = { cachedCount: 0, onSave: vi.fn(), onClearCache: vi.fn(), onReset: vi.fn(), onBack: vi.fn() };

describe("DataStoragePanel 档位/开关/重置", () => {
  it("已是出厂默认：重置按钮禁用", () => {
    render(<DataStoragePanel {...base} settings={defaultDownloadSettings()} />);
    expect((screen.getByText("重置自动下载设置").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("非默认（改过视频上限）：重置可点，点击回传 onReset", () => {
    const st = defaultDownloadSettings();
    st.wifi.video.max_bytes = 999; // 偏离默认
    const onReset = vi.fn();
    render(<DataStoragePanel {...base} settings={st} onReset={onReset} />);
    const btn = screen.getByText("重置自动下载设置").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onReset).toHaveBeenCalled();
  });

  it("点档位按钮（低/中/高）经 onSave 落一次设置", () => {
    const onSave = vi.fn();
    render(<DataStoragePanel {...base} settings={defaultDownloadSettings()} onSave={onSave} />);
    fireEvent.click(screen.getByText("低"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toHaveProperty("wifi");
  });

  it("关闭「自动下载」总开关经 onSave 落设置且 enabled=false", () => {
    const onSave = vi.fn();
    const { container } = render(<DataStoragePanel {...base} settings={defaultDownloadSettings()} onSave={onSave} />);
    const autoToggle = container.querySelector('.switch-row input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(autoToggle);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].wifi.enabled).toBe(false);
  });

  it("清除缓存按钮回传 onClearCache", () => {
    const onClearCache = vi.fn();
    render(<DataStoragePanel {...base} settings={defaultDownloadSettings()} onClearCache={onClearCache} />);
    fireEvent.click(screen.getByText("清除缓存"));
    expect(onClearCache).toHaveBeenCalled();
  });
});
