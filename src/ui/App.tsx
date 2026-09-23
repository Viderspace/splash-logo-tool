import { useState } from 'react';
import { DEFAULT_OPTIONS } from '../core/pipeline';
import type { ProcessOptions } from '../core/types';
import { Controls } from './Controls';
import { DropZone } from './DropZone';
import { Preview, type PreviewMode } from './Preview';
import { StatusLine } from './StatusLine';
import { OUTPUT_NAME, useProcessor, type ChangeMode } from './useProcessor';

const MODES: { id: PreviewMode; label: string }[] = [
  { id: 'phone', label: 'Phone mockup' },
  { id: 'splash', label: 'Splash' },
  { id: 'checker', label: 'Transparent output' },
];

const SWATCHES = [
  { color: '#ffffff', name: 'White' },
  { color: '#000000', name: 'Black' },
  { color: '#808080', name: 'Mid-gray' },
  { color: '#ff6a00', name: 'Orange' },
];

export function App() {
  const { state, load, update, download } = useProcessor();
  const [options, setOptions] = useState<ProcessOptions>(DEFAULT_OPTIONS);
  // View preferences: kept across files (unlike the processing settings).
  const [mode, setMode] = useState<PreviewMode>('phone');
  const [background, setBackground] = useState('#ffffff');
  // Circle outline per mode: on by default only in Transparent output.
  const [showCircle, setShowCircle] = useState<Record<PreviewMode, boolean>>({ phone: false, splash: false, checker: true });
  const [showBox, setShowBox] = useState(false);

  // Settings are per-logo decisions: every new file starts from the defaults.
  const openFile = (f: File) => {
    setOptions(DEFAULT_OPTIONS);
    void load(f, DEFAULT_OPTIONS);
  };

  const change = (next: ProcessOptions, how: ChangeMode) => {
    setOptions(next);
    update(next, how);
  };

  const { file, latest, full } = state;
  const previewing = latest?.quality === 'preview' && latest !== full;
  const canDownload = !!file && !!full?.report && !state.busy;

  return (
    <div className="app">
      <header>
        <h1>Splash Logo Tool</h1>
        <p className="muted">
          Turns a logo into a 1152×1152 transparent PNG for the Android 12+ splash screen, scaled so the
          logo’s shape fits the 768 px circle.
        </p>
      </header>

      <main>
        <section className="left">
          <DropZone compact={!!file} loading={state.loading} onFile={openFile} />
          {state.loadError && <p className="error">{state.loadError}</p>}
          <Controls
            options={options}
            disabled={!file}
            onChange={change}
            onReset={() => change(DEFAULT_OPTIONS, 'commit')}
          />
        </section>

        <section className="right">
          {file ? (
            <>
              <StatusLine file={file} full={full} activeJob={state.activeJob} />
              <div className="preview-bar">
                <div className="segmented" role="tablist" aria-label="Preview mode">
                  {MODES.map((m) => (
                    <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="view-options">
                {mode !== 'checker' && (
                  <div className="bg-picker" role="group" aria-label="Preview background color">
                    <span>
                      Background <small className="muted">(preview only, not in the download)</small>
                    </span>
                    <span className="swatches">
                      {SWATCHES.map((s) => (
                        <button
                          key={s.color}
                          type="button"
                          className={`swatch-btn${background === s.color ? ' on' : ''}`}
                          style={{ background: s.color }}
                          title={s.name}
                          aria-label={`${s.name} background`}
                          aria-pressed={background === s.color}
                          onClick={() => setBackground(s.color)}
                        />
                      ))}
                      <input type="color" value={background} aria-label="Custom background color" onChange={(e) => setBackground(e.target.value)} />
                    </span>
                  </div>
                )}
                <div className="overlay-toggles">
                  <label className="toggle inline">
                    <input
                      type="checkbox"
                      checked={showCircle[mode]}
                      onChange={(e) => setShowCircle({ ...showCircle, [mode]: e.target.checked })}
                    />
                    <span>Show circle</span>
                  </label>
                  <label className="toggle inline">
                    <input type="checkbox" checked={showBox} onChange={(e) => setShowBox(e.target.checked)} />
                    <span>Show bounding box</span>
                  </label>
                </div>
              </div>
              <Preview
                output={latest?.output ?? null}
                fit={latest?.report?.fit ?? null}
                mode={mode}
                background={background}
                showCircle={showCircle[mode]}
                showBox={showBox}
                dimmed={previewing || state.loading}
              />
              <button
                type="button"
                className="primary"
                disabled={!canDownload}
                onClick={() => void download(options)}
              >
                Download {OUTPUT_NAME}
              </button>
            </>
          ) : (
            <div className="placeholder muted">The preview appears here.</div>
          )}
        </section>
      </main>
    </div>
  );
}
