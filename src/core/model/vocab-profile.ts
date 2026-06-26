import type { Document, VocabProfile } from './token';
import type { Token } from './token';
import { DEFAULT_XRAY_SETTINGS, bucketOf } from './buckets';

const MAX_BAND = 25;

export interface BandWord {
  lemma: string;
  surface: string;
  count: number;
  token: Token;
}

export interface PersonalCoverageInput {
  doc: Document;
  learnerBand: number;
  known: ReadonlySet<string>;
  unknown: ReadonlySet<string>;
}

function bandIndex(band: number | null | undefined): number {
  if (band == null) return 0;
  const rounded = Math.round(band);
  return rounded >= 1 && rounded <= MAX_BAND ? rounded : 0;
}

function lemmaOf(token: Token): string {
  return token.lemma ?? token.surface.toLowerCase();
}

export function computeVocabProfile(doc: Document): VocabProfile {
  const bandCounts = Array(MAX_BAND + 1).fill(0) as number[];
  const types = new Set<string>();

  for (const token of doc.tokens) {
    if (token.kind !== 'word') continue;
    const index = bandIndex(token.band);
    bandCounts[index] = (bandCounts[index] ?? 0) + 1;
    types.add(token.lemma ?? token.surface.toLowerCase());
  }

  return {
    bandCounts,
    tokenCount: bandCounts.reduce((sum, count) => sum + count, 0),
    typeCount: types.size,
  };
}

export function bucketDistribution(
  profile: VocabProfile,
  properNounRunningWords = 0,
): number[] {
  const counts = Array(DEFAULT_XRAY_SETTINGS.buckets.length).fill(0) as number[];
  profile.bandCounts.forEach((count, band) => {
    const bucket = band === 0 ? 4 : bucketOf(band);
    const adjusted = band === 0 ? Math.max(0, count - properNounRunningWords) : count;
    counts[bucket] = (counts[bucket] ?? 0) + adjusted;
  });
  if (properNounRunningWords > 0) counts.push(properNounRunningWords);
  return counts;
}

export function typesByBand(
  doc: Document,
  properNounLemmas?: ReadonlySet<string>,
): { byBand: Map<number, BandWord[]>; properNouns: BandWord[] } {
  const words = new Map<string, BandWord>();

  for (const token of doc.tokens) {
    if (token.kind !== 'word') continue;
    const lemma = lemmaOf(token);
    const current = words.get(lemma);
    if (current) {
      current.count += 1;
    } else {
      words.set(lemma, { lemma, surface: token.surface, count: 1, token });
    }
  }

  const byBand = new Map<number, BandWord[]>();
  const properNouns: BandWord[] = [];
  for (const entry of words.values()) {
    if (properNounLemmas?.has(entry.lemma)) {
      properNouns.push(entry);
      continue;
    }
    const index = bandIndex(entry.token.band);
    const bucket = byBand.get(index);
    if (bucket) bucket.push(entry);
    else byBand.set(index, [entry]);
  }

  const sortWords = (a: BandWord, b: BandWord) => b.count - a.count || a.lemma.localeCompare(b.lemma);
  byBand.forEach((entries) => entries.sort(sortWords));
  properNouns.sort(sortWords);

  return { byBand, properNouns };
}

export function coverageAtLevel(
  profile: VocabProfile,
  sliderBand: number,
  excludeRunningWords = 0,
): number {
  const denominator = profile.tokenCount - excludeRunningWords;
  if (denominator <= 0) return 0;
  const level = Math.max(1, Math.min(MAX_BAND, Math.round(sliderBand)));
  let covered = 0;
  for (let band = 1; band <= level; band += 1) {
    covered += profile.bandCounts[band] ?? 0;
  }
  return covered / denominator;
}

export function personalCoverage(input: PersonalCoverageInput): number {
  const level = Math.max(1, Math.min(MAX_BAND, Math.round(input.learnerBand)));
  let total = 0;
  let covered = 0;

  for (const token of input.doc.tokens) {
    if (token.kind !== 'word') continue;
    total += 1;
    const lemma = lemmaOf(token);
    if (input.known.has(lemma)) {
      covered += 1;
      continue;
    }
    if (input.unknown.has(lemma)) continue;
    if (token.band != null && token.band <= level) covered += 1;
  }

  return total === 0 ? 0 : covered / total;
}

export function vocabNeededFor(
  profile: VocabProfile,
  ratio = 0.95,
  excludeRunningWords = 0,
): number | null {
  const denominator = profile.tokenCount - excludeRunningWords;
  if (denominator <= 0) return 0;
  let covered = 0;
  for (let band = 1; band <= MAX_BAND; band += 1) {
    covered += profile.bandCounts[band] ?? 0;
    if (covered / denominator >= ratio) return band;
  }
  return null;
}
