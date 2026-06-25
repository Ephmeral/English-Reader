// md → 纯文本（规格 §1.3 约定）：剥格式，仅保留段落边界（空行 / 换行）。
// 产出的纯文本将作为 Document.source，token 偏移索引到它（不是原始 md）。

export function stripMarkdown(md: string): string {
  let text = md.replace(/\r\n/g, '\n');

  // 去除围栏代码块的栅栏标记，保留内部文本行。
  text = text.replace(/^```[^\n]*\n([\s\S]*?)```/gm, (_m, code: string) => code);

  // 行级处理
  const lines = text.split('\n').map((line) => {
    let l = line;
    // ATX 标题：去掉前导 #
    l = l.replace(/^\s{0,3}#{1,6}\s+/, '');
    // 引用块：去掉前导 >
    l = l.replace(/^\s{0,3}>\s?/, '');
    // 列表标记：- * + 或 1.
    l = l.replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/, '');
    // 分隔线整行
    if (/^\s{0,3}(?:[-*_]\s?){3,}$/.test(l)) return '';
    return l;
  });
  text = lines.join('\n');

  // 行内：图片 ![alt](url) → alt
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 链接 [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 行内代码 `code` → code
  text = text.replace(/`([^`]*)`/g, '$1');
  // 加粗/斜体标记
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');

  // 折叠 3+ 连续空行为段落边界（最多一个空行）
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim() + '\n';
}
