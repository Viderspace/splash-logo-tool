export type BackgroundErrorKind = 'borderMatch' | 'sideMismatch' | 'empty';

/** Port of the reference's BackgroundError; messages match the reference text. */
export class BackgroundError extends Error {
  readonly kind: BackgroundErrorKind;
  readonly details: Record<string, unknown>;

  constructor(kind: BackgroundErrorKind, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BackgroundError';
    this.kind = kind;
    this.details = details;
  }
}
