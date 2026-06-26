import { useMemo, useState, type FormEvent } from 'react';
import type { LexiconTable } from '../core/lexicon/lexicon';
import {
  bandFromVocabSize,
  generateTest,
  scoreTest,
  type MeasurementLogEntry,
  type MeasurementSource,
  type TestAnswers,
  type TestResult,
  type TestSpec,
} from '../core/assessment/vocab-size-test';
import decoys from '../data/decoys.json';

function formatSize(value: number): string {
  return Math.round(value).toLocaleString('zh-CN');
}

function sourceLabel(source: MeasurementSource): string {
  return source === 'native' ? '内置' : '外部';
}

function MeasurementSparkline({ log }: { log: MeasurementLogEntry[] }) {
  const sorted = [...log].sort((a, b) => a.at - b.at);
  const width = 240;
  const height = 56;
  const pad = 6;
  const values = sorted.map((entry) => entry.vocabSize);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = Math.max(1, max - min);
  const points = sorted
    .map((entry, index) => {
      const x =
        sorted.length <= 1
          ? width / 2
          : pad + (index / (sorted.length - 1)) * (width - pad * 2);
      const y = height - pad - ((entry.vocabSize - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="measurement-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />
      {sorted.length > 0 && <polyline points={points} />}
    </svg>
  );
}

function startNativeTest(table: LexiconTable): TestSpec {
  return generateTest(table, decoys, { seed: Date.now() });
}

export function VocabSizeTest({
  table,
  measuredBand,
  measurementLog,
  onAdopt,
  onBack,
}: {
  table: LexiconTable;
  measuredBand: number | null;
  measurementLog: MeasurementLogEntry[];
  onAdopt: (source: MeasurementSource, vocabSize: number, band: number) => void;
  onBack: () => void;
}) {
  const [spec, setSpec] = useState<TestSpec>(() => startNativeTest(table));
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<TestAnswers>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [externalValue, setExternalValue] = useState('');
  const [externalError, setExternalError] = useState('');
  const current = spec.items[index] ?? null;
  const history = useMemo(
    () => [...measurementLog].sort((a, b) => b.at - a.at),
    [measurementLog],
  );

  const restart = () => {
    setSpec(startNativeTest(table));
    setIndex(0);
    setAnswers({});
    setResult(null);
  };

  const answer = (known: boolean) => {
    if (!current) return;
    const next = { ...answers, [current.key]: known };
    setAnswers(next);
    if (index >= spec.items.length - 1) {
      setResult(scoreTest(spec, next));
    } else {
      setIndex(index + 1);
    }
  };

  const adoptNative = () => {
    if (!result || !result.reliable) return;
    onAdopt('native', result.estimatedSize, result.estimatedBand);
  };

  const submitExternal = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(externalValue);
    if (!Number.isFinite(value) || value <= 0) {
      setExternalError('请输入有效的词族量数字。');
      return;
    }
    const vocabSize = Math.round(value);
    onAdopt('external', vocabSize, bandFromVocabSize(vocabSize));
    setExternalValue('');
    setExternalError('');
  };

  return (
    <div className="assessment pad">
      <div className="assessment-head">
        <div>
          <h2>水平评估</h2>
          <p className="muted">
            {measuredBand == null ? '还没有测量结果。' : `当前采用水平 ≈ ${measuredBand}k`}
          </p>
        </div>
        <button type="button" onClick={onBack}>
          返回
        </button>
      </div>

      <section className="assessment-section">
        <div className="section-head">
          <h3>内置词汇量测试</h3>
          {!result && current && (
            <span className="muted">
              {index + 1} / {spec.items.length}
            </span>
          )}
        </div>

        {result ? (
          <div className="test-result">
            <div className="result-number">{formatSize(result.estimatedSize)}</div>
            <div className="muted">约 = {result.estimatedBand}k</div>
            {!result.reliable && (
              <p className="error">
                诱饵误认率 {(result.decoyFalseAlarm * 100).toFixed(0)}%，本次结果不可靠，请重测。
              </p>
            )}
            <div className="assessment-actions">
              <button type="button" onClick={adoptNative} disabled={!result.reliable}>
                采用
              </button>
              <button type="button" onClick={restart}>
                重测
              </button>
            </div>
          </div>
        ) : current ? (
          <div className="test-card">
            <div className="test-word">{current.key}</div>
            <div className="assessment-actions">
              <button type="button" onClick={() => answer(false)}>
                不认识
              </button>
              <button type="button" onClick={() => answer(true)}>
                认识
              </button>
            </div>
          </div>
        ) : (
          <p className="empty">没有可用测试题。</p>
        )}
      </section>

      <section className="assessment-section">
        <h3>外部测试录入</h3>
        <p className="muted">
          可在{' '}
          <a href="https://my.vocabularysize.com/" target="_blank" rel="noreferrer">
            my.vocabularysize.com
          </a>{' '}
          完成测试后填回词族量。
        </p>
        <form className="external-form" onSubmit={submitExternal}>
          <input
            type="number"
            min={1}
            step={1}
            value={externalValue}
            onChange={(event) => setExternalValue(event.target.value)}
            placeholder="例如 5200"
            aria-label="外部词族量"
          />
          <button type="submit">采用外部结果</button>
        </form>
        {externalError && <p className="error">{externalError}</p>}
      </section>

      <section className="assessment-section">
        <div className="section-head">
          <h3>测量历史</h3>
          {history.length > 0 && <span className="muted">{history.length} 次</span>}
        </div>
        {history.length === 0 ? (
          <p className="empty">暂无测量记录。</p>
        ) : (
          <>
            <MeasurementSparkline log={history} />
            <ul className="measurement-list">
              {history.map((entry) => (
                <li key={`${entry.at}:${entry.source}:${entry.vocabSize}`}>
                  <span>{new Date(entry.at).toLocaleString('zh-CN')}</span>
                  <span>{sourceLabel(entry.source)}</span>
                  <strong>{formatSize(entry.vocabSize)}</strong>
                  <span>{entry.band}k</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
