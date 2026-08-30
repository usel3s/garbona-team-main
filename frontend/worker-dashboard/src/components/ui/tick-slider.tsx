import { useId, useMemo, type CSSProperties } from "react";
import "./tick-slider.css";

export type TickSliderProps = {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Show a label under every Nth tick (default 2). */
  skipInterval?: number;
  label?: string;
  onChange: (value: number) => void;
};

/**
 * Dark-theme slider with numeric ticks under the track (shadcn "Slider with ticks" look).
 */
export function TickSlider({
  value,
  min = 0,
  max = 10,
  step = 1,
  skipInterval = 2,
  label,
  onChange,
}: TickSliderProps) {
  const id = useId();
  const ticks = useMemo(() => {
    const list: number[] = [];
    for (let i = min; i <= max; i += 1) list.push(i);
    return list;
  }, [min, max]);

  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <div className="gts">
      {label ? (
        <label className="gts__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className="gts__track-wrap">
        <input
          id={id}
          className="gts__input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          style={{ "--gts-fill": `${pct}%` } as CSSProperties}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <div className="gts__ticks" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick}
              className={tick % skipInterval === 0 ? "is-major" : undefined}
            />
          ))}
        </div>
        <div className="gts__labels" aria-hidden="true">
          {ticks
            .filter((tick) => tick % skipInterval === 0)
            .map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
        </div>
      </div>
    </div>
  );
}

export default TickSlider;
