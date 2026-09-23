import { useEffect, useState } from 'react';
import { MIN_CONTRAST } from '../core/constants';
import { formatFixed } from '../core/round';
import type { FileInfo, Outcome } from './useProcessor';

/** Show the processing indicator only when a single job runs longer than this. */
const BUSY_DELAY_MS = 200;

interface Props {
  file: FileInfo;
  full: Outcome | null;
  /** Id of the running worker job, or null when idle. */
  activeJob: number | null;
}

/**
 * True once the current job has been running for `delay` ms. The timer restarts per
 * job, so a stream of fast jobs (e.g. slider previews) never shows the indicator.
 */
function useSlowJob(activeJob: number | null, delay: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (activeJob === null) {
      setShown(false);
      return;
    }
    const t = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(t);
  }, [activeJob, delay]);
  return shown;
}

export function StatusLine({ file, full, activeJob }: Props) {
  const showBusy = useSlowJob(activeJob, BUSY_DELAY_MS);
  const items: React.ReactNode[] = [];

  // Transient state lives in fixed-width slots on this line, so it never changes the layout.
  items.push(
    <li key="file" className="meta muted">
      <span className="meta-name" title={file.name}>{file.name}</span>
      <span className="meta-dims">
        · {file.width}×{file.height} {file.format.toUpperCase()}
      </span>
      <span className="meta-ms">{full ? `· ${Math.round(full.ms)} ms` : ''}</span>
      <span className="meta-busy" role="status">{showBusy ? 'Processing…' : ''}</span>
    </li>,
  );

  if (file.exifOrientation !== 1) {
    items.push(
      <li key="exif" className="note">
        This JPEG carries an EXIF rotation. It is processed rotated, as browsers display it; the
        reference script ignores EXIF rotation.
      </li>,
    );
  }

  if (full?.failure) {
    const bg = full.failure.kind === 'borderMatch' || full.failure.kind === 'sideMismatch';
    items.push(
      <li key="err" className="error">
        <strong>Can’t process this image.</strong> {full.failure.message}
        {bg && ' If the logo sits on a full-bleed badge or graphic, turn on “Keep background”.'}
      </li>,
    );
  } else if (full?.report) {
    const r = full.report;
    const o = full.options;
    if (r.skip === 'alreadyTransparent') {
      items.push(<li key="bg">Image already has transparency: background removal skipped.</li>);
    } else if (r.skip === 'keepBg') {
      items.push(<li key="bg">Background kept (“Keep background” is on).</li>);
    } else if (r.bgRgb && r.bgHex) {
      items.push(
        <li key="bg">
          Background removed: <span className="swatch" style={{ background: r.bgHex }} />{' '}
          <code>{r.bgHex}</code>
        </li>,
      );
    }
    if (r.lowContrast) {
      const ratio = `${formatFixed(r.contrast, 2)}:1, minimum ${MIN_CONTRAST}:1`;
      items.push(
        <li key="contrast" className="warning">
          {o.keepBg ? (
            <>
              Low contrast against the white splash ({ratio}). Because “Keep background” is on, this
              is measured over the whole image including its background, not just the logo.
            </>
          ) : (
            <>
              Low contrast against the white splash ({ratio}): the logo may be hard to see.
              {!o.invert && ' Try “Invert lightness”.'}
            </>
          )}
        </li>,
      );
    }
  }

  return <ul className="status">{items}</ul>;
}
