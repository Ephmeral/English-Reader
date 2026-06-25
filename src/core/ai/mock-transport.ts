// Mock transport（规格 §3 阶段3 验证："先用 Mock transport 跑通闭环，再接真实 transport"）。
// 不发网络，返回一段确定性的"解释"，便于本地端到端验证缓存/浮层闭环。

import type { AITransport } from './ai-service';

export class MockTransport implements AITransport {
  constructor(private readonly delayMs = 350) {}

  async complete(prompt: string, opts?: { signal?: AbortSignal }): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, this.delayMs);
      opts?.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
    // 从 prompt 里抠出被解释的词（仅用于让 mock 输出可辨识）。
    const m = prompt.match(/word:\s*"?([A-Za-z'’-]+)"?/i);
    const word = m ? m[1] : 'this word';
    return `(mock) A simple meaning of "${word}": something you can understand from everyday words.`;
  }
}
