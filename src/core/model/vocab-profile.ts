import type { Document, VocabProfile } from './token';

const MAX_BAND = 25;

function bandIndex(band: number | null | undefined): number {
  if (band == null) return 0;
  const rounded = Math.round(band);
  return rounded >= 1 && rounded <= MAX_BAND ? rounded : 0;
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

export function coverageAtLevel(profile: VocabProfile, sliderBand: number): number {
  if (profile.tokenCount === 0) return 0;
  const level = Math.max(1, Math.min(MAX_BAND, Math.round(sliderBand)));
  let covered = 0;
  for (let band = 1; band <= level; band += 1) {
    covered += profile.bandCounts[band] ?? 0;
  }
  return covered / profile.tokenCount;
}

export function vocabNeededFor(profile: VocabProfile, ratio = 0.95): number | null {
  if (profile.tokenCount === 0) return 0;
  let covered = 0;
  for (let band = 1; band <= MAX_BAND; band += 1) {
    covered += profile.bandCounts[band] ?? 0;
    if (covered / profile.tokenCount >= ratio) return band;
  }
  return null;
}
