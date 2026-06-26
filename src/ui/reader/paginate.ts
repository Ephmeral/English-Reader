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

export function measurePageStarts(
  measureBox: PaginationMeasureBox,
  tokens: readonly Token[],
  metrics: PaginationMetrics,
): number[] {
  assertUsableMetrics(metrics);
  if (tokens.length === 0) return [];

  const pageStarts: number[] = [];
  let startIndex = 0;
  let seedTokenCount = 1;

  while (startIndex < tokens.length) {
    const page = measurePage(measureBox, tokens, startIndex, metrics, seedTokenCount);
    if (!page) break;
    pageStarts.push(page.start);
    startIndex = page.endIndex;
    seedTokenCount = page.tokenCount;
  }

  measureBox.replaceChildren();
  return pageStarts;
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
