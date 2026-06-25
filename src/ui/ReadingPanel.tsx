import type { ReadingPrefs, Theme } from '../app/deps';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'day', label: '日间' },
  { value: 'sepia', label: '米黄' },
  { value: 'night', label: '夜间' },
];

interface ReadingPanelProps {
  prefs: ReadingPrefs;
  theme: Theme;
  onPrefsChange: (prefs: ReadingPrefs) => void;
  onThemeChange: (theme: Theme) => void;
  onReset: () => void;
}

export function ReadingPanel({
  prefs,
  theme,
  onPrefsChange,
  onThemeChange,
  onReset,
}: ReadingPanelProps) {
  return (
    <div className="reading-panel" role="dialog" aria-label="阅读设置">
      <label className="reading-control">
        <span>页边距</span>
        <input
          type="range"
          min={24}
          max={120}
          step={4}
          value={prefs.marginPx}
          onChange={(event) =>
            onPrefsChange({ ...prefs, marginPx: Number(event.currentTarget.value) })
          }
        />
        <span className="reading-value">{prefs.marginPx}px</span>
      </label>

      <label className="reading-control">
        <span>字号</span>
        <input
          type="range"
          min={16}
          max={26}
          step={1}
          value={prefs.fontPx}
          onChange={(event) =>
            onPrefsChange({ ...prefs, fontPx: Number(event.currentTarget.value) })
          }
        />
        <span className="reading-value">{prefs.fontPx}px</span>
      </label>

      <label className="reading-control">
        <span>行距</span>
        <input
          type="range"
          min={1.4}
          max={2.2}
          step={0.1}
          value={prefs.lineHeight}
          onChange={(event) =>
            onPrefsChange({ ...prefs, lineHeight: Number(event.currentTarget.value) })
          }
        />
        <span className="reading-value">{prefs.lineHeight.toFixed(1)}</span>
      </label>

      <div className="font-options" aria-label="字体">
        <button
          type="button"
          className={prefs.fontFamily === 'serif' ? 'active' : ''}
          onClick={() => onPrefsChange({ ...prefs, fontFamily: 'serif' })}
        >
          衬线
        </button>
        <button
          type="button"
          className={prefs.fontFamily === 'sans' ? 'active' : ''}
          onClick={() => onPrefsChange({ ...prefs, fontFamily: 'sans' })}
        >
          无衬线
        </button>
      </div>

      <label className="reading-switch">
        <input
          type="checkbox"
          checked={prefs.justify}
          onChange={(event) => onPrefsChange({ ...prefs, justify: event.currentTarget.checked })}
        />
        <span>两端对齐</span>
      </label>

      <div className="theme-options" aria-label="主题">
        {THEMES.map((option) => (
          <button
            key={option.value}
            type="button"
            className={theme === option.value ? 'active' : ''}
            onClick={() => onThemeChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <button type="button" className="reading-reset" onClick={onReset}>
        恢复默认
      </button>
    </div>
  );
}
