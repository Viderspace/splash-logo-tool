// The lines the reference CLI prints, reproduced from a report (tests compare
// them with the goldens; the UI shows its own wording built on the same data).

import { MIN_CONTRAST } from './constants';
import type { ProcessReport } from './pipeline';
import { formatFixed, formatPyFloat } from './round';
import type { ProcessOptions } from './types';

export function contrastWarning(contrast: number, inverted: boolean): string {
  const hint = inverted ? '' : ' Consider running with --invert.';
  return (
    `WARNING: low contrast against a white splash ` +
    `(${formatFixed(contrast, 2)}:1, minimum ${formatPyFloat(MIN_CONTRAST)}:1).${hint}`
  );
}

export function referenceLog(report: Omit<ProcessReport, 'fit'>, opts: ProcessOptions): string[] {
  const log: string[] = [];
  if (report.skip === 'keepBg') log.push('Background removal skipped (--keep-bg).');
  else if (report.skip === 'alreadyTransparent') log.push('Image already has transparency — background removal skipped.');
  else log.push('Background removed.');
  if (opts.invert) log.push('Lightness inverted (--invert).');
  if (report.lowContrast) log.push(contrastWarning(report.contrast, opts.invert));
  return log;
}
