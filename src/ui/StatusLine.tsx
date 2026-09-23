import { MIN_CONTRAST } from '../core/constants';
import { formatFixed } from '../core/round';
import type { FileInfo, Outcome } from './useProcessor';

interface Props {
  file: FileInfo;
  full: Outcome | null;
  previewing: boolean;
  busy: boolean;
}

export function StatusLine({ file, full, previewing, busy }: Props) {
  const items: React.ReactNode[] = [];

  items.push(
    <li key="file" className="muted">
      {file.name} · {file.width}×{file.height} {file.format.toUpperCase()}
      {full && ` · ${Math.round(full.ms)} ms`}
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

  if (previewing || busy) {
    items.push(
      <li key="busy" className="muted">
        {previewing ? 'Preview at reduced resolution…' : 'Processing…'}
      </li>,
    );
  }

  return <ul className="status" aria-live="polite">{items}</ul>;
}
