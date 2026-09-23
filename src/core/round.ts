/**
 * Python's round() / numpy's np.round: round half to even.
 * (Math.round rounds half up, which would differ e.g. for band = round(2.5).)
 */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  // Math.round(x) rounds .5 up; on an exact tie pick the even neighbour.
  if (r - x === 0.5 && r % 2 !== 0) return r - 1;
  return r;
}

/**
 * Format like Python's f"{x:.{digits}f}": correctly rounded from the exact binary
 * value, ties to even. (Number.prototype.toFixed breaks exact ties upward.)
 */
export function formatFixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) return String(x);
  const neg = x < 0 || Object.is(x, -0);
  // toFixed(100) is the exact decimal expansion for the magnitudes used here.
  const exact = Math.abs(x).toFixed(100);
  const dot = exact.indexOf('.');
  const intPart = exact.slice(0, dot);
  const frac = exact.slice(dot + 1);
  const keep = intPart + frac.slice(0, digits);
  const rest = frac.slice(digits);
  const first = rest.charCodeAt(0) - 48;
  const tail = rest.slice(1).replace(/0+$/, '');
  const lastKept = keep.charCodeAt(keep.length - 1) - 48;
  const roundUp = first > 5 || (first === 5 && (tail.length > 0 || lastKept % 2 === 1));
  let digitsStr = roundUp ? incrementDecimalString(keep) : keep;
  const intLen = digitsStr.length - digits;
  let out = digits > 0 ? `${digitsStr.slice(0, intLen)}.${digitsStr.slice(intLen)}` : digitsStr;
  out = out.replace(/^0+(?=\d)/, '');
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

function incrementDecimalString(s: string): string {
  const d = s.split('').map((c) => c.charCodeAt(0) - 48);
  let i = d.length - 1;
  while (i >= 0) {
    if (d[i] === 9) {
      d[i] = 0;
      i--;
    } else {
      d[i]++;
      break;
    }
  }
  return (i < 0 ? '1' : '') + d.join('');
}

/** Python's f"{x:.0%}". */
export function formatPercent0(x: number): string {
  return `${formatFixed(x * 100, 0)}%`;
}

/** Python's str() of a float, for the values used in messages (e.g. 24.0, 30.5). */
export function formatPyFloat(x: number): string {
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
}
