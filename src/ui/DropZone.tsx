import { useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  compact: boolean;
}

export function DropZone({ onFile, compact }: Props) {
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
        <span>Drop another logo here, or <u>choose a file</u></span>
      ) : (
        <>
          <strong>Drop a logo here</strong>
          <span>or click to choose a file (PNG, JPEG or WebP)</span>
          <span className="muted">The image is processed in your browser and never uploaded.</span>
        </>
      )}
    </div>
  );
}
