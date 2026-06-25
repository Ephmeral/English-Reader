import type { Annotation } from '../core/model/annotation';
import type { Document } from '../core/model/token';
import type { Deps } from './deps';

function anchorOffset(annotation: Annotation): number {
  return annotation.anchor.kind === 'point' ? annotation.anchor.offset : annotation.anchor.start;
}

export async function listAnnotations(deps: Deps, docId: string): Promise<Annotation[]> {
  const annotations = await deps.storage.loadAnnotations(docId);
  return annotations.sort((a, b) => anchorOffset(a) - anchorOffset(b));
}

export async function createRangeAnnotation(
  deps: Deps,
  doc: Document,
  range: { start: number; end: number; quote: string; note?: string },
): Promise<Annotation> {
  const now = Date.now();
  const annotation: Annotation = {
    id: crypto.randomUUID(),
    docId: doc.id,
    anchor: { kind: 'range', start: range.start, end: range.end },
    quote: range.quote,
    note: range.note?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await deps.storage.saveAnnotation(annotation);
  return annotation;
}

export async function createBookmarkAnnotation(
  deps: Deps,
  doc: Document,
  offset: number,
): Promise<Annotation> {
  const now = Date.now();
  const annotation: Annotation = {
    id: crypto.randomUUID(),
    docId: doc.id,
    anchor: { kind: 'point', offset },
    quote: '',
    createdAt: now,
    updatedAt: now,
  };
  await deps.storage.saveAnnotation(annotation);
  return annotation;
}

export async function updateAnnotationNote(
  deps: Deps,
  annotation: Annotation,
  note: string,
): Promise<Annotation> {
  const updated: Annotation = {
    ...annotation,
    note: note.trim() || undefined,
    updatedAt: Date.now(),
  };
  await deps.storage.saveAnnotation(updated);
  return updated;
}

export async function removeAnnotation(deps: Deps, id: string): Promise<void> {
  await deps.storage.deleteAnnotation(id);
}
