// EpubSourceParser（规格 §1.3 / §1.7，v1.3）：把 .epub 归一化为同一扁平 Document。
// 设计依据：docs/adr/0001（展平进扁平模型 + 章节索引）。
// 边界：本 parser 是 core 中唯一允许 import fflate / 使用 DOMParser 的地方（规格 §4）。
//   parse 只产出 ParsedSource（含待落库 assets）；落库由导入流水线交给 Storage。
// 不变式：对每个 token，surface === source.slice(start,end)；image token 零宽（取空切片）。

import { unzipSync } from 'fflate';
import type { Block, BlockRole, Document, DocumentMeta, ChapterMark, Token } from '../model/token';
import { ParseError } from '../errors';
import { tokenize } from './tokenize';
import {
  stableId,
  titleFrom,
  type SourceFile,
  type SourceParser,
  type ParsedSource,
  type AssetBlob,
} from './source-parser';

// ── 最小结构化 XML 类型：同时满足浏览器 DOMParser 与 @xmldom/xmldom（避免 any / 全量 lib.dom 耦合）。
interface XmlNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly childNodes: ArrayLike<XmlNode>;
}
interface XmlElement extends XmlNode {
  getAttribute(name: string): string | null;
  getElementsByTagName(name: string): ArrayLike<XmlElement>;
}
interface XmlDocument extends XmlNode {
  readonly documentElement: XmlElement | null;
  getElementsByTagName(name: string): ArrayLike<XmlElement>;
}

/** XML 解析注入点：浏览器用全局 DOMParser；Node 测试注入 @xmldom/xmldom。 */
export type XmlParse = (text: string, mime: 'application/xml' | 'application/xhtml+xml') => XmlDocument;

const browserXmlParse: XmlParse = (text, mime) =>
  new DOMParser().parseFromString(text, mime) as unknown as XmlDocument;

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;
const DC_TITLE = 'dc:title';

// 块级标签：处理后补段落边界（→ newline）。
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'figure', 'figcaption',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol',
  'table', 'tr', 'td', 'th', 'pre', 'aside', 'main', 'hr',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const PARAGRAPH_BLOCKS = new Set(['p', 'pre', 'figcaption', 'figure']);
// 不进入正文的标签。
const SKIP = new Set(['head', 'script', 'style', 'title', 'link', 'meta']);

function toArr<T>(a: ArrayLike<T>): T[] {
  const out: T[] = [];
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v !== undefined) out.push(v);
  }
  return out;
}

function first<T>(a: ArrayLike<T>): T | undefined {
  return a.length > 0 ? a[0] : undefined;
}

function isElement(n: XmlNode): n is XmlElement {
  return n.nodeType === NODE_ELEMENT;
}

function localName(el: XmlElement): string {
  const n = el.nodeName;
  const i = n.lastIndexOf(':');
  return (i >= 0 ? n.slice(i + 1) : n).toLowerCase();
}

/** 递归取节点文本（不依赖 textContent，xmldom 兼容）。 */
function textOf(node: XmlNode): string {
  let s = '';
  for (const c of toArr(node.childNodes)) {
    if (c.nodeType === NODE_TEXT) s += c.nodeValue ?? '';
    else if (c.nodeType === NODE_ELEMENT) s += textOf(c);
  }
  return s.replace(/\s+/g, ' ').trim();
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

/** 把相对 href 解析为 zip 内绝对路径（处理 ./ ../、去 #fragment/?query、URL 解码）。 */
function resolvePath(baseDir: string, href: string): string {
  let h = href.split('#')[0] ?? '';
  h = h.split('?')[0] ?? '';
  try {
    h = decodeURIComponent(h);
  } catch {
    /* 保留原样 */
  }
  if (h.startsWith('/')) h = h.slice(1);
  const parts = (baseDir ? baseDir.split('/') : []).concat(h.split('/'));
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
};
function inferMime(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function blockRole(tag: string): { role: BlockRole; level?: number } | null {
  if (tag === 'blockquote') return { role: 'blockquote' };
  if (tag === 'li') return { role: 'list-item' };
  if (HEADINGS.has(tag)) return { role: 'heading', level: Number(tag.slice(1)) };
  if (PARAGRAPH_BLOCKS.has(tag)) return { role: 'paragraph' };
  return null;
}

/** 逐段构建扁平 source + token 流：文本走 tokenize，图片为零宽 token，保证不变式。 */
class DocBuilder {
  source = '';
  tokens: Token[] = [];
  blocks: Block[] = [];
  private id = 0;

  appendText(text: string): void {
    if (!text) return;
    const base = this.source.length;
    for (const t of tokenize(text)) {
      this.tokens.push({ ...t, id: this.id++, start: t.start + base, end: t.end + base });
    }
    this.source += text;
  }

  appendImage(assetId: string): void {
    const at = this.source.length;
    this.tokens.push({ id: this.id++, kind: 'image', surface: '', start: at, end: at, assetId });
  }

  appendBlock(startTokenId: number, role: BlockRole, level?: number): void {
    if (startTokenId < 0 || startTokenId >= this.id) return;
    if (this.blocks.at(-1)?.startTokenId === startTokenId) return;
    this.blocks.push({ startTokenId, role, level });
  }

  ensureNewline(): void {
    if (this.source.length > 0 && !this.source.endsWith('\n')) this.appendText('\n');
  }

  /** 下一个 token 的 id（= 当前 token 数）；用作章节起点。 */
  get nextTokenId(): number {
    return this.id;
  }
}

interface ManifestItem {
  id: string;
  href: string; // 已解析为 zip 路径
  mediaType: string;
  properties: string;
}

export class EpubSourceParser implements SourceParser {
  constructor(private readonly parseXml: XmlParse = browserXmlParse) {}

  supports(file: SourceFile): boolean {
    const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
    return ext === 'epub' || file.mime === 'application/epub+zip';
  }

  async parse(file: SourceFile): Promise<ParsedSource> {
    // 1) 解压
    let zip: Record<string, Uint8Array>;
    try {
      zip = unzipSync(new Uint8Array(file.bytes));
    } catch (cause) {
      throw new ParseError('PARSE_MALFORMED', `无法解压 epub：${file.name}`, { cause });
    }

    // 2) DRM 检测
    if (zip['META-INF/encryption.xml']) {
      throw new ParseError('PARSE_DRM', `受 DRM 保护，暂不支持：${file.name}`);
    }

    const decode = (path: string): string | null => {
      const u8 = zip[path];
      return u8 ? new TextDecoder('utf-8', { fatal: false }).decode(u8) : null;
    };
    const parse = (path: string, mime: 'application/xml' | 'application/xhtml+xml'): XmlDocument => {
      const text = decode(path);
      if (text === null) throw new ParseError('PARSE_MALFORMED', `缺少文件：${path}`);
      const doc = this.parseXml(text, mime);
      if (!doc.documentElement) throw new ParseError('PARSE_MALFORMED', `无法解析：${path}`);
      return doc;
    };

    // 3) container.xml → OPF 路径
    const container = parse('META-INF/container.xml', 'application/xml');
    const rootEl = first(container.getElementsByTagName('rootfile'));
    const opfPath = rootEl?.getAttribute('full-path');
    if (!opfPath) throw new ParseError('PARSE_MALFORMED', '缺少 OPF rootfile');
    const opfDir = dirOf(opfPath);

    // 4) OPF：manifest / spine / cover / nav / ncx / 书名
    const opf = parse(opfPath, 'application/xml');
    const manifestById = new Map<string, ManifestItem>();
    const manifestMimeByPath = new Map<string, string>();
    for (const it of toArr(opf.getElementsByTagName('item'))) {
      const id = it.getAttribute('id');
      const href = it.getAttribute('href');
      if (!id || !href) continue;
      const path = resolvePath(opfDir, href);
      const item: ManifestItem = {
        id,
        href: path,
        mediaType: it.getAttribute('media-type') ?? '',
        properties: it.getAttribute('properties') ?? '',
      };
      manifestById.set(id, item);
      manifestMimeByPath.set(path, item.mediaType);
    }

    const spinePaths: string[] = [];
    for (const ref of toArr(opf.getElementsByTagName('itemref'))) {
      const idref = ref.getAttribute('idref');
      if (!idref) continue;
      const item = manifestById.get(idref);
      if (item) spinePaths.push(item.href);
    }
    if (spinePaths.length === 0) throw new ParseError('PARSE_MALFORMED', 'spine 为空');

    // 封面：properties=cover-image 优先，否则 metadata meta[name=cover]。
    let coverAssetId: string | undefined;
    for (const item of manifestById.values()) {
      if (item.properties.split(/\s+/).includes('cover-image')) {
        coverAssetId = item.href;
        break;
      }
    }
    if (!coverAssetId) {
      for (const m of toArr(opf.getElementsByTagName('meta'))) {
        if (m.getAttribute('name') === 'cover') {
          const ref = m.getAttribute('content');
          const item = ref ? manifestById.get(ref) : undefined;
          if (item) coverAssetId = item.href;
          break;
        }
      }
    }

    // 章节标题表（file 路径 → 标题）：优先 EPUB3 nav，回退 EPUB2 ncx。
    let navItem: ManifestItem | undefined;
    let ncxItem: ManifestItem | undefined;
    for (const item of manifestById.values()) {
      if (item.properties.split(/\s+/).includes('nav')) navItem = item;
      if (item.mediaType === 'application/x-dtbncx+xml') ncxItem = item;
    }
    const titleByFile = navItem
      ? this.titlesFromNav(parse(navItem.href, 'application/xhtml+xml'), dirOf(navItem.href))
      : ncxItem
        ? this.titlesFromNcx(parse(ncxItem.href, 'application/xml'), dirOf(ncxItem.href))
        : new Map<string, string>();

    // 书名
    const dcTitleEl = first(opf.getElementsByTagName(DC_TITLE));
    const title = (dcTitleEl ? textOf(dcTitleEl) : '') || titleFrom(file.name);

    // 5) 逐 spine item 抽文本 + 图片，建扁平流与章节索引。
    const builder = new DocBuilder();
    const chapters: ChapterMark[] = [];
    const assets = new Map<string, AssetBlob>();

    const addAsset = (path: string): boolean => {
      const u8 = zip[path];
      if (!u8) return false;
      if (!assets.has(path)) {
        assets.set(path, {
          assetId: path,
          mime: manifestMimeByPath.get(path) ?? inferMime(path),
          bytes: u8.slice().buffer,
        });
      }
      return true;
    };

    const walk = (node: XmlNode, xhtmlDir: string, activeBlock = false): void => {
      for (const child of toArr(node.childNodes)) {
        if (child.nodeType === NODE_TEXT) {
          const raw = child.nodeValue ?? '';
          if (/\S/.test(raw)) {
            const start = builder.nextTokenId;
            builder.appendText(raw.replace(/\s+/g, ' '));
            if (!activeBlock) builder.appendBlock(start, 'paragraph');
          }
          continue;
        }
        if (!isElement(child)) continue;
        const tag = localName(child);
        if (SKIP.has(tag)) continue;
        if (tag === 'br') {
          builder.appendText('\n');
          continue;
        }
        if (tag === 'img' || tag === 'image') {
          const src = child.getAttribute('src') ?? child.getAttribute('xlink:href') ?? child.getAttribute('href');
          if (src) {
            const path = resolvePath(xhtmlDir, src);
            if (addAsset(path)) {
              const start = builder.nextTokenId;
              builder.appendImage(path);
              if (!activeBlock) builder.appendBlock(start, 'paragraph');
            }
          }
          continue;
        }
        const block = BLOCK.has(tag);
        const role = blockRole(tag);
        if (block) builder.ensureNewline();
        if (role && !activeBlock) {
          const start = builder.nextTokenId;
          walk(child, xhtmlDir, true);
          builder.appendBlock(start, role.role, role.level);
        } else {
          walk(child, xhtmlDir, activeBlock);
        }
        if (block) builder.appendText('\n');
      }
    };

    const firstHeading = (root: XmlNode): string | undefined => {
      for (const h of HEADINGS) {
        const found = isElementWith(root, h);
        if (found) {
          const t = textOf(found);
          if (t) return t;
        }
      }
      return undefined;
    };

    spinePaths.forEach((path, idx) => {
      const xhtml = decode(path);
      if (xhtml === null) return;
      const doc = this.parseXml(xhtml, 'application/xhtml+xml');
      const body = first(doc.getElementsByTagName('body')) ?? doc.documentElement;
      if (!body) return;

      builder.ensureNewline();
      const startTokenId = builder.nextTokenId;
      walk(body, dirOf(path));
      builder.ensureNewline();

      const chTitle = titleByFile.get(path) ?? firstHeading(body) ?? `Section ${idx + 1}`;
      chapters.push({ title: chTitle, startTokenId });
    });

    if (coverAssetId) addAsset(coverAssetId);

    // 6) 组装 Document
    const source = builder.source;
    const tokens = builder.tokens;
    const blocks = builder.blocks.length > 0 ? builder.blocks : tokens.length > 0 ? [{ startTokenId: 0, role: 'paragraph' as const }] : [];
    if (tokens.length > 0 && blocks[0]?.startTokenId !== 0) blocks.unshift({ startTokenId: 0, role: 'paragraph' });
    const wordCount = tokens.reduce((n, t) => (t.kind === 'word' ? n + 1 : n), 0);
    const id = stableId(source, file.name);

    const meta: DocumentMeta = {
      id,
      sourceFormat: 'epub',
      fileName: file.name,
      importedAt: Date.now(),
      tokenCount: tokens.length,
      wordCount,
      annotated: false,
      coverAssetId,
      chapterCount: chapters.length,
    };

    const document: Document = { id, title, source, tokens, chapters, blocks, meta };
    return { document, assets: [...assets.values()] };
  }

  /** EPUB3 nav.xhtml：<nav epub:type="toc"> 内 <a href> → 文件路径标题表（首个为准）。 */
  private titlesFromNav(doc: XmlDocument, navDir: string): Map<string, string> {
    const map = new Map<string, string>();
    const navs = toArr(doc.getElementsByTagName('nav'));
    const toc =
      navs.find((n) => (n.getAttribute('epub:type') ?? '').split(/\s+/).includes('toc')) ??
      navs.find((n) => n.getAttribute('role') === 'doc-toc') ??
      navs[0];
    if (!toc) return map;
    for (const a of toArr(toc.getElementsByTagName('a'))) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const path = resolvePath(navDir, href);
      const t = textOf(a);
      if (t && !map.has(path)) map.set(path, t);
    }
    return map;
  }

  /** EPUB2 toc.ncx：navPoint > navLabel/text + content[src] → 文件路径标题表（首个为准）。 */
  private titlesFromNcx(doc: XmlDocument, ncxDir: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const np of toArr(doc.getElementsByTagName('navPoint'))) {
      const content = first(np.getElementsByTagName('content'));
      const src = content?.getAttribute('src');
      if (!src) continue;
      const path = resolvePath(ncxDir, src);
      const label = first(np.getElementsByTagName('text'));
      const t = label ? textOf(label) : '';
      if (t && !map.has(path)) map.set(path, t);
    }
    return map;
  }
}

/** 深度优先找第一个指定标签的元素。 */
function isElementWith(root: XmlNode, tag: string): XmlElement | undefined {
  if (isElement(root) && localName(root) === tag) return root;
  for (const c of toArr(root.childNodes)) {
    const found = isElementWith(c, tag);
    if (found) return found;
  }
  return undefined;
}
