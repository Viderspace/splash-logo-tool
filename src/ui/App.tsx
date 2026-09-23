import { useState } from 'react';
import { DEFAULT_OPTIONS } from '../core/pipeline';
import type { ProcessOptions } from '../core/types';
import { Controls } from './Controls';
import { DropZone } from './DropZone';
import { Preview, type PreviewMode } from './Preview';
import { StatusLine } from './StatusLine';
import { outputName, useProcessor, type ChangeMode } from './useProcessor';

export function App() {
  const { state, load, update, download } = useProcessor();
  const [options, setOptions] = useState<ProcessOptions>(DEFAULT_OPTIONS);
  const [mode, setMode] = useState<PreviewMode>('splash');
  const [outline, setOutline] = useState(false);

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
          <DropZone compact={!!file} onFile={openFile} />
          {state.loading && <p className="muted">Reading the image…</p>}
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
              <StatusLine file={file} full={full} previewing={previewing} busy={state.busy} />
              <div className="preview-bar">
                <div className="segmented" role="tablist" aria-label="Preview mode">
                  <button role="tab" aria-selected={mode === 'splash'} className={mode === 'splash' ? 'on' : ''} onClick={() => setMode('splash')}>
                    Splash on white
                  </button>
                  <button role="tab" aria-selected={mode === 'checker'} className={mode === 'checker' ? 'on' : ''} onClick={() => setMode('checker')}>
                    Transparent output
                  </button>
                </div>
                {mode === 'splash' && (
                  <label className="toggle inline">
                    <input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} />
                    <span>Show circle</span>
                  </label>
                )}
              </div>
              <Preview output={latest?.output ?? null} mode={mode} outline={outline} dimmed={previewing} />
              <button
                type="button"
                className="primary"
                disabled={!canDownload}
                onClick={() => void download(options)}
              >
                Download {outputName(file.name)}
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
