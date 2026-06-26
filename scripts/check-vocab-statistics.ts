import assert from 'node:assert/strict';
import { detectProperNouns } from '../src/core/model/proper-nouns';
import { buildPrelearnPlan } from '../src/core/model/prelearn';
import {
  bucketDistribution,
  computeVocabProfile,
  coverageAtLevel,
  personalCoverage,
  typesByBand,
  vocabNeededFor,
} from '../src/core/model/vocab-profile';
import type { Document, Token } from '../src/core/model/token';
import type { Lexicon } from '../src/core/lexicon/lexicon';

const known = new Map<string, number>([
  ['the', 1],
  ['i', 1],
  ['went', 1],
  ['to', 1],
  ['and', 1],
  ['said', 1],
  ['saw', 1],
  ['it', 1],
]);

const lexicon: Lexicon = {
  level(word) {
    return known.get(word.toLowerCase()) ?? null;
  },
  annotate(surface) {
    const lemma = surface.toLowerCase();
    return { lemma, band: this.level(lemma) };
  },
};

function word(id: number, surface: string, start: number): Token {
  const annotation = lexicon.annotate(surface);
  return {
    id,
    kind: 'word',
    surface,
    start,
    end: start + surface.length,
    ...annotation,
  };
}

function punct(id: number, surface: string, start: number): Token {
  return { id, kind: 'punct', surface, start, end: start + surface.length };
}

function space(id: number, start: number): Token {
  return { id, kind: 'space', surface: ' ', start, end: start + 1 };
}

function doc(tokens: Token[]): Document {
  return {
    id: 'doc:test',
    title: 'Test',
    source: tokens.map((token) => token.surface).join(''),
    tokens,
    chapters: [{ title: 'Test', startTokenId: 0 }],
    blocks: [{ startTokenId: 0, role: 'paragraph' }],
    emphases: [],
    footnotes: [],
    meta: {
      id: 'doc:test',
      sourceFormat: 'txt',
      fileName: 'test.txt',
      importedAt: 0,
      tokenCount: tokens.length,
      wordCount: tokens.filter((token) => token.kind === 'word').length,
      annotated: true,
    },
  };
}

const sample = doc([
  word(0, 'Alice', 0),
  space(1, 5),
  word(2, 'went', 6),
  space(3, 10),
  word(4, 'to', 11),
  space(5, 13),
  word(6, 'Wonderland', 14),
  punct(7, '.', 24),
  space(8, 25),
  word(9, 'The', 26),
  space(10, 29),
  word(11, 'Cat', 30),
  space(12, 33),
  word(13, 'saw', 34),
  space(14, 37),
  word(15, 'Alice', 38),
  punct(16, '.', 43),
  space(17, 44),
  word(18, 'I', 45),
  space(19, 46),
  word(20, 'saw', 47),
  space(21, 50),
  word(22, 'Alice', 51),
  punct(23, '.', 56),
  space(24, 57),
  punct(25, "'", 58),
  word(26, 'It', 59),
  punct(27, '.', 61),
  punct(28, "'", 62),
  space(29, 63),
  word(30, 'said', 64),
  space(31, 68),
  word(32, 'the', 69),
  space(33, 72),
  word(34, 'King', 73),
  punct(35, '.', 77),
]);

const proper = detectProperNouns(sample, lexicon);

assert.deepEqual([...proper.lemmas].sort(), ['alice', 'cat', 'king', 'wonderland']);
assert.equal(proper.runningWords, 6);
assert.equal(proper.lemmas.has('i'), false);
assert.equal(proper.lemmas.has('the'), false);
assert.equal(proper.lemmas.has('it'), false);

const profile = computeVocabProfile(sample);
assert.equal(coverageAtLevel(profile, 1), 9 / 15);
assert.equal(personalCoverage({ doc: sample, learnerBand: 1, known: new Set(), unknown: new Set() }), 9 / 15);
assert.equal(coverageAtLevel(profile, 1, proper.runningWords), 1);
assert.equal(vocabNeededFor(profile, 0.95), null);
assert.equal(vocabNeededFor(profile, 0.95, proper.runningWords), 1);
assert.equal(personalCoverage({ doc: sample, learnerBand: 1, known: new Set(['alice']), unknown: new Set() }), 12 / 15);
assert.equal(personalCoverage({ doc: sample, learnerBand: 1, known: new Set(), unknown: new Set(['saw']) }), 7 / 15);

const distribution = bucketDistribution(profile, proper.runningWords);
assert.deepEqual(distribution, [9, 0, 0, 0, 0, 6]);

const { byBand, properNouns } = typesByBand(sample, proper.lemmas);
assert.deepEqual(
  properNouns.map((entry) => [entry.lemma, entry.count]),
  [
    ['alice', 3],
    ['cat', 1],
    ['king', 1],
    ['wonderland', 1],
  ],
);
assert.equal(byBand.get(0)?.some((entry) => proper.lemmas.has(entry.lemma)) ?? false, false);

const prelearnSample = doc([
  word(0, 'the', 0),
  space(1, 3),
  word(2, 'dragon', 4),
  space(3, 10),
  word(4, 'dragon', 11),
  space(5, 17),
  word(6, 'river', 18),
  space(7, 23),
  word(8, 'spell', 24),
  space(9, 29),
  word(10, 'spell', 30),
  space(11, 35),
  word(12, 'spell', 36),
  space(13, 41),
  word(14, 'Alice', 42),
]);
const prelearnPlan = buildPrelearnPlan(
  prelearnSample,
  1,
  new Set(),
  new Set(),
  0.75,
);
assert.equal(prelearnPlan.current, 1 / 8);
assert.deepEqual(
  prelearnPlan.words.map((entry) => [entry.lemma, entry.bookCount]),
  [
    ['spell', 3],
    ['dragon', 2],
  ],
);
assert.deepEqual(
  prelearnPlan.words.map((entry) => entry.cumulativeCoverage),
  [4 / 8, 6 / 8],
);
assert.equal(prelearnPlan.reachable, true);

const exhaustedPlan = buildPrelearnPlan(prelearnSample, 1, new Set(), new Set(), 0.99);
assert.equal(exhaustedPlan.reachable, false);
assert.equal(exhaustedPlan.words.at(-1)?.cumulativeCoverage, 7 / 8);

console.log('vocab statistics checks passed');
