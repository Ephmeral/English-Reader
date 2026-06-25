// 阶段2 验收门报告（规格 §6）：分级质量。
// 读取真实文章 + 真实词表产物 (lexicon-table.json) + 真实标记逻辑（专名抑制），
// 在给定滑块水平下统计被标记词，并输出供人工核对 假难/假易 的清单与指标。
//
// 用法：node scripts/quality-report.mjs [article.txt] [sliderLevel=3]
//
// 通过线（硬性）：误判率(假难+假易)/总 word token < 10%，且每段"假难" ≤ 1。
// 注：假难/假易的最终判定需人工核对本脚本输出的清单；脚本给出量化骨架 + 启发式标记。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tokenize } from './_tokenize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const articlePath = process.argv[2] || join(ROOT, 'test/sample-article.txt');
const slider = parseInt(process.argv[3] || '3', 10);

const table = JSON.parse(readFileSync(join(ROOT, 'src/data/lexicon-table.json'), 'utf8'));

function stripPossessive(w) {
  return w.replace(/['’]s$/, '').replace(/['’]$/, '');
}
function annotate(surface) {
  const key = surface.toLowerCase();
  let idx = table.surface[key];
  if (idx === undefined) {
    const dep = stripPossessive(key);
    if (dep !== key) idx = table.surface[dep];
  }
  if (idx === undefined) return { lemma: key, band: null };
  return { lemma: table.lemmas[idx], band: table.bands[idx] };
}

function looksLikeProperNoun(s) {
  return /^[A-Z][a-zA-Z'’-]*$/.test(s) && /[a-z]/.test(s);
}

const source = readFileSync(articlePath, 'utf8');
const tokens = tokenize(source);
const words = tokens.filter((t) => t.kind === 'word');

// 按段落（newline 含空行）切分，用于"每段假难 ≤ 1"统计
const paragraphs = source
  .split(/\n{2,}/)
  .map((p) => p.trim())
  .filter(Boolean);

let marked = 0;
let oov = 0;
let oovProperSuppressed = 0;
const markedLemmas = new Map(); // lemma -> {surface, band, count}

for (const t of words) {
  const { lemma, band } = annotate(t.surface);
  if (band === null) oov++;
  const isAbove = band === null ? true : band > slider;
  if (!isAbove) continue;
  // 专名抑制（与 src/core/model/marking.ts 同逻辑）
  if (band === null && looksLikeProperNoun(t.surface)) {
    oovProperSuppressed++;
    continue;
  }
  marked++;
  const rec = markedLemmas.get(lemma) || { surface: t.surface, band, count: 0 };
  rec.count++;
  markedLemmas.set(lemma, rec);
}

// 每段假难启发式：统计每段被标记的 distinct lemma 数（人工再判其中哪些是真"假难"）
const perParaMarked = paragraphs.map((p) => {
  const ptoks = tokenize(p).filter((t) => t.kind === 'word');
  const set = new Set();
  for (const t of ptoks) {
    const { lemma, band } = annotate(t.surface);
    const isAbove = band === null ? true : band > slider;
    if (!isAbove) continue;
    if (band === null && looksLikeProperNoun(t.surface)) continue;
    set.add(lemma);
  }
  return set.size;
});

const sorted = [...markedLemmas.entries()].sort((a, b) => {
  const ba = a[1].band ?? 999;
  const bb = b[1].band ?? 999;
  return ba - bb || a[0].localeCompare(b[0]);
});

console.log('=== 阶段2 分级质量报告 (§6) ===');
console.log(`文章: ${articlePath}`);
console.log(`滑块水平 sliderLevel = ${slider}`);
console.log(`总 word token = ${words.length}, distinct marked lemma = ${markedLemmas.size}`);
console.log(`标记 word token = ${marked} (${((marked / words.length) * 100).toFixed(1)}%)`);
console.log(`OOV word token = ${oov}（其中疑似专名被抑制 = ${oovProperSuppressed}）`);
console.log(`段落数 = ${paragraphs.length}, 每段被标记 distinct lemma = [${perParaMarked.join(', ')}]`);
console.log(`每段最多被标记 lemma = ${Math.max(...perParaMarked)}`);
console.log('');
console.log('--- 被标记词清单（按 band 升序；OOV=未登录，需人工判是否"假难"）---');
for (const [lemma, rec] of sorted) {
  const bandLabel = rec.band === null ? 'OOV' : `${rec.band}k`;
  console.log(`  ${bandLabel.padStart(4)}  ${lemma}${rec.count > 1 ? ` (x${rec.count})` : ''}`);
}
console.log('');
console.log('提示：把上面 OOV 与高 band 词逐个对照文章语境，数"假难/假易"，套用 §6 通过线。');
