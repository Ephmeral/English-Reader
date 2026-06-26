import { looksLikeProperNoun } from './marking';
import type { Document, Token } from './token';
import { personalCoverage } from './vocab-profile';

export interface PrelearnWord {
  lemma: string;
  surface: string;
  band: number | null;
  bookCount: number;
  cumulativeCoverage: number;
}

export interface PrelearnPlan {
  current: number;
  target: number;
  words: PrelearnWord[];
  reachable: boolean;
}

interface Candidate {
  lemma: string;
  surface: string;
  band: number | null;
  bookCount: number;
}

function lemmaOf(token: Token): string {
  return token.lemma ?? token.surface.toLowerCase();
}

function currentCovered(
  token: Token,
  learnerBand: number,
  known: ReadonlySet<string>,
  unknown: ReadonlySet<string>,
): boolean {
  const lemma = lemmaOf(token);
  if (known.has(lemma)) return true;
  if (unknown.has(lemma)) return false;
  return token.band != null && token.band <= learnerBand;
}

export function buildPrelearnPlan(
  doc: Document,
  learnerBand: number,
  known: ReadonlySet<string>,
  unknown: ReadonlySet<string>,
  target = 0.98,
): PrelearnPlan {
  const candidates = new Map<string, Candidate>();
  let total = 0;

  for (const token of doc.tokens) {
    if (token.kind !== 'word') continue;
    total += 1;
    if (currentCovered(token, learnerBand, known, unknown)) continue;
    if (token.band == null && looksLikeProperNoun(token.surface)) continue;

    const lemma = lemmaOf(token);
    const existing = candidates.get(lemma);
    if (existing) {
      existing.bookCount += 1;
    } else {
      candidates.set(lemma, {
        lemma,
        surface: token.surface,
        band: token.band ?? null,
        bookCount: 1,
      });
    }
  }

  const current = personalCoverage({ doc, learnerBand, known, unknown });
  if (total === 0 || current >= target) {
    return { current, target, words: [], reachable: current >= target };
  }

  const sorted = [...candidates.values()].sort(
    (a, b) => b.bookCount - a.bookCount || a.lemma.localeCompare(b.lemma),
  );
  const words: PrelearnWord[] = [];
  let cumulative = current;

  for (const candidate of sorted) {
    cumulative += candidate.bookCount / total;
    words.push({ ...candidate, cumulativeCoverage: Math.min(1, cumulative) });
    if (cumulative >= target) break;
  }

  return {
    current,
    target,
    words,
    reachable: cumulative >= target,
  };
}
