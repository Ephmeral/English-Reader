import type { Document } from '../core/model/token';

export function Toc({
  doc,
  currentChapter,
  onSelect,
}: {
  doc: Document;
  currentChapter: number;
  onSelect: (index: number) => void;
}) {
  if (doc.chapters.length <= 1) return null;

  return (
    <section className="toc" aria-label="目录">
      <div className="toc-head">目录</div>
      <ol className="toc-list">
        {doc.chapters.map((chapter, i) => (
          <li key={`${chapter.startTokenId}:${i}`}>
            <button
              className={i === currentChapter ? 'active' : ''}
              onClick={() => onSelect(i)}
              title={chapter.title}
            >
              {chapter.title}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
