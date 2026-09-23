/**
 * Connected-component labeling with 4-connectivity (scipy.ndimage.label default),
 * iterative scanline flood fill: no recursion, and the stack holds row segments
 * rather than pixels so it stays small on large images.
 *
 * Returns the label per pixel (0 = not in mask, 1..count otherwise).
 */
export function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; count: number } {
  const labels = new Int32Array(width * height);
  let count = 0;
  // Stack of seed points (x, y), grown on demand.
  let stack = new Int32Array(1024);
  let sp = 0;
  const push = (x: number, y: number) => {
    if (sp + 2 > stack.length) {
      const next = new Int32Array(stack.length * 2);
      next.set(stack);
      stack = next;
    }
    stack[sp++] = x;
    stack[sp++] = y;
  };

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== 0) continue;
    const label = ++count;
    push(start % width, (start / width) | 0);
    while (sp > 0) {
      const y = stack[--sp];
      const x = stack[--sp];
      const row = y * width;
      if (!mask[row + x] || labels[row + x] !== 0) continue;
      // Extend the run left and right.
      let xl = x;
      while (xl > 0 && mask[row + xl - 1] && labels[row + xl - 1] === 0) xl--;
      let xr = x;
      while (xr < width - 1 && mask[row + xr + 1] && labels[row + xr + 1] === 0) xr++;
      for (let i = xl; i <= xr; i++) labels[row + i] = label;
      // Seed one point per unlabeled run in the rows above and below.
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= height) continue;
        const nrow = ny * width;
        let inRun = false;
        for (let i = xl; i <= xr; i++) {
          const open = mask[nrow + i] !== 0 && labels[nrow + i] === 0;
          if (open && !inRun) push(i, ny);
          inRun = open;
        }
      }
    }
  }
  return { labels, count };
}
