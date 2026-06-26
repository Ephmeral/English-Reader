import assert from 'node:assert/strict';
import { inferBehavioralBand } from '../src/core/assessment/behavior-suggestion';

const now = 1_000_000;

const down = inferBehavioralBand({
  measuredBand: 6,
  now,
  wordClicks: [
    ...Array.from({ length: 9 }, (_, index) => ({ band: 3, at: now - index })),
    ...Array.from({ length: 4 }, (_, index) => ({ band: 8, at: now - index })),
  ],
  comprehensionMarks: [],
  vocabEntries: [],
});
assert.deepEqual(down, { suggestedBand: 4, reason: 'lookup_below_level' });

const up = inferBehavioralBand({
  measuredBand: 4,
  now,
  wordClicks: [],
  comprehensionMarks: Array.from({ length: 6 }, (_, index) => ({
    lemma: `known-${index}`,
    mark: 'known',
    at: now - index,
  })),
  vocabEntries: Array.from({ length: 6 }, (_, index) => ({
    lemma: `known-${index}`,
    band: 7,
  })),
});
assert.deepEqual(up, { suggestedBand: 6, reason: 'known_above_level' });

const quiet = inferBehavioralBand({
  measuredBand: 5,
  now,
  wordClicks: Array.from({ length: 3 }, (_, index) => ({ band: 2, at: now - index })),
  comprehensionMarks: [],
  vocabEntries: [],
});
assert.equal(quiet, null);

const noMeasured = inferBehavioralBand({
  measuredBand: null,
  now,
  wordClicks: Array.from({ length: 20 }, (_, index) => ({ band: 1, at: now - index })),
  comprehensionMarks: [],
  vocabEntries: [],
});
assert.equal(noMeasured, null);

console.log('behavior suggestion checks passed');
