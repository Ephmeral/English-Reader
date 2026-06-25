// 生词本写入逻辑（规格 §3 阶段4）。id 约定用 lemma；点过即建条目，标记理解度即更新。

import type { Document, Token } from '../core/model/token';
import { sentenceAround } from '../core/model/context';
import type { Comprehension, VocabEntry } from '../core/storage/storage';
import type { Deps } from './deps';

function lemmaOf(token: Token): string {
  return token.lemma ?? token.surface.toLowerCase();
}

async function findEntry(deps: Deps, id: string): Promise<VocabEntry | null> {
  const all = await deps.storage.loadVocab();
  return all.find((e) => e.id === id) ?? null;
}

/** 点词即持久化（comprehension 默认 unknown），并追加上下文句。 */
export async function upsertVocabOnClick(deps: Deps, doc: Document, token: Token): Promise<void> {
  const id = lemmaOf(token);
  const now = Date.now();
  const sentence = sentenceAround(doc, token);
  const existing = await findEntry(deps, id);

  if (existing) {
    const dup = existing.contexts.some((c) => c.docId === doc.id && c.tokenId === token.id);
    const entry: VocabEntry = {
      ...existing,
      surface: existing.surface || token.surface,
      band: existing.band ?? token.band ?? null,
      contexts: dup
        ? existing.contexts
        : [...existing.contexts, { docId: doc.id, sentence, tokenId: token.id, at: now }],
    };
    await deps.storage.saveVocabEntry(entry);
    return;
  }

  const entry: VocabEntry = {
    id,
    lemma: id,
    surface: token.surface,
    band: token.band ?? null,
    comprehension: 'unknown',
    contexts: [{ docId: doc.id, sentence, tokenId: token.id, at: now }],
    firstSeenAt: now,
    lastMarkedAt: now,
  };
  await deps.storage.saveVocabEntry(entry);
}

/** 设置理解程度并埋 comprehension_mark。 */
export async function setComprehension(
  deps: Deps,
  doc: Document,
  token: Token,
  mark: Comprehension,
): Promise<void> {
  const id = lemmaOf(token);
  const now = Date.now();
  const existing = await findEntry(deps, id);
  const base: VocabEntry = existing ?? {
    id,
    lemma: id,
    surface: token.surface,
    band: token.band ?? null,
    comprehension: 'unknown',
    contexts: [{ docId: doc.id, sentence: sentenceAround(doc, token), tokenId: token.id, at: now }],
    firstSeenAt: now,
    lastMarkedAt: now,
  };
  await deps.storage.saveVocabEntry({ ...base, comprehension: mark, lastMarkedAt: now });
  await deps.logger.log({ type: 'comprehension_mark', lemma: id, mark });
}
