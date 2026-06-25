// 顶层装配（规格 §4 app/）。视图切换 + 会话生命周期 + 事件埋点编排。

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Annotation } from '../core/model/annotation';
import type { Document } from '../core/model/token';
import { BandLevelScale, SLIDER_DEFAULT } from '../core/model/level';
import { normalizeXraySettings } from '../core/model/buckets';
import type { XraySettings } from '../core/model/buckets';
import {
  createDeps,
  DEFAULT_DICT_ENABLED,
  DEFAULT_READING_PREFS,
  DEFAULT_THEME,
  SETTINGS_KEYS,
  normalizeReadingPrefs,
} from './deps';
import type { DictEnabled, ReadingPrefs, Theme } from './deps';
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
import { VocabList } from '../ui/VocabList';
import { Settings } from '../ui/Settings';
import { Slider } from '../ui/Slider';
import type { Comprehension, VocabEntry } from '../core/storage/storage';

type View = 'library' | 'reader' | 'vocab' | 'settings';

const scale = new BandLevelScale();
const resumeKey = (docId: string) => `resume:${docId}`;

function clampChapter(doc: Document, index: number): number {
  const count = Math.max(1, doc.chapters.length);
  return Math.max(0, Math.min(count - 1, Math.round(index)));
}

function lemmaOf(token: { lemma?: string; surface: string }): string {
  return token.lemma ?? token.surface.toLowerCase();
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

function Shell() {
  const deps = useDeps();
  const [view, setView] = useState<View>('library');
  const [doc, setDoc] = useState<Document | null>(null);
  const [sliderLevel, setSliderLevel] = useState(SLIDER_DEFAULT);
  const [dictEnabled, setDictEnabled] = useState<DictEnabled>(DEFAULT_DICT_ENABLED);
  const [xray, setXray] = useState<XraySettings>(() => normalizeXraySettings());
  const [readingPrefs, setReadingPrefs] = useState<ReadingPrefs>(DEFAULT_READING_PREFS);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [focusMode, setFocusMode] = useState(false);
  const [sel, setSel] = useState<WordClick | null>(null);
  const [selectedPriorComprehension, setSelectedPriorComprehension] = useState<
    Exclude<Comprehension, 'known'> | undefined
  >(undefined);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [resumeOffset, setResumeOffset] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [vocabEntries, setVocabEntries] = useState<VocabEntry[]>([]);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);

  const knownLemmas = useMemo(() => {
    return new Set(
      vocabEntries.filter((entry) => entry.comprehension === 'known').map((entry) => entry.lemma),
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

  // 会话生命周期
  useEffect(() => {
    void deps.logger.log({ type: 'session_start' });
    deps.storage
      .getSetting<number>(SETTINGS_KEYS.sliderLevel)
      .then((v) => v != null && setSliderLevel(v));
    deps.storage.getSetting<Partial<DictEnabled>>(SETTINGS_KEYS.dictEnabled).then((enabled) => {
      setDictEnabled({ ...DEFAULT_DICT_ENABLED, ...enabled });
    });
    deps.storage.getSetting<Partial<XraySettings>>(SETTINGS_KEYS.xray).then((value) => {
      setXray(normalizeXraySettings(value));
    });
    deps.storage.getSetting<unknown>(SETTINGS_KEYS.readingPrefs).then((value) => {
      setReadingPrefs(normalizeReadingPrefs(value));
    });
    deps.storage.getSetting<Theme>(SETTINGS_KEYS.theme).then((value) => {
      if (value === 'day' || value === 'sepia' || value === 'night') setTheme(value);
    });
    const onUnload = () => void deps.logger.logSessionEnd();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [deps]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusMode]);

  const changeSlider = useCallback(
    (v: number) => {
      setSliderLevel(v);
      void deps.storage.setSetting(SETTINGS_KEYS.sliderLevel, v);
    },
    [deps],
  );

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
      const [resume, loadedAnnotations, loadedVocab] = await Promise.all([
        deps.storage.getSetting<ResumeState>(resumeKey(loaded.id)),
        listAnnotations(deps, loaded.id),
        deps.storage.loadVocab(),
      ]);
      setDoc(loaded);
      setChapterIndex(clampChapter(loaded, resume?.chapterIndex ?? 0));
      setResumeOffset(resume?.scrollOffset ?? 0);
      setCurrentOffset(tokenForOffset(loaded, 0)?.start ?? 0);
      setAnnotations(loadedAnnotations);
      setVocabEntries(loadedVocab);
      setJumpTarget(null);
      setSel(null);
      setSelectedPriorComprehension(undefined);
      setView('reader');
      await deps.logger.log({
        type: 'doc_open',
        docId: loaded.id,
        tokenCount: loaded.meta.tokenCount,
        wordCount: loaded.meta.wordCount,
        sourceFormat: loaded.meta.sourceFormat,
        sliderLevel,
      });
    },
    [deps, sliderLevel],
  );

  const selectChapter = useCallback(
    (index: number) => {
      if (!doc) return;
      const next = clampChapter(doc, index);
      setChapterIndex(next);
      setResumeOffset(0);
      setJumpTarget(null);
      setSel(null);
      setSelectedPriorComprehension(undefined);
      void deps.storage.setSetting<ResumeState>(resumeKey(doc.id), {
        chapterIndex: next,
        scrollOffset: 0,
      });
    },
    [deps, doc],
  );

  const saveResume = useCallback(
    (state: ResumeState) => {
      if (!doc) return;
      void deps.storage.setSetting<ResumeState>(resumeKey(doc.id), state);
    },
    [deps, doc],
  );

  const reloadAnnotations = useCallback(async () => {
    if (!doc) return;
    setAnnotations(await listAnnotations(deps, doc.id));
  }, [deps, doc]);

  const reloadVocab = useCallback(async () => {
    setVocabEntries(await deps.storage.loadVocab());
  }, [deps]);

  const onWordClick = useCallback(
    (c: WordClick) => {
      const lemma = lemmaOf(c.token);
      const prior = vocabEntries.find((entry) => entry.id === lemma)?.comprehension;
      setSelectedPriorComprehension(prior === 'unknown' || prior === 'fuzzy' ? prior : undefined);
      setSel(c);
      if (!doc) return;
      const t = c.token;
      void deps.logger.log({
        type: 'word_click',
        docId: doc.id,
        tokenId: t.id,
        surface: t.surface,
        lemma: t.lemma ?? t.surface.toLowerCase(),
        band: t.band ?? null,
        sliderLevel,
      });
      void upsertVocabOnClick(deps, doc, t).then(reloadVocab);
    },
    [deps, doc, reloadVocab, sliderLevel, vocabEntries],
  );

  const onProgress = useCallback(
    (maxTokenId: number, percent: number) => {
      if (!doc) return;
      void deps.logger.log({ type: 'reading_progress', docId: doc.id, maxTokenId, percent });
    },
    [deps, doc],
  );

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
      setResumeOffset(0);
      setJumpTarget({ offset, nonce: Date.now() });
      setSel(null);
      setSelectedPriorComprehension(undefined);
      setView('reader');
      void deps.storage.setSetting<ResumeState>(resumeKey(doc.id), {
        chapterIndex: nextChapter,
        scrollOffset: 0,
      });
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
            className={view === 'settings' ? 'active' : ''}
            onClick={() => setView('settings')}
          >
            设置
          </button>
        </nav>
        {(view === 'reader' || view === 'library') && (
          <Slider value={sliderLevel} onChange={changeSlider} />
        )}
      </header>

      <main className="content">
        {view === 'library' && (
          <Library deps={deps} sliderLevel={sliderLevel} onOpen={openDoc} />
        )}
        {view === 'reader' &&
          (doc ? (
            <div className={focusMode ? 'reader-shell focus' : 'reader-shell'}>
              <button className="focus-exit" onClick={() => setFocusMode(false)}>
                退出专注
              </button>
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
                <div className="reader-title">{doc.title}</div>
                <Reader
                  doc={doc}
                  storage={deps.storage}
                  sliderLevel={sliderLevel}
                  scale={scale}
                  chapterIndex={chapterIndex}
                  initialScrollOffset={resumeOffset}
                  annotations={annotations}
                  knownLemmas={knownLemmas}
                  xray={xray}
                  readingPrefs={readingPrefs}
                  theme={theme}
                  jumpTarget={jumpTarget}
                  onChapterChange={selectChapter}
                  onWordClick={onWordClick}
                  onProgress={onProgress}
                  onResumeChange={saveResume}
                  onVisibleOffsetChange={setCurrentOffset}
                  onCreateRangeAnnotation={(range) => void saveRangeAnnotation(range)}
                  onJumpComplete={() => setJumpTarget(null)}
                  onXrayEnabledChange={changeXrayEnabled}
                  onReadingPrefsChange={changeReadingPrefs}
                  onThemeChange={changeTheme}
                  onToggleFocus={() => setFocusMode(true)}
                />
              </section>
            </div>
          ) : (
            <div className="empty pad">还没有打开文档。去书架选一本。</div>
          ))}
        {view === 'vocab' && <VocabList deps={deps} />}
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
          sliderLevel={sliderLevel}
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
