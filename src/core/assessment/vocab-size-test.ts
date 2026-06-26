import { SLIDER_MAX, SLIDER_MIN } from '../model/level';
import type { LexiconTable } from '../lexicon/lexicon';

export interface TestItem {
  key: string;
  band: number | null;
  isDecoy: boolean;
}

export interface TestSpec {
  items: TestItem[];
}

export interface TestAnswers {
  [key: string]: boolean;
}

export interface TestResult {
  estimatedSize: number;
  estimatedBand: number;
  decoyFalseAlarm: number;
  reliable: boolean;
}

export type MeasurementSource = 'native' | 'external';

export interface MeasurementLogEntry {
  at: number;
  source: MeasurementSource;
  vocabSize: number;
  band: number;
}

const DEFAULT_PER_BAND = 4;
const DEFAULT_DECOY_RATIO = 0.2;
const DECOY_RELIABILITY_LIMIT = 0.2;
const RECENT_CALIBRATION_MS = 30 * 24 * 60 * 60 * 1000;

function clampBand(value: number): number {
  if (!Number.isFinite(value)) return SLIDER_MIN;
  return Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Math.round(value)));
}

export function bandFromVocabSize(vocabSize: number): number {
  return clampBand(Math.round(vocabSize / 1000));
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sample<T>(items: readonly T[], count: number, rng: () => number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (pool.length > 0 && picked.length < count) {
    const index = Math.floor(rng() * pool.length);
    const [item] = pool.splice(index, 1);
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const left = items[i];
    const right = items[j];
    if (left === undefined || right === undefined) continue;
    items[i] = right;
    items[j] = left;
  }
  return items;
}

/** 从 lexicon 表按 band 分层抽样 + 掺入诱饵。每个 band 抽 perBand 个，覆盖 1..maxBand。 */
export function generateTest(
  table: LexiconTable,
  decoys: string[],
  opts: { perBand?: number; decoyRatio?: number; seed?: number } = {},
): TestSpec {
  const perBand = Math.max(1, Math.round(opts.perBand ?? DEFAULT_PER_BAND));
  const decoyRatio = Math.max(0, opts.decoyRatio ?? DEFAULT_DECOY_RATIO);
  const maxBand = clampBand(table.maxBand);
  const rng = makeRng(opts.seed ?? Date.now());
  const buckets = new Map<number, string[]>();

  for (let index = 0; index < table.lemmas.length; index += 1) {
    const key = table.lemmas[index];
    const band = table.bands[index];
    if (!key || typeof band !== 'number' || !Number.isFinite(band)) continue;
    if (band < SLIDER_MIN || band > maxBand) continue;
    const bucket = buckets.get(band) ?? [];
    bucket.push(key);
    buckets.set(band, bucket);
  }

  const items: TestItem[] = [];
  for (let band = SLIDER_MIN; band <= maxBand; band += 1) {
    for (const key of sample(buckets.get(band) ?? [], perBand, rng)) {
      items.push({ key, band, isDecoy: false });
    }
  }

  const desiredDecoys = Math.round(items.length * decoyRatio);
  const seenDecoys = new Set<string>();
  const eligibleDecoys = decoys
    .map((word) => word.trim().toLowerCase())
    .filter((word) => {
      if (!word || seenDecoys.has(word)) return false;
      seenDecoys.add(word);
      return table.surface[word] === undefined;
    });

  for (const key of sample(eligibleDecoys, desiredDecoys, rng)) {
    items.push({ key, band: null, isDecoy: true });
  }

  return { items: shuffle(items, rng) };
}

/** Nation 式估算：按 band 命中率推词族量，并用诱饵误认率折扣高估。 */
export function scoreTest(spec: TestSpec, answers: TestAnswers): TestResult {
  const byBand = new Map<number, { total: number; known: number }>();
  let decoyTotal = 0;
  let decoyKnown = 0;

  for (const item of spec.items) {
    const known = answers[item.key] === true;
    if (item.isDecoy) {
      decoyTotal += 1;
      if (known) decoyKnown += 1;
      continue;
    }
    if (item.band == null) continue;
    const entry = byBand.get(item.band) ?? { total: 0, known: 0 };
    entry.total += 1;
    if (known) entry.known += 1;
    byBand.set(item.band, entry);
  }

  let rawSize = 0;
  byBand.forEach((entry) => {
    rawSize += (entry.known / entry.total) * 1000;
  });

  const decoyFalseAlarm = decoyTotal > 0 ? decoyKnown / decoyTotal : 0;
  const estimatedSize = Math.round(Math.max(0, rawSize * (1 - decoyFalseAlarm)));

  return {
    estimatedSize,
    estimatedBand: bandFromVocabSize(estimatedSize),
    decoyFalseAlarm,
    reliable: decoyFalseAlarm <= DECOY_RELIABILITY_LIMIT,
  };
}

export function normalizeMeasurementLog(value: unknown): MeasurementLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is MeasurementLogEntry => {
      if (!item || typeof item !== 'object') return false;
      const raw = item as Partial<MeasurementLogEntry>;
      return (
        Number.isFinite(raw.at) &&
        (raw.source === 'native' || raw.source === 'external') &&
        Number.isFinite(raw.vocabSize) &&
        Number.isFinite(raw.band)
      );
    })
    .map((item) => ({
      at: Math.round(item.at),
      source: item.source,
      vocabSize: Math.max(0, Math.round(item.vocabSize)),
      band: clampBand(item.band),
    }))
    .sort((a, b) => a.at - b.at);
}

function latestRecent(
  log: readonly MeasurementLogEntry[],
  source: MeasurementSource,
  now: number,
): MeasurementLogEntry | null {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const entry = log[index];
    if (!entry || entry.source !== source) continue;
    if (now - entry.at <= RECENT_CALIBRATION_MS) return entry;
    return null;
  }
  return null;
}

/**
 * A/B 交叉校准策略：
 * 最近 30 天同时有内置测试与外部测试时，用词族量做加权平均，外部测试权重 0.6、
 * 内置测试权重 0.4；只有单一近期来源时采用该来源。这样不是简单后写覆盖前写，
 * 但也不会让很旧的测量长期牵制当前水平。
 */
export function calibratedBandFromLog(
  log: readonly MeasurementLogEntry[],
  now = Date.now(),
): number | null {
  const normalized = normalizeMeasurementLog(log);
  const native = latestRecent(normalized, 'native', now);
  const external = latestRecent(normalized, 'external', now);

  if (native && external) {
    return bandFromVocabSize(external.vocabSize * 0.6 + native.vocabSize * 0.4);
  }
  if (external) return external.band;
  if (native) return native.band;
  return null;
}
