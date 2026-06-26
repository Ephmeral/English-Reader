// md -> 纯文本（规格 §1.3 约定）：剥格式，仅保留段落边界（空行 / 换行）。
// 产出的纯文本将作为 Document.source，token 偏移索引到它（不是原始 md）。

import type { BlockRole, EmphasisStyle } from '../model/token';

export interface MarkdownBlock {
  startOffset: number;
  role: BlockRole;
  level?: number;
}

export interface MarkdownEmphasis {
  start: number;
  end: number;
  style: EmphasisStyle;
}

export interface MarkdownNoteref {
  id: string;
  label: string;
  start: number;
  end: number;
}

export interface MarkdownFootnoteDefinition {
  id: string;
  body: string;
}

export interface NormalizedMarkdown {
  source: string;
  blocks: MarkdownBlock[];
  emphases: MarkdownEmphasis[];
  noterefs: MarkdownNoteref[];
  footnotes: MarkdownFootnoteDefinition[];
}

interface PendingBlock {
  lines: string[];
  role: BlockRole;
  level?: number;
}

interface NormalizedLine {
  text: string;
  emphases: MarkdownEmphasis[];
  noterefs: MarkdownNoteref[];
}

interface NormalizedBlock {
  lines: NormalizedLine[];
  role: BlockRole;
  level?: number;
}

function stripLinksAndCode(text: string): string {
  // 图片 ![alt](url) -> alt；链接 [text](url) -> text。
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/`([^`]*)`/g, '$1');
  return text;
}

function collectInlineMarkdown(raw: string): NormalizedLine {
  const text = stripLinksAndCode(raw);
  const emphases: MarkdownEmphasis[] = [];
  const noterefs: MarkdownNoteref[] = [];
  const re = /\[\^([^\]]+)\]|(\*\*|__)([\s\S]+?)\2|(\*|_)([\s\S]+?)\4/g;
  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    out += text.slice(cursor, match.index);
    if (match[1]) {
      const id = match[1];
      const start = out.length;
      out += id;
      noterefs.push({ id, label: id, start, end: out.length });
      cursor = match.index + match[0].length;
      continue;
    }

    const content = match[3] ?? match[5] ?? '';
    const style: EmphasisStyle = match[2] ? 'bold' : 'italic';
    const start = out.length;
    out += content;
    if (start < out.length) emphases.push({ start, end: out.length, style });
    cursor = match.index + match[0].length;
  }

  out += text.slice(cursor);
  return { text: out, emphases, noterefs };
}

function trimLine(line: NormalizedLine): NormalizedLine {
  const leading = line.text.match(/^\s*/)?.[0].length ?? 0;
  const trailing = line.text.length - (line.text.match(/\s*$/)?.[0].length ?? 0);
  if (trailing <= leading) return { text: '', emphases: [], noterefs: [] };

  const emphases = line.emphases
    .map((emphasis) => ({
      start: Math.max(emphasis.start, leading) - leading,
      end: Math.min(emphasis.end, trailing) - leading,
      style: emphasis.style,
    }))
    .filter((emphasis) => emphasis.start < emphasis.end);

  const noterefs = line.noterefs
    .map((noteref) => ({
      ...noteref,
      start: Math.max(noteref.start, leading) - leading,
      end: Math.min(noteref.end, trailing) - leading,
    }))
    .filter((noteref) => noteref.start < noteref.end);

  return { text: line.text.slice(leading, trailing), emphases, noterefs };
}

function normalizeLine(raw: string): NormalizedLine {
  return trimLine(collectInlineMarkdown(raw));
}

function normalizeBlockLines(lines: readonly string[]): NormalizedLine[] {
  return lines.map(normalizeLine).filter((line) => line.text.length > 0);
}

export function normalizeMarkdown(md: string): NormalizedMarkdown {
  let text = md.replace(/\r\n/g, '\n');
  text = text.replace(/^```[^\n]*\n([\s\S]*?)```/gm, (_m, code: string) => code);
  const footnoteBodies = new Map<string, string>();
  const bodyLines: string[] = [];

  for (const raw of text.split('\n')) {
    const definition = raw.match(/^\s{0,3}\[\^([^\]]+)\]:\s*(.*)$/);
    if (definition) {
      footnoteBodies.set(definition[1]!, normalizeLine(definition[2] ?? '').text);
      continue;
    }
    bodyLines.push(raw);
  }

  const blocks: NormalizedBlock[] = [];
  let pending: PendingBlock | null = null;

  const pushPending = () => {
    if (!pending) return;
    const lines = normalizeBlockLines(pending.lines);
    if (lines.length > 0) blocks.push({ ...pending, lines });
    pending = null;
  };

  for (const raw of bodyLines) {
    if (/^\s*$/.test(raw) || /^\s{0,3}(?:[-*_]\s?){3,}$/.test(raw)) {
      pushPending();
      continue;
    }

    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      pushPending();
      blocks.push({
        role: 'heading',
        level: heading[1]!.length,
        lines: normalizeBlockLines([heading[2]!.trim()]),
      });
      continue;
    }

    const quote = raw.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) {
      const line = quote[1] ?? '';
      if (pending?.role !== 'blockquote') {
        pushPending();
        pending = { role: 'blockquote', lines: [line] };
      } else {
        pending.lines.push(line);
      }
      continue;
    }

    const list = raw.match(/^\s{0,3}(?:[-*+]|\d+\.)\s+(.*)$/);
    if (list) {
      pushPending();
      blocks.push({ role: 'list-item', lines: normalizeBlockLines([list[1]!.trim()]) });
      continue;
    }

    if (pending?.role !== 'paragraph') {
      pushPending();
      pending = { role: 'paragraph', lines: [raw] };
    } else {
      pending.lines.push(raw);
    }
  }
  pushPending();

  let source = '';
  const indexed: MarkdownBlock[] = [];
  const emphases: MarkdownEmphasis[] = [];
  const noterefs: MarkdownNoteref[] = [];
  for (const block of blocks) {
    if (source.length > 0) source += '\n\n';
    indexed.push({ startOffset: source.length, role: block.role, level: block.level });
    block.lines.forEach((line, index) => {
      if (index > 0) source += '\n';
      const lineStart = source.length;
      for (const emphasis of line.emphases) {
        emphases.push({
          start: lineStart + emphasis.start,
          end: lineStart + emphasis.end,
          style: emphasis.style,
        });
      }
      for (const noteref of line.noterefs) {
        noterefs.push({
          id: noteref.id,
          label: noteref.label,
          start: lineStart + noteref.start,
          end: lineStart + noteref.end,
        });
      }
      source += line.text;
    });
  }

  return {
    source: source.trim() + '\n',
    blocks: indexed,
    emphases,
    noterefs,
    footnotes: [...footnoteBodies].map(([id, body]) => ({ id, body })),
  };
}

export function stripMarkdown(md: string): string {
  return normalizeMarkdown(md).source;
}
