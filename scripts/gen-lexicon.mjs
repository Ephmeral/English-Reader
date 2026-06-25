// 构建期脚本：把 BNC/COCA 词族表 (BNC_COCA_lists.csv) 转成紧凑的运行期查找表。
//
// 输入 CSV 列：List(1k..25k), Headword, Related forms("able (29930), abler (5)..."), Total frequency
// 关键洞察：
//   - "List" 列即 band：1k→1, 2k→2, ... 25k→25。整数、越大越难。
//   - "Related forms" 列把屈折/派生形式映射回 headword，是一份免费的高精度词形还原词典。
//     例：run 行含 running/ran/runs → 全部还原为 run(band 1)。
//
// 产物：src/data/lexicon-table.json
//   { version, source, maxBand, lemmas: string[], bands: number[], surface: { [form]: lemmaIndex } }
//   surface 的难度 = bands[surface[form]]；form 的原形 = lemmas[surface[form]]。
//
// 用法：npm run gen:lexicon

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_CSV = join(ROOT, 'src/data/BNC_COCA_lists.csv');
const OUT_JSON = join(ROOT, 'src/data/lexicon-table.json');

/** 极简 CSV 行解析：支持双引号包裹字段内的逗号。 */
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/** "able (29930)" → "able"；"good and" 之类多词短语保留（无害，单词 token 不会命中）。 */
function extractForm(token) {
  const m = token.trim().match(/^(.*?)\s*\(\d+\)\s*$/);
  return (m ? m[1] : token).trim().toLowerCase();
}

function bandFromList(list) {
  const m = list.trim().match(/^(\d+)k$/i);
  return m ? parseInt(m[1], 10) : null;
}

function main() {
  const raw = readFileSync(SRC_CSV, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // 跳过表头
  const rows = lines.slice(1);

  const lemmas = [];
  const bands = [];
  const lemmaIndex = new Map(); // headword -> index
  const surface = Object.create(null); // form -> lemma index（碰撞时保留更小 band）

  let maxBand = 0;

  for (const line of rows) {
    const cols = parseCsvLine(line);
    if (cols.length < 3) continue;
    const band = bandFromList(cols[0]);
    const headword = (cols[1] || '').trim().toLowerCase();
    if (band == null || !headword) continue;
    maxBand = Math.max(maxBand, band);

    let idx = lemmaIndex.get(headword);
    if (idx === undefined) {
      idx = lemmas.length;
      lemmas.push(headword);
      bands.push(band);
      lemmaIndex.set(headword, idx);
    }

    // 收集该词族的所有词面
    const forms = new Set([headword]);
    const related = cols[2] || '';
    for (const tok of related.split(',')) {
      const f = extractForm(tok);
      if (f) forms.add(f);
    }

    for (const form of forms) {
      const existing = surface[form];
      if (existing === undefined) {
        surface[form] = idx;
      } else {
        // 碰撞：保留更高频（band 更小）的归类，降低"假难"
        if (band < bands[existing]) surface[form] = idx;
      }
    }
  }

  const out = {
    version: 1,
    source: 'BNC/COCA word family lists (Paul Nation) — band = k-list (1..25)',
    generatedAt: new Date().toISOString(),
    maxBand,
    lemmaCount: lemmas.length,
    surfaceCount: Object.keys(surface).length,
    lemmas,
    bands,
    surface,
  };

  writeFileSync(OUT_JSON, JSON.stringify(out));
  console.log(
    `[gen:lexicon] lemmas=${lemmas.length} surfaces=${out.surfaceCount} maxBand=${maxBand}`,
  );
  console.log(`[gen:lexicon] wrote ${OUT_JSON}`);
}

main();
