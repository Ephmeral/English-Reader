import { SLIDER_MAX, SLIDER_MIN } from '../model/level';
import type { Comprehension } from '../storage/storage';

export interface WordClickSignal {
  band: number | null;
  at: number;
}

export interface ComprehensionMarkSignal {
  lemma: string;
  mark: Comprehension;
  at: number;
}

export interface VocabBandSignal {
  lemma: string;
  band: number | null;
}

export interface BehavioralBandSuggestion {
  suggestedBand: number;
  reason: 'lookup_below_level' | 'known_above_level';
}

const RECENT_LOOKUP_MS = 14 * 24 * 60 * 60 * 1000;
const RECENT_MARK_MS = 30 * 24 * 60 * 60 * 1000;
const LOW_LOOKUP_MIN_COUNT = 8;
const LOW_LOOKUP_RATIO = 0.35;
const HIGH_KNOWN_MIN_COUNT = 5;

function clampBand(value: number): number {
  return Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Math.round(value)));
}

/**
 * 从被动行为估计一个温和的水平建议，只返回建议，不直接改 measuredBand。
 *
 * - 低于 measuredBand 的词被频繁点击，说明当前事实水平可能偏高。
 * - 高于 measuredBand 的词被持续标 known，说明当前事实水平可能偏低。
 * - 两种信号同时出现时，只有更强的一侧胜出；接近打平则不提示。
 */
export function inferBehavioralBand({
  measuredBand,
  wordClicks,
  comprehensionMarks,
  vocabEntries,
  now = Date.now(),
}: {
  measuredBand: number | null;
  wordClicks: readonly WordClickSignal[];
  comprehensionMarks: readonly ComprehensionMarkSignal[];
  vocabEntries: readonly VocabBandSignal[];
  now?: number;
}): BehavioralBandSuggestion | null {
  if (measuredBand == null) return null;

  const recentClicks = wordClicks.filter(
    (event) =>
      now - event.at <= RECENT_LOOKUP_MS &&
      typeof event.band === 'number' &&
      Number.isFinite(event.band),
  );
  const lowLookups = recentClicks.filter((event) => event.band !== null && event.band < measuredBand);
  const lowRatio = recentClicks.length > 0 ? lowLookups.length / recentClicks.length : 0;
  const downScore =
    lowLookups.length >= LOW_LOOKUP_MIN_COUNT && lowRatio >= LOW_LOOKUP_RATIO ? lowRatio : 0;

  const bandByLemma = new Map(
    vocabEntries
      .filter((entry) => typeof entry.band === 'number' && Number.isFinite(entry.band))
      .map((entry) => [entry.lemma, entry.band as number]),
  );
  const recentKnownHigh = comprehensionMarks
    .filter((event) => event.mark === 'known' && now - event.at <= RECENT_MARK_MS)
    .map((event) => bandByLemma.get(event.lemma))
    .filter((band): band is number => typeof band === 'number' && band > measuredBand);
  const upScore =
    recentKnownHigh.length >= HIGH_KNOWN_MIN_COUNT
      ? Math.min(1, recentKnownHigh.length / 10)
      : 0;

  if (downScore === 0 && upScore === 0) return null;
  if (Math.abs(upScore - downScore) < 0.15) return null;

  if (upScore > downScore) {
    const averageHighBand =
      recentKnownHigh.reduce((sum, band) => sum + band, 0) / recentKnownHigh.length;
    const suggestedBand = clampBand(Math.min(measuredBand + 2, Math.round(averageHighBand - 1)));
    if (suggestedBand === measuredBand) return null;
    return {
      suggestedBand,
      reason: 'known_above_level',
    };
  }

  const averageLowBand =
    lowLookups.reduce((sum, event) => sum + (event.band ?? 0), 0) / lowLookups.length;
  const suggestedBand = clampBand(Math.round(averageLowBand + 1));
  if (suggestedBand === measuredBand) return null;
  return {
    suggestedBand,
    reason: 'lookup_below_level',
  };
}
