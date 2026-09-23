/**
 * Per-channel median of 8-bit values, exactly like np.median: for an even count
 * the mean of the two middle values (which may end in .5).
 */
export class ChannelHistogram {
  readonly bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  count = 0;

  add(r: number, g: number, b: number): void {
    this.bins[0][r]++;
    this.bins[1][g]++;
    this.bins[2][b]++;
    this.count++;
  }

  median(): [number, number, number] {
    return [kthMedian(this.bins[0], this.count), kthMedian(this.bins[1], this.count), kthMedian(this.bins[2], this.count)];
  }
}

function kth(bins: Uint32Array, k: number): number {
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += bins[v];
    if (acc > k) return v;
  }
  throw new Error('kth out of range');
}

function kthMedian(bins: Uint32Array, n: number): number {
  if (n === 0) return NaN;
  const half = n >> 1;
  if (n % 2 === 1) return kth(bins, half);
  return (kth(bins, half - 1) + kth(bins, half)) / 2;
}

/** Median over a rectangle [x0,x1) x [y0,y1) of an RGBA buffer. */
export function rectMedian(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number] {
  const h = new ChannelHistogram();
  for (let y = y0; y < y1; y++) {
    let i = (y * width + x0) * 4;
    for (let x = x0; x < x1; x++, i += 4) h.add(data[i], data[i + 1], data[i + 2]);
  }
  return h.median();
}
