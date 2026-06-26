// 书架（规格 §3 阶段1 上传 / 阶段5 默认书 + 空/加载/错误态）。

import { useEffect, useRef, useState } from 'react';
import type { DocumentMeta } from '../core/model/token';
import type { VocabProfile } from '../core/model/token';
import { DEFAULT_XRAY_SETTINGS } from '../core/model/buckets';
import { bucketDistribution, coverageAtLevel, vocabNeededFor } from '../core/model/vocab-profile';
import { DEFAULT_BOOKS } from '../data/books';
import { importFromFile, importFromText } from '../app/import-doc';
import type { Deps } from '../app/deps';

export function Library({
  deps,
  sliderLevel,
  onOpen,
}: {
  deps: Deps;
  sliderLevel: number;
  onOpen: (docId: string) => void;
}) {
  const [docs, setDocs] = useState<DocumentMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => {
    void deps.storage.listDocuments().then(setDocs);
  };
  useEffect(reload, [deps]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openDefault = (fileName: string, mime: string, text: string) =>
    guard(async () => {
      const doc = await importFromText(deps, { name: fileName, mime, text });
      await reload();
      onOpen(doc.id);
    });

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void guard(async () => {
      const doc = await importFromFile(deps, file);
      await reload();
      onOpen(doc.id);
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const remove = (id: string) =>
    guard(async () => {
      await deps.storage.deleteDocument(id);
      await reload();
    });

  return (
    <div className="library pad">
      <section>
        <h2>上传</h2>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.markdown,.epub,text/plain,text/markdown,application/epub+zip"
          onChange={onUpload}
          disabled={busy}
        />
        <p className="muted">支持 txt / markdown / epub，全英文。</p>
        {error && <p className="error">{error}</p>}
      </section>

      <section>
        <h2>默认书</h2>
        <div className="book-grid">
          {DEFAULT_BOOKS.map((b) => (
            <button
              key={b.fileName}
              className="book-card"
              disabled={busy}
              onClick={() => openDefault(b.fileName, b.mime, b.text)}
            >
              <span className="book-title">{b.title}</span>
              <span className="book-meta muted">{b.mime === 'text/markdown' ? 'md' : 'txt'}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>我的文档</h2>
        {docs === null && <p className="muted">加载中…</p>}
        {docs !== null && docs.length === 0 && (
          <p className="empty">还没有文档。上传一个文件，或打开上面的默认书。</p>
        )}
        {docs !== null && docs.length > 0 && (
          <ul className="doc-list">
            {docs.map((m) => (
              <li key={m.id} className="doc-item">
                <button
                  className="doc-open"
                  disabled={busy}
                  onClick={() => onOpen(m.id)}
                  title={m.fileName}
                >
                  <LibraryCover deps={deps} meta={m} />
                    <span className="doc-main">
                      <span className="doc-name">{m.fileName.replace(/\.[^.]+$/, '')}</span>
                      <span className="muted">
                        {m.wordCount} 词 · {m.sourceFormat}
                        {m.chapterCount && m.chapterCount > 1 ? ` · ${m.chapterCount} 章` : ''}
                      </span>
                      <Readability profile={m.vocabProfile} sliderLevel={sliderLevel} />
                    </span>
                  </button>
                <button className="doc-del" disabled={busy} onClick={() => remove(m.id)}>
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Readability({
  profile,
  sliderLevel,
}: {
  profile?: VocabProfile;
  sliderLevel: number;
}) {
  if (!profile) return <span className="readability muted">词汇画像 —</span>;

  const coverage = coverageAtLevel(profile, sliderLevel);
  const needed = vocabNeededFor(profile, 0.95);
  const counts = bucketDistribution(profile);
  const total = Math.max(1, profile.tokenCount);

  return (
    <span className="readability">
      <span className="coverage-bar" aria-hidden="true">
        {counts.map((count, index) => (
          <span
            key={DEFAULT_XRAY_SETTINGS.buckets[index]?.label ?? index}
            style={{
              flexGrow: count,
              background: DEFAULT_XRAY_SETTINGS.buckets[index]?.color,
              minWidth: count > 0 ? 3 : 0,
            }}
          />
        ))}
      </span>
      <span className="muted">
        你认识约 {(coverage * 100).toFixed(0)}% · 95% 覆盖需{' '}
        {needed === null ? '>25k' : `≈${needed}k`} · {profile.typeCount} 类词
      </span>
      <span className="sr-only">总词数 {total}</span>
    </span>
  );
}

function LibraryCover({ deps, meta }: { deps: Deps; meta: DocumentMeta }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!meta.coverAssetId) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let alive = true;
    deps.storage.loadAsset(meta.id, meta.coverAssetId).then((blob) => {
      if (!alive || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [deps, meta.coverAssetId, meta.id]);

  return (
    <span className="doc-cover" aria-hidden="true">
      {url && <img src={url} alt="" loading="lazy" />}
    </span>
  );
}
