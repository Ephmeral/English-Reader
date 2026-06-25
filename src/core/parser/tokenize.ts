// 词元化（规格 §1.1 边界）：把归一化纯文本切成 Token 流。
// 不变式：对每个 token，surface === source.slice(start, end)，且 token 全量覆盖 source。
// lemma/band 不在此填（导入预处理负责，见 lexicon/annotate.ts）。

import type { Token, TokenKind } from '../model/token';

// 单词：字母串，允许内部撇号/连字符（don't、well-known）。含直/弯撇号。
const RE_WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*/y;
const RE_NEWLINE = /(?:\r?\n)+/y;
const RE_SPACE = /[^\S\r\n]+/y; // 非换行空白

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let id = 0;

  const push = (kind: TokenKind, start: number, end: number) => {
    tokens.push({ id: id++, kind, surface: source.slice(start, end), start, end });
  };

  while (pos < source.length) {
    RE_WORD.lastIndex = pos;
    const wm = RE_WORD.exec(source);
    if (wm && wm.index === pos) {
      push('word', pos, pos + wm[0].length);
      pos += wm[0].length;
      continue;
    }

    RE_NEWLINE.lastIndex = pos;
    const nm = RE_NEWLINE.exec(source);
    if (nm && nm.index === pos) {
      push('newline', pos, pos + nm[0].length);
      pos += nm[0].length;
      continue;
    }

    RE_SPACE.lastIndex = pos;
    const sm = RE_SPACE.exec(source);
    if (sm && sm.index === pos) {
      push('space', pos, pos + sm[0].length);
      pos += sm[0].length;
      continue;
    }

    // 其余按单字符标点处理（含 emoji/CJK 等，单字成元保证可还原）。
    push('punct', pos, pos + 1);
    pos += 1;
  }

  return tokens;
}
