// 事件 / 数据 Schema（规格 §2，字段定死）。本地 append-only 事件日志，存 IndexedDB。
// 用于观测先行/滞后信号。字段不可增删改名而不回规格登记。

import type { Level } from '../model/level';
import type { Comprehension } from '../storage/storage';

export type AppEventType =
  | 'session_start'
  | 'session_end'
  | 'doc_open'
  | 'reading_progress'
  | 'word_click'
  | 'comprehension_mark'
  | 'explain_shown';

export interface AppEventBase {
  /** uuid。 */
  id: string;
  type: AppEventType;
  /** epoch ms。 */
  at: number;
  /** 关联到一次会话。 */
  sessionId: string;
}

export type AppEvent =
  | (AppEventBase & { type: 'session_start'; docId?: string })
  | (AppEventBase & { type: 'session_end'; durationMs: number })
  | (AppEventBase & {
      type: 'doc_open';
      docId: string;
      tokenCount: number;
      wordCount: number;
      sourceFormat: 'txt' | 'md' | 'epub';
      /** 打开时的滑块水平。 */
      sliderLevel: number;
    })
  | (AppEventBase & {
      type: 'reading_progress';
      docId: string;
      /** 到达的最大词元 id。 */
      maxTokenId: number;
      /** 读完比例 0..100（按词位置）。 */
      percent: number;
    })
  | (AppEventBase & {
      type: 'word_click';
      docId: string;
      tokenId: number;
      surface: string;
      lemma: string;
      band: number | null;
      /** 点击时的滑块水平——必填，用于归一化频段趋势。 */
      sliderLevel: number;
    })
  | (AppEventBase & {
      type: 'comprehension_mark';
      lemma: string;
      mark: Comprehension;
    })
  | (AppEventBase & {
      type: 'explain_shown';
      lemma: string;
      level: Level;
      /** 是否命中缓存——同时盯成本与重复曝光。 */
      cacheHit: boolean;
      latencyMs?: number;
    });
