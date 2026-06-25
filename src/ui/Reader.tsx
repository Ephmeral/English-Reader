// 阅读器渲染：按章节渲染 Document 词元流，高于滑块水平的词高亮可点。
// 埋 reading_progress；EPUB 图片从 Storage asset 加载。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { Annotation } from '../core/model/annotation';
import type { Document, Token } from '../core/model/token';
import type { LevelScale } from '../core/model/level';
import { bucketOf } from '../core/model/buckets';
import type { XraySettings } from '../core/model/buckets';
import { shouldHighlight } from '../core/model/marking';
import type { Storage } from '../core/storage/storage';
import type { SourceSelection } from './selection';
import { selectionToSourceRange } from './selection';

export interface WordClick {
  token: Token;
  rect: DOMRect;
}

export interface ResumeState {
  chapterIndex: number;
  scrollOffset: number;
}

export interface JumpTarget {
  offset: number;
  nonce: number;
}

function intersectsRange(token: Token, annotation: Annotation): boolean {
  if (annotation.anchor.kind !== 'range') return false;
  if (token.end === token.start) return false;
  return token.start < annotation.anchor.end && token.end > annotation.anchor.start;
}

function topVisibleOffset(reader: HTMLElement): number | null {
  const top = reader.getBoundingClientRect().top;
  const nodes = [...reader.querySelectorAll<HTMLElement>('[data-start]')];
  const visible = nodes.find((node) => node.getBoundingClientRect().bottom >= top + 4);
  const value = Number(visible?.dataset.start);
  return Number.isFinite(value) ? value : null;
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

export function Reader({
  doc,
  storage,
  sliderLevel,
  scale,
  chapterIndex,
  initialScrollOffset,
  annotations,
  knownLemmas,
  xray,
  jumpTarget,
  onChapterChange,
  onWordClick,
  onProgress,
  onResumeChange,
  onVisibleOffsetChange,
  onCreateRangeAnnotation,
  onJumpComplete,
  onXrayEnabledChange,
}: {
  doc: Document;
  storage: Storage;
  sliderLevel: number;
  scale: LevelScale;
  chapterIndex: number;
  initialScrollOffset: number;
  annotations: Annotation[];
  knownLemmas: ReadonlySet<string>;
  xray: XraySettings;
  jumpTarget: JumpTarget | null;
  onChapterChange: (index: number) => void;
  onWordClick: (c: WordClick) => void;
  onProgress: (maxTokenId: number, percent: number) => void;
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
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const maxPercentRef = useRef(0);
  const imageUrlsRef = useRef<Map<string, string>>(new Map());
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [activeSelection, setActiveSelection] = useState<SourceSelection | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [noteText, setNoteText] = useState('');

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = initialScrollOffset;
      const offset = topVisibleOffset(el);
      if (offset != null) onVisibleOffsetChange(offset);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [doc.id, safeChapterIndex, initialScrollOffset, onVisibleOffsetChange]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !jumpTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const exact = el.querySelector<HTMLElement>(`[data-start="${jumpTarget.offset}"]`);
      const target =
        exact ??
        [...el.querySelectorAll<HTMLElement>('[data-start]')].find(
          (node) => Number(node.dataset.start) >= jumpTarget.offset,
        );
      target?.scrollIntoView({ block: 'center' });
      onJumpComplete();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [jumpTarget, onJumpComplete]);

  const openLookup = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return;
      const el = target.closest<HTMLElement>('[data-start]');
      if (!el) return;
      const start = Number(el.dataset.start);
      if (!Number.isFinite(start)) return;
      const token = tokenByStart.get(start);
      if (!token) return;
      onWordClick({ token, rect: el.getBoundingClientRect() });
    },
    [onWordClick, tokenByStart],
  );

  const onLookupClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (hasActiveTextSelection()) return;
      openLookup(e.target);
    },
    [openLookup],
  );

  const onLookupKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openLookup(e.target);
    },
    [openLookup],
  );

  const nodes = useMemo(() => {
    return chapterTokens.map((t) => {
      if (t.kind === 'image') {
        const src = t.assetId ? imageUrls[t.assetId] : undefined;
        return (
          <figure key={t.id} className="reader-image" data-start={t.start}>
            {src ? <img src={src} alt="" loading="lazy" /> : <div className="image-placeholder" />}
          </figure>
        );
      }
      if (t.kind === 'punct') {
        const userHighlighted = annotations.some((annotation) => intersectsRange(t, annotation));
        return (
          <span
            key={t.id}
            className={userHighlighted ? 'punct user-highlight' : 'punct'}
            data-start={t.start}
          >
            {t.surface}
          </span>
        );
      }
      if (t.kind !== 'word') {
        return (
          <span key={t.id} data-start={t.start}>
            {t.surface}
          </span>
        );
      }

      const userHighlighted = annotations.some((annotation) => intersectsRange(t, annotation));
      const marked = !xray.enabled && shouldHighlight(t, learner, scale, knownLemmas);
      const bucket = xray.buckets[bucketOf(t.band)];
      const style = xray.enabled && bucket?.visible ? { color: bucket.color } : undefined;
      const bandLabel = t.band == null ? 'OOV' : `${t.band}k`;
      const className = ['word', marked ? 'marked' : '', userHighlighted ? 'user-highlight' : '']
        .filter(Boolean)
        .join(' ');
      return (
        <span
          key={t.id}
          className={className}
          data-start={t.start}
          role="button"
          tabIndex={0}
          title={`${bandLabel} · 点击查词`}
          style={style}
        >
          {t.surface}
        </span>
      );
    });
  }, [annotations, chapterTokens, imageUrls, learner, scale, knownLemmas, xray]);

  // 进度：按章节内滚动比例合成整书百分比，单调上报，节流。
  useEffect(() => {
    maxPercentRef.current = Math.round((safeChapterIndex / chapters.length) * 100);
    const el = scrollRef.current;
    if (!el) return;
    let timer: number | null = null;
    const handler = () => {
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        const denom = el.scrollHeight - el.clientHeight;
        const ratio = denom > 0 ? Math.min(1, Math.max(0, el.scrollTop / denom)) : 1;
        const percent = Math.round(((safeChapterIndex + ratio) / chapters.length) * 100);
        const tokenIndex = Math.round(ratio * Math.max(0, chapterTokens.length - 1));
        const maxTokenId = chapterTokens[tokenIndex]?.id ?? startTokenId;
        const offset = topVisibleOffset(el);
        if (offset != null) onVisibleOffsetChange(offset);
        onResumeChange({ chapterIndex: safeChapterIndex, scrollOffset: el.scrollTop });
        if (percent > maxPercentRef.current) {
          maxPercentRef.current = percent;
          onProgress(maxTokenId, percent);
        }
      }, 1500);
    };
    el.addEventListener('scroll', handler, { passive: true });
    if (el.scrollHeight <= el.clientHeight) {
      const percent = Math.round(((safeChapterIndex + 1) / chapters.length) * 100);
      onProgress(chapterTokens.at(-1)?.id ?? startTokenId, percent);
    }
    return () => {
      el.removeEventListener('scroll', handler);
      if (timer != null) clearTimeout(timer);
    };
  }, [
    chapterTokens,
    chapters.length,
    onProgress,
    onResumeChange,
    onVisibleOffsetChange,
    safeChapterIndex,
    startTokenId,
  ]);

  const updateSelection = () => {
    const el = scrollRef.current;
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

  return (
    <div className="reader-wrap">
      <div className="chapter-bar">
        <button onClick={prev} disabled={safeChapterIndex === 0}>
          上一章
        </button>
        <span className="muted">
          {safeChapterIndex + 1} / {chapters.length}
        </span>
        <button onClick={next} disabled={safeChapterIndex >= chapters.length - 1}>
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
      </div>
      <div
        className="reader"
        ref={scrollRef}
        onMouseUp={() => window.setTimeout(updateSelection, 0)}
        onKeyUp={updateSelection}
      >
        <article className="reader-page" onClick={onLookupClick} onKeyDown={onLookupKeyDown}>
          {nodes}
        </article>
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
    </div>
  );
}
