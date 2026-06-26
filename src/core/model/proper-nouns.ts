import type { Lexicon } from '../lexicon/lexicon';
import type { Document, Token } from './token';

export interface ProperNounResult {
  lemmas: Set<string>;
  runningWords: number;
}

interface LemmaStats {
  total: number;
  capAny: number;
  capMid: number;
}

const SENTENCE_END_RE = /[.!?]$/;
const QUOTE_RE = /^["'“”‘’]+$/;

function lemmaOf(token: Token): string {
  return token.lemma ?? token.surface.toLowerCase();
}

function isCapitalized(surface: string): boolean {
  return /^[A-Z]/.test(surface);
}

function isTooShort(surface: string): boolean {
  return surface.length < 2;
}

function previousSignificantToken(tokens: Token[], index: number): Token | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (!token || token.kind === 'space' || token.kind === 'newline') continue;
    if (token.kind === 'punct' && QUOTE_RE.test(token.surface)) continue;
    return token;
  }
  return null;
}

function isSentenceInitial(tokens: Token[], index: number): boolean {
  const previous = previousSignificantToken(tokens, index);
  if (!previous) return true;
  // 称谓缩写如 Mr./Mrs./St. 会让后续名字按句首处理；当前启发式接受这类少量漏判。
  return SENTENCE_END_RE.test(previous.surface);
}

export function detectProperNouns(doc: Document, lexicon: Lexicon): ProperNounResult {
  const stats = new Map<string, LemmaStats>();

  doc.tokens.forEach((token, index) => {
    if (token.kind !== 'word' || isTooShort(token.surface)) return;

    const lemma = lemmaOf(token);
    const current = stats.get(lemma) ?? { total: 0, capAny: 0, capMid: 0 };
    const cap = isCapitalized(token.surface);
    current.total += 1;
    if (cap) {
      current.capAny += 1;
      if (!isSentenceInitial(doc.tokens, index)) current.capMid += 1;
    }
    stats.set(lemma, current);
  });

  const lemmas = new Set<string>();
  let runningWords = 0;

  for (const [lemma, item] of stats) {
    if (item.capMid < 1) continue;
    if (item.capAny / item.total < 0.8) continue;
    if (lexicon.level(lemma) !== null) continue;
    lemmas.add(lemma);
    runningWords += item.total;
  }

  return { lemmas, runningWords };
}
