// 阶段1 验证脚本：校验所有 token 偏移自洽。
// 断言：① surface === source.slice(start,end)；② token 全量覆盖 source（无缝无叠）。
// 用法：node scripts/check-offsets.mjs [file ...]（缺省用内置样例）

import { readFileSync } from 'node:fs';
import { tokenize } from './_tokenize.mjs';

const SAMPLE = `Hello, world!

This is a "test" — with don't, well-known words,
and some 中文 too.\tTabs and  double spaces.
`;

function checkOne(name, source) {
  const tokens = tokenize(source);
  let sliceFails = 0;
  let coverFails = 0;
  let cursor = 0;
  for (const t of tokens) {
    if (t.surface !== source.slice(t.start, t.end)) sliceFails++;
    if (t.start !== cursor) coverFails++;
    cursor = t.end;
  }
  if (cursor !== source.length) coverFails++;
  const ok = sliceFails === 0 && coverFails === 0;
  console.log(
    `[offsets] ${name}: tokens=${tokens.length} sliceFails=${sliceFails} coverFails=${coverFails} => ${ok ? 'PASS' : 'FAIL'}`,
  );
  return ok;
}

const files = process.argv.slice(2);
let allOk = true;
if (files.length === 0) {
  allOk = checkOne('built-in-sample', SAMPLE) && allOk;
} else {
  for (const f of files) {
    allOk = checkOne(f, readFileSync(f, 'utf8')) && allOk;
  }
}

process.exit(allOk ? 0 : 1);
