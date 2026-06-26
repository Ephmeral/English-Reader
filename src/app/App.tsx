// 顶层装配（规格 §4 app/）。视图切换 + 会话生命周期 + 事件埋点编排。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Annotation } from '../core/model/annotation';
import type { Document } from '../core/model/token';
import { BandLevelScale, SLIDER_DEFAULT, SLIDER_MAX, SLIDER_MIN } from '../core/model/level';
import { normalizeXraySettings } from '../core/model/buckets';
import type { XraySettings } from '../core/model/buckets';
import {
  inferBehavioralBand,
  type ComprehensionMarkSignal,
  type WordClickSignal,
} from '../core/assessment/behavior-suggestion';
import { calibratedBandFromLog } from '../core/assessment/vocab-size-test';
import {
  createDeps,
  DEFAULT_DICT_ENABLED,
  DEFAULT_READING_PREFS,
  DEFAULT_READING_GOAL,
  DEFAULT_THEME,
  SETTINGS_KEYS,
  normalizeReadingGoal,
  normalizeReadingLog,
  normalizeMeasurementLog,
  normalizeReadingPrefs,
} from './deps';
import type {
  DictEnabled,
  Deps,
  MeasurementLogEntry,
  MeasurementSource,
  ReadingGoal,
  ReadingLogEntry,
  ReadingPrefs,
  Theme,
} from './deps';
import { DepsProvider, useDeps } from './context';
import { upsertVocabOnClick } from './vocab';
import {
  createBookmarkAnnotation,
  createRangeAnnotation,
  listAnnotations,
  removeAnnotation,
  updateAnnotationNote,
} from './annotations';
import { Library } from '../ui/Library';
import { Reader } from '../ui/Reader';
import type { JumpTarget, ResumeState, WordClick } from '../ui/Reader';
import { Toc } from '../ui/Toc';
import { AnnotationsPanel } from '../ui/Annotations';
import { WordPopup } from '../ui/WordPopup';
import { VocabStatsPanel } from '../ui/VocabStatsPanel';
import { PrelearnPanel } from '../ui/PrelearnPanel';
import { VocabList } from '../ui/VocabList';
import { Settings } from '../ui/Settings';
import { Slider } from '../ui/Slider';
import { VocabSizeTest } from '../ui/VocabSizeTest';
import type { Comprehension, VocabEntry } from '../core/storage/storage';

type View = 'library' | 'reader' | 'vocab' | 'assessment' | 'settings';

const scale = new BandLevelScale();
const resumeKey = (docId: string) => `resume:${docId}`;
const READING_LOG_DAYS = 90;
const MIN_WORDS_FOR_DIFFICULTY_HINT = 200;
const LOOKUP_DENSITY_THRESHOLD = 5;

function clampChapter(doc: Document, index: number): number {
  const count = Math.max(1, doc.chapters.length);
  return Math.max(0, Math.min(count - 1, Math.round(index)));
}

function lemmaOf(token: { lemma?: string; surface: string }): string {
  return token.lemma ?? token.surface.toLowerCase();
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  return start;
}

function wordPositionForOffset(doc: Document, offset: number): number {
  let count = 0;
  for (const token of doc.tokens) {
    if (token.kind !== 'word') continue;
    if (token.start >= offset) break;
    count += 1;
  }
  return count;
}

function trimReadingLog(log: ReadingLogEntry[]): ReadingLogEntry[] {
  return [...log]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-READING_LOG_DAYS);
}

function normalizeBandValue(value: unknown, fallback = SLIDER_DEFAULT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Math.round(value)));
}

function normalizeMeasuredBand(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return normalizeBandValue(value);
}

function toWordClickSignals(events: Awaited<ReturnType<Deps['storage']['loadEvents']>>): WordClickSignal[] {
  return events
    .filter((event) => event.type === 'word_click')
    .map((event) => ({ band: event.band, at: event.at }));
}

function toComprehensionMarkSignals(
  events: Awaited<ReturnType<Deps['storage']['loadEvents']>>,
): ComprehensionMarkSignal[] {
  return events
    .filter((event) => event.type === 'comprehension_mark')
    .map((event) => ({ lemma: event.lemma, mark: event.mark, at: event.at }));
}

function weekDoneDays(log: ReadingLogEntry[], weekStart: Date, dailyWords: number): number {
  const byDate = new Map(log.map((entry) => [entry.date, entry.words]));
  let done = 0;
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    if ((byDate.get(localDateKey(date)) ?? 0) >= dailyWords) done += 1;
  }
  return done;
}

function streakWeeks(log: ReadingLogEntry[], goal: ReadingGoal): number {
  const currentWeekStart = startOfLocalWeek(new Date());
  const cursor = new Date(currentWeekStart);
  if (weekDoneDays(log, cursor, goal.dailyWords) < goal.daysPerWeek) {
    cursor.setDate(cursor.getDate() - 7);
  }

  let streak = 0;
  while (weekDoneDays(log, cursor, goal.dailyWords) >= goal.daysPerWeek) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}

function tokenForOffset(doc: Document, offset: number) {
  return (
    doc.tokens.find((t) => t.start <= offset && t.end >= offset) ??
    doc.tokens.find((t) => t.start >= offset) ??
    doc.tokens[0]
  );
}

function chapterForOffset(doc: Document, offset: number): number {
  const token = tokenForOffset(doc, offset);
  if (!token) return 0;
  let chapter = 0;
  for (let i = 0; i < doc.chapters.length; i += 1) {
    const mark = doc.chapters[i];
    if (mark && mark.startTokenId <= token.id) chapter = i;
    else break;
  }
  return chapter;
}

function chapterStartOffset(doc: Document, index: number): number {
  const chapter = doc.chapters[clampChapter(doc, index)];
  const token = chapter ? doc.tokens[chapter.startTokenId] : doc.tokens[0];
  return token?.start ?? 0;
}

function normalizeResumeState(doc: Document, value: unknown): ResumeState {
  if (value && typeof value === 'object') {
    const raw = value as { offset?: unknown; chapterIndex?: unknown };
    if (typeof raw.offset === 'number' && Number.isFinite(raw.offset)) {
      return { offset: raw.offset };
    }
    if (typeof raw.chapterIndex === 'number' && Number.isFinite(raw.chapterIndex)) {
      return { offset: chapterStartOffset(doc, raw.chapterIndex) };
    }
  }
  return { offset: chapterStartOffset(doc, 0) };
}

function Shell() {
  const deps = useDeps();
  const [view, setView] = useState<View>('library');
  const [doc, setDoc] = useState<Document | null>(null);
  const [measuredBand, setMeasuredBand] = useState<number | null>(null);
  const [highlightBand, setHighlightBand] = useState(SLIDER_DEFAULT);
  const [dictEnabled, setDictEnabled] = useState<DictEnabled>(DEFAULT_DICT_ENABLED);
  const [xray, setXray] = useState<XraySettings>(() => normalizeXraySettings());
  const [readingPrefs, setReadingPrefs] = useState<ReadingPrefs>(DEFAULT_READING_PREFS);
  const [readingGoal, setReadingGoal] = useState<ReadingGoal>(DEFAULT_READING_GOAL);
  const [readingLog, setReadingLog] = useState<ReadingLogEntry[]>([]);
  const [measurementLog, setMeasurementLog] = useState<MeasurementLogEntry[]>([]);
  const [wordClickSignals, setWordClickSignals] = useState<WordClickSignal[]>([]);
  const [comprehensionMarkSignals, setComprehensionMarkSignals] = useState<
    ComprehensionMarkSignal[]
  >([]);
  const [readWordsByDoc, setReadWordsByDoc] = useState<Map<string, number>>(() => new Map());
  const [wordClicksByDoc, setWordClicksByDoc] = useState<Map<string, number>>(() => new Map());
  const [ignoredDifficultyDocs, setIgnoredDifficultyDocs] = useState<Set<string>>(() => new Set());
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [focusMode, setFocusMode] = useState(false);
  const [sel, setSel] = useState<WordClick | null>(null);
  const [selectedPriorComprehension, setSelectedPriorComprehension] = useState<
    Comprehension | undefined
  >(undefined);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [resumeOffset, setResumeOffset] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [vocabEntries, setVocabEntries] = useState<VocabEntry[]>([]);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [prelearnOpen, setPrelearnOpen] = useState(false);
  const maxWordPosByDocRef = useRef<Map<string, number>>(new Map());
  const learnerBand = measuredBand ?? highlightBand;

  const knownLemmas = useMemo(() => {
    return new Set(
      vocabEntries.filter((entry) => entry.comprehension === 'known').map((entry) => entry.lemma),
    );
  }, [vocabEntries]);

  const unknownLemmas = useMemo(() => {
    return new Set(
      vocabEntries
        .filter((entry) => entry.comprehension === 'unknown' || entry.comprehension === 'fuzzy')
        .map((entry) => entry.lemma),
    );
  }, [vocabEntries]);

  const occurrences = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!doc) return map;
    for (const token of doc.tokens) {
      if (token.kind !== 'word') continue;
      const lemma = lemmaOf(token);
      const ids = map.get(lemma);
      if (ids) ids.push(token.id);
      else map.set(lemma, [token.id]);
    }
    return map;
  }, [doc]);

  const selectedLemma = sel ? lemmaOf(sel.token) : null;
  const selectedOccurrence = sel && selectedLemma ? occurrences.get(selectedLemma) : undefined;
  const popupOccurrence =
    sel && selectedOccurrence
      ? {
          index: Math.max(1, selectedOccurrence.indexOf(sel.token.id) + 1),
          total: selectedOccurrence.length,
        }
      : undefined;
  const behavioralSuggestion = useMemo(
    () =>
      inferBehavioralBand({
        measuredBand,
        wordClicks: wordClickSignals,
        comprehensionMarks: comprehensionMarkSignals,
        vocabEntries: vocabEntries.map((entry) => ({ lemma: entry.lemma, band: entry.band })),
      }),
    [comprehensionMarkSignals, measuredBand, vocabEntries, wordClickSignals],
  );
  const todayKey = localDateKey();
  const todayWords = readingLog.find((entry) => entry.date === todayKey)?.words ?? 0;
  const currentWeekStart = startOfLocalWeek(new Date());
  const readingRhythm = {
    todayWords,
    dailyWords: readingGoal.dailyWords,
    weekDone: Math.min(
      readingGoal.daysPerWeek,
      weekDoneDays(readingLog, currentWeekStart, readingGoal.dailyWords),
    ),
    daysPerWeek: readingGoal.daysPerWeek,
    streakWeeks: streakWeeks(readingLog, readingGoal),
  };
  const currentReadWords = doc ? (readWordsByDoc.get(doc.id) ?? 0) : 0;
  const currentWordClicks = doc ? (wordClicksByDoc.get(doc.id) ?? 0) : 0;
  const lookupDensity =
    currentReadWords > 0 ? (currentWordClicks / currentReadWords) * 100 : 0;
  const difficultyHint =
    doc &&
    currentReadWords >= MIN_WORDS_FOR_DIFFICULTY_HINT &&
    lookupDensity > LOOKUP_DENSITY_THRESHOLD &&
    !ignoredDifficultyDocs.has(doc.id)
      ? { density: lookupDensity }
      : null;

  // 会话生命周期
  useEffect(() => {
    void deps.logger.log({ type: 'session_start' });
    void (async () => {
      const [measured, highlight, legacySlider, measurements] = await Promise.all([
        deps.storage.getSetting<number | null>(SETTINGS_KEYS.measuredBand),
        deps.storage.getSetting<number>(SETTINGS_KEYS.highlightBand),
        deps.storage.getSetting<number>(SETTINGS_KEYS.sliderLevel),
        deps.storage.getSetting<unknown>(SETTINGS_KEYS.measurementLog),
      ]);
      const nextMeasurements = normalizeMeasurementLog(measurements);
      const calibratedBand = calibratedBandFromLog(nextMeasurements);
      const nextMeasured = normalizeMeasuredBand(measured) ?? calibratedBand;
      const nextHighlight =
        typeof highlight === 'number' && Number.isFinite(highlight)
          ? normalizeBandValue(highlight)
          : typeof legacySlider === 'number' && Number.isFinite(legacySlider)
            ? normalizeBandValue(legacySlider)
            : nextMeasured ?? SLIDER_DEFAULT;
      setMeasuredBand(nextMeasured);
      setHighlightBand(nextHighlight);
      setMeasurementLog(nextMeasurements);
      if (measured == null && nextMeasured != null) {
        void deps.storage.setSetting(SETTINGS_KEYS.measuredBand, nextMeasured);
      }
      if (highlight == null) void deps.storage.setSetting(SETTINGS_KEYS.highlightBand, nextHighlight);
    })();
    deps.storage.getSetting<Partial<DictEnabled>>(SETTINGS_KEYS.dictEnabled).then((enabled) => {
      setDictEnabled({ ...DEFAULT_DICT_ENABLED, ...enabled });
    });
    deps.storage.getSetting<Partial<XraySettings>>(SETTINGS_KEYS.xray).then((value) => {
      setXray(normalizeXraySettings(value));
    });
    deps.storage.getSetting<unknown>(SETTINGS_KEYS.readingPrefs).then((value) => {
      setReadingPrefs(normalizeReadingPrefs(value));
    });
    deps.storage.getSetting<unknown>(SETTINGS_KEYS.readingGoal).then((value) => {
      setReadingGoal(normalizeReadingGoal(value));
    });
    deps.storage.getSetting<unknown>(SETTINGS_KEYS.readingLog).then((value) => {
      setReadingLog(trimReadingLog(normalizeReadingLog(value)));
    });
    deps.storage.getSetting<string[]>(SETTINGS_KEYS.difficultyHintsIgnored).then((value) => {
      if (Array.isArray(value)) setIgnoredDifficultyDocs(new Set(value));
    });
    deps.storage.getSetting<Theme>(SETTINGS_KEYS.theme).then((value) => {
      if (value === 'day' || value === 'sepia' || value === 'night') setTheme(value);
    });
    deps.storage.loadVocab().then(setVocabEntries);
    deps.storage.loadEvents({ type: 'word_click' }).then((events) => {
      setWordClickSignals(toWordClickSignals(events));
    });
    deps.storage.loadEvents({ type: 'comprehension_mark' }).then((events) => {
      setComprehensionMarkSignals(toComprehensionMarkSignals(events));
    });
    const onUnload = () => void deps.logger.logSessionEnd();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [deps]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (view !== 'reader') {
      setStatsOpen(false);
      setPrelearnOpen(false);
    }
  }, [view]);

  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.popup')) return;
      setFocusMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusMode]);

  const changeHighlightBand = useCallback(
    (v: number) => {
      const next = normalizeBandValue(v);
      setHighlightBand(next);
      void deps.storage.setSetting(SETTINGS_KEYS.highlightBand, next);
      void deps.storage.setSetting(SETTINGS_KEYS.sliderLevel, next);
    },
    [deps],
  );

  const adoptMeasurement = useCallback(
    (source: MeasurementSource, vocabSize: number, band: number) => {
      const entry: MeasurementLogEntry = {
        at: Date.now(),
        source,
        vocabSize: Math.max(0, Math.round(vocabSize)),
        band: normalizeBandValue(band),
      };
      const nextLog = normalizeMeasurementLog([...measurementLog, entry]);
      const nextMeasured = calibratedBandFromLog(nextLog, entry.at) ?? entry.band;
      setMeasurementLog(nextLog);
      setMeasuredBand(nextMeasured);
      setHighlightBand(nextMeasured);
      void deps.storage.setSetting(SETTINGS_KEYS.measurementLog, nextLog);
      void deps.storage.setSetting(SETTINGS_KEYS.measuredBand, nextMeasured);
      void deps.storage.setSetting(SETTINGS_KEYS.highlightBand, nextMeasured);
      void deps.storage.setSetting(SETTINGS_KEYS.sliderLevel, nextMeasured);
    },
    [deps, measurementLog],
  );

  const applyBehaviorSuggestion = useCallback(() => {
    if (!behavioralSuggestion) return;
    const next = normalizeBandValue(behavioralSuggestion.suggestedBand);
    setMeasuredBand(next);
    void deps.storage.setSetting(SETTINGS_KEYS.measuredBand, next);
  }, [behavioralSuggestion, deps]);

  const changeReadingPrefs = useCallback(
    (next: ReadingPrefs) => {
      const normalized = normalizeReadingPrefs(next);
      setReadingPrefs(normalized);
      void deps.storage.setSetting(SETTINGS_KEYS.readingPrefs, normalized);
    },
    [deps],
  );

  const changeTheme = useCallback(
    (next: Theme) => {
      setTheme(next);
      void deps.storage.setSetting(SETTINGS_KEYS.theme, next);
    },
    [deps],
  );

  const changeXrayEnabled = useCallback(
    (enabled: boolean) => {
      setXray((current) => {
        const next = { ...current, enabled };
        void deps.storage.setSetting(SETTINGS_KEYS.xray, next);
        return next;
      });
    },
    [deps],
  );

  const openDoc = useCallback(
    async (id: string) => {
      const loaded = await deps.storage.loadDocument(id);
      if (!loaded) return;
      const [resume, loadedAnnotations, loadedVocab, wordClicks] = await Promise.all([
        deps.storage.getSetting<unknown>(resumeKey(loaded.id)),
        listAnnotations(deps, loaded.id),
        deps.storage.loadVocab(),
        deps.storage.loadEvents({ type: 'word_click' }),
      ]);
      const normalizedResume = normalizeResumeState(loaded, resume);
      const resumeWordPosition = wordPositionForOffset(loaded, normalizedResume.offset);
      const wordClickCount = wordClicks.filter(
        (event) => event.type === 'word_click' && event.docId === loaded.id,
      ).length;
      maxWordPosByDocRef.current.set(loaded.id, resumeWordPosition);
      flushSync(() => {
        setReadWordsByDoc((current) => new Map(current).set(loaded.id, resumeWordPosition));
        setWordClicksByDoc((current) => new Map(current).set(loaded.id, wordClickCount));
        setChapterIndex(chapterForOffset(loaded, normalizedResume.offset));
        setResumeOffset(normalizedResume.offset);
        setCurrentOffset(normalizedResume.offset);
        setAnnotations(loadedAnnotations);
        setVocabEntries(loadedVocab);
        setJumpTarget({ offset: normalizedResume.offset, nonce: Date.now() });
        setSel(null);
        setStatsOpen(false);
        setPrelearnOpen(false);
        setSelectedPriorComprehension(undefined);
        setDoc(loaded);
        setView('reader');
      });
      await deps.logger.log({
        type: 'doc_open',
        docId: loaded.id,
        tokenCount: loaded.meta.tokenCount,
        wordCount: loaded.meta.wordCount,
        sourceFormat: loaded.meta.sourceFormat,
        sliderLevel: highlightBand,
      });
    },
    [deps, highlightBand],
  );

  const selectChapter = useCallback(
    (index: number) => {
      if (!doc) return;
      const next = clampChapter(doc, index);
      const offset = chapterStartOffset(doc, next);
      setChapterIndex(next);
      setResumeOffset(offset);
      setJumpTarget(null);
      setSel(null);
      setSelectedPriorComprehension(undefined);
      void deps.storage.setSetting<ResumeState>(resumeKey(doc.id), { offset });
    },
    [deps, doc],
  );

  const saveResume = useCallback(
    (state: ResumeState) => {
      if (!doc) return;
      setResumeOffset(state.offset);
      void deps.storage.setSetting<ResumeState>(resumeKey(doc.id), state);
    },
    [deps, doc],
  );

  const reloadAnnotations = useCallback(async () => {
    if (!doc) return;
    setAnnotations(await listAnnotations(deps, doc.id));
  }, [deps, doc]);

  const reloadVocab = useCallback(async () => {
    const [entries, markEvents] = await Promise.all([
      deps.storage.loadVocab(),
      deps.storage.loadEvents({ type: 'comprehension_mark' }),
    ]);
    setVocabEntries(entries);
    setComprehensionMarkSignals(toComprehensionMarkSignals(markEvents));
  }, [deps]);

  const onWordClick = useCallback(
    (c: WordClick) => {
      const lemma = lemmaOf(c.token);
      const prior = vocabEntries.find((entry) => entry.id === lemma)?.comprehension;
      setSelectedPriorComprehension(prior);
      setSel(c);
      if (!doc) return;
      const t = c.token;
      const bookOccurrences = occurrences.get(lemma)?.length;
      void deps.logger.log({
        type: 'word_click',
        docId: doc.id,
        tokenId: t.id,
        surface: t.surface,
        lemma: t.lemma ?? t.surface.toLowerCase(),
        band: t.band ?? null,
        sliderLevel: highlightBand,
      });
      setWordClickSignals((current) => [...current, { band: t.band ?? null, at: Date.now() }]);
      setWordClicksByDoc((current) => {
        const next = new Map(current);
        next.set(doc.id, (next.get(doc.id) ?? 0) + 1);
        return next;
      });
      void upsertVocabOnClick(deps, doc, t, bookOccurrences).then(reloadVocab);
    },
    [deps, doc, highlightBand, occurrences, reloadVocab, vocabEntries],
  );

  const onProgress = useCallback(
    (maxTokenId: number, percent: number) => {
      if (!doc) return;
      void deps.logger.log({ type: 'reading_progress', docId: doc.id, maxTokenId, percent });
    },
    [deps, doc],
  );

  const addReadingWords = useCallback(
    (delta: number) => {
      if (delta <= 0) return;
      setReadingLog((current) => {
        const today = localDateKey();
        const byDate = new Map(current.map((entry) => [entry.date, entry.words]));
        byDate.set(today, (byDate.get(today) ?? 0) + delta);
        const next = trimReadingLog(
          [...byDate.entries()].map(([date, words]) => ({ date, words })),
        );
        void deps.storage.setSetting(SETTINGS_KEYS.readingLog, next);
        return next;
      });
    },
    [deps],
  );

  const onReadingAdvance = useCallback(
    (wordPosition: number) => {
      if (!doc || !Number.isFinite(wordPosition)) return;
      const prev = maxWordPosByDocRef.current.get(doc.id) ?? wordPosition;
      if (wordPosition <= prev) {
        maxWordPosByDocRef.current.set(doc.id, Math.max(prev, wordPosition));
        setReadWordsByDoc((current) => new Map(current).set(doc.id, Math.max(prev, wordPosition)));
        return;
      }
      maxWordPosByDocRef.current.set(doc.id, wordPosition);
      setReadWordsByDoc((current) => new Map(current).set(doc.id, wordPosition));
      addReadingWords(wordPosition - prev);
    },
    [addReadingWords, doc],
  );

  const dismissDifficultyHint = useCallback(() => {
    if (!doc) return;
    setIgnoredDifficultyDocs((current) => {
      const next = new Set(current).add(doc.id);
      void deps.storage.setSetting(SETTINGS_KEYS.difficultyHintsIgnored, [...next]);
      return next;
    });
  }, [deps, doc]);

  const saveRangeAnnotation = useCallback(
    async (range: { start: number; end: number; quote: string; note?: string }) => {
      if (!doc) return;
      await createRangeAnnotation(deps, doc, range);
      await reloadAnnotations();
    },
    [deps, doc, reloadAnnotations],
  );

  const addBookmark = useCallback(async () => {
    if (!doc) return;
    await createBookmarkAnnotation(deps, doc, currentOffset);
    await reloadAnnotations();
  }, [currentOffset, deps, doc, reloadAnnotations]);

  const deleteAnnotation = useCallback(
    async (id: string) => {
      await removeAnnotation(deps, id);
      await reloadAnnotations();
    },
    [deps, reloadAnnotations],
  );

  const saveAnnotationNote = useCallback(
    async (annotation: Annotation, note: string) => {
      await updateAnnotationNote(deps, annotation, note);
      await reloadAnnotations();
    },
    [deps, reloadAnnotations],
  );

  const jumpToOffset = useCallback(
    (offset: number) => {
      if (!doc) return;
      const nextChapter = chapterForOffset(doc, offset);
      setChapterIndex(nextChapter);
      setResumeOffset(offset);
      setJumpTarget({ offset, nonce: Date.now() });
      setSel(null);
      setSelectedPriorComprehension(undefined);
      setView('reader');
      void deps.storage.setSetting<ResumeState>(resumeKey(doc.id), { offset });
    },
    [deps, doc],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setView('library')}>
          📖 i+1 Reader
        </div>
        <nav className="nav">
          <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>
            书架
          </button>
          <button
            className={view === 'reader' ? 'active' : ''}
            onClick={() => setView('reader')}
            disabled={!doc}
          >
            阅读
          </button>
          <button className={view === 'vocab' ? 'active' : ''} onClick={() => setView('vocab')}>
            生词本
          </button>
          <button
            className={view === 'assessment' ? 'active' : ''}
            onClick={() => setView('assessment')}
          >
            测水平
          </button>
          <button
            className={view === 'settings' ? 'active' : ''}
            onClick={() => setView('settings')}
          >
            设置
          </button>
        </nav>
        {(view === 'reader' || view === 'library') && (
          <Slider
            value={highlightBand}
            onChange={changeHighlightBand}
            measuredBand={measuredBand}
            behaviorSuggestion={behavioralSuggestion}
            onApplyBehaviorSuggestion={applyBehaviorSuggestion}
            onOpenAssessment={() => setView('assessment')}
          />
        )}
      </header>

      <main className="content">
        {view === 'library' && (
          <Library deps={deps} sliderLevel={learnerBand} onOpen={openDoc} />
        )}
        {view === 'reader' &&
          (doc ? (
            <div className={focusMode ? 'reader-shell focus' : 'reader-shell'}>
              <aside className="reader-side">
                <Toc doc={doc} currentChapter={chapterIndex} onSelect={selectChapter} />
                <AnnotationsPanel
                  doc={doc}
                  annotations={annotations}
                  currentOffset={currentOffset}
                  onAddBookmark={addBookmark}
                  onJump={jumpToOffset}
                  onDelete={deleteAnnotation}
                  onUpdateNote={saveAnnotationNote}
                />
              </aside>
              <section className="reader-main">
                <button type="button" className="focus-exit" onClick={() => setFocusMode(false)}>
                  退出专注
                </button>
                <div className="reader-title">{doc.title}</div>
                <Reader
                  doc={doc}
                  storage={deps.storage}
                  sliderLevel={highlightBand}
                  scale={scale}
                  chapterIndex={chapterIndex}
                  initialOffset={resumeOffset}
                  annotations={annotations}
                  knownLemmas={knownLemmas}
                  xray={xray}
                  readingPrefs={readingPrefs}
                  theme={theme}
                  jumpTarget={jumpTarget}
                  onChapterChange={selectChapter}
                  onWordClick={onWordClick}
                  onProgress={onProgress}
                  onReadingAdvance={onReadingAdvance}
                  onResumeChange={saveResume}
                  onVisibleOffsetChange={setCurrentOffset}
                  onCreateRangeAnnotation={(range) => void saveRangeAnnotation(range)}
                  onJumpComplete={() => setJumpTarget(null)}
                  onXrayEnabledChange={changeXrayEnabled}
                  onOpenPrelearn={() => {
                    setSel(null);
                    setSelectedPriorComprehension(undefined);
                    setStatsOpen(false);
                    setPrelearnOpen(true);
                  }}
                  onOpenStats={() => {
                    setSel(null);
                    setSelectedPriorComprehension(undefined);
                    setPrelearnOpen(false);
                    setStatsOpen(true);
                  }}
                  onPageTurn={() => {
                    setSel(null);
                    setSelectedPriorComprehension(undefined);
                  }}
                  onReadingPrefsChange={changeReadingPrefs}
                  onThemeChange={changeTheme}
                  onToggleFocus={() => setFocusMode(true)}
                  readingRhythm={readingRhythm}
                  difficultyHint={difficultyHint}
                  onDismissDifficultyHint={dismissDifficultyHint}
                  onLeaveBook={() => {
                    setSel(null);
                    setSelectedPriorComprehension(undefined);
                    setStatsOpen(false);
                    setPrelearnOpen(false);
                    setView('library');
                  }}
                />
              </section>
            </div>
          ) : (
            <div className="empty pad">还没有打开文档。去书架选一本。</div>
          ))}
        {view === 'vocab' && <VocabList deps={deps} />}
        {view === 'assessment' && (
          <VocabSizeTest
            table={deps.lexiconTable}
            measuredBand={measuredBand}
            measurementLog={measurementLog}
            onAdopt={adoptMeasurement}
            onBack={() => setView(doc ? 'reader' : 'library')}
          />
        )}
        {view === 'settings' && (
          <Settings deps={deps} onDictEnabledChange={setDictEnabled} onXrayChange={setXray} />
        )}
      </main>

      {sel && doc && (
        <WordPopup
          deps={deps}
          doc={doc}
          token={sel.token}
          rect={sel.rect}
          sliderLevel={learnerBand}
          scale={scale}
          dictEnabled={dictEnabled}
          occurrence={popupOccurrence}
          existingComprehension={selectedPriorComprehension}
          onClose={() => {
            setSel(null);
            setSelectedPriorComprehension(undefined);
          }}
          onVocabChange={reloadVocab}
          onGoSettings={() => {
            setSel(null);
            setSelectedPriorComprehension(undefined);
            setView('settings');
          }}
        />
      )}
      {statsOpen && doc && view === 'reader' && (
        <VocabStatsPanel
          deps={deps}
          doc={doc}
          sliderLevel={learnerBand}
          scale={scale}
          dictEnabled={dictEnabled}
          knownLemmas={knownLemmas}
          onVocabChange={reloadVocab}
          onClose={() => setStatsOpen(false)}
          onGoSettings={() => setView('settings')}
        />
      )}
      {prelearnOpen && doc && view === 'reader' && (
        <PrelearnPanel
          deps={deps}
          doc={doc}
          sliderLevel={learnerBand}
          dictEnabled={dictEnabled}
          knownLemmas={knownLemmas}
          unknownLemmas={unknownLemmas}
          onVocabChange={reloadVocab}
          onClose={() => setPrelearnOpen(false)}
          onGoSettings={() => setView('settings')}
        />
      )}
    </div>
  );
}

export function App() {
  const deps = useMemo(() => createDeps(), []);
  return (
    <DepsProvider deps={deps}>
      <Shell />
    </DepsProvider>
  );
}
