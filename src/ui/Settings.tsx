// 设置页（规格 §3 阶段3 无 key 引导 + 阶段5 日志导出）。
// OpenAI 兼容配置（baseURL/apiKey/model）、Mock 开关、导出事件 JSON。

import { useEffect, useState } from 'react';
import { DEFAULT_AI_CONFIG } from '../core/ai/openai-transport';
import type { OpenAICompatConfig } from '../core/ai/openai-transport';
import { normalizeXraySettings } from '../core/model/buckets';
import type { XraySettings } from '../core/model/buckets';
import { DEFAULT_DICT_ENABLED, SETTINGS_KEYS } from '../app/deps';
import type { Deps, DictEnabled } from '../app/deps';

export function Settings({
  deps,
  onDictEnabledChange,
  onXrayChange,
}: {
  deps: Deps;
  onDictEnabledChange?: (enabled: DictEnabled) => void;
  onXrayChange?: (settings: XraySettings) => void;
}) {
  const [cfg, setCfg] = useState<OpenAICompatConfig>(DEFAULT_AI_CONFIG);
  const [useMock, setUseMock] = useState(false);
  const [dictEnabled, setDictEnabled] = useState<DictEnabled>(DEFAULT_DICT_ENABLED);
  const [xray, setXray] = useState<XraySettings>(() => normalizeXraySettings());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    deps.storage.getSetting<OpenAICompatConfig>(SETTINGS_KEYS.aiConfig).then((c) => {
      if (c) setCfg({ ...DEFAULT_AI_CONFIG, ...c });
    });
    deps.storage.getSetting<boolean>(SETTINGS_KEYS.aiUseMock).then((m) => setUseMock(m ?? false));
    deps.storage.getSetting<Partial<DictEnabled>>(SETTINGS_KEYS.dictEnabled).then((enabled) => {
      setDictEnabled({ ...DEFAULT_DICT_ENABLED, ...enabled });
    });
    deps.storage.getSetting<Partial<XraySettings>>(SETTINGS_KEYS.xray).then((value) => {
      setXray(normalizeXraySettings(value));
    });
  }, [deps]);

  const save = async () => {
    await deps.storage.setSetting(SETTINGS_KEYS.aiConfig, cfg);
    await deps.storage.setSetting(SETTINGS_KEYS.aiUseMock, useMock);
    await deps.storage.setSetting(SETTINGS_KEYS.dictEnabled, dictEnabled);
    await deps.storage.setSetting(SETTINGS_KEYS.xray, xray);
    onDictEnabledChange?.(dictEnabled);
    onXrayChange?.(xray);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const exportEvents = async () => {
    const events = await deps.storage.exportEvents();
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `web-read-events-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="settings pad">
      <div className="settings-heading">
        <h2>设置</h2>
        {saved && <span className="muted">已保存</span>}
      </div>

      <section>
        <h3>离线词典</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={dictEnabled.wordnet}
            onChange={(e) => setDictEnabled({ ...dictEnabled, wordnet: e.target.checked })}
          />
          WordNet 英英词典
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={dictEnabled.ecdict}
            onChange={(e) => setDictEnabled({ ...dictEnabled, ecdict: e.target.checked })}
          />
          ECDICT 英汉词典
        </label>
        <button onClick={save}>保存</button>
      </section>

      <section>
        <h3>x-ray 频段</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={xray.enabled}
            onChange={(e) => setXray({ ...xray, enabled: e.target.checked })}
          />
          默认开启 x-ray
        </label>
        <div className="bucket-settings">
          {xray.buckets.map((bucket, index) => (
            <div key={bucket.label} className="bucket-row">
              <label className="row">
                <input
                  type="checkbox"
                  checked={bucket.visible}
                  onChange={(e) => {
                    const buckets = xray.buckets.map((item, i) =>
                      i === index ? { ...item, visible: e.target.checked } : item,
                    );
                    setXray({ ...xray, buckets });
                  }}
                />
                {bucket.label}
              </label>
              <input
                type="color"
                value={bucket.color}
                onChange={(e) => {
                  const buckets = xray.buckets.map((item, i) =>
                    i === index ? { ...item, color: e.target.value } : item,
                  );
                  setXray({ ...xray, buckets });
                }}
                aria-label={`${bucket.label} 颜色`}
              />
            </div>
          ))}
        </div>
        <button onClick={save}>保存</button>
      </section>

      <section>
        <h3>AI 释义（OpenAI 兼容）</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={useMock}
            onChange={(e) => setUseMock(e.target.checked)}
          />
          使用 Mock（无需 key，用于本地验证闭环）
        </label>
        <label className="field">
          Base URL
          <input
            type="text"
            value={cfg.baseURL}
            disabled={useMock}
            onChange={(e) => setCfg({ ...cfg, baseURL: e.target.value })}
            placeholder="https://api.deepseek.com"
          />
        </label>
        <label className="field">
          Model
          <input
            type="text"
            value={cfg.model}
            disabled={useMock}
            onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
            placeholder="deepseek-chat"
          />
        </label>
        <label className="field">
          API Key（仅存本地 IndexedDB）
          <input
            type="password"
            value={cfg.apiKey}
            disabled={useMock}
            onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </label>
        <button onClick={save}>保存</button>
      </section>

      <section>
        <h3>数据</h3>
        <button onClick={exportEvents}>导出事件日志（JSON）</button>
        <p className="muted">用于观测先行/滞后信号与缓存命中率（规格 §2）。</p>
      </section>
    </div>
  );
}
