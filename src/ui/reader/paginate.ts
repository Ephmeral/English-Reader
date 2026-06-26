import type { Token } from '../../core/model/token';

export interface PaginationMeasureBox {
  readonly scrollHeight: number;
  replaceChildren(...nodes: (Node | string)[]): void;
}

export interface PaginationMetrics {
  pageHeightPx: number;
  renderTokens: (tokens: readonly Token[]) => readonly (Node | string)[];
}

export interface PageMeasure {
  start: number;
  startIndex: number;
  endIndex: number;
  tokenCount: number;
  done: boolean;
}

export interface PaginationCursor {
  starts: number[];
  nextIndex: number;
  seedTokenCount: number;
  done: boolean;
}

function assertUsableMetrics(metrics: PaginationMetrics) {
  if (!Number.isFinite(metrics.pageHeightPx) || metrics.pageHeightPx <= 0) {
    throw new Error('pageHeightPx must be a positive finite number');
  }
}

function fitsPage(
  measureBox: PaginationMeasureBox,
  tokens: readonly Token[],
  startIndex: number,
  count: number,
  metrics: PaginationMetrics,
): boolean {
  const nodes = metrics.renderTokens(tokens.slice(startIndex, startIndex + count));
  measureBox.replaceChildren(...nodes);
  return measureBox.scrollHeight <= metrics.pageHeightPx;
}

function normalizedSeed(seedTokenCount: number | undefined, remaining: number): number {
  if (!Number.isFinite(seedTokenCount) || !seedTokenCount) return 1;
  return Math.max(1, Math.min(remaining, Math.trunc(seedTokenCount)));
}

function normalizedStartIndex(tokens: readonly Token[], startIndex: number | undefined): number {
  if (!Number.isFinite(startIndex)) return 0;
  return Math.max(0, Math.min(tokens.length, Math.trunc(startIndex ?? 0)));
}

export function measurePage(
  measureBox: PaginationMeasureBox,
  tokens: readonly Token[],
  startIndex: number,
  metrics: PaginationMetrics,
  seedTokenCount = 1,
): PageMeasure | null {
  assertUsableMetrics(metrics);
  if (tokens.length === 0 || startIndex >= tokens.length) return null;

  const token = tokens[startIndex];
  if (!token) return null;

  const remaining = tokens.length - startIndex;
  let low = 0;
  let high = normalizedSeed(seedTokenCount, remaining);
  let restFits = false;

  if (fitsPage(measureBox, tokens, startIndex, high, metrics)) {
    low = high;
    if (high === remaining) {
      restFits = true;
    }
    while (!restFits) {
      const nextHigh = Math.min(remaining, Math.max(high + 1, high * 2));
      high = nextHigh;
      if (!fitsPage(measureBox, tokens, startIndex, high, metrics)) break;
      low = high;
      if (high === remaining) restFits = true;
    }
  }

  if (!restFits) {
    while (low + 1 < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (fitsPage(measureBox, tokens, startIndex, mid, metrics)) low = mid;
      else high = mid;
    }
  }

  const tokenCount = restFits ? low : Math.max(1, low);
  const endIndex = Math.min(tokens.length, startIndex + tokenCount);
  return {
    start: token.start,
    startIndex,
    endIndex,
    tokenCount,
    done: endIndex >= tokens.length,
  };
}

export function createPaginationCursor(tokens: readonly Token[], startIndex = 0): PaginationCursor {
  const nextIndex = normalizedStartIndex(tokens, startIndex);
  return {
    starts: [],
    nextIndex,
    seedTokenCount: 1,
    done: nextIndex >= tokens.length,
  };
}

export function measurePageChunk(
  measureBox: PaginationMeasureBox,
  tokens: readonly Token[],
  metrics: PaginationMetrics,
  cursor: PaginationCursor,
  pageLimit: number,
): PaginationCursor {
  assertUsableMetrics(metrics);
  if (tokens.length === 0 || cursor.done) {
    return { ...cursor, done: true };
  }

  const limit = Number.isFinite(pageLimit) ? Math.max(0, Math.trunc(pageLimit)) : 0;
  const starts = [...cursor.starts];
  let nextIndex = normalizedStartIndex(tokens, cursor.nextIndex);
  let seedTokenCount = cursor.seedTokenCount;
  let measuredPages = 0;

  while (nextIndex < tokens.length && measuredPages < limit) {
    const page = measurePage(measureBox, tokens, nextIndex, metrics, seedTokenCount);
    if (!page) break;
    starts.push(page.start);
    nextIndex = page.endIndex;
    seedTokenCount = page.tokenCount;
    measuredPages += 1;
    if (page.done) break;
  }

  return {
    starts,
    nextIndex,
    seedTokenCount,
    done: nextIndex >= tokens.length,
  };
}

export function pageStartsWithBoundary(cursor: PaginationCursor, tokens: readonly Token[]): number[] {
  const nextStart = tokens[cursor.nextIndex]?.start;
  return cursor.done || nextStart == null ? [...cursor.starts] : [...cursor.starts, nextStart];
}

export function measurePageStarts(
  measureBox: PaginationMeasureBox,
  tokens: readonly Token[],
  metrics: PaginationMetrics,
): number[] {
  assertUsableMetrics(metrics);
  if (tokens.length === 0) return [];

  let cursor = createPaginationCursor(tokens);
  while (!cursor.done) {
    cursor = measurePageChunk(measureBox, tokens, metrics, cursor, 1);
  }

  measureBox.replaceChildren();
  return cursor.starts;
}

export function pageRangeForOffset(pageStarts: readonly number[], offset: number): number {
  if (pageStarts.length === 0) return 0;
  let low = 0;
  let high = pageStarts.length - 1;

  while (low <= high) {
    const mid = low + Math.floor((high - low) / 2);
    const start = pageStarts[mid] ?? 0;
    if (start <= offset) low = mid + 1;
    else high = mid - 1;
  }

  return Math.max(0, Math.min(pageStarts.length - 1, high));
}

export function firstTokenAtOrAfter(tokens: readonly Token[], offset: number): number {
  let low = 0;
  let high = tokens.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const token = tokens[mid];
    if (token && token.start < offset) low = mid + 1;
    else high = mid;
  }

  return low;
}

export function tokensForPage(
  tokens: readonly Token[],
  pageStarts: readonly number[],
  pageIndex: number,
): Token[] {
  if (tokens.length === 0 || pageStarts.length === 0) return [];
  const safeIndex = Math.max(0, Math.min(pageStarts.length - 1, Math.trunc(pageIndex)));
  const startOffset = pageStarts[safeIndex] ?? 0;
  const endOffset = pageStarts[safeIndex + 1];
  const startIndex = firstTokenAtOrAfter(tokens, startOffset);
  const endIndex = endOffset == null ? tokens.length : firstTokenAtOrAfter(tokens, endOffset);
  return tokens.slice(startIndex, endIndex);
}
