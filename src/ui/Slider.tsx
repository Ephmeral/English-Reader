// 阅读标记偏好滑块。取值域 1..25 整数，默认由 measuredBand 或旧 sliderLevel 播种。

import { SLIDER_MAX, SLIDER_MIN } from '../core/model/level';
import type { BehavioralBandSuggestion } from '../core/assessment/behavior-suggestion';

export function Slider({
  value,
  onChange,
  measuredBand,
  behaviorSuggestion,
  onApplyBehaviorSuggestion,
  onOpenAssessment,
}: {
  value: number;
  onChange: (v: number) => void;
  measuredBand: number | null;
  behaviorSuggestion: BehavioralBandSuggestion | null;
  onApplyBehaviorSuggestion: () => void;
  onOpenAssessment: () => void;
}) {
  return (
    <div className="slider">
      <div className="level-summary">
        {measuredBand == null ? (
          <button type="button" className="link-button" onClick={onOpenAssessment}>
            未测词汇量
          </button>
        ) : (
          <span>
            你的词汇量 ≈ <strong>{measuredBand}k</strong>
          </span>
        )}
        {behaviorSuggestion && behaviorSuggestion.suggestedBand !== measuredBand && (
          <span className="level-suggestion">
            近期阅读更像 {behaviorSuggestion.suggestedBand}k
            <button type="button" onClick={onApplyBehaviorSuggestion}>
              更新
            </button>
          </span>
        )}
      </div>
      <span className="slider-bound">少标记</span>
      <input
        id="level-slider"
        aria-label="标记多少"
        type="range"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-bound">多标记</span>
      <span className="slider-hint">高于 {value}k 的词会被标记</span>
    </div>
  );
}
