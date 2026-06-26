import { useEffect, useMemo, useRef, useState } from 'react';
import type { DictEnabled, Deps } from '../app/deps';
import { SETTINGS_KEYS } from '../app/deps';
import { setComprehension } from '../app/vocab';
import { DEFAULT_XRAY_SETTINGS } from '../core/model/buckets';
import type { LevelScale } from '../core/model/level';
import { detectProperNouns } from '../core/model/proper-nouns';
import type { Document, Token, VocabProfile } from '../core/model/token';
import type { BandWord } from '../core/model/vocab-profile';
import {
  bucketDistribution,
  computeVocabProfile,
  coverageAtLevel,
  typesByBand,
  vocabNeededFor,
} from '../core/model/vocab-profile';
import { WordPopup } from './WordPopup';

type ActiveSlice = { kind: 'bucket'; index: number } | { kind: 'proper' };
type SelectedBand = number | 'all';

interface SliceItem {
  key: string;
  label: string;
  color: string;
  count: number;
  active: ActiveSlice;
}

interface PopupSelection {
  token: Token;
  rect: DOMRect;
}

const PROPER_NOUN_COLOR = '#7f858b';
const BUCKET_BANDS: Record<number, number[]> = {
  0: [1, 2],
  1: [3, 4, 5],
  2: [6, 7, 8, 9],
  3: Array.from({ length: 16 }, (_, index) => index + 10),
  4: [0],
};

function formatCount(count: number): string {
  return count.toLocaleString('zh-CN');
}

function formatPercent(count: number, total: number): string {
  if (total <= 0) return '0%';
  return `${((count / total) * 100).toFixed(0)}%`;
}

function bandLabel(band: number): string {
  return band === 0 ? 'OOV' : `${band}k`;
}

function sameSlice(left: ActiveSlice, right: ActiveSlice): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'proper') return true;
  return right.kind === 'bucket' && left.index === right.index;
}

function bandsForSlice(slice: ActiveSlice): number[] {
  return slice.kind === 'proper' ? [] : (BUCKET_BANDS[slice.index] ?? []);
}

function wordsForBands(byBand: Map<number, BandWord[]>, bands: number[]): BandWord[] {
  return bands
    .flatMap((band) => byBand.get(band) ?? [])
    .sort((a, b) => b.count - a.count || a.lemma.localeCompare(b.lemma));
}

function bandRunningCount(profile: VocabProfile, band: number, properNounRunningWords: number): number {
  const count = profile.bandCounts[band] ?? 0;
  if (band !== 0) return count;
  return Math.max(0, count - properNounRunningWords);
}

function Donut({ slices, total }: { slices: SliceItem[]; total: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = slices
    .filter((slice) => slice.count > 0 && total > 0)
    .map((slice) => {
      const length = (slice.count / total) * circumference;
      const segment = { ...slice, length, offset };
      offset += length;
      return segment;
    });

  return (
    <svg className="stats-donut" viewBox="0 0 128 128" aria-hidden="true">
      <circle className="stats-donut-track" cx="64" cy="64" r={radius} />
      {segments.map((segment) => (
        <circle
          key={segment.key}
          cx="64"
          cy="64"
          r={radius}
          stroke={segment.color}
          strokeDasharray={`${segment.length} ${circumference}`}
          strokeDashoffset={-segment.offset}
          transform="rotate(-90 64 64)"
        />
      ))}
    </svg>
  );
}

export function VocabStatsPanel({
  deps,
  doc,
  sliderLevel,
  scale,
  dictEnabled,
  knownLemmas,
  onVocabChange,
  onClose,
  onGoSettings,
}: {
  deps: Deps;
  doc: Document;
  sliderLevel: number;
  scale: LevelScale;
  dictEnabled: DictEnabled;
  knownLemmas: ReadonlySet<string>;
  onVocabChange: () => void | Promise<void>;
  onClose: () => void;
  onGoSettings: () => void;
}) {
  const [semanticRecognition, setSemanticRecognition] = useState(false);
  const [activeSlice, setActiveSlice] = useState<ActiveSlice>({ kind: 'bucket', index: 0 });
  const [selectedBand, setSelectedBand] = useState<SelectedBand>('all');
  const [popup, setPopup] = useState<PopupSelection | null>(null);
  const [busyLemma, setBusyLemma] = useState<string | null>(null);
  const [error, setError] = useState('');
  const semanticTouchedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    deps.storage.getSetting<boolean>(SETTINGS_KEYS.semanticRecognition).then((value) => {
      if (alive && !semanticTouchedRef.current) setSemanticRecognition(value ?? false);
    });
    return () => {
      alive = false;
    };
  }, [deps]);

  useEffect(() => {
    if (!semanticRecognition && activeSlice.kind === 'proper') {
      setActiveSlice({ kind: 'bucket', index: 4 });
    }
  }, [activeSlice.kind, semanticRecognition]);

  useEffect(() => {
    setSelectedBand('all');
  }, [activeSlice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.popup')) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const profile = useMemo(() => doc.meta.vocabProfile ?? computeVocabProfile(doc), [doc]);
  const properNouns = useMemo(() => {
    if (!semanticRecognition) return { lemmas: new Set<string>(), runningWords: 0 };
    return detectProperNouns(doc, deps.lexicon);
  }, [deps.lexicon, doc, semanticRecognition]);
  const excludedRunningWords = semanticRecognition ? properNouns.runningWords : 0;
  const distribution = useMemo(
    () => bucketDistribution(profile, excludedRunningWords),
    [excludedRunningWords, profile],
  );
  const groupedWords = useMemo(
    () => typesByBand(doc, semanticRecognition ? properNouns.lemmas : undefined),
    [doc, properNouns.lemmas, semanticRecognition],
  );
  const slices = useMemo(() => {
    const base = DEFAULT_XRAY_SETTINGS.buckets.map<SliceItem>((bucket, index) => ({
      key: bucket.label,
      label: bucket.label,
      color: bucket.color,
      count: distribution[index] ?? 0,
      active: { kind: 'bucket', index },
    }));
    if (semanticRecognition) {
      base.push({
        key: 'proper',
        label: '专名',
        color: PROPER_NOUN_COLOR,
        count: properNouns.runningWords,
        active: { kind: 'proper' },
      });
    }
    return base;
  }, [distribution, properNouns.runningWords, semanticRecognition]);

  const coverage = coverageAtLevel(profile, sliderLevel, excludedRunningWords);
  const needed = vocabNeededFor(profile, 0.95, excludedRunningWords);
  const chartTotal = Math.max(0, profile.tokenCount);
  const activeBands = bandsForSlice(activeSlice);
  const activeWords =
    activeSlice.kind === 'proper'
      ? groupedWords.properNouns
      : selectedBand === 'all'
        ? wordsForBands(groupedWords.byBand, activeBands)
        : (groupedWords.byBand.get(selectedBand) ?? []);
  const activeItem = slices.find((slice) => sameSlice(slice.active, activeSlice));
  const subBands =
    activeSlice.kind === 'bucket' && activeBands.length > 1
      ? activeBands.map((band) => ({
          band,
          count: bandRunningCount(profile, band, excludedRunningWords),
        }))
      : [];

  const changeSemanticRecognition = (enabled: boolean) => {
    semanticTouchedRef.current = true;
    setSemanticRecognition(enabled);
    setPopup(null);
    void deps.storage.setSetting(SETTINGS_KEYS.semanticRecognition, enabled);
  };

  const markKnown = async (entry: BandWord) => {
    setBusyLemma(entry.lemma);
    setError('');
    try {
      await setComprehension(deps, doc, entry.token, 'known', entry.count);
      await onVocabChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLemma(null);
    }
  };

  return (
    <div
      className="stats-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="stats-panel">
        <div className="stats-head">
          <div>
            <h2>{doc.title}</h2>
            <p className="muted">
              {formatCount(profile.typeCount)} 类词 · 总 {formatCount(profile.tokenCount)} 词 ·
              你认识约 {(coverage * 100).toFixed(0)}% · 95% 覆盖需{' '}
              {needed === null ? '>25k' : `≈${needed}k`}
            </p>
          </div>
          <div className="stats-actions">
            <label className="stats-toggle">
              <input
                type="checkbox"
                checked={semanticRecognition}
                onChange={(event) => changeSemanticRecognition(event.currentTarget.checked)}
              />
              语义识别
            </label>
            <button type="button" className="stats-close" onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
        </div>

        <div className="stats-summary">
          <Donut slices={slices} total={chartTotal} />
          <div className="stats-legend">
            {slices.map((slice) => (
              <button
                key={slice.key}
                type="button"
                className={sameSlice(slice.active, activeSlice) ? 'active' : ''}
                onClick={() => setActiveSlice(slice.active)}
              >
                <span className="stats-swatch" style={{ background: slice.color }} />
                <span>{slice.label}</span>
                <span className="muted">
                  {formatCount(slice.count)} · {formatPercent(slice.count, chartTotal)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="stats-drill">
          <div className="stats-drill-head">
            <h3>{activeItem?.label ?? '词表'}</h3>
            <span className="muted">{formatCount(activeWords.length)} 类词</span>
          </div>
          {subBands.length > 0 && (
            <div className="stats-subbands">
              <button
                type="button"
                className={selectedBand === 'all' ? 'active' : ''}
                onClick={() => setSelectedBand('all')}
              >
                全部
              </button>
              {subBands.map(({ band, count }) => (
                <button
                  key={band}
                  type="button"
                  className={selectedBand === band ? 'active' : ''}
                  onClick={() => setSelectedBand(band)}
                >
                  {bandLabel(band)} · {formatCount(count)}
                </button>
              ))}
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <div className="stats-word-list">
            {activeWords.length === 0 && <p className="empty">暂无词汇。</p>}
            {activeWords.map((entry) => {
              const known = knownLemmas.has(entry.lemma);
              return (
                <div key={entry.lemma} className={known ? 'stats-word known' : 'stats-word'}>
                  <div>
                    <strong>{entry.surface}</strong>
                    <span className="muted">
                      {entry.lemma !== entry.surface.toLowerCase() ? ` · ${entry.lemma}` : ''} · ×
                      {entry.count}
                    </span>
                  </div>
                  <div className="stats-word-actions">
                    <button
                      type="button"
                      onClick={(event) =>
                        setPopup({ token: entry.token, rect: event.currentTarget.getBoundingClientRect() })
                      }
                    >
                      查词
                    </button>
                    <button
                      type="button"
                      disabled={known || busyLemma === entry.lemma}
                      onClick={() => void markKnown(entry)}
                    >
                      {known ? '已认识' : '标记认识'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {popup && (
        // 刻意嵌在 stats-backdrop 内；配合 .popup 的 z-index，查词浮层保持在统计面板之上。
        <WordPopup
          deps={deps}
          doc={doc}
          token={popup.token}
          rect={popup.rect}
          sliderLevel={sliderLevel}
          scale={scale}
          dictEnabled={dictEnabled}
          onClose={() => setPopup(null)}
          onVocabChange={onVocabChange}
          onGoSettings={() => {
            setPopup(null);
            onClose();
            onGoSettings();
          }}
        />
      )}
    </div>
  );
}
