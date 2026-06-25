// 核心模型（规格 §1.1）。纯 TS，不依赖 React/DOM。
// 一切先归一化成 Document 词元流——这是能复用到任何平台的核心资产。

/** 词元种类。空白与换行单独成元，保证 surface 可逐字还原原文。
 *  v1.3 image：epub 图片占位，零宽（start===end、surface===''），不参与分级/点击。 */
export type TokenKind = 'word' | 'punct' | 'space' | 'newline' | 'image';

/** 归一化词元流中的一个单位。 */
export interface Token {
  /** 文档内稳定序号，0 起，连续。 */
  id: number;
  kind: TokenKind;
  /** 原文精确切片。约定：surface === document.source.slice(start, end)。 */
  surface: string;
  /** 在 document.source 中的字符偏移，含。 */
  start: number;
  /** 字符偏移，不含。 */
  end: number;
  // 以下仅 kind === 'word' 时有意义，其余为 undefined：
  /** 小写原形；词形还原失败时回退为 surface.toLowerCase()。 */
  lemma?: string;
  /**
   * 词频频段：整数，越小越高频/越简单。
   * null = 未登录词（OOV），按"最难/高于任何水平"处理。
   * 注：band 的语义是"频率排名分段"，底层词频表来源见 src/data/SOURCE.md（可替换）。
   */
  band?: number | null;
  /** v1.3：仅 kind==='image' —— 指向该文档的 Asset（图片 Blob），见规格 §1.7。 */
  assetId?: string;
}

export interface VocabProfile {
  /** index 0 = OOV；index 1..25 = 对应 band 的 running word token 数。 */
  bandCounts: number[];
  tokenCount: number;
  /** 去重 lemma 数。 */
  typeCount: number;
}

export interface DocumentMeta {
  /** 文档稳定 id，与 Document.id 相同。v1.1 增补：列表导航/删除需要它（见规格 §1.1 修订）。 */
  id: string;
  /** v1.3：新增 'epub'。 */
  sourceFormat: 'txt' | 'md' | 'epub';
  fileName: string;
  /** 导入时间，epoch ms。 */
  importedAt: number;
  tokenCount: number;
  wordCount: number;
  /** 导入预处理是否已完成（lemma/band 是否已填）。 */
  annotated: boolean;
  /** v1.3：封面图 assetId（epub 才有），供 Library 缩略图，免加载整本 Document。 */
  coverAssetId?: string;
  /** v1.3：章节数（= Document.chapters.length），便于列表展示，免加载整本。 */
  chapterCount?: number;
  /** v1.4：词汇画像，供 Library 可读性展示。 */
  vocabProfile?: VocabProfile;
}

/** v1.3：章节索引——把结构以最轻量形式保留在扁平流之上。一个 spine item 一条。 */
export interface ChapterMark {
  title: string;
  /** 章节起始 token 的 id（= 渲染切片与 TOC 跳转的锚）。 */
  startTokenId: number;
}

/** 平台无关的核心资产。所有功能只跟它打交道。 */
export interface Document {
  /** 稳定 id（内容 hash 或 uuid，由实现决定，但需稳定可复现优先）。 */
  id: string;
  title: string;
  /** 归一化后的纯文本源；所有 token 的 start/end 索引到这里。 */
  source: string;
  tokens: Token[];
  /** v1.3：章节索引（txt/md = 单章；epub = 每 spine item 一章）。 */
  chapters: ChapterMark[];
  meta: DocumentMeta;
}
