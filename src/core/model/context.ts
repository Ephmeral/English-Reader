// 句子上下文提取（供 VocabEntry.contexts 与 explain 消歧）。纯函数，作用于 Document.source。

import type { Document, Token } from './token';

/** 取 token 所在句子（按 . ! ? 与段落边界切分），用于上下文与消歧。 */
export function sentenceAround(doc: Document, token: Token): string {
  const src = doc.source;
  // 向左找句首：上一个 .!? 或换行之后
  let start = token.start;
  while (start > 0) {
    const ch = src[start - 1];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') break;
    start--;
  }
  // 向右找句尾：下一个 .!? 或换行
  let end = token.end;
  while (end < src.length) {
    const ch = src[end];
    end++;
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') break;
  }
  return src.slice(start, end).trim();
}
