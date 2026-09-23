import { useEffect, useRef, useState } from 'react';
import { relativeLuminance } from '../core/color';
import { CANVAS_SIZE, CIRCLE_DIAMETER } from '../core/constants';
import type { FitInfo } from '../core/fit';

export type PreviewMode = 'phone' | 'splash' | 'checker';

interface Props {
  output: Uint8ClampedArray | null;
  /** Fit geometry of this output (logo extent in canvas coordinates). */
  fit: FitInfo | null;
  mode: PreviewMode;
  /** Preview-only splash background (Phone mockup and Splash modes). */
  background: string;
  showCircle: boolean;
  showBox: boolean;
  dimmed: boolean;
}

// Generic phone, in dp. Android 12+ splash icon without an icon background:
// 288x288 dp, masked to a 192 dp circle (= the 1152 px canvas and 768 px circle at xxxhdpi).
const DP = 2; // canvas px per dp
const PHONE = {
  screenW: 412,
  screenH: 915,
  bezel: 11,
  outerRadius: 46,
  screenRadius: 36,
  iconSize: 288,
  statusBarY: 22, // baseline of the status bar content
  pillW: 108,
  pillH: 4,
  pillBottom: 10,
};
const PHONE_W = (PHONE.screenW + 2 * PHONE.bezel) * DP;
const PHONE_H = (PHONE.screenH + 2 * PHONE.bezel) * DP;

/** Display only: the canvas never feeds back into processing or the download. */
export function Preview({ output, fit, mode, background, showCircle, showBox, dimmed }: Props) {
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

  const width = mode === 'phone' ? PHONE_W : CANVAS_SIZE;
  const height = mode === 'phone' ? PHONE_H : CANVAS_SIZE;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    // Canvas px per CSS px, so overlay lines keep the same on-screen width in every mode.
    const cssWidth = el.getBoundingClientRect().width;
    const lw = cssWidth > 0 ? el.width / cssWidth : 2;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.imageSmoothingQuality = 'high';
    const overlays = { fit, showCircle, showBox, lw };

    if (mode === 'phone') {
      drawPhone(ctx, bitmap, background, overlays);
    } else {
      if (mode === 'splash') {
        // The splash is one background color across the whole screen; the mask clips only the icon.
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      }
      const c = CANVAS_SIZE / 2;
      drawIcon(ctx, bitmap, c, c, CANVAS_SIZE, mode === 'splash');
      drawOverlays(ctx, c, c, CANVAS_SIZE, overlays);
    }
  }, [bitmap, mode, background, showCircle, showBox, fit, width]);

  return (
    <canvas
      ref={canvas}
      width={width}
      height={height}
      className={`preview ${mode}${dimmed ? ' dimmed' : ''}`}
      aria-label={
        mode === 'phone'
          ? 'Splash screen on a generic phone'
          : mode === 'splash'
            ? 'Splash preview'
            : 'Transparent output on a checkerboard'
      }
    />
  );
}

interface Overlays {
  fit: FitInfo | null;
  showCircle: boolean;
  showBox: boolean;
  /** Canvas px per CSS px. */
  lw: number;
}

/** The 1152 output drawn at `size` px centered on (cx, cy), optionally clipped to the mask circle. */
function drawIcon(ctx: CanvasRenderingContext2D, bmp: ImageBitmap | null, cx: number, cy: number, size: number, clip: boolean) {
  if (!bmp) return;
  ctx.save();
  if (clip) {
    ctx.beginPath();
    ctx.arc(cx, cy, (size * CIRCLE_DIAMETER) / 2 / CANVAS_SIZE, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.drawImage(bmp, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

/**
 * Circle: solid magenta on a white halo. Bounding box: black/white dashes.
 * Both have a light and a dark component, so they stay visible on any background.
 */
function drawOverlays(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, o: Overlays) {
  const k = size / CANVAS_SIZE;
  if (o.showBox && o.fit) {
    // The algorithm's own extent: the trimmed box (alpha >= EXTENT_ALPHA_MIN), scaled and
    // placed exactly as fit_in_circle does, mapped into preview coordinates.
    const x = cx - size / 2 + o.fit.offset[0] * k;
    const y = cy - size / 2 + o.fit.offset[1] * k;
    const w = o.fit.newSize[0] * k;
    const h = o.fit.newSize[1] * k;
    ctx.save();
    ctx.lineWidth = 3 * o.lw;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1.5 * o.lw;
    ctx.setLineDash([6 * o.lw, 4 * o.lw]);
    ctx.strokeStyle = '#111111';
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
  if (o.showCircle) {
    const r = (size * CIRCLE_DIAMETER) / 2 / CANVAS_SIZE;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 4 * o.lw;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
    ctx.lineWidth = 2 * o.lw;
    ctx.strokeStyle = '#d81b72';
    ctx.stroke();
    ctx.restore();
  }
}

function contrastInk(background: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(background);
  if (!m) return '#1f1f1f';
  const y = relativeLuminance(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
  return y > 0.4 ? '#1f1f1f' : '#f2f2f2';
}

function drawPhone(ctx: CanvasRenderingContext2D, bmp: ImageBitmap | null, background: string, o: Overlays) {
  const P = PHONE;
  // Body.
  ctx.save();
  ctx.fillStyle = '#17181b';
  ctx.beginPath();
  ctx.roundRect(0, 0, PHONE_W, PHONE_H, P.outerRadius * DP);
  ctx.fill();
  ctx.strokeStyle = '#34363b';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  const x0 = P.bezel * DP, y0 = P.bezel * DP;
  const sw = P.screenW * DP, sh = P.screenH * DP;
  const ink = contrastInk(background);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, y0, sw, sh, P.screenRadius * DP);
  ctx.clip();
  ctx.fillStyle = background;
  ctx.fillRect(x0, y0, sw, sh);

  // Splash icon: 288 dp, centered in the full screen, masked to the 192 dp circle.
  const cx = x0 + sw / 2, cy = y0 + sh / 2, size = P.iconSize * DP;
  drawIcon(ctx, bmp, cx, cy, size, true);

  // Status bar: time on the left, generic signal + battery on the right, punch-hole camera.
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.85;
  ctx.font = `500 ${14 * DP}px system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('12:00', x0 + 24 * DP, y0 + (P.statusBarY + 5) * DP);
  const right = x0 + sw - 24 * DP;
  const base = y0 + (P.statusBarY + 4) * DP;
  // Battery.
  ctx.lineWidth = 1.5 * DP;
  ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.roundRect(right - 22 * DP, base - 11 * DP, 20 * DP, 11 * DP, 2.5 * DP);
  ctx.stroke();
  ctx.fillRect(right - 2 * DP, base - 7.5 * DP, 2 * DP, 4 * DP);
  ctx.fillRect(right - 19.5 * DP, base - 8.5 * DP, 12 * DP, 6 * DP);
  // Signal bars.
  for (let i = 0; i < 4; i++) {
    const bh = (4 + i * 2.5) * DP;
    ctx.fillRect(right - (50 - i * 5) * DP, base - bh, 3 * DP, bh);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0a0a0b';
  ctx.beginPath();
  ctx.arc(x0 + sw / 2, y0 + 17 * DP, 5.5 * DP, 0, Math.PI * 2);
  ctx.fill();

  // Gesture navigation pill.
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.roundRect(x0 + (sw - P.pillW * DP) / 2, y0 + sh - (P.pillBottom + P.pillH) * DP, P.pillW * DP, P.pillH * DP, 2 * DP);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  drawOverlays(ctx, cx, cy, size, o);
}
