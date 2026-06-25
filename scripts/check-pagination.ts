import assert from 'node:assert/strict';
import type { Token, TokenKind } from '../src/core/model/token';
import {
  measurePageStarts,
  pageRangeForOffset,
  tokensForPage,
  type PaginationMeasureBox,
  type PaginationMetrics,
} from '../src/ui/reader/paginate';

class StubMeasureBox implements PaginationMeasureBox {
  scrollHeight = 0;

  replaceChildren(...nodes: (Node | string)[]) {
    this.scrollHeight = Number(nodes[0] ?? 0);
  }
}

function makeTokens(surfaces: string[]): Token[] {
  let offset = 0;
  return surfaces.map((surface, id) => {
    const kind: TokenKind =
      surface === '\n' ? 'newline' : surface.trim() === '' ? 'space' : /^\w+$/.test(surface) ? 'word' : 'punct';
    const token: Token = { id, kind, surface, start: offset, end: offset + surface.length };
    offset = token.end;
    return token;
  });
}

function setupMetrics(
  pageHeightPx: number,
  tokenHeight: (token: Token) => number,
): { box: StubMeasureBox; metrics: PaginationMetrics; maxRendered: () => number } {
  const box = new StubMeasureBox();
  let maxRendered = 0;
  const metrics: PaginationMetrics = {
    pageHeightPx,
    renderTokens(tokens) {
      maxRendered = Math.max(maxRendered, tokens.length);
      return [String(tokens.reduce((sum, token) => sum + tokenHeight(token), 0))];
    },
  };
  return { box, metrics, maxRendered: () => maxRendered };
}

function assertReconstructs(tokens: Token[], pageStarts: number[]) {
  const reconstructed = pageStarts.flatMap((_, index) => tokensForPage(tokens, pageStarts, index));
  assert.deepEqual(
    reconstructed.map((token) => token.id),
    tokens.map((token) => token.id),
  );
}

const paragraph = makeTokens([
  'Alpha',
  ' ',
  'beta',
  ' ',
  'gamma',
  ',',
  ' ',
  'delta',
  ' ',
  'epsilon',
  '.',
  '\n',
  'Zeta',
  ' ',
  'eta',
  ' ',
  'theta',
  '.',
]);

{
  const { box, metrics } = setupMetrics(16, (token) => token.surface.length || 1);
  const pageStarts = measurePageStarts(box, paragraph, metrics);

  assert.ok(pageStarts.length > 1);
  assert.equal(pageStarts[0], paragraph[0]?.start);
  for (let i = 1; i < pageStarts.length; i += 1) {
    assert.ok(pageStarts[i]! > pageStarts[i - 1]!);
  }
  assertReconstructs(paragraph, pageStarts);

  let previousPage = 0;
  const lastOffset = paragraph.at(-1)?.end ?? 0;
  for (let offset = 0; offset <= lastOffset; offset += 1) {
    const page = pageRangeForOffset(pageStarts, offset);
    assert.ok(page >= previousPage);
    previousPage = page;
  }
  assert.equal(pageRangeForOffset(pageStarts, -10), 0);
  assert.equal(pageRangeForOffset(pageStarts, lastOffset + 100), pageStarts.length - 1);
}

{
  const manyTokens = makeTokens(Array.from({ length: 100 }, (_, index) => String(index % 10)));
  const { box, metrics, maxRendered } = setupMetrics(10, () => 1);
  const pageStarts = measurePageStarts(box, manyTokens, metrics);

  assert.equal(pageStarts.length, 10);
  assert.ok(maxRendered() <= 16);
  assertReconstructs(manyTokens, pageStarts);
}

{
  const oversized = makeTokens(['A', 'B', 'C']);
  const { box, metrics } = setupMetrics(10, (token) => (token.id === 1 ? 100 : 1));
  const pageStarts = measurePageStarts(box, oversized, metrics);

  assert.deepEqual(pageStarts, [0, 1, 2]);
  assertReconstructs(oversized, pageStarts);
}

assert.throws(() => measurePageStarts(new StubMeasureBox(), paragraph, { pageHeightPx: 0, renderTokens: () => [] }));

console.log('pagination checks passed');
