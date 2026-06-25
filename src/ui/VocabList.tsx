// 生词本视图（规格 §3 阶段4）。展示持久化的 VocabEntry，可改理解程度。

import { useEffect, useState } from 'react';
import type { Comprehension, VocabEntry } from '../core/storage/storage';
import type { Deps } from '../app/deps';

const MARK_LABEL: Record<Comprehension, string> = {
  unknown: '不认识',
  fuzzy: '模糊',
  known: '认识',
};

export function VocabList({ deps }: { deps: Deps }) {
  const [entries, setEntries] = useState<VocabEntry[] | null>(null);

  const reload = () => {
    deps.storage.loadVocab().then(setEntries);
  };

  useEffect(reload, [deps]);

  const changeMark = async (entry: VocabEntry, mark: Comprehension) => {
    await deps.storage.saveVocabEntry({ ...entry, comprehension: mark, lastMarkedAt: Date.now() });
    await deps.logger.log({ type: 'comprehension_mark', lemma: entry.lemma, mark });
    reload();
  };

  if (entries === null) return <div className="muted pad">加载生词本…</div>;
  if (entries.length === 0)
    return <div className="empty pad">还没有生词。在阅读中点击高亮词即可加入生词本。</div>;

  return (
    <div className="vocab pad">
      <h2>生词本（{entries.length}）</h2>
      <ul className="vocab-list">
        {entries.map((e) => (
          <li key={e.id} className="vocab-item">
            <div className="vocab-head">
              <span className="vocab-lemma">{e.lemma}</span>
              <span className="vocab-band">{e.band == null ? 'OOV' : `${e.band}k`}</span>
              <span className="vocab-count muted">{e.contexts.length} 处</span>
            </div>
            {e.contexts[0] && <p className="vocab-context">“{e.contexts[0].sentence}”</p>}
            <div className="vocab-marks">
              {(Object.keys(MARK_LABEL) as Comprehension[]).map((m) => (
                <button
                  key={m}
                  className={e.comprehension === m ? 'mark active' : 'mark'}
                  onClick={() => changeMark(e, m)}
                >
                  {MARK_LABEL[m]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
