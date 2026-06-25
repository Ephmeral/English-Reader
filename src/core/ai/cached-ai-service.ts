// AIService 实现：prompt 构造（盒内私有）+ 按「词+水平」狠缓存 + 透传 AbortSignal。

import type { AIService, AITransport, ExplainCache, ExplainInput, ExplainResult } from './ai-service';
import { cacheKey } from './ai-service';

/** 盒内私有：构造 i+1 英解英 prompt。解释本身需不高于学习者水平。 */
function buildPrompt(input: ExplainInput): string {
  const band = input.level.band;
  const ctx = input.context ? `\nThe word appears in: "${input.context.trim()}"` : '';
  return [
    `You are a concise English dictionary for an English learner.`,
    `The learner knows roughly the ${band}k most frequent English word families.`,
    `Explain the following word using ONLY simpler, more common English words (at or below the learner's level).`,
    `Keep it to one or two short sentences. No translation, no phonetics, no examples unless one short example helps.`,
    `word: "${input.word}"${ctx}`,
    `Explanation:`,
  ].join('\n');
}

export class CachedAIService implements AIService {
  constructor(
    private readonly transport: AITransport,
    private readonly cache: ExplainCache,
  ) {}

  async explain(input: ExplainInput, signal?: AbortSignal): Promise<ExplainResult> {
    const key = cacheKey(input);

    const hit = await this.cache.get(key);
    if (hit != null) {
      return { word: input.word, level: input.level, explanation: hit, cached: true };
    }

    const raw = await this.transport.complete(buildPrompt(input), { signal });
    const explanation = raw.trim();
    await this.cache.set(key, explanation);

    return { word: input.word, level: input.level, explanation, cached: false };
  }
}
