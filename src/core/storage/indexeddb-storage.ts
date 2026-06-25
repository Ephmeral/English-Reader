// IndexedDB 实现（规格 §1.6）。core 唯一允许的平台 API，限于此处，藏在 Storage 后。
// 纯本地、无登录。云端实现将来替换本类，签名不变。

import type { Document, DocumentMeta } from '../model/token';
import type { Annotation } from '../model/annotation';
import type { AppEvent } from '../events/events';
import { StorageError } from '../errors';
import type { AssetBlob } from '../parser/source-parser';
import type { EventFilter, Storage, VocabEntry } from './storage';

const DB_NAME = 'web-read';
const DB_VERSION = 2;

const STORE_DOCMETA = 'docmeta';
const STORE_DOCS = 'documents';
const STORE_VOCAB = 'vocab';
const STORE_EVENTS = 'events';
const STORE_SETTINGS = 'settings';
const STORE_ASSETS = 'assets';
const STORE_ANNOTATIONS = 'annotations';
const INDEX_BY_DOC = 'byDoc';

interface AssetRecord {
  docId: string;
  assetId: string;
  mime: string;
  blob: Blob;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbStorage implements Storage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new StorageError('STORAGE_UNAVAILABLE', '当前环境不支持 IndexedDB。'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_DOCMETA))
          db.createObjectStore(STORE_DOCMETA, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_DOCS))
          db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_VOCAB))
          db.createObjectStore(STORE_VOCAB, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_EVENTS))
          db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_SETTINGS))
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          const assets = db.createObjectStore(STORE_ASSETS, { keyPath: ['docId', 'assetId'] });
          assets.createIndex(INDEX_BY_DOC, 'docId');
        }
        if (!db.objectStoreNames.contains(STORE_ANNOTATIONS)) {
          const annotations = db.createObjectStore(STORE_ANNOTATIONS, { keyPath: 'id' });
          annotations.createIndex(INDEX_BY_DOC, 'docId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new StorageError('STORAGE_IO', '打开数据库失败。', { cause: req.error }));
    });
    return this.dbPromise;
  }

  private async tx<T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(new StorageError('STORAGE_IO', '事务失败。', { cause: tx.error }));
      tx.onabort = () => reject(new StorageError('STORAGE_IO', '事务中止。', { cause: tx.error }));
      fn(tx).then(
        (r) => {
          result = r;
        },
        (e) => {
          reject(e);
          try {
            tx.abort();
          } catch {
            /* already done */
          }
        },
      );
    });
  }

  // ---- 文档 ----
  async saveDocument(doc: Document): Promise<void> {
    await this.tx([STORE_DOCS, STORE_DOCMETA], 'readwrite', async (tx) => {
      tx.objectStore(STORE_DOCS).put(doc);
      tx.objectStore(STORE_DOCMETA).put({ id: doc.id, title: doc.title, meta: doc.meta });
    });
  }

  async loadDocument(id: string): Promise<Document | null> {
    return this.tx(STORE_DOCS, 'readonly', async (tx) => {
      const r = await promisify(tx.objectStore(STORE_DOCS).get(id));
      return (r as Document) ?? null;
    });
  }

  async listDocuments(): Promise<DocumentMeta[]> {
    return this.tx(STORE_DOCMETA, 'readonly', async (tx) => {
      const all = (await promisify(tx.objectStore(STORE_DOCMETA).getAll())) as Array<{
        id: string;
        meta: DocumentMeta;
      }>;
      return all
        .map((r) => r.meta)
        .sort((a, b) => b.importedAt - a.importedAt);
    });
  }

  async deleteDocument(id: string): Promise<void> {
    await this.tx(
      [STORE_DOCS, STORE_DOCMETA, STORE_ASSETS, STORE_ANNOTATIONS],
      'readwrite',
      async (tx) => {
        tx.objectStore(STORE_DOCS).delete(id);
        tx.objectStore(STORE_DOCMETA).delete(id);
        await this.deleteByDoc(tx.objectStore(STORE_ASSETS), id);
        await this.deleteByDoc(tx.objectStore(STORE_ANNOTATIONS), id);
      },
    );
  }

  // ---- EPUB 资源 ----
  async saveAsset(docId: string, asset: AssetBlob): Promise<void> {
    await this.tx(STORE_ASSETS, 'readwrite', async (tx) => {
      tx.objectStore(STORE_ASSETS).put({
        docId,
        assetId: asset.assetId,
        mime: asset.mime,
        blob: new Blob([asset.bytes], { type: asset.mime }),
      });
    });
  }

  async loadAsset(docId: string, assetId: string): Promise<Blob | null> {
    return this.tx(STORE_ASSETS, 'readonly', async (tx) => {
      const r = (await promisify(tx.objectStore(STORE_ASSETS).get([docId, assetId]))) as
        | AssetRecord
        | undefined;
      return r?.blob ?? null;
    });
  }

  // ---- 批注 ----
  async saveAnnotation(ann: Annotation): Promise<void> {
    await this.tx(STORE_ANNOTATIONS, 'readwrite', async (tx) => {
      tx.objectStore(STORE_ANNOTATIONS).put(ann);
    });
  }

  async loadAnnotations(docId: string): Promise<Annotation[]> {
    return this.tx(STORE_ANNOTATIONS, 'readonly', async (tx) => {
      return (await promisify(
        tx.objectStore(STORE_ANNOTATIONS).index(INDEX_BY_DOC).getAll(docId),
      )) as Annotation[];
    });
  }

  async deleteAnnotation(id: string): Promise<void> {
    await this.tx(STORE_ANNOTATIONS, 'readwrite', async (tx) => {
      tx.objectStore(STORE_ANNOTATIONS).delete(id);
    });
  }

  // ---- 生词 ----
  async saveVocabEntry(entry: VocabEntry): Promise<void> {
    await this.tx(STORE_VOCAB, 'readwrite', async (tx) => {
      tx.objectStore(STORE_VOCAB).put(entry);
    });
  }

  async loadVocab(): Promise<VocabEntry[]> {
    return this.tx(STORE_VOCAB, 'readonly', async (tx) => {
      const all = (await promisify(tx.objectStore(STORE_VOCAB).getAll())) as VocabEntry[];
      return all.sort((a, b) => b.lastMarkedAt - a.lastMarkedAt);
    });
  }

  // ---- 事件 ----
  async appendEvent(event: AppEvent): Promise<void> {
    await this.tx(STORE_EVENTS, 'readwrite', async (tx) => {
      tx.objectStore(STORE_EVENTS).put(event);
    });
  }

  async loadEvents(filter?: EventFilter): Promise<AppEvent[]> {
    const all = await this.tx(STORE_EVENTS, 'readonly', async (tx) => {
      return (await promisify(tx.objectStore(STORE_EVENTS).getAll())) as AppEvent[];
    });
    const filtered = filter
      ? all.filter(
          (e) =>
            (filter.type === undefined || e.type === filter.type) &&
            (filter.sessionId === undefined || e.sessionId === filter.sessionId) &&
            (filter.since === undefined || e.at >= filter.since) &&
            (filter.until === undefined || e.at <= filter.until),
        )
      : all;
    return filtered.sort((a, b) => a.at - b.at);
  }

  async exportEvents(): Promise<AppEvent[]> {
    return this.loadEvents();
  }

  // ---- 设置 ----
  async getSetting<T>(key: string): Promise<T | null> {
    return this.tx(STORE_SETTINGS, 'readonly', async (tx) => {
      const r = (await promisify(tx.objectStore(STORE_SETTINGS).get(key))) as
        | { key: string; value: T }
        | undefined;
      return r ? r.value : null;
    });
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    await this.tx(STORE_SETTINGS, 'readwrite', async (tx) => {
      tx.objectStore(STORE_SETTINGS).put({ key, value });
    });
  }

  private deleteByDoc(store: IDBObjectStore, docId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = store.index(INDEX_BY_DOC).openCursor(IDBKeyRange.only(docId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }
}
