// md -> 纯文本（规格 §1.3 约定）：剥格式，仅保留段落边界（空行 / 换行）。
// 产出的纯文本将作为 Document.source，token 偏移索引到它（不是原始 md）。

import type { BlockRole } from '../model/token';

export interface MarkdownBlock {
  startOffset: number;
  role: BlockRole;
  level?: number;
}

export interface NormalizedMarkdown {
  source: string;
  blocks: MarkdownBlock[];
}

interface PendingBlock {
  lines: string[];
  role: BlockRole;
  level?: number;
}

function stripInlineMarkdown(text: string): string {
  // 图片 ![alt](url) -> alt；链接 [text](url) -> text。
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  return text;
}

export function normalizeMarkdown(md: string): NormalizedMarkdown {
  let text = md.replace(/\r\n/g, '\n');
  text = text.replace(/^```[^\n]*\n([\s\S]*?)```/gm, (_m, code: string) => code);

  const blocks: PendingBlock[] = [];
  let pending: PendingBlock | null = null;

  const pushPending = () => {
    if (!pending) return;
    const lines = pending.lines.map(stripInlineMarkdown).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0) blocks.push({ ...pending, lines });
    pending = null;
  };

  for (const raw of text.split('\n')) {
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
        lines: [stripInlineMarkdown(heading[2]!.trim())],
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
      blocks.push({ role: 'list-item', lines: [stripInlineMarkdown(list[1]!.trim())] });
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
  for (const block of blocks) {
    if (source.length > 0) source += '\n\n';
    indexed.push({ startOffset: source.length, role: block.role, level: block.level });
    source += block.lines.join('\n');
  }

  return { source: source.trim() + '\n', blocks: indexed };
}

export function stripMarkdown(md: string): string {
  return normalizeMarkdown(md).source;
}
