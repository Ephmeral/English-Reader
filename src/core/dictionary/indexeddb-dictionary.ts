import { StorageError } from '../errors';
import type { DictEntry, Dictionary, DictionaryKind } from './dictionary';

const STORE_ENTRIES = 'entries';
const STORE_META = 'meta';

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/^['’]+|['’]+$/g, '');
}

export class IndexedDbDictionary implements Dictionary {
  readonly id: string;
  readonly label: string;
  readonly kind: DictionaryKind;

  private readonly dbName: string;
  private readonly seedUrl: string;
  private readonly seedVersion: number;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private seedPromise: Promise<void> | null = null;

  constructor(opts: {
    id: string;
    label: string;
    kind: DictionaryKind;
    seedUrl: string;
    seedVersion: number;
  }) {
    this.id = opts.id;
    this.label = opts.label;
    this.kind = opts.kind;
    this.dbName = `web-read-dict-${opts.id}`;
    this.seedUrl = opts.seedUrl;
    this.seedVersion = opts.seedVersion;
  }

  async ensureSeeded(): Promise<void> {
    if (this.seedPromise) return this.seedPromise;
    this.seedPromise = this.seed();
    return this.seedPromise;
  }

  async lookup(surface: string, lemma?: string | null): Promise<DictEntry | null> {
    await this.ensureSeeded();
    const candidates = [normalizeWord(surface), lemma ? normalizeWord(lemma) : ''].filter(Boolean);
    return this.tx(STORE_ENTRIES, 'readonly', async (tx) => {
      const store = tx.objectStore(STORE_ENTRIES);
      for (const word of candidates) {
        const entry = (await promisify(store.get(word))) as DictEntry | undefined;
        if (entry) return entry;
      }
      return null;
    });
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new StorageError('STORAGE_UNAVAILABLE', '当前环境不支持 IndexedDB。'));
        return;
      }
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
          db.createObjectStore(STORE_ENTRIES, { keyPath: 'word' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new StorageError('STORAGE_IO', '打开词典数据库失败。', { cause: req.error }));
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
      tx.onerror = () => reject(new StorageError('STORAGE_IO', '词典事务失败。', { cause: tx.error }));
      tx.onabort = () => reject(new StorageError('STORAGE_IO', '词典事务中止。', { cause: tx.error }));
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

  private async seed(): Promise<void> {
    const seeded = await this.tx(STORE_META, 'readonly', async (tx) => {
      const rec = (await promisify(tx.objectStore(STORE_META).get('seeded'))) as
        | { key: string; value: number }
        | undefined;
      return rec?.value === this.seedVersion;
    });
    if (seeded) return;

    const res = await fetch(this.seedUrl);
    if (!res.ok) throw new Error(`词典资源加载失败：${this.label}`);
    const entries = (await res.json()) as DictEntry[];

    await this.tx([STORE_ENTRIES, STORE_META], 'readwrite', async (tx) => {
      const entriesStore = tx.objectStore(STORE_ENTRIES);
      entriesStore.clear();
      for (const entry of entries) entriesStore.put(entry);
      tx.objectStore(STORE_META).put({ key: 'seeded', value: this.seedVersion });
    });
  }
}
