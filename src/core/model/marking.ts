// 标记决策（规格 §6 验收门的可调旋钮之一："给专有名词/大写词加小停用表"）。
//
// 设计：band 保持诚实（OOV 仍为 null，照实写进日志），但"是否高亮"是 UI 层产品决策——
// 不把专有名词（伦敦/人名）当生词刷满屏。这样既满足 §1.2 "OOV isAbove 恒 true"，
// 又能压住 §6 里最典型的"假难"（专名被当生词）。

import type { Token } from './token';
import type { Level, LevelScale } from './level';

/** 形如 London / Krashen：首字母大写、其余为字母。"I" 等在表内的词不受影响（只抑制 OOV）。 */
export function looksLikeProperNoun(surface: string): boolean {
  return /^[A-Z][a-zA-Z'’-]*$/.test(surface) && /[a-z]/.test(surface);
}

/** 该 word token 是否应被高亮/可点。 */
export function shouldHighlight(
  token: Token,
  learner: Level,
  scale: LevelScale,
  knownLemmas: ReadonlySet<string> = new Set(),
): boolean {
  if (token.kind !== 'word') return false;
  const lemma = token.lemma ?? token.surface.toLowerCase();
  if (knownLemmas.has(lemma)) return false;
  const wordLevel = scale.ofWord(token);
  if (!scale.isAbove(wordLevel, learner)) return false;
  // 专名抑制：仅对 OOV 且形似专名者生效，避免满屏假难。
  if (token.band == null && looksLikeProperNoun(token.surface)) return false;
  return true;
}
