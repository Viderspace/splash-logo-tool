import { useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  compact: boolean;
  /** Shown in place of a line of text (same height), so loading never shifts the layout. */
  loading: boolean;
}

export function DropZone({ onFile, compact, loading }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      className={`dropzone${over ? ' over' : ''}${compact ? ' compact' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      {compact ? (
        <Swap loading={loading} idle={<>Drop another logo here, or <u>choose a file</u></>} />
      ) : (
        <>
          <strong>Drop a logo here</strong>
          <Swap loading={loading} idle="or click to choose a file (PNG, JPEG or WebP)" />
          <span className="muted">The image is processed in your browser and never uploaded.</span>
        </>
      )}
    </div>
  );
}

/** Both texts occupy the same grid cell; only visibility changes, so nothing moves. */
function Swap({ loading, idle }: { loading: boolean; idle: React.ReactNode }) {
  return (
    <span className="swap">
      <span style={{ visibility: loading ? 'hidden' : 'visible' }}>{idle}</span>
      <span style={{ visibility: loading ? 'visible' : 'hidden' }} aria-hidden={!loading}>
        Reading the image…
      </span>
    </span>
  );
}
