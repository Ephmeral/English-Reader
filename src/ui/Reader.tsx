// 阅读器渲染：按章节渲染 Document 词元流，高于滑块水平的词高亮可点。
// 埋 reading_progress；EPUB 图片从 Storage asset 加载。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, WheelEvent } from 'react';
import type { Annotation } from '../core/model/annotation';
import type { Block, Document, Emphasis, Footnote, Token } from '../core/model/token';
import type { LevelScale } from '../core/model/level';
import { bucketOf } from '../core/model/buckets';
import type { XraySettings } from '../core/model/buckets';
import { shouldHighlight } from '../core/model/marking';
import type { Storage } from '../core/storage/storage';
import { DEFAULT_READING_PREFS } from '../app/deps';
import type { ReadingPrefs, Theme } from '../app/deps';
import type { SourceSelection } from './selection';
import { selectionToSourceRange } from './selection';
import { ReadingPanel } from './ReadingPanel';
import {
  createPaginationCursor,
  firstTokenAtOrAfter,
  measurePageChunk,
  measurePageStarts,
  pageRangeForOffset,
  pageStartsWithBoundary,
  tokensForPage,
  type PaginationCursor,
  type PaginationMetrics,
} from './reader/paginate';

const RESIZE_MEASURE_DEBOUNCE_MS = 120;
const LAYOUT_RETRY_MS = 50;
const CHUNKED_PAGINATION_THRESHOLD = 4000;
const INITIAL_CHUNKED_PAGES = 2;
const FALLBACK_PAGE_TOKEN_COUNT = 220;
const IDLE_PAGINATION_BUDGET_MS = 10;
const IDLE_PAGINATION_MAX_PAGES = 1;
const IDLE_PAGINATION_TIMEOUT_MS = 120;

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining: () => number;
}

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function schedulePaginationIdle(callback: (deadline: IdleDeadlineLike) => void): () => void {
  const win = window as WindowWithIdleCallback;
  if (win.requestIdleCallback && win.cancelIdleCallback) {
    const handle = win.requestIdleCallback(callback, { timeout: IDLE_PAGINATION_TIMEOUT_MS });
    return () => win.cancelIdleCallback?.(handle);
  }

  const start = performance.now();
  const handle = window.setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => Math.max(0, IDLE_PAGINATION_BUDGET_MS - (performance.now() - start)),
    });
  }, 0);
  return () => window.clearTimeout(handle);
}

export interface WordClick {
  token: Token;
  rect: DOMRect;
}

export interface ResumeState {
  offset: number;
}

export interface JumpTarget {
  offset: number;
  nonce: number;
}

export interface ReadingRhythm {
  todayWords: number;
  dailyWords: number;
  weekDone: number;
  daysPerWeek: number;
  streakWeeks: number;
}

function intersectsRange(token: Token, annotation: Annotation): boolean {
  if (annotation.anchor.kind !== 'range') return false;
  if (token.end === token.start) return false;
  return token.start < annotation.anchor.end && token.end > annotation.anchor.start;
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

function popupPositionForRect(rect: DOMRect): { top: number; left: number } {
  const fallbackHeight = Math.min(320, window.innerHeight - 24);
  return {
    top: Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - fallbackHeight - 8)),
    left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 340)),
  };
}

interface ActiveFootnote {
  footnote: Footnote;
  position: { top: number; left: number };
}

interface RenderTokensContext {
  annotations: Annotation[];
  emphases: readonly Emphasis[];
  imageUrls: Record<string, string>;
  knownLemmas: ReadonlySet<string>;
  learner: ReturnType<LevelScale['fromSlider']>;
  scale: LevelScale;
  xray: XraySettings;
}

function tokenEmphasisClasses(token: Token, emphases: readonly Emphasis[]): string[] {
  if (token.kind === 'image') return [];
  return emphases
    .filter((emphasis) => token.start < emphasis.end && emphasis.start < token.end)
    .map((emphasis) => (emphasis.style === 'bold' ? 'em-bold' : 'em-italic'));
}

function tokenPresentation(token: Token, ctx: RenderTokensContext) {
  const userHighlighted = ctx.annotations.some((annotation) => intersectsRange(token, annotation));
  const emphasisClasses = tokenEmphasisClasses(token, ctx.emphases);
  if (token.kind === 'punct') {
    return {
      className: ['punct', userHighlighted ? 'user-highlight' : '', ...emphasisClasses]
        .filter(Boolean)
        .join(' '),
      style: undefined,
      title: undefined,
    };
  }
  if (token.kind !== 'word') {
    return {
      className: emphasisClasses.length > 0 ? emphasisClasses.join(' ') : undefined,
      style: undefined,
      title: undefined,
    };
  }

  const marked = !ctx.xray.enabled && shouldHighlight(token, ctx.learner, ctx.scale, ctx.knownLemmas);
  const bucket = ctx.xray.buckets[bucketOf(token.band)];
  const bandLabel = token.band == null ? 'OOV' : `${token.band}k`;
  return {
    className: [
      'word',
      marked ? 'marked' : '',
      userHighlighted ? 'user-highlight' : '',
      ...emphasisClasses,
    ]
      .filter(Boolean)
      .join(' '),
    style: ctx.xray.enabled && bucket?.visible ? { color: bucket.color } : undefined,
    title: `${bandLabel} · 点击查词`,
  };
}

interface TokenBlockRun {
  block: Block;
  tokens: Token[];
}

function fallbackBlock(tokens: readonly Token[]): Block {
  return { startTokenId: tokens[0]?.id ?? 0, role: 'paragraph' };
}

function blockForToken(blocks: readonly Block[], tokenId: number, startIndex: number): number {
  let index = Math.max(0, startIndex);
  while (blocks[index + 1] && blocks[index + 1]!.startTokenId <= tokenId) index += 1;
  return index;
}

function tokenBlockRuns(tokens: readonly Token[], blocks: readonly Block[]): TokenBlockRun[] {
  if (tokens.length === 0) return [];
  if (blocks.length === 0) return [{ block: fallbackBlock(tokens), tokens: [...tokens] }];

  const runs: TokenBlockRun[] = [];
  let blockIndex = blockForToken(blocks, tokens[0]?.id ?? 0, 0);
  for (const token of tokens) {
    blockIndex = blockForToken(blocks, token.id, blockIndex);
    const block = blocks[blockIndex] ?? fallbackBlock(tokens);
    const last = runs.at(-1);
    if (last?.block.startTokenId === block.startTokenId) {
      last.tokens.push(token);
    } else {
      runs.push({ block, tokens: [token] });
    }
  }
  return runs;
}

function blockTag(block: Block): keyof JSX.IntrinsicElements {
  if (block.role === 'blockquote') return 'blockquote';
  if (block.role === 'list-item') return 'li';
  if (block.role === 'heading') {
    const level = Math.max(2, Math.min(6, Math.round(block.level ?? 2)));
    return `h${level}` as keyof JSX.IntrinsicElements;
  }
  return 'p';
}

function blockClassName(block: Block): string {
  return [
    'reader-block',
    block.role === 'blockquote' ? 'blk-quote' : '',
    block.role === 'heading' ? 'blk-heading' : '',
    block.role === 'list-item' ? 'blk-list-item' : '',
    block.role === 'paragraph' ? 'blk-paragraph' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function renderToken(token: Token, ctx: RenderTokensContext) {
  if (token.kind === 'noteref') {
    return (
      <sup
        key={token.id}
        className="noteref"
        data-start={token.start}
        data-footnote-id={token.footnoteId}
        role="button"
        tabIndex={0}
        title="脚注"
      >
        {token.surface}
      </sup>
    );
  }

  if (token.kind === 'image') {
    const src = token.assetId ? ctx.imageUrls[token.assetId] : undefined;
    return (
      <figure key={token.id} className="reader-image" data-start={token.start}>
        {src ? <img src={src} alt="" loading="lazy" /> : <div className="image-placeholder" />}
      </figure>
    );
  }

  const presentation = tokenPresentation(token, ctx);
  if (token.kind !== 'word') {
    return (
      <span key={token.id} className={presentation.className} data-start={token.start}>
        {token.surface}
      </span>
    );
  }

  return (
    <span
      key={token.id}
      className={presentation.className}
      data-start={token.start}
      role="button"
      tabIndex={0}
      title={presentation.title}
      style={presentation.style}
    >
      {token.surface}
    </span>
  );
}

function renderTokens(tokens: readonly Token[], ctx: RenderTokensContext, blocks: readonly Block[]) {
  return tokenBlockRuns(tokens, blocks).map((run) => {
    const Tag = blockTag(run.block);
    return (
      <Tag
        key={`${run.block.startTokenId}:${run.tokens[0]?.id ?? 0}`}
        className={blockClassName(run.block)}
      >
        {run.tokens.map((token) => renderToken(token, ctx))}
      </Tag>
    );
  });
}

function createMeasureTokenNode(token: Token, ctx: RenderTokensContext): Node {
  if (token.kind === 'noteref') {
    const sup = document.createElement('sup');
    sup.className = 'noteref';
    sup.dataset.start = String(token.start);
    sup.textContent = token.surface;
    return sup;
  }

  if (token.kind === 'image') {
    const figure = document.createElement('figure');
    figure.className = 'reader-image';
    figure.dataset.start = String(token.start);
    const placeholder = document.createElement('div');
    placeholder.className = 'image-placeholder image-measure-placeholder';
    figure.append(placeholder);
    return figure;
  }

  const span = document.createElement('span');
  const presentation = tokenPresentation(token, ctx);
  if (presentation.className) span.className = presentation.className;
  if (presentation.style?.color) span.style.color = presentation.style.color;
  span.dataset.start = String(token.start);
  span.textContent = token.surface;
  return span;
}

function createMeasureNodes(
  tokens: readonly Token[],
  ctx: RenderTokensContext,
  blocks: readonly Block[],
): (Node | string)[] {
  return tokenBlockRuns(tokens, blocks).map((run) => {
    const element = document.createElement(blockTag(run.block));
    element.className = blockClassName(run.block);
    element.append(...run.tokens.map((token) => createMeasureTokenNode(token, ctx)));
    return element;
  });
}

function runningWordPositionForOffset(wordStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = wordStarts.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const start = wordStarts[mid] ?? 0;
    if (start < offset) low = mid + 1;
    else high = mid;
  }

  return low;
}

function withAnchoredPageStart(
  pageStarts: readonly number[],
  anchor: number,
  tokens: readonly Token[],
): number[] {
  if (!Number.isFinite(anchor) || pageStarts.length === 0 || pageStarts.includes(anchor)) {
    return [...pageStarts];
  }
  const first = pageStarts[0] ?? 0;
  const lastTokenStart = tokens[tokens.length - 1]?.start ?? first;
  if (anchor <= first || anchor > lastTokenStart) return [...pageStarts];

  const nextIndex = pageStarts.findIndex((start) => start > anchor);
  if (nextIndex === -1) return [...pageStarts, anchor];
  return [...pageStarts.slice(0, nextIndex), anchor, ...pageStarts.slice(nextIndex)];
}

export function Reader({
  doc,
  storage,
  sliderLevel,
  scale,
  chapterIndex,
  initialOffset,
  annotations,
  knownLemmas,
  xray,
  readingPrefs,
  theme,
  jumpTarget,
  onChapterChange,
  onWordClick,
  onProgress,
  onReadingAdvance,
  onResumeChange,
  onVisibleOffsetChange,
  onCreateRangeAnnotation,
  onJumpComplete,
  onXrayEnabledChange,
  onOpenPrelearn,
  onOpenStats,
  onPageTurn,
  onReadingPrefsChange,
  onThemeChange,
  onToggleFocus,
  readingRhythm,
  difficultyHint,
  onDismissDifficultyHint,
  onLeaveBook,
}: {
  doc: Document;
  storage: Storage;
  sliderLevel: number;
  scale: LevelScale;
  chapterIndex: number;
  initialOffset: number;
  annotations: Annotation[];
  knownLemmas: ReadonlySet<string>;
  xray: XraySettings;
  readingPrefs: ReadingPrefs;
  theme: Theme;
  jumpTarget: JumpTarget | null;
  onChapterChange: (index: number) => void;
  onWordClick: (c: WordClick) => void;
  onProgress: (maxTokenId: number, percent: number) => void;
  onReadingAdvance: (wordPosition: number) => void;
  onResumeChange: (state: ResumeState) => void;
  onVisibleOffsetChange: (offset: number) => void;
  onCreateRangeAnnotation: (range: {
    start: number;
    end: number;
    quote: string;
    note?: string;
  }) => void;
  onJumpComplete: () => void;
  onXrayEnabledChange: (enabled: boolean) => void;
  onOpenPrelearn: () => void;
  onOpenStats: () => void;
  onPageTurn: () => void;
  onReadingPrefsChange: (prefs: ReadingPrefs) => void;
  onThemeChange: (theme: Theme) => void;
  onToggleFocus: () => void;
  readingRhythm: ReadingRhythm;
  difficultyHint: { density: number } | null;
  onDismissDifficultyHint: () => void;
  onLeaveBook: () => void;
}) {
  const readerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLElement>(null);
  const maxPercentRef = useRef(0);
  const imageUrlsRef = useRef<Map<string, string>>(new Map());
  const currentPageStartRef = useRef(initialOffset);
  const lastInitialOffsetRef = useRef(initialOffset);
  const pendingAnchorRef = useRef<number | null>(initialOffset);
  const userNavigationRef = useRef(false);
  const pendingTurnRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressLookupRef = useRef(false);
  const wheelLockRef = useRef<number | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [activeSelection, setActiveSelection] = useState<SourceSelection | null>(null);
  const [activeFootnote, setActiveFootnote] = useState<ActiveFootnote | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [readingPanelOpen, setReadingPanelOpen] = useState(false);
  const [pageStarts, setPageStarts] = useState<number[]>([]);
  const [paginationComplete, setPaginationComplete] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [trackPosition, setTrackPosition] = useState(-100);
  const [trackAnimating, setTrackAnimating] = useState(false);

  const learner = useMemo(() => scale.fromSlider(sliderLevel), [scale, sliderLevel]);
  const chapters = doc.chapters.length
    ? doc.chapters
    : [{ title: doc.title, startTokenId: 0 }];
  const safeChapterIndex = Math.max(0, Math.min(chapters.length - 1, chapterIndex));
  const currentChapter = chapters[safeChapterIndex] ?? chapters[0];
  const nextChapter = chapters[safeChapterIndex + 1];
  const startTokenId = currentChapter?.startTokenId ?? 0;
  const endTokenId = nextChapter?.startTokenId ?? doc.tokens.length;
  const chapterTokens = useMemo(
    () => doc.tokens.slice(startTokenId, endTokenId),
    [doc.tokens, startTokenId, endTokenId],
  );
  const chapterWordCount = useMemo(
    () => chapterTokens.filter((token) => token.kind === 'word').length,
    [chapterTokens],
  );
  const runningWordStarts = useMemo(
    () => doc.tokens.filter((token) => token.kind === 'word').map((token) => token.start),
    [doc.tokens],
  );
  const readerStyle = useMemo(
    () =>
      ({
        '--reader-font': `${readingPrefs.fontPx}px`,
        '--reader-line': `${readingPrefs.lineHeight}`,
        '--reader-margin': `${readingPrefs.marginPx}px`,
        '--reader-margin-v': `${readingPrefs.marginVPx}px`,
        '--reader-indent': `${readingPrefs.firstLineIndentEm}em`,
        '--reader-para-spacing': `${readingPrefs.paragraphSpacingEm}em`,
        '--reader-font-family':
          readingPrefs.fontFamily === 'serif'
            ? "'Literata', Georgia, 'Times New Roman', 'Songti SC', serif"
            : "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        '--reader-align': readingPrefs.justify ? 'justify' : 'left',
        '--reader-hyphens': readingPrefs.justify ? 'auto' : 'manual',
      }) as CSSProperties,
    [readingPrefs],
  );
  const tokenByStart = useMemo(() => {
    const map = new Map<number, Token>();
    for (const token of chapterTokens) {
      if (token.kind === 'word') map.set(token.start, token);
    }
    return map;
  }, [chapterTokens]);

  const imageAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const token of chapterTokens) {
      if (token.kind === 'image' && token.assetId) ids.add(token.assetId);
    }
    return [...ids];
  }, [chapterTokens]);

  const renderCtx = useMemo<RenderTokensContext>(
    () => ({ annotations, emphases: doc.emphases ?? [], imageUrls, knownLemmas, learner, scale, xray }),
    [annotations, doc.emphases, imageUrls, knownLemmas, learner, scale, xray],
  );
  const documentBlocks = useMemo(() => doc.blocks ?? [], [doc.blocks]);
  const documentFootnotes = useMemo(() => doc.footnotes ?? [], [doc.footnotes]);
  const footnoteById = useMemo(() => {
    const map = new Map<string, Footnote>();
    for (const footnote of documentFootnotes) map.set(footnote.id, footnote);
    return map;
  }, [documentFootnotes]);
  const effectivePageStarts = useMemo(
    () => {
      if (pageStarts.length) return pageStarts;
      if (chapterTokens.length === 0) return [];
      const startIndex = firstTokenAtOrAfter(chapterTokens, initialOffset);
      const start = chapterTokens[startIndex]?.start ?? chapterTokens[0]?.start ?? 0;
      const fallbackEnd = chapterTokens[startIndex + FALLBACK_PAGE_TOKEN_COUNT]?.start;
      return fallbackEnd != null && fallbackEnd > start ? [start, fallbackEnd] : [start];
    },
    [chapterTokens, initialOffset, pageStarts],
  );
  const pageCount = Math.max(
    1,
    paginationComplete ? effectivePageStarts.length : effectivePageStarts.length - 1,
  );
  const safePageIndex = Math.max(0, Math.min(pageCount - 1, pageIndex));
  const chapterRatio = chapterTokens.length ? (safePageIndex + 1) / pageCount : 1;
  const currentPageNumber = safePageIndex + 1;
  const remainingPages = paginationComplete ? Math.max(0, pageCount - currentPageNumber) : 0;
  const wordsPerPage = pageCount ? chapterWordCount / pageCount : chapterWordCount;
  const remainingMinutes = Math.ceil((remainingPages * wordsPerPage) / 200);
  const pageWindow = useMemo(
    () => [safePageIndex - 1, safePageIndex, safePageIndex + 1],
    [safePageIndex],
  );
  const pageTokens = useMemo(
    () =>
      pageWindow.map((index) =>
        index >= 0 && index < pageCount ? tokensForPage(chapterTokens, effectivePageStarts, index) : [],
      ),
    [chapterTokens, effectivePageStarts, pageCount, pageWindow],
  );

  useEffect(() => {
    const urls = imageUrlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [doc.id]);

  useEffect(() => {
    let alive = true;
    const loadImages = async () => {
      let changed = false;
      for (const assetId of imageAssetIds) {
        if (imageUrlsRef.current.has(assetId)) continue;
        const blob = await storage.loadAsset(doc.id, assetId);
        if (!alive || !blob) continue;
        imageUrlsRef.current.set(assetId, URL.createObjectURL(blob));
        changed = true;
      }
      if (alive && changed) setImageUrls(Object.fromEntries(imageUrlsRef.current));
    };
    void loadImages();
    return () => {
      alive = false;
    };
  }, [doc.id, imageAssetIds, storage]);

  useLayoutEffect(() => {
    pendingAnchorRef.current = initialOffset;
    userNavigationRef.current = false;
    currentPageStartRef.current = initialOffset;
    maxPercentRef.current = 0;
    pendingTurnRef.current = null;
    setPageStarts([]);
    setPaginationComplete(false);
    setTrackAnimating(false);
    setTrackPosition(-100);
  }, [doc.id, initialOffset, safeChapterIndex]);

  useLayoutEffect(() => {
    const reader = readerRef.current;
    const measureBox = measureRef.current;
    if (!reader || !measureBox || chapterTokens.length === 0) {
      setPageStarts([]);
      setPaginationComplete(false);
      return;
    }
    const readerEl = reader;
    const measureBoxEl = measureBox;

    let frame: number | null = null;
    let timer: number | null = null;
    let cancelIdleMeasure: (() => void) | null = null;
    let alive = true;

    function clearIdleMeasure() {
      if (cancelIdleMeasure) {
        cancelIdleMeasure();
        cancelIdleMeasure = null;
      }
    }

    function clearScheduledMeasure() {
      if (frame != null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
      clearIdleMeasure();
    }

    function scheduleMeasure(delayMs = 0) {
      if (!alive) return;
      clearScheduledMeasure();
      const requestMeasure = () => {
        if (!alive) return;
        frame = requestAnimationFrame(measure);
      };
      if (delayMs > 0) {
        timer = window.setTimeout(() => {
          timer = null;
          requestMeasure();
        }, delayMs);
        return;
      }
      requestMeasure();
    }

    function scheduleResizeMeasure() {
      scheduleMeasure(RESIZE_MEASURE_DEBOUNCE_MS);
    }

    function currentMetrics(): PaginationMetrics | null {
      const pageHeightPx =
        readerEl.querySelector<HTMLElement>('.page-track')?.clientHeight ?? readerEl.clientHeight;
      if (pageHeightPx <= 0) {
        return null;
      }
      return {
        pageHeightPx,
        renderTokens: (tokens) => createMeasureNodes(tokens, renderCtx, documentBlocks),
      };
    }

    function retainedOffset() {
      return pendingAnchorRef.current ?? currentPageStartRef.current ?? chapterTokens[0]?.start ?? 0;
    }

    function applyMeasuredStarts(starts: readonly number[], complete: boolean, resetTrack: boolean) {
      if (!alive) return;
      const retained = retainedOffset();
      const anchoredStarts = withAnchoredPageStart(starts, retained, chapterTokens);
      setPageStarts(anchoredStarts);
      setPaginationComplete(complete);
      setPageIndex(pageRangeForOffset(anchoredStarts, retained));
      if (resetTrack) {
        pendingTurnRef.current = null;
        setTrackAnimating(false);
        setTrackPosition(-100);
      }
    }

    function measureChunked(metrics: PaginationMetrics, initial: PaginationCursor | null, publishProgress: boolean) {
      let cursor = initial ?? createPaginationCursor(chapterTokens);

      const runChunk = (deadline: IdleDeadlineLike) => {
        cancelIdleMeasure = null;
        if (!alive) return;
        let pagesLeft = IDLE_PAGINATION_MAX_PAGES;
        while (!cursor.done && pagesLeft > 0) {
          cursor = measurePageChunk(measureBoxEl, chapterTokens, metrics, cursor, 1);
          pagesLeft -= 1;
          if (deadline.timeRemaining() <= 1) break;
        }

        if (cursor.done) {
          measureBoxEl.replaceChildren();
          applyMeasuredStarts(cursor.starts, true, false);
          return;
        }

        if (publishProgress && cursor.starts.length > 0) {
          applyMeasuredStarts(pageStartsWithBoundary(cursor, chapterTokens), false, false);
        }
        cancelIdleMeasure = schedulePaginationIdle(runChunk);
      };

      cancelIdleMeasure = schedulePaginationIdle(runChunk);
    }

    function measure() {
      frame = null;
      clearIdleMeasure();
      if (!alive) return;
      const metrics = currentMetrics();
      if (!metrics) {
        scheduleMeasure(LAYOUT_RETRY_MS);
        return;
      }
      const retained = retainedOffset();

      if (chapterTokens.length <= CHUNKED_PAGINATION_THRESHOLD) {
        const starts = measurePageStarts(measureBoxEl, chapterTokens, metrics);
        applyMeasuredStarts(starts, true, true);
        return;
      }

      const startIndex = firstTokenAtOrAfter(chapterTokens, retained);
      const initialWindow = measurePageChunk(
        measureBoxEl,
        chapterTokens,
        metrics,
        createPaginationCursor(chapterTokens, startIndex),
        INITIAL_CHUNKED_PAGES,
      );
      const initialStarts = pageStartsWithBoundary(initialWindow, chapterTokens);
      const complete = startIndex === 0 && initialWindow.done;
      applyMeasuredStarts(initialStarts, complete, true);
      if (!complete) {
        measureChunked(metrics, startIndex === 0 ? initialWindow : null, startIndex === 0);
      }
    }

    if (chapterTokens.length > CHUNKED_PAGINATION_THRESHOLD) {
      scheduleMeasure();
    } else {
      measure();
      scheduleMeasure();
    }
    if (document.fonts) {
      void document.fonts.ready.then(() => scheduleMeasure());
    }
    const resizeObserver = new ResizeObserver(scheduleResizeMeasure);
    resizeObserver.observe(readerEl);
    window.addEventListener('resize', scheduleResizeMeasure);
    window.addEventListener('orientationchange', scheduleResizeMeasure);
    return () => {
      alive = false;
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleResizeMeasure);
      window.removeEventListener('orientationchange', scheduleResizeMeasure);
      clearScheduledMeasure();
      clearIdleMeasure();
    };
  }, [chapterTokens, documentBlocks, initialOffset, readingPrefs, renderCtx]);

  useLayoutEffect(() => {
    if (lastInitialOffsetRef.current !== initialOffset) {
      lastInitialOffsetRef.current = initialOffset;
      pendingAnchorRef.current = initialOffset;
      currentPageStartRef.current = initialOffset;
    }
    const pendingAnchor = pendingAnchorRef.current;
    if (pendingAnchor != null && pageStarts.length > 0) {
      setPageIndex(pageRangeForOffset(pageStarts, pendingAnchor));
    }
  }, [initialOffset, pageStarts]);

  useEffect(() => {
    if (!jumpTarget || pageStarts.length === 0) return;
    const nextPage = pageRangeForOffset(pageStarts, jumpTarget.offset);
    pendingAnchorRef.current = jumpTarget.offset;
    currentPageStartRef.current = jumpTarget.offset;
    setPageIndex(nextPage);
    setTrackAnimating(false);
    setTrackPosition(-100);
    onJumpComplete();
  }, [jumpTarget, onJumpComplete, pageStarts]);

  useEffect(() => {
    if (!readingPanelOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setReadingPanelOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readingPanelOpen]);

  useEffect(() => {
    return () => {
      if (wheelLockRef.current != null) clearTimeout(wheelLockRef.current);
    };
  }, []);

  const openFootnote = useCallback(
    (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const el = target.closest<HTMLElement>('[data-footnote-id]');
      const footnoteId = el?.dataset.footnoteId;
      if (!el || !footnoteId) return false;
      const footnote = footnoteById.get(footnoteId);
      if (!footnote) return false;
      setActiveFootnote({ footnote, position: popupPositionForRect(el.getBoundingClientRect()) });
      return true;
    },
    [footnoteById],
  );

  const openLookup = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return;
      const el = target.closest<HTMLElement>('[data-start]');
      if (!el) return;
      const start = Number(el.dataset.start);
      if (!Number.isFinite(start)) return;
      const token = tokenByStart.get(start);
      if (!token) return;
      setActiveFootnote(null);
      onWordClick({ token, rect: el.getBoundingClientRect() });
    },
    [onWordClick, tokenByStart],
  );

  const onLookupClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (suppressLookupRef.current) {
        suppressLookupRef.current = false;
        return;
      }
      if (hasActiveTextSelection()) return;
      if (openFootnote(e.target)) return;
      openLookup(e.target);
    },
    [openFootnote, openLookup],
  );

  const onLookupKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (openFootnote(e.target)) return;
      openLookup(e.target);
    },
    [openFootnote, openLookup],
  );

  const clearTransientUi = useCallback(() => {
    onPageTurn();
    setReadingPanelOpen(false);
    setActiveFootnote(null);
    setActiveSelection(null);
    setNoteMode(false);
    setNoteText('');
    window.getSelection()?.removeAllRanges();
  }, [onPageTurn]);

  const turnPage = useCallback(
    (delta: -1 | 1) => {
      if (trackAnimating) return;
      clearTransientUi();
      if (delta < 0 && safePageIndex === 0) {
        onChapterChange(Math.max(0, safeChapterIndex - 1));
        return;
      }
      if (delta > 0 && safePageIndex >= pageCount - 1) {
        if (paginationComplete) {
          onChapterChange(Math.min(chapters.length - 1, safeChapterIndex + 1));
        }
        return;
      }

      userNavigationRef.current = true;
      pendingTurnRef.current = delta;
      setTrackAnimating(true);
      requestAnimationFrame(() => setTrackPosition(delta > 0 ? -200 : 0));
    },
    [
      chapters.length,
      clearTransientUi,
      onChapterChange,
      pageCount,
      paginationComplete,
      safeChapterIndex,
      safePageIndex,
      trackAnimating,
    ],
  );

  const finishTrackTurn = useCallback(() => {
    const delta = pendingTurnRef.current;
    if (delta == null) return;
    pendingTurnRef.current = null;
    setTrackAnimating(false);
    setPageIndex((index) => Math.max(0, Math.min(pageCount - 1, index + delta)));
    setTrackPosition(-100);
  }, [pageCount]);

  const onReaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        turnPage(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        turnPage(1);
      }
    },
    [turnPage],
  );

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      suppressLookupRef.current = true;
      turnPage(dx < 0 ? 1 : -1);
    },
    [turnPage],
  );

  const onReaderWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (Math.abs(event.deltaX) < 40 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (wheelLockRef.current != null) return;
      turnPage(event.deltaX > 0 ? 1 : -1);
      wheelLockRef.current = window.setTimeout(() => {
        wheelLockRef.current = null;
      }, 450);
    },
    [turnPage],
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        turnPage(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        turnPage(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [turnPage]);

  const renderedPages = useMemo(
    () => pageTokens.map((tokens) => renderTokens(tokens, renderCtx, documentBlocks)),
    [documentBlocks, pageTokens, renderCtx],
  );

  useEffect(() => {
    if (pageStarts.length === 0) return;
    if (jumpTarget) return;
    const targetPage = pageRangeForOffset(pageStarts, initialOffset);
    if (!userNavigationRef.current && safePageIndex !== targetPage) {
      setPageIndex(targetPage);
      return;
    }
    const pendingAnchor = pendingAnchorRef.current;
    if (pendingAnchor != null) {
      const targetPage = pageRangeForOffset(pageStarts, pendingAnchor);
      if (safePageIndex !== targetPage) return;
      pendingAnchorRef.current = null;
    }
    const offset = pageStarts[safePageIndex] ?? chapterTokens[0]?.start ?? 0;
    userNavigationRef.current = false;
    currentPageStartRef.current = offset;
    onVisibleOffsetChange(offset);
    onResumeChange({ offset });

    const wordPosition = runningWordPositionForOffset(runningWordStarts, offset);
    onReadingAdvance(wordPosition);
    const percent = runningWordStarts.length
      ? Math.round((wordPosition / runningWordStarts.length) * 100)
      : 100;
    const currentTokens = pageTokens[1] ?? [];
    const maxTokenId = currentTokens[0]?.id ?? startTokenId;
    if (percent > maxPercentRef.current) {
      maxPercentRef.current = percent;
      onProgress(maxTokenId, percent);
    }
  }, [
    chapterTokens,
    chapterRatio,
    effectivePageStarts,
    initialOffset,
    onProgress,
    onReadingAdvance,
    onResumeChange,
    onVisibleOffsetChange,
    pageTokens,
    pageStarts,
    jumpTarget,
    runningWordStarts,
    safeChapterIndex,
    safePageIndex,
    startTokenId,
  ]);

  const updateSelection = () => {
    const el = readerRef.current;
    if (!el) return;
    const selected = selectionToSourceRange(el, doc.source);
    setActiveSelection(selected);
    setNoteMode(false);
    setNoteText('');
  };

  const saveSelection = (note?: string) => {
    if (!activeSelection) return;
    onCreateRangeAnnotation({
      start: activeSelection.start,
      end: activeSelection.end,
      quote: activeSelection.quote,
      note,
    });
    window.getSelection()?.removeAllRanges();
    setActiveSelection(null);
    setNoteMode(false);
    setNoteText('');
  };

  const prev = () => onChapterChange(Math.max(0, safeChapterIndex - 1));
  const next = () => onChapterChange(Math.min(chapters.length - 1, safeChapterIndex + 1));
  const canTurnPrev = safePageIndex > 0 || safeChapterIndex > 0;
  const canTurnNext =
    safePageIndex < pageCount - 1 || (paginationComplete && safeChapterIndex < chapters.length - 1);
  const goalProgress = Math.min(1, readingRhythm.todayWords / readingRhythm.dailyWords);
  const estimatedMinutes = Math.max(1, Math.round(readingRhythm.dailyWords / 75));
  const goalStyle = { '--goal-progress': `${Math.round(goalProgress * 100)}%` } as CSSProperties;

  return (
    <div className="reader-wrap" style={readerStyle}>
      <div className="reading-goal-widget" style={goalStyle} aria-label="今日进度">
        <div className={goalProgress >= 1 ? 'goal-ring complete' : 'goal-ring'}>
          <span>{Math.round(goalProgress * 100)}%</span>
        </div>
        <div>
          <strong>今日 {readingRhythm.todayWords} / {readingRhythm.dailyWords}</strong>
          <span className="muted">≈ 半页 / ≈ {estimatedMinutes} 分钟</span>
          <span className="muted">
            本周 {readingRhythm.weekDone} / {readingRhythm.daysPerWeek} · 已坚持{' '}
            {readingRhythm.streakWeeks} 周
          </span>
        </div>
      </div>
      {difficultyHint && (
        <div className="difficulty-hint">
          <span>这本对你有点吃力，要不要换更顺的一本?</span>
          <button type="button" onClick={onOpenPrelearn}>
            先预背几个词再回来
          </button>
          <button type="button" onClick={onDismissDifficultyHint}>
            暂不提示
          </button>
        </div>
      )}
      <div className="chapter-bar">
        <button type="button" onClick={prev} disabled={safeChapterIndex === 0}>
          上一章
        </button>
        <span className="muted">
          {safeChapterIndex + 1} / {chapters.length}
        </span>
        <button type="button" onClick={next} disabled={safeChapterIndex >= chapters.length - 1}>
          下一章
        </button>
        <label className="xray-toggle">
          <input
            type="checkbox"
            checked={xray.enabled}
            onChange={(e) => onXrayEnabledChange(e.target.checked)}
          />
          x-ray
        </label>
        <button type="button" onClick={onOpenStats}>
          统计
        </button>
        <button type="button" onClick={onOpenPrelearn}>
          预背本书生词
        </button>
        <div className="reading-panel-anchor">
          <button
            type="button"
            aria-expanded={readingPanelOpen}
            onClick={() => setReadingPanelOpen((open) => !open)}
          >
            Aa
          </button>
          {readingPanelOpen && (
            <>
              <div className="reading-panel-backdrop" onClick={() => setReadingPanelOpen(false)} />
              <ReadingPanel
                prefs={readingPrefs}
                theme={theme}
                onPrefsChange={onReadingPrefsChange}
                onThemeChange={onThemeChange}
                onReset={() => onReadingPrefsChange(DEFAULT_READING_PREFS)}
              />
            </>
          )}
        </div>
        <button type="button" onClick={onToggleFocus}>
          专注
        </button>
        <button type="button" onClick={onLeaveBook}>
          这本不适合我
        </button>
      </div>
      <div
        className="reader"
        ref={readerRef}
        tabIndex={0}
        onKeyDown={onReaderKeyDown}
        onMouseUp={() => window.setTimeout(updateSelection, 0)}
        onKeyUp={updateSelection}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onWheel={onReaderWheel}
      >
        <button
          type="button"
          className="page-gutter page-gutter-left"
          aria-label="上一页"
          disabled={!canTurnPrev}
          onClick={() => turnPage(-1)}
        />
        <div
          className={trackAnimating ? 'page-track animating' : 'page-track'}
          style={{ transform: `translateX(${trackPosition}%)` }}
          onTransitionEnd={finishTrackTurn}
        >
          {pageWindow.map((index, slot) => (
            <article
              key={`${safeChapterIndex}:${index}`}
              className="reader-page page-panel"
              lang="en"
              aria-hidden={index !== safePageIndex}
              onClick={onLookupClick}
              onKeyDown={onLookupKeyDown}
            >
              {renderedPages[slot]}
            </article>
          ))}
        </div>
        <button
          type="button"
          className="page-gutter page-gutter-right"
          aria-label="下一页"
          disabled={!canTurnNext}
          onClick={() => turnPage(1)}
        />
        <article
          ref={measureRef}
          className="reader-page reader-measure-page"
          lang="en"
          aria-hidden="true"
        />
        {activeSelection && (
          <div
            className="selection-toolbar"
            style={{
              top: Math.min(activeSelection.rect.bottom + 8, window.innerHeight - 160),
              left: Math.min(Math.max(8, activeSelection.rect.left), window.innerWidth - 260),
            }}
          >
            {noteMode ? (
              <>
                <input
                  autoFocus
                  value={noteText}
                  placeholder="评论"
                  onChange={(e) => setNoteText(e.currentTarget.value)}
                />
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => saveSelection(noteText)}>
                  保存
                </button>
              </>
            ) : (
              <>
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => saveSelection()}>
                  划线
                </button>
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => setNoteMode(true)}>
                  加评论
                </button>
              </>
            )}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                window.getSelection()?.removeAllRanges();
                setActiveSelection(null);
                setNoteMode(false);
              }}
            >
              取消
            </button>
          </div>
        )}
      </div>
      {activeFootnote && (
        <>
          <div className="popup-backdrop" onClick={() => setActiveFootnote(null)} />
          <div
            className="popup footnote-popup"
            style={{
              top: activeFootnote.position.top,
              left: activeFootnote.position.left,
            }}
          >
            <div className="popup-head">
              <span className="popup-word">脚注 {activeFootnote.footnote.label}</span>
              <button
                className="popup-close"
                type="button"
                onClick={() => setActiveFootnote(null)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="popup-body footnote-body">
              {activeFootnote.footnote.body || '没有脚注正文。'}
            </div>
          </div>
        </>
      )}
      <div className="page-status" aria-label="本章页码">
        <span>
          本章第 {currentPageNumber} / {paginationComplete ? pageCount : `${pageCount}+`} 页
        </span>
        <span>
          {!paginationComplete
            ? `正在分页… 已可读 ${pageCount} 页`
            : remainingPages === 0
              ? '本章最后一页'
              : `剩 ${remainingPages} 页 · 约 ${remainingMinutes} 分钟`}
        </span>
      </div>
    </div>
  );
}
