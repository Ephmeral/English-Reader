import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { strToU8, zipSync } from 'fflate';
import type { BlockRole, Document, EmphasisStyle } from '../src/core/model/token';
import { EpubSourceParser, type XmlParse } from '../src/core/parser/epub-source-parser';
import { TextSourceParser, type SourceFile } from '../src/core/parser/source-parser';

const textParser = new TextSourceParser();
const xmlParse = ((text: string, mime: string) =>
  new DOMParser().parseFromString(text, mime)) as unknown as XmlParse;
const epubParser = new EpubSourceParser(xmlParse);

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function sourceFile(name: string, mime: string, text: string): SourceFile {
  return { name, mime, bytes: new TextEncoder().encode(text).buffer };
}

function roles(doc: Document): string[] {
  return doc.blocks.map((block) =>
    block.role === 'heading' ? `${block.role}:${block.level ?? 1}` : block.role,
  );
}

function emphasisTexts(doc: Document): string[] {
  return doc.emphases.map((emphasis) => `${emphasis.style}:${doc.source.slice(emphasis.start, emphasis.end)}`);
}

function assertEmphases(doc: Document, expected: Array<[EmphasisStyle, string]>, label: string) {
  assert.deepEqual(
    emphasisTexts(doc),
    expected.map(([style, text]) => `${style}:${text}`),
    `${label}: emphasis ranges`,
  );
}

function assertFootnote(doc: Document, expectedLabel: string, expectedBody: string, label: string) {
  assert.equal(doc.footnotes.length, 1, `${label}: expected one footnote`);
  const footnote = doc.footnotes[0]!;
  assert.equal(footnote.label, expectedLabel, `${label}: footnote label`);
  assert.equal(footnote.body, expectedBody, `${label}: footnote body`);
  assert.ok(!doc.source.includes(expectedBody), `${label}: footnote body is outside source`);
  const token = doc.tokens[footnote.anchorTokenId];
  assert.equal(token?.kind, 'noteref', `${label}: anchor token is noteref`);
  assert.equal(token?.surface, expectedLabel, `${label}: noteref surface`);
  assert.equal(token?.footnoteId, footnote.id, `${label}: noteref id`);
}

function assertBlocksCover(doc: Document, expected: BlockRole[], label: string) {
  assert.ok(doc.tokens.length > 0, `${label}: expected tokens`);
  assert.ok(doc.blocks.length > 0, `${label}: expected blocks`);
  assert.equal(doc.blocks[0]?.startTokenId, 0, `${label}: first block starts at token 0`);

  for (let index = 0; index < doc.blocks.length; index += 1) {
    const block = doc.blocks[index]!;
    assert.ok(block.startTokenId >= 0, `${label}: block start is non-negative`);
    assert.ok(block.startTokenId < doc.tokens.length, `${label}: block start is within tokens`);
    if (index > 0) {
      assert.ok(
        block.startTokenId > doc.blocks[index - 1]!.startTokenId,
        `${label}: block starts are strictly increasing`,
      );
    }
  }

  for (const role of expected) {
    assert.ok(doc.blocks.some((block) => block.role === role), `${label}: missing ${role}`);
  }
}

{
  const parsed = await textParser.parse(sourceFile('plain.txt', 'text/plain', 'One paragraph.\nAnother line.'));
  assertBlocksCover(parsed.document, ['paragraph'], 'txt');
  assert.deepEqual(roles(parsed.document), ['paragraph']);
}

{
  const md = [
    '# Heading',
    '',
    'Plain *italic* and **bold** paragraph[^1]',
    'continues.',
    '',
    '> Quoted idea',
    '',
    '- First item',
    '2. Second item',
    '',
    '[^1]: Footnote body text.',
    '',
  ].join('\n');
  const parsed = await textParser.parse(sourceFile('sample.md', 'text/markdown', md));
  assertBlocksCover(parsed.document, ['heading', 'paragraph', 'blockquote', 'list-item'], 'md');
  assert.deepEqual(roles(parsed.document), [
    'heading:1',
    'paragraph',
    'blockquote',
    'list-item',
    'list-item',
  ]);
  assertEmphases(parsed.document, [['italic', 'italic'], ['bold', 'bold']], 'md');
  assertFootnote(parsed.document, '1', 'Footnote body text.', 'md');
}

{
  const container =
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const opf =
    '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Structure</dc:title></metadata><manifest><item id="chap" href="chap.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chap"/></spine></package>';
  const xhtml =
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><h1>Heading</h1><p>Plain <em>italic</em> and <strong>bold</strong> paragraph<a epub:type="noteref" href="#fn1">1</a>.</p><aside epub:type="footnote" id="fn1"><p>Footnote body text.</p></aside><blockquote><p>Quoted idea.</p></blockquote><ul><li>First item.</li><li>Second item.</li></ul></body></html>';
  const epub = zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/chap.xhtml': strToU8(xhtml),
  });
  const parsed = await epubParser.parse({
    name: 'structure.epub',
    mime: 'application/epub+zip',
    bytes: toArrayBuffer(epub),
  });
  assertBlocksCover(parsed.document, ['heading', 'paragraph', 'blockquote', 'list-item'], 'epub');
  assert.deepEqual(roles(parsed.document), [
    'heading:1',
    'paragraph',
    'blockquote',
    'list-item',
    'list-item',
  ]);
  assertEmphases(parsed.document, [['italic', 'italic'], ['bold', 'bold']], 'epub');
  assertFootnote(parsed.document, '1', 'Footnote body text.', 'epub');
}

console.log('structure checks passed');
