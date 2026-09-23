import { describe, expect, it } from 'vitest';
import { borderBand } from '../src/core/background';
import { labelComponents } from '../src/core/labels';
import { ChannelHistogram } from '../src/core/median';
import { formatFixed, formatPercent0, formatPyFloat, roundHalfEven } from '../src/core/round';

describe('roundHalfEven (Python round)', () => {
  it.each([
    [0.5, 0], [1.5, 2], [2.5, 2], [3.5, 4], [2.4999, 2], [2.5001, 3], [-2.5, -2], [-3.5, -4], [254.5, 254], [255.5, 256],
  ])('%s -> %s', (x, want) => expect(roundHalfEven(x)).toBe(want));

  it('band for min side 250 is 2 (250*0.01 = 2.5 rounds to even)', () => {
    expect(borderBand(250, 300)).toBe(2);
    expect(borderBand(350, 400)).toBe(4); // 3.5 -> 4
  });
});

describe('Python-style formatting', () => {
  it.each([
    [0.125, 2, '0.12'], [0.375, 2, '0.38'], [2.675, 2, '2.67'], [47.04, 1, '47.0'], [1.128591, 2, '1.13'], [0.5, 0, '0'], [1.5, 0, '2'],
  ])('%s .%sf -> %s', (x, d, want) => expect(formatFixed(x, d)).toBe(want));
  it('percent', () => {
    expect(formatPercent0(0.03535353535353535)).toBe('4%');
    expect(formatPercent0(0.745)).toBe('74%'); // 0.745*100 == 74.5 exactly -> ties to even
    expect(formatPercent0(0.125)).toBe('12%');
    expect(formatPercent0(0.625)).toBe('62%');
  });
  it('str(float)', () => {
    expect(formatPyFloat(24)).toBe('24.0');
    expect(formatPyFloat(30.5)).toBe('30.5');
  });
});

describe('median (np.median semantics)', () => {
  it('odd count', () => {
    const h = new ChannelHistogram();
    [[1, 5, 9], [3, 5, 7], [2, 6, 8]].forEach(([r, g, b]) => h.add(r, g, b));
    expect(h.median()).toEqual([2, 5, 8]);
  });
  it('even count averages the two middle values', () => {
    const h = new ChannelHistogram();
    [[200, 0, 10], [201, 0, 11], [200, 1, 10], [201, 1, 11]].forEach(([r, g, b]) => h.add(r, g, b));
    expect(h.median()).toEqual([200.5, 0.5, 10.5]);
  });
});

describe('labelComponents (4-connectivity)', () => {
  it('diagonal neighbours are separate components', () => {
    // 1 0
    // 0 1
    const { labels, count } = labelComponents(new Uint8Array([1, 0, 0, 1]), 2, 2);
    expect(count).toBe(2);
    expect(labels[0]).not.toBe(labels[3]);
  });
  it('U shape is one component; enclosed region is its own', () => {
    const W = 5;
    const rows = ['11111', '10001', '10101', '10001', '11111'];
    const mask = new Uint8Array(rows.join('').split('').map(Number));
    const { labels, count } = labelComponents(mask, W, 5);
    expect(count).toBe(2);
    expect(labels[12]).not.toBe(labels[0]);
    const inv = new Uint8Array(mask.map((v) => 1 - v));
    expect(labelComponents(inv, W, 5).count).toBe(1); // the ring-shaped gap
  });
  it('handles a large spiral without recursion', () => {
    const N = 801;
    const mask = new Uint8Array(N * N);
    // Concentric square rings of 1s separated by 0s, connected by a gap -> serpentine path.
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ring = Math.min(x, y, N - 1 - x, N - 1 - y);
      mask[y * N + x] = ring % 2 === 0 ? 1 : 0;
    }
    for (let r = 1; r < N / 2; r += 2) mask[r * N + (N >> 1)] = 1; // bridges
    const { count } = labelComponents(mask, N, N);
    expect(count).toBe(1);
  });
});
