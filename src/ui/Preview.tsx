import { useEffect, useRef, useState } from 'react';
import { CANVAS_SIZE, CIRCLE_DIAMETER } from '../core/constants';

export type PreviewMode = 'splash' | 'checker';

interface Props {
  output: Uint8ClampedArray | null;
  mode: PreviewMode;
  outline: boolean;
  dimmed: boolean;
}

/** Display only: the canvas never feeds back into processing or the download. */
export function Preview({ output, mode, outline, dimmed }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);

  useEffect(() => {
    const replace = (next: ImageBitmap | null) =>
      setBitmap((prev) => {
        prev?.close();
        return next;
      });
    if (!output) {
      replace(null);
      return;
    }
    let cancelled = false;
    const data = new ImageData(new Uint8ClampedArray(output), CANVAS_SIZE, CANVAS_SIZE);
    createImageBitmap(data).then((bmp) => {
      if (cancelled) bmp.close();
      else replace(bmp);
    });
    return () => {
      cancelled = true;
    };
  }, [output]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const c = CANVAS_SIZE / 2, r = CIRCLE_DIAMETER / 2;
    ctx.save();
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (mode === 'splash') {
      // The splash is one background color across the whole screen; the mask clips only the icon.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.clip();
      if (bitmap) ctx.drawImage(bitmap, 0, 0);
      ctx.restore();
      if (outline) strokeCircle(ctx, c, r, 'rgba(0, 0, 0, 0.18)', [10, 10]);
    } else {
      if (bitmap) ctx.drawImage(bitmap, 0, 0);
      ctx.restore();
      strokeCircle(ctx, c, r, 'rgba(220, 30, 120, 0.9)', []);
    }
  }, [bitmap, mode, outline]);

  return (
    <canvas
      ref={canvas}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      className={`preview ${mode}${dimmed ? ' dimmed' : ''}`}
      aria-label={mode === 'splash' ? 'Splash preview on white' : 'Transparent output with circle outline'}
    />
  );
}

function strokeCircle(ctx: CanvasRenderingContext2D, c: number, r: number, color: string, dash: number[]) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
