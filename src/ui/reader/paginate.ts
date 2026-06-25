import type { Token } from '../../core/model/token';

export interface PaginationMeasureBox {
  readonly scrollHeight: number;
  replaceChildren(...nodes: (Node | string)[]): void;
}

export interface PaginationMetrics {
  pageHeightPx: number;
  renderTokens: (tokens: readonly Token[]) => readonly (Node | string)[];
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

export function measurePageStarts(
  measureBox: PaginationMeasureBox,
  tokens: readonly Token[],
  metrics: PaginationMetrics,
): number[] {
  assertUsableMetrics(metrics);
  if (tokens.length === 0) return [];

  const pageStarts: number[] = [];
  let startIndex = 0;

  while (startIndex < tokens.length) {
    const token = tokens[startIndex];
    if (!token) break;
    pageStarts.push(token.start);

    const remaining = tokens.length - startIndex;
    let low = 0;
    let high = 1;
    let restFits = false;

    while (high <= remaining) {
      if (!fitsPage(measureBox, tokens, startIndex, high, metrics)) break;
      low = high;
      if (high === remaining) {
        restFits = true;
        break;
      }
      high = Math.min(remaining, high * 2);
    }

    if (restFits) {
      startIndex += low;
      continue;
    }

    if (low === 0) {
      startIndex += 1;
      continue;
    }

    while (low + 1 < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (fitsPage(measureBox, tokens, startIndex, mid, metrics)) low = mid;
      else high = mid;
    }

    startIndex += low;
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

function firstTokenAtOrAfter(tokens: readonly Token[], offset: number): number {
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
