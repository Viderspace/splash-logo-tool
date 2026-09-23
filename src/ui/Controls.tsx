import type { ProcessOptions } from '../core/types';
import type { ChangeMode } from './useProcessor';

const MIN = 0;
const MAX = 60;
const STEP = 0.5;

interface Props {
  options: ProcessOptions;
  disabled: boolean;
  onChange: (options: ProcessOptions, mode: ChangeMode) => void;
  onReset: () => void;
}

export function Controls({ options, disabled, onChange, onReset }: Props) {
  const tolDisabled = disabled || options.keepBg;
  const commit = () => onChange(options, 'commit');

  return (
    <fieldset className="controls" disabled={disabled}>
      <legend>Settings</legend>

      <Slider
        label="Tolerance low"
        hint="Colors closer to the background than this become fully transparent."
        value={options.tolLow}
        disabled={tolDisabled}
        onInput={(v) => onChange({ ...options, tolLow: Math.min(v, options.tolHigh - STEP) }, 'drag')}
        onCommit={commit}
      />
      <Slider
        label="Tolerance high"
        hint="Colors farther from the background than this stay fully opaque."
        value={options.tolHigh}
        disabled={tolDisabled}
        onInput={(v) => onChange({ ...options, tolHigh: Math.max(v, options.tolLow + STEP) }, 'drag')}
        onCommit={commit}
      />

      <Toggle
        label="Keep holes"
        hint="Keep enclosed background-colored areas (e.g. inside an “O”) opaque."
        checked={options.keepHoles}
        disabled={tolDisabled}
        onChange={(v) => onChange({ ...options, keepHoles: v }, 'commit')}
      />
      <Toggle
        label="Invert lightness"
        hint="For light logos: makes them dark, keeping their hue."
        checked={options.invert}
        onChange={(v) => onChange({ ...options, invert: v }, 'commit')}
      />
      <Toggle
        label="Keep background"
        hint="Skip background removal (e.g. for full-bleed badges)."
        checked={options.keepBg}
        onChange={(v) => onChange({ ...options, keepBg: v }, 'commit')}
      />

      <button type="button" className="secondary" onClick={onReset}>
        Reset to defaults
      </button>
    </fieldset>
  );
}

function Slider(props: {
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  onInput: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className={`slider${props.disabled ? ' disabled' : ''}`} title={props.hint}>
      <span className="row">
        <span>{props.label}</span>
        <output>{props.value.toFixed(1)}</output>
      </span>
      <input
        type="range"
        min={MIN}
        max={MAX}
        step={STEP}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onInput(Number(e.target.value))}
        onPointerUp={props.onCommit}
        onKeyUp={props.onCommit}
      />
    </label>
  );
}

function Toggle(props: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`toggle${props.disabled ? ' disabled' : ''}`} title={props.hint}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>
        {props.label}
        <small>{props.hint}</small>
      </span>
    </label>
  );
}
