// 点词释义浮层（规格 §3 阶段3 + 阶段4 理解度）。
// loading/错误/重试态；无 key 引导设置；i+1 英文释义；理解程度标记。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Document, Token } from '../core/model/token';
import type { LevelScale } from '../core/model/level';
import { sentenceAround } from '../core/model/context';
import { AIError } from '../core/errors';
import type { Comprehension } from '../core/storage/storage';
import type { DictEntry, Dictionary } from '../core/dictionary/dictionary';
import type { Deps, DictEnabled } from '../app/deps';
import { setComprehension } from '../app/vocab';

type DictionaryStatus = 'loading' | 'ok' | 'error';
type AIStatus = 'idle' | 'loading' | 'ok' | 'error';

interface LookupEntry {
  dictionary: Dictionary;
  entry: DictEntry;
}

const MARKS: { mark: Comprehension; label: string }[] = [
  { mark: 'unknown', label: '不认识' },
  { mark: 'fuzzy', label: '模糊' },
  { mark: 'known', label: '认识' },
];

function isDictionaryEnabled(enabled: DictEnabled, dictionaryId: string): boolean {
  if (dictionaryId === 'wordnet') return enabled.wordnet;
  if (dictionaryId === 'ecdict') return enabled.ecdict;
  return false;
}

export function WordPopup({
  deps,
  doc,
  token,
  rect,
  sliderLevel,
  scale,
  dictEnabled,
  occurrence,
  existingComprehension,
  onClose,
  onVocabChange,
  onGoSettings,
}: {
  deps: Deps;
  doc: Document;
  token: Token;
  rect: DOMRect;
  sliderLevel: number;
  scale: LevelScale;
  dictEnabled: DictEnabled;
  occurrence?: { index: number; total: number };
  existingComprehension?: Exclude<Comprehension, 'known'>;
  onClose: () => void;
  onVocabChange: () => void;
  onGoSettings: () => void;
}) {
  const [dictionaryStatus, setDictionaryStatus] = useState<DictionaryStatus>('loading');
  const [dictionaryEntries, setDictionaryEntries] = useState<LookupEntry[]>([]);
  const [dictionaryError, setDictionaryError] = useState('');
  const [aiStatus, setAIStatus] = useState<AIStatus>('idle');
  const [explanation, setExplanation] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [noKey, setNoKey] = useState(false);
  const [mark, setMark] = useState<Comprehension>(existingComprehension ?? 'unknown');
  const abortRef = useRef<AbortController | null>(null);

  const lemma = token.lemma ?? token.surface.toLowerCase();
  const level = scale.fromSlider(sliderLevel);
  const bandLabel = token.band == null ? 'OOV' : `${token.band}k`;
  const enabledDictionaryCount = deps.dictionaries.filter((dictionary) =>
    isDictionaryEnabled(dictEnabled, dictionary.id),
  ).length;
  const reinforcement =
    occurrence
      ? `本书第 ${occurrence.index} / ${occurrence.total} 次出现${
          existingComprehension ? ` · 你上次标为「${existingComprehension === 'fuzzy' ? '模糊' : '不认识'}」` : ''
        }`
      : '';

  useEffect(() => {
    setMark(existingComprehension ?? 'unknown');
  }, [existingComprehension, lemma]);

  useEffect(() => {
    let alive = true;
    const enabled = deps.dictionaries.filter((dictionary) =>
      isDictionaryEnabled(dictEnabled, dictionary.id),
    );
    setDictionaryStatus('loading');
    setDictionaryEntries([]);
    setDictionaryError('');

    if (enabled.length === 0) {
      setDictionaryStatus('ok');
      return () => {
        alive = false;
      };
    }

    (async () => {
      try {
        const entries = await Promise.all(
          enabled.map(async (dictionary) => {
            const entry = await dictionary.lookup(token.surface, lemma);
            return entry ? { dictionary, entry } : null;
          }),
        );
        if (!alive) return;
        setDictionaryEntries(entries.filter((entry): entry is LookupEntry => entry !== null));
        setDictionaryStatus('ok');
      } catch (e) {
        if (!alive) return;
        setDictionaryError(e instanceof Error ? e.message : String(e));
        setDictionaryStatus('error');
      }
    })();

    return () => {
      alive = false;
    };
  }, [deps.dictionaries, dictEnabled, lemma, token.surface]);

  useEffect(() => {
    abortRef.current?.abort();
    setAIStatus('idle');
    setExplanation('');
    setErrMsg('');
    setNoKey(false);
  }, [lemma, sliderLevel, token.id]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const requestExplanation = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setAIStatus('loading');
    setNoKey(false);
    setErrMsg('');

    const started = performance.now();
    try {
      const ai = await deps.makeAIService();
      const result = await ai.explain(
        { word: lemma, level, context: sentenceAround(doc, token) },
        ac.signal,
      );
      setExplanation(result.explanation);
      setAIStatus('ok');
      await deps.logger.log({
        type: 'explain_shown',
        lemma,
        level,
        cacheHit: result.cached,
        latencyMs: Math.round(performance.now() - started),
      });
    } catch (e) {
      if (e instanceof AIError && e.code === 'AI_ABORTED') return;
      if (e instanceof AIError && e.code === 'AI_NO_KEY') {
        setNoKey(true);
      }
      setErrMsg(e instanceof Error ? e.message : String(e));
      setAIStatus('error');
    }
  }, [deps, doc, lemma, level, token]);

  const choose = useCallback(
    async (m: Comprehension) => {
      setMark(m);
      await setComprehension(deps, doc, token, m);
      onVocabChange();
    },
    [deps, doc, onVocabChange, token],
  );

  // 定位：词的下方，水平/垂直夹到视口内
  const top = Math.min(rect.bottom + 8, window.innerHeight - 360);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - 340);

  return (
    <>
      <div className="popup-backdrop" onClick={onClose} />
      <div className="popup" style={{ top, left }} role="dialog" aria-label={`查词 ${token.surface}`}>
        <div className="popup-head">
          <span className="popup-word">{token.surface}</span>
          <span className="popup-band">{bandLabel}</span>
          <button className="popup-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="popup-body">
          {reinforcement && <div className="reinforcement muted">{reinforcement}</div>}
          {dictionaryStatus === 'loading' && <div className="muted">准备词典中…</div>}
          {dictionaryStatus === 'error' && (
            <div className="error">词典加载失败：{dictionaryError}</div>
          )}
          {dictionaryStatus === 'ok' && dictionaryEntries.length === 0 && (
            <div className="muted">
              {enabledDictionaryCount === 0 ? '未启用离线词典。' : '未找到离线词典条目。'}
            </div>
          )}
          {dictionaryEntries.map(({ dictionary, entry }) => (
            <section key={dictionary.id} className="dict-entry">
              <div className="dict-head">
                <span>{dictionary.label}</span>
                {entry.phonetic && <span className="dict-phonetic">/{entry.phonetic}/</span>}
              </div>
              {entry.senses.length > 0 && (
                <ol className="dict-senses">
                  {entry.senses.slice(0, 5).map((sense, index) => (
                    <li key={`${sense.pos ?? 'sense'}-${index}`}>
                      {sense.pos && <span className="dict-pos">{sense.pos}</span>}
                      {sense.gloss}
                    </li>
                  ))}
                </ol>
              )}
              {entry.translations && entry.translations.length > 0 && (
                <ul className="dict-translations">
                  {entry.translations.slice(0, 6).map((translation) => (
                    <li key={translation}>{translation}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <div className="ai-panel">
            <button onClick={requestExplanation} disabled={aiStatus === 'loading'}>
              用更简单的英文解释
            </button>
            {aiStatus === 'loading' && <div className="muted">正在生成…</div>}
            {aiStatus === 'ok' && <p className="explanation">{explanation}</p>}
            {aiStatus === 'error' && (
              <div className="error">
                <p>{noKey ? '尚未配置 API key。' : `解释失败：${errMsg}`}</p>
                {noKey ? (
                  <button onClick={onGoSettings}>去设置</button>
                ) : (
                  <button onClick={requestExplanation}>重试</button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="popup-marks">
          <span className="muted">我对这个词：</span>
          {MARKS.map((m) => (
            <button
              key={m.mark}
              className={mark === m.mark ? 'mark active' : 'mark'}
              onClick={() => choose(m.mark)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
