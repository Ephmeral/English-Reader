import type { Annotation } from '../core/model/annotation';
import type { Document } from '../core/model/token';

function offsetOf(annotation: Annotation): number {
  return annotation.anchor.kind === 'point' ? annotation.anchor.offset : annotation.anchor.start;
}

function chapterTitleFor(doc: Document, offset: number): string {
  const token =
    doc.tokens.find((t) => t.start <= offset && t.end >= offset) ??
    doc.tokens.find((t) => t.start >= offset) ??
    doc.tokens[0];
  if (!token) return doc.title;
  let chapter = doc.chapters[0]?.title ?? doc.title;
  for (const mark of doc.chapters) {
    if (mark.startTokenId <= token.id) chapter = mark.title;
    else break;
  }
  return chapter;
}

export function AnnotationsPanel({
  doc,
  annotations,
  currentOffset,
  onAddBookmark,
  onJump,
  onDelete,
  onUpdateNote,
}: {
  doc: Document;
  annotations: Annotation[];
  currentOffset: number;
  onAddBookmark: () => void;
  onJump: (offset: number) => void;
  onDelete: (id: string) => void;
  onUpdateNote: (annotation: Annotation, note: string) => void;
}) {
  return (
    <section className="annotations-panel" aria-label="我的标注">
      <div className="annotations-head">
        <span>我的标注</span>
        <button onClick={onAddBookmark}>书签</button>
      </div>
      <div className="annotation-current muted">当前位置 {currentOffset}</div>
      {annotations.length === 0 ? (
        <p className="empty annotation-empty">暂无标注。</p>
      ) : (
        <ol className="annotation-list">
          {annotations.map((annotation) => {
            const offset = offsetOf(annotation);
            const isPoint = annotation.anchor.kind === 'point';
            return (
              <li key={annotation.id} className="annotation-item">
                <button className="annotation-jump" onClick={() => onJump(offset)}>
                  <span className="annotation-kind">{isPoint ? '书签' : '划线'}</span>
                  <span className="annotation-chapter">{chapterTitleFor(doc, offset)}</span>
                  <span className="annotation-quote">
                    {isPoint ? `位置 ${offset}` : annotation.quote}
                  </span>
                </button>
                <input
                  className="annotation-note"
                  defaultValue={annotation.note ?? ''}
                  placeholder="评论"
                  onBlur={(e) => onUpdateNote(annotation, e.currentTarget.value)}
                />
                <button className="annotation-delete" onClick={() => onDelete(annotation.id)}>
                  删除
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
