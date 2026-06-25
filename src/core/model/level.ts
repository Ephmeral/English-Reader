// Level 抽象（规格 §1.2）。单一内部水平，MVP 后端 = 词频频段。
// 未来映射 CEFR/雅思/托福只换实现，签名不变。

import type { Token } from './token';

/** 序数化难度值。MVP 由词频频段支撑。 */
export interface Level {
  /** 频段；与 Token.band 同尺度。越大越难。 */
  band: number;
}

export interface LevelScale {
  /** 词的难度 → Level。OOV（band 为 null）→ 最大难度。 */
  ofWord(token: Token): Level;
  /** 词是否高于学习者当前水平（= 是否应被标记/可点）。 */
  isAbove(wordLevel: Level, learnerLevel: Level): boolean;
  /** 由手动滑块位置构造学习者 Level。position 取值域由实现定义并在本文件登记。 */
  fromSlider(position: number): Level;
  /** UI 可读标签（MVP：频段数字；未来：CEFR 等）。供未来框架映射的缝。 */
  label(level: Level): string;
}

/**
 * MVP 实现：band = BNC/COCA k-list 序号（1..25，越大越难）。
 *
 * 滑块取值域登记（规格 §1.2 / §2 sliderLevel 进日志）：
 *   - position 为整数 1..25，语义="我大概掌握到第 position 千词族"。
 *   - 默认 3（约 3k 词族 ≈ 中级），见 SLIDER_DEFAULT。
 *   - 标记规则：word.band > learner.band 视为"高于水平"（应被标记/可点）。
 *   - OOV（band=null）的 word 在 ofWord 中映射为 OOV_BAND（最难），恒高于任何 learner。
 */
export const SLIDER_MIN = 1;
export const SLIDER_MAX = 25;
export const SLIDER_DEFAULT = 3;

/** OOV 难度：比任何真实 band 都大，保证恒被标记。 */
export const OOV_BAND = Number.MAX_SAFE_INTEGER;

export class BandLevelScale implements LevelScale {
  ofWord(token: Token): Level {
    const band = token.band;
    if (band == null) return { band: OOV_BAND };
    return { band };
  }

  isAbove(wordLevel: Level, learnerLevel: Level): boolean {
    return wordLevel.band > learnerLevel.band;
  }

  fromSlider(position: number): Level {
    const clamped = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Math.round(position)));
    return { band: clamped };
  }

  label(level: Level): string {
    if (level.band === OOV_BAND || level.band > SLIDER_MAX) return 'OOV';
    return `${level.band}k`;
  }
}
