// 导入流水线：file/text → SourceParser.parse → 导入预处理(annotate) → Storage.saveDocument。
// 词元化与 COCA 标注在导入时一次性预处理并缓存（规格 §2/§3 阶段2）。

import type { Document } from '../core/model/token';
import { annotateDocument } from '../core/lexicon/annotate';
import { computeVocabProfile } from '../core/model/vocab-profile';
import type { Deps } from './deps';

function mimeForFile(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.epub')) return 'application/epub+zip';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'text/markdown';
  return 'text/plain';
}

export async function importFromText(
  deps: Deps,
  input: { name: string; mime: string; text: string },
): Promise<Document> {
  const bytes = new TextEncoder().encode(input.text).buffer;
  const parsed = await deps.parser.parse({ name: input.name, mime: input.mime, bytes });
  const annotated = annotateDocument(parsed.document, deps.lexicon);
  annotated.meta.vocabProfile = computeVocabProfile(annotated);
  await deps.storage.saveDocument(annotated);
  for (const asset of parsed.assets) await deps.storage.saveAsset(annotated.id, asset);
  return annotated;
}

export async function importFromFile(deps: Deps, file: File): Promise<Document> {
  const bytes = await file.arrayBuffer();
  const mime = mimeForFile(file);
  const parsed = await deps.parser.parse({ name: file.name, mime, bytes });
  const annotated = annotateDocument(parsed.document, deps.lexicon);
  annotated.meta.vocabProfile = computeVocabProfile(annotated);
  await deps.storage.saveDocument(annotated);
  for (const asset of parsed.assets) await deps.storage.saveAsset(annotated.id, asset);
  return annotated;
}
