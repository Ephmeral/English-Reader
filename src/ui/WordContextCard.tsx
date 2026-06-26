import type { ReactNode } from 'react';

function highlightedSentence(sentence: string, surface: string): ReactNode {
  const target = surface.trim();
  if (!target) return sentence;
  const start = sentence.toLowerCase().indexOf(target.toLowerCase());
  if (start < 0) return sentence;
  const end = start + target.length;
  return (
    <>
      {sentence.slice(0, start)}
      <mark>{sentence.slice(start, end)}</mark>
      {sentence.slice(end)}
    </>
  );
}

export function WordContextCard({
  sentence,
  surface,
  onSpeak,
}: {
  sentence: string;
  surface: string;
  onSpeak?: () => void;
}) {
  return (
    <section className="word-context-card">
      <p>{highlightedSentence(sentence, surface)}</p>
      {onSpeak && (
        <button type="button" className="speech-button" onClick={onSpeak}>
          朗读例句
        </button>
      )}
    </section>
  );
}
