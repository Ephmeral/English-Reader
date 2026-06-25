// 阶段 6（Slice 1）验证脚本：在 Node 下跑真实 EpubSourceParser。
// 注入 @xmldom/xmldom 的 DOMParser（浏览器用全局 DOMParser；逻辑同一份）。
// 断言：① 偏移不变式 surface===source.slice 且全量覆盖（image token 零宽）；
//       ② 章节索引与书的 TOC 一致；③ 图片成 asset + 封面；④ DRM 抛 PARSE_DRM；
//       ⑤ EPUB2（NCX、无 nav）也能出章节标题。
// 用法：npm run test:epub

import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { zipSync, strToU8 } from 'fflate';
import { EpubSourceParser, type XmlParse } from '../src/core/parser/epub-source-parser';
import type { ParsedSource } from '../src/core/parser/source-parser';
import { AppError } from '../src/core/errors';

const xmlParse = ((text: string, mime: string) =>
  new DOMParser().parseFromString(text, mime)) as unknown as XmlParse;

const parser = new EpubSourceParser(xmlParse);

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** 复用阶段1 的偏移不变式校验（image token 零宽，cursor 不前进，规则不变）。 */
function checkOffsets(p: ParsedSource): boolean {
  const { source, tokens } = p.document;
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
  console.log(`[offsets] sliceFails=${sliceFails} coverFails=${coverFails} => ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

let allOk = true;

// ── 1) 真实 EPUB3（Alice，含封面与插图）
{
  console.log('\n=== alice.epub (EPUB3) ===');
  const u8 = readFileSync('test/fixtures/alice.epub');
  const parsed = await parser.parse({
    name: 'alice.epub',
    mime: 'application/epub+zip',
    bytes: toArrayBuffer(u8),
  });
  const d = parsed.document;
  console.log(`title=${JSON.stringify(d.title)}`);
  console.log(`tokens=${d.meta.tokenCount} words=${d.meta.wordCount} chapters=${d.chapters.length}`);
  console.log(`assets=${parsed.assets.length} cover=${d.meta.coverAssetId ?? '(none)'}`);
  const imageTokens = d.tokens.filter((t) => t.kind === 'image').length;
  console.log(`imageTokens=${imageTokens}`);
  console.log('chapter tree (title @ startTokenId):');
  for (const c of d.chapters) console.log(`  - ${JSON.stringify(c.title)} @ ${c.startTokenId}`);

  const offsetsOk = checkOffsets(parsed);
  const chaptersOk = d.chapters.length > 0;
  const titleOk = d.title.includes('Alice');
  const coverOk = !!d.meta.coverAssetId && parsed.assets.some((a) => a.assetId === d.meta.coverAssetId);
  // 章节标题应至少认出若干 "CHAPTER" 条目（来自 nav）。
  const namedChapters = d.chapters.filter((c) => /CHAPTER/i.test(c.title)).length;
  console.log(`checks: offsets=${offsetsOk} chapters=${chaptersOk} title=${titleOk} cover=${coverOk} namedChapters=${namedChapters}`);
  allOk = allOk && offsetsOk && chaptersOk && titleOk && coverOk && namedChapters >= 10;
}

// ── 2) DRM 检测（合成：含 META-INF/encryption.xml）
{
  console.log('\n=== synthetic DRM epub ===');
  const container =
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const drm = zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'META-INF/encryption.xml': strToU8('<encryption/>'),
    'OEBPS/content.opf': strToU8('<package/>'),
  });
  let code = '(none)';
  try {
    await parser.parse({ name: 'drm.epub', mime: '', bytes: toArrayBuffer(drm) });
  } catch (e) {
    code = e instanceof AppError ? e.code : String(e);
  }
  const drmOk = code === 'PARSE_DRM';
  console.log(`thrown code=${code} => ${drmOk ? 'PASS' : 'FAIL'}`);
  allOk = allOk && drmOk;
}

// ── 3) EPUB2（NCX，无 nav）
{
  console.log('\n=== synthetic EPUB2 (NCX) ===');
  const container =
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const opf =
    '<?xml version="1.0"?><package version="2.0" unique-identifier="id" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Synthetic EPUB2</dc:title></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="ch1"/></spine></package>';
  const ncx =
    '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="n1" playOrder="1"><navLabel><text>Chapter One</text></navLabel><content src="ch1.xhtml"/></navPoint></navMap></ncx>';
  const ch1 =
    '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body><h1>Chapter One</h1><p>Hello brave new world.</p></body></html>';
  const z = zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/toc.ncx': strToU8(ncx),
    'OEBPS/ch1.xhtml': strToU8(ch1),
  });
  const parsed = await parser.parse({ name: 'epub2.epub', mime: '', bytes: toArrayBuffer(z) });
  const d = parsed.document;
  console.log(`title=${JSON.stringify(d.title)} chapters=${d.chapters.map((c) => c.title).join(' | ')}`);
  const offsetsOk = checkOffsets(parsed);
  const titleOk = d.title === 'Synthetic EPUB2';
  const chapterTitleOk = d.chapters.length === 1 && d.chapters[0]?.title === 'Chapter One';
  console.log(`checks: offsets=${offsetsOk} title=${titleOk} chapterTitle=${chapterTitleOk}`);
  allOk = allOk && offsetsOk && titleOk && chapterTitleOk;
}

console.log(`\n${allOk ? 'ALL PASS' : 'SOME FAILED'}`);
process.exit(allOk ? 0 : 1);
