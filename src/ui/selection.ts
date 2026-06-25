export interface SourceSelection {
  start: number;
  end: number;
  quote: string;
  rect: DOMRect;
}

function elementFromNode(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function anchoredElement(node: Node): HTMLElement | null {
  return elementFromNode(node)?.closest<HTMLElement>('[data-start]') ?? null;
}

function pointOffset(node: Node, offset: number, preferEnd: boolean): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const el = anchoredElement(node);
    const base = Number(el?.dataset.start);
    return Number.isFinite(base) ? base + offset : null;
  }

  const element = elementFromNode(node);
  if (!element) return null;
  const childIndex = preferEnd ? Math.max(0, offset - 1) : offset;
  const child = element.childNodes[childIndex] ?? element;
  const anchored = anchoredElement(child) ?? element.closest<HTMLElement>('[data-start]');
  const base = Number(anchored?.dataset.start);
  if (!Number.isFinite(base)) return null;
  return preferEnd ? base + (anchored?.textContent?.length ?? 0) : base;
}

export function selectionToSourceRange(root: HTMLElement, source: string): SourceSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  const startEl = elementFromNode(range.startContainer);
  const endEl = elementFromNode(range.endContainer);
  if (!startEl || !endEl || !root.contains(startEl) || !root.contains(endEl)) return null;

  const start = pointOffset(range.startContainer, range.startOffset, false);
  const end = pointOffset(range.endContainer, range.endOffset, true);
  if (start == null || end == null) return null;

  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(source.length, Math.max(start, end));
  if (from === to) return null;

  return {
    start: from,
    end: to,
    quote: source.slice(from, to),
    rect: range.getBoundingClientRect(),
  };
}
