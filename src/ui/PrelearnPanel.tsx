import { useEffect, useMemo, useState } from 'react';
import type { Deps, DictEnabled } from '../app/deps';
import { setComprehension } from '../app/vocab';
import type { DictEntry, Dictionary } from '../core/dictionary/dictionary';
import { sentenceAround } from '../core/model/context';
import { buildPrelearnPlan } from '../core/model/prelearn';
import type { Document, Token } from '../core/model/token';
import type { Comprehension } from '../core/storage/storage';
import { WordContextCard } from './WordContextCard';

type LookupStatus = 'loading' | 'ok' | 'error';

interface LookupEntry {
  dictionary: Dictionary;
  entry: DictEntry;
}

function isDictionaryEnabled(enabled: DictEnabled, dictionaryId: string): boolean {
  if (dictionaryId === 'wordnet') return enabled.wordnet;
  if (dictionaryId === 'ecdict') return enabled.ecdict;
  return false;
}

function lemmaOf(token: Token): string {
  return token.lemma ?? token.surface.toLowerCase();
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function speak(text: string) {
  if (!canSpeak() || !text.trim()) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function PrelearnPanel({
  deps,
  doc,
  sliderLevel,
  dictEnabled,
  knownLemmas,
  unknownLemmas,
  onVocabChange,
  onClose,
  onGoSettings,
}: {
  deps: Deps;
  doc: Document;
  sliderLevel: number;
  dictEnabled: DictEnabled;
  knownLemmas: ReadonlySet<string>;
  unknownLemmas: ReadonlySet<string>;
  onVocabChange: () => void;
  onClose: () => void;
  onGoSettings: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [localMarks, setLocalMarks] = useState<Map<string, Comprehension>>(() => new Map());
  const [lookupStatus, setLookupStatus] = useState<LookupStatus>('loading');
  const [lookupEntries, setLookupEntries] = useState<LookupEntry[]>([]);
  const [lookupError, setLookupError] = useState('');

  const effectiveKnown = useMemo(() => {
    const next = new Set(knownLemmas);
    localMarks.forEach((mark, lemma) => {
      if (mark === 'known') next.add(lemma);
      else next.delete(lemma);
    });
    return next;
  }, [knownLemmas, localMarks]);

  const effectiveUnknown = useMemo(() => {
    const next = new Set(unknownLemmas);
    localMarks.forEach((mark, lemma) => {
      if (mark === 'known') next.delete(lemma);
      else next.add(lemma);
    });
    return next;
  }, [localMarks, unknownLemmas]);

  const plan = useMemo(
    () => buildPrelearnPlan(doc, sliderLevel, effectiveKnown, effectiveUnknown),
    [doc, effectiveKnown, effectiveUnknown, sliderLevel],
  );
  const activeWord = plan.words[index] ?? null;
  const activeToken = useMemo(() => {
    if (!activeWord) return null;
    return (
      doc.tokens.find((token) => token.kind === 'word' && lemmaOf(token) === activeWord.lemma) ?? null
    );
  }, [activeWord, doc.tokens]);
  const sentence = activeToken ? sentenceAround(doc, activeToken) : '';
  const enabledDictionaryCount = deps.dictionaries.filter((dictionary) =>
    isDictionaryEnabled(dictEnabled, dictionary.id),
  ).length;

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, plan.words.length - 1)));
  }, [plan.words.length]);

  useEffect(() => {
    if (!activeWord) return;
    let alive = true;
    const enabled = deps.dictionaries.filter((dictionary) =>
      isDictionaryEnabled(dictEnabled, dictionary.id),
    );
    setLookupStatus('loading');
    setLookupEntries([]);
    setLookupError('');

    if (enabled.length === 0) {
      setLookupStatus('ok');
      return () => {
        alive = false;
      };
    }

    (async () => {
      try {
        const entries = await Promise.all(
          enabled.map(async (dictionary) => {
            const entry = await dictionary.lookup(activeWord.surface, activeWord.lemma);
            return entry ? { dictionary, entry } : null;
          }),
        );
        if (!alive) return;
        setLookupEntries(entries.filter((entry): entry is LookupEntry => entry !== null));
        setLookupStatus('ok');
      } catch (e) {
        if (!alive) return;
        setLookupError(e instanceof Error ? e.message : String(e));
        setLookupStatus('error');
      }
    })();

    return () => {
      alive = false;
    };
  }, [activeWord, deps.dictionaries, dictEnabled]);

  const choose = async (mark: Comprehension) => {
    if (!activeWord || !activeToken) return;
    setLocalMarks((current) => new Map(current).set(activeWord.lemma, mark));
    await setComprehension(deps, doc, activeToken, mark, activeWord.bookCount);
    onVocabChange();
    if (mark !== 'known') setIndex((current) => current + 1);
  };

  return (
    <div className="prelearn-backdrop">
      <aside className="prelearn-panel" role="dialog" aria-label="预背本书生词">
        <div className="prelearn-head">
          <div>
            <h2>预背本书生词</h2>
            <p className="muted">
              当前对你约 {percent(plan.current)} → 学完这 {plan.words.length} 词约{' '}
              {percent(plan.words.at(-1)?.cumulativeCoverage ?? plan.current)}
            </p>
          </div>
          <button type="button" className="stats-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {!activeWord || !activeToken ? (
          <div className="empty pad">
            {plan.reachable || plan.current >= plan.target
              ? `已经达到 ${percent(plan.target)} 附近，可以开始读。`
              : '这本书里可用于预背的高价值生词已经看完。'}
          </div>
        ) : (
          <div className="prelearn-card">
            <div className="prelearn-card-head">
              <strong>{activeWord.surface}</strong>
              <span className="popup-band">{activeWord.band == null ? 'OOV' : `${activeWord.band}k`}</span>
              <span className="muted">本书 {activeWord.bookCount} 次</span>
            </div>

            <WordContextCard
              sentence={sentence}
              surface={activeWord.surface}
              onSpeak={canSpeak() ? () => speak(sentence) : undefined}
            />

            <details className="dict-details">
              <summary>展开看词典释义</summary>
              {lookupStatus === 'loading' && <div className="muted">准备词典中…</div>}
              {lookupStatus === 'error' && <div className="error">词典加载失败：{lookupError}</div>}
              {lookupStatus === 'ok' && lookupEntries.length === 0 && (
                <div className="muted">
                  {enabledDictionaryCount === 0 ? (
                    <>
                      未启用离线词典。
                      <button type="button" onClick={onGoSettings}>
                        去设置
                      </button>
                    </>
                  ) : (
                    '未找到离线词典条目。'
                  )}
                </div>
              )}
              {lookupEntries.map(({ dictionary, entry }) => (
                <section key={dictionary.id} className="dict-entry">
                  <div className="dict-head">
                    <span>{dictionary.label}</span>
                    {entry.phonetic && <span className="dict-phonetic">/{entry.phonetic}/</span>}
                  </div>
                  {entry.senses.length > 0 && (
                    <ol className="dict-senses">
                      {entry.senses.slice(0, 5).map((sense, senseIndex) => (
                        <li key={`${sense.pos ?? 'sense'}-${senseIndex}`}>
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
            </details>

            <div className="prelearn-actions">
              <button type="button" onClick={() => void choose('known')}>
                认识
              </button>
              <button type="button" onClick={() => void choose('fuzzy')}>
                还不熟
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
