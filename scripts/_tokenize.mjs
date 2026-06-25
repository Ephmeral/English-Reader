// 验证脚本用的词元化镜像（与 src/core/parser/tokenize.ts 保持同一套正则）。
// 作为独立再实现，用于交叉校验 surface===slice 不变式。

const RE_WORD = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/y;
const RE_NEWLINE = /(?:\r?\n)+/y;
const RE_SPACE = /[^\S\r\n]+/y;

export function tokenize(source) {
  const tokens = [];
  let pos = 0;
  let id = 0;
  const push = (kind, start, end) =>
    tokens.push({ id: id++, kind, surface: source.slice(start, end), start, end });

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
    push('punct', pos, pos + 1);
    pos += 1;
  }
  return tokens;
}
