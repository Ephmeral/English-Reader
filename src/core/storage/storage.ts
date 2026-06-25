// Storage（规格 §1.6）：MVP = IndexedDB 实现。接口保持云端可替换（决策保留的缝）。

import type { Document, DocumentMeta } from '../model/token';
import type { Annotation } from '../model/annotation';
import type { AppEvent } from '../events/events';
import type { AssetBlob } from '../parser/source-parser';

export type Comprehension = 'unknown' | 'fuzzy' | 'known';

export interface VocabEntry {
  /** 稳定 id，约定用 lemma。 */
  id: string;
  lemma: string;
  /** 首次遇到时的词面。 */
  surface: string;
  band: number | null;
  comprehension: Comprehension;
  contexts: Array<{ docId: string; sentence: string; tokenId: number; at: number }>;
  firstSeenAt: number;
  lastMarkedAt: number;
}

export interface EventFilter {
  type?: string;
  sessionId?: string;
  since?: number;
  until?: number;
}

export interface Storage {
  // 文档
  saveDocument(doc: Document): Promise<void>;
  loadDocument(id: string): Promise<Document | null>;
  listDocuments(): Promise<DocumentMeta[]>;
  deleteDocument(id: string): Promise<void>;

  // EPUB 资源
  saveAsset(docId: string, asset: AssetBlob): Promise<void>;
  loadAsset(docId: string, assetId: string): Promise<Blob | null>;

  // 批注
  saveAnnotation(ann: Annotation): Promise<void>;
  loadAnnotations(docId: string): Promise<Annotation[]>;
  deleteAnnotation(id: string): Promise<void>;

  // 生词
  saveVocabEntry(entry: VocabEntry): Promise<void>;
  loadVocab(): Promise<VocabEntry[]>;

  // 事件（append-only）
  appendEvent(event: AppEvent): Promise<void>;
  loadEvents(filter?: EventFilter): Promise<AppEvent[]>;
  /** 导出全量事件供验证/分析。 */
  exportEvents(): Promise<AppEvent[]>;

  // 设置（含本地 API key、滑块水平、explain 缓存等）
  getSetting<T>(key: string): Promise<T | null>;
  setSetting<T>(key: string, value: T): Promise<void>;
}
