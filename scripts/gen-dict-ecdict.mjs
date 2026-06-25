// 离线转换：ECDICT CSV -> compact DictEntry JSON.
// Source: https://github.com/skywind3000/ECDICT/blob/master/ecdict.csv
// License: ECDICT project states the data may be freely used; see src/data/SOURCE.md.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const URL = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv';
const OUT = join(ROOT, 'src/data/dict/ecdict.json');

function targetWords() {
  const table = JSON.parse(readFileSync(join(ROOT, 'src/data/lexicon-table.json'), 'utf8'));
  return new Set([...table.lemmas, ...Object.keys(table.surface)].map((w) => w.toLowerCase()));
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quote && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quote = !quote;
      }
    } else if (ch === ',' && !quote) {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

function splitText(text, limit) {
  return text
    .replace(/\\n/g, '\n')
    .split(/\r?\n|;|；/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, limit);
}

const allowed = targetWords();
const res = await fetch(URL);
if (!res.ok) throw new Error(`ECDICT download failed: ${res.status}`);
const csv = await res.text();
const lines = csv.split(/\r?\n/);
const header = parseCsvLine(lines.shift() ?? '');
const index = Object.fromEntries(header.map((name, i) => [name, i]));
const entries = [];

for (const line of lines) {
  if (!line) continue;
  const row = parseCsvLine(line);
  const word = row[index.word]?.toLowerCase();
  if (!word || !allowed.has(word)) continue;
  const phonetic = row[index.phonetic]?.trim() || undefined;
  const definitions = splitText(row[index.definition] ?? '', 5);
  const translations = splitText(row[index.translation] ?? '', 6);
  if (definitions.length === 0 && translations.length === 0) continue;
  entries.push({
    word,
    ...(phonetic ? { phonetic } : {}),
    senses: definitions.map((gloss) => ({ gloss })),
    ...(translations.length ? { translations } : {}),
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(entries.sort((a, b) => a.word.localeCompare(b.word))));
console.log(`ecdict entries=${entries.length} out=${OUT}`);
