import assert from 'node:assert/strict';
import type { LexiconTable } from '../src/core/lexicon/lexicon';
import {
  bandFromVocabSize,
  calibratedBandFromLog,
  generateTest,
  scoreTest,
  type TestAnswers,
} from '../src/core/assessment/vocab-size-test';

function buildTable(): LexiconTable {
  const lemmas: string[] = [];
  const bands: number[] = [];
  const surface: Record<string, number> = {};

  for (let band = 1; band <= 5; band += 1) {
    for (let index = 0; index < 6; index += 1) {
      const lemma = `band${band}_${index}`;
      surface[lemma] = lemmas.length;
      lemmas.push(lemma);
      bands.push(band);
    }
  }

  return {
    version: 1,
    source: 'test',
    maxBand: 5,
    lemmas,
    bands,
    surface,
  };
}

const table = buildTable();
const decoys = ['magnal', 'stipible', 'band1_0', 'frandish'];

const first = generateTest(table, decoys, { perBand: 2, decoyRatio: 0.5, seed: 42 });
const second = generateTest(table, decoys, { perBand: 2, decoyRatio: 0.5, seed: 42 });
assert.deepEqual(second, first);
assert.equal(first.items.filter((item) => !item.isDecoy).length, 10);
assert.equal(first.items.filter((item) => item.isDecoy).length, 3);
assert.equal(first.items.some((item) => item.key === 'band1_0' && item.isDecoy), false);

const allKnown = Object.fromEntries(first.items.map((item) => [item.key, true]));
const allKnownResult = scoreTest(first, allKnown);
assert.equal(allKnownResult.decoyFalseAlarm, 1);
assert.equal(allKnownResult.reliable, false);
assert.equal(allKnownResult.estimatedBand, 1);

const lowOnly: TestAnswers = {};
for (const item of first.items) {
  lowOnly[item.key] = !item.isDecoy && item.band !== null && item.band <= 2;
}
const lowOnlyResult = scoreTest(first, lowOnly);
assert.equal(lowOnlyResult.reliable, true);
assert.equal(lowOnlyResult.estimatedSize, 2000);
assert.equal(lowOnlyResult.estimatedBand, 2);

assert.equal(bandFromVocabSize(1499), 1);
assert.equal(bandFromVocabSize(1500), 2);
assert.equal(bandFromVocabSize(999999), 25);
assert.equal(bandFromVocabSize(0), 1);

const now = 100_000;
assert.equal(
  calibratedBandFromLog([
    { at: now - 100, source: 'native', vocabSize: 3000, band: 3 },
    { at: now - 50, source: 'external', vocabSize: 6000, band: 6 },
  ], now),
  5,
);
assert.equal(
  calibratedBandFromLog([{ at: now - 50, source: 'external', vocabSize: 6000, band: 6 }], now),
  6,
);

console.log('vocab size test checks passed');
