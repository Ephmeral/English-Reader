// 导入预处理（规格 §3 阶段2）：对 Document 的所有 word token 填 lemma + band，
// 置 meta.annotated = true。词元化与 COCA 标注在导入时后台预处理并缓存。

import type { Document } from '../model/token';
import type { Lexicon } from './lexicon';

/** 返回带标注的新 Document（不可变更新）。对 word 以外的 token 不动。 */
export function annotateDocument(doc: Document, lexicon: Lexicon): Document {
  if (doc.meta.annotated) return doc;

  const tokens = doc.tokens.map((t) => {
    if (t.kind !== 'word') return t;
    const { lemma, band } = lexicon.annotate(t.surface);
    return { ...t, lemma, band };
  });

  return {
    ...doc,
    tokens,
    meta: { ...doc.meta, annotated: true },
  };
}
