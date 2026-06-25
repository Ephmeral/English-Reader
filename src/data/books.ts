// 默认书清单（规格 §3 阶段5：≥3 本内置书）。用 Vite ?raw 把 books/ 下文本作为字符串引入。

export interface DefaultBook {
  fileName: string;
  title: string;
  mime: string;
  text: string;
}

const raw = import.meta.glob('./books/*.{txt,md}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function titleFrom(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .split('-')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export const DEFAULT_BOOKS: DefaultBook[] = Object.entries(raw)
  .map(([path, text]) => {
    const fileName = path.split('/').pop() ?? path;
    const mime = fileName.endsWith('.md') ? 'text/markdown' : 'text/plain';
    return { fileName, title: titleFrom(fileName), mime, text };
  })
  .sort((a, b) => a.title.localeCompare(b.title));
