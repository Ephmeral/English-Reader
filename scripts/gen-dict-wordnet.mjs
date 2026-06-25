// 离线转换：WordNet 3.0 database files -> compact DictEntry JSON.
// Source: https://wordnet.princeton.edu/ and https://wordnetcode.princeton.edu/3.0/WNdb-3.0.tar.gz
// License: WordNet license, see https://wordnet.princeton.edu/license-and-commercial-use

import { createGunzip } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const URL = 'https://wordnetcode.princeton.edu/3.0/WNdb-3.0.tar.gz';
const OUT = join(ROOT, 'src/data/dict/wordnet.json');
const POS = new Map([
  ['n', 'noun'],
  ['v', 'verb'],
  ['a', 'adj'],
  ['s', 'adj'],
  ['r', 'adv'],
]);
const POS_ORDER = new Map([
  ['noun', 0],
  ['verb', 1],
  ['adj', 2],
  ['adv', 3],
]);

function targetWords() {
  const table = JSON.parse(readFileSync(join(ROOT, 'src/data/lexicon-table.json'), 'utf8'));
  return new Set([...table.lemmas, ...Object.keys(table.surface)].map((w) => w.toLowerCase()));
}

async function download() {
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new Error(`WordNet download failed: ${res.status}`);
  const chunks = [];
  await pipeline(Readable.fromWeb(res.body), createGunzip(), async function* (source) {
    for await (const chunk of source) chunks.push(chunk);
  });
  return Buffer.concat(chunks);
}

function tarEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeText || '0', 8);
    const start = offset + 512;
    const end = start + size;
    entries.set(name, buffer.subarray(start, end).toString('utf8'));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function senseKey(pos, word, offset) {
  return `${pos}\t${word}\t${offset}`;
}

function parseIndexFile(text, allowed, out) {
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const parts = line.trim().split(/\s+/);
    const pos = POS.get(parts[1]);
    if (!pos) continue;
    const word = parts[0]?.replace(/_/g, ' ');
    if (!word || word !== word.toLowerCase() || !allowed.has(word)) continue;
    const synsetCount = parseInt(parts[2] ?? '0', 10);
    const pointerCount = parseInt(parts[3] ?? '0', 10);
    const offsets = parts.slice(6 + pointerCount, 6 + pointerCount + synsetCount);
    offsets.forEach((offset, rank) => out.set(senseKey(pos, word, offset), rank));
  }
}

function parseDataFile(text, allowed, senseOrder, out) {
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const [rawData, rawGloss = ''] = line.split('|');
    const parts = rawData.trim().split(/\s+/);
    const offset = parts[0];
    const pos = POS.get(parts[2]);
    if (!pos) continue;
    const wordCount = parseInt(parts[3] ?? '0', 16);
    const gloss = rawGloss.trim().replace(/\s*;.*$/, '').trim();
    if (!gloss) continue;
    for (let i = 0; i < wordCount; i += 1) {
      const word = parts[4 + i * 2]?.replace(/_/g, ' ');
      // WordNet case is semantic: Be is beryllium, not the verb be.
      if (!word || word !== word.toLowerCase() || !allowed.has(word)) continue;
      const entry = out.get(word) ?? { word, senses: [] };
      const rank = senseOrder.get(senseKey(pos, word, offset)) ?? Number.MAX_SAFE_INTEGER;
      const existing = entry.senses.find((sense) => sense.pos === pos && sense.gloss === gloss);
      if (existing) {
        existing.rank = Math.min(existing.rank, rank);
        continue;
      }
      entry.senses.push({ pos, gloss, rank });
      out.set(word, entry);
    }
  }
}

function finalizeEntries(entries) {
  return [...entries.values()]
    .map((entry) => ({
      word: entry.word,
      senses: entry.senses
        .sort(
          (a, b) =>
            (POS_ORDER.get(a.pos) ?? 99) - (POS_ORDER.get(b.pos) ?? 99) ||
            a.rank - b.rank ||
            a.gloss.localeCompare(b.gloss),
        )
        .slice(0, 8)
        .map(({ pos, gloss }) => ({ pos, gloss })),
    }))
    .sort((a, b) => a.word.localeCompare(b.word));
}

const allowed = targetWords();
const senseOrder = new Map();
const entries = new Map();
const tar = tarEntries(await download());
for (const name of ['index.noun', 'index.verb', 'index.adj', 'index.adv']) {
  const text = [...tar.entries()].find(([path]) => path.endsWith(`/dict/${name}`) || path.endsWith(name))?.[1];
  if (!text) throw new Error(`Missing WordNet ${name}`);
  parseIndexFile(text, allowed, senseOrder);
}
for (const name of ['data.noun', 'data.verb', 'data.adj', 'data.adv']) {
  const text = [...tar.entries()].find(([path]) => path.endsWith(`/dict/${name}`) || path.endsWith(name))?.[1];
  if (!text) throw new Error(`Missing WordNet ${name}`);
  parseDataFile(text, allowed, senseOrder, entries);
}

const json = JSON.stringify(finalizeEntries(entries));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);
console.log(`wordnet entries=${entries.size} out=${OUT}`);
