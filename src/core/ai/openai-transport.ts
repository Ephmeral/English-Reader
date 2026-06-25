// OpenAI 兼容的 AITransport 实现（决策：第三方 OpenAI 兼容格式，默认 DeepSeek）。
// 配置（baseURL/apiKey/model）由调用方从 Storage settings 取后注入。
// 浏览器直连 + 本地自有 key；将来换薄 serverless 代理只需替换本 transport。

import type { AITransport } from './ai-service';
import { AIError } from '../errors';

export interface OpenAICompatConfig {
  /** 如 https://api.deepseek.com（自动补 /chat/completions）。 */
  baseURL: string;
  apiKey: string;
  /** 如 deepseek-chat。 */
  model: string;
  /** 采样温度，默认 0.3（释义要稳定、可缓存复用）。 */
  temperature?: number;
}

export const DEFAULT_AI_CONFIG: OpenAICompatConfig = {
  baseURL: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.3,
};

function endpoint(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/v1/chat/completions`;
}

export class OpenAICompatTransport implements AITransport {
  private readonly cfg: OpenAICompatConfig;

  constructor(cfg: OpenAICompatConfig) {
    this.cfg = cfg;
  }

  async complete(prompt: string, opts?: { signal?: AbortSignal }): Promise<string> {
    if (!this.cfg.apiKey) {
      throw new AIError('AI_NO_KEY', '未配置 API key，请到设置页填写。');
    }

    let res: Response;
    try {
      res = await fetch(endpoint(this.cfg.baseURL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          temperature: this.cfg.temperature ?? 0.3,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: opts?.signal,
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw new AIError('AI_ABORTED', '请求已取消。', { cause });
      }
      throw new AIError('AI_NETWORK', '网络请求失败。', { cause });
    }

    if (res.status === 429) {
      throw new AIError('AI_RATE_LIMIT', '触发限流，请稍后重试。');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AIError('AI_NETWORK', `LLM 返回 ${res.status}：${body.slice(0, 200)}`);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch (cause) {
      throw new AIError('AI_BAD_RESPONSE', '无法解析 LLM 响应。', { cause });
    }

    const content = extractContent(data);
    if (!content) {
      throw new AIError('AI_BAD_RESPONSE', 'LLM 响应缺少内容。');
    }
    return content;
  }
}

function extractContent(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as { message?: { content?: unknown } }).message;
  const content = msg?.content;
  return typeof content === 'string' ? content.trim() : null;
}
