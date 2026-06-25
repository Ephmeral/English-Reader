// AIService（规格 §1.5）：MVP 里唯一的 LLM 入口。所有 LLM 调用藏此后面，狠缓存。

import type { Level } from '../model/level';

export interface ExplainInput {
  /** 缓存键的一部分；约定用归一化原形（lemma）。 */
  word: string;
  /** 学习者水平；缓存键的一部分。 */
  level: Level;
  /**
   * 可选上下文句，用于消歧。
   * MVP 约定：不进缓存键（一词多义为【已接受的 MVP 局限】）。
   */
  context?: string;
}

export interface ExplainResult {
  word: string;
  level: Level;
  /** 简洁英文解释；其本身应不高于学习者水平（i+1 的定义也要可理解）。 */
  explanation: string;
  /** 是否命中缓存。 */
  cached: boolean;
}

export interface AIService {
  /**
   * 对高于水平的词给 i+1 英文解释。
   * 缓存键 = normalize(word) + level。命中不调用 LLM。
   * 错误：无 key / 网络 / 限流 → 抛 AIError（带 code），调用方渲染错误+重试态。
   * 支持取消：实现应接受 AbortSignal（经 transport 透传）。
   */
  explain(input: ExplainInput, signal?: AbortSignal): Promise<ExplainResult>;
}

/**
 * 决策①的缝：MVP 实现 = 直连 LLM + 本地自有 key；
 * 拉用户时的实现 = 极薄 serverless 代理（key 留服务端 + 限流）。
 * 两种实现都满足此 transport，AIService.explain 签名不变。
 */
export interface AITransport {
  complete(prompt: string, opts?: { signal?: AbortSignal }): Promise<string>;
}

/** explain 缓存抽象（落地由 Storage 决定，缓存键规则见 cacheKey）。 */
export interface ExplainCache {
  get(key: string): Promise<string | null>;
  set(key: string, explanation: string): Promise<void>;
}

/** 缓存键 = normalize(word) + level.band（规格 §1.5：context 不进缓存键）。 */
export function cacheKey(input: ExplainInput): string {
  return `${input.word.trim().toLowerCase()}@${input.level.band}`;
}
