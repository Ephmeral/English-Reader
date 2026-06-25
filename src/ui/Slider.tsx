// 手动水平滑块（规格 §3 阶段2）。取值域 1..25 整数，默认 3（见 level.ts 登记）。

import { SLIDER_MAX, SLIDER_MIN } from '../core/model/level';

export function Slider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="slider">
      <label htmlFor="level-slider">
        我的水平：<strong>{value}k</strong> 词族
      </label>
      <input
        id="level-slider"
        type="range"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-hint">高于 {value}k 的词会被标记</span>
    </div>
  );
}
