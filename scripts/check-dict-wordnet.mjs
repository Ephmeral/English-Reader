import { readFileSync } from 'node:fs';

const entries = JSON.parse(readFileSync(new URL('../src/data/dict/wordnet.json', import.meta.url), 'utf8'));
const byWord = new Map(entries.map((entry) => [entry.word, entry]));
const berylliumGloss = /\b(beryllium|bivalent metallic element|atomic number 4)\b/i;

let allOk = true;

function check(condition, message) {
  console.log(`[wordnet] ${message} => ${condition ? 'PASS' : 'FAIL'}`);
  allOk = condition && allOk;
}

const be = byWord.get('be');
check(!!be, 'entry "be" exists');

if (be) {
  const badSenses = be.senses.filter((sense) => berylliumGloss.test(sense.gloss));
  const verbSenses = be.senses.filter((sense) => sense.pos === 'verb');
  const nonVerbSenses = be.senses.filter((sense) => sense.pos !== 'verb');

  check(verbSenses.length > 0, 'entry "be" keeps verb senses');
  check(badSenses.length === 0, 'entry "be" excludes beryllium senses');
  check(nonVerbSenses.length === 0, 'entry "be" excludes non-verb senses');
}

process.exit(allOk ? 0 : 1);
