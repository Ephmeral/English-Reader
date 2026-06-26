import type { ReactNode } from 'react';

const WORD_CHAR = /[\p{L}\p{N}]/u;

function isWordChar(ch: string | undefined): boolean {
  return !!ch && WORD_CHAR.test(ch);
}

/** 在句中定位目标词。优先词边界匹配，避免把更长单词内部的子串（如 "art" in "start"）误高亮。 */
function findTarget(sentence: string, target: string): number {
  const lowerSentence = sentence.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const targetStartsWord = isWordChar(lowerTarget[0]);
  const targetEndsWord = isWordChar(lowerTarget[lowerTarget.length - 1]);
  for (let from = 0; from <= lowerSentence.length; ) {
    const idx = lowerSentence.indexOf(lowerTarget, from);
    if (idx < 0) break;
    const beforeOk = !targetStartsWord || !isWordChar(lowerSentence[idx - 1]);
    const afterOk = !targetEndsWord || !isWordChar(lowerSentence[idx + lowerTarget.length]);
    if (beforeOk && afterOk) return idx;
    from = idx + 1;
  }
  // 回退：找不到词边界匹配时退回首个子串匹配，保证仍有高亮。
  return lowerSentence.indexOf(lowerTarget);
}

function highlightedSentence(sentence: string, surface: string): ReactNode {
  const target = surface.trim();
  if (!target) return sentence;
  const start = findTarget(sentence, target);
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
