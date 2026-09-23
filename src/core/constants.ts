// Constants from reference_logo_to_square.py. Do not change: the reference is the spec.

export const CANVAS_SIZE = 1152;
export const CIRCLE_DIAMETER = 768;

/** Delta E thresholds: below TOL_LOW -> fully transparent, above TOL_HIGH -> fully opaque. */
export const TOL_LOW = 6.0;
export const TOL_HIGH = 24.0;

/** Share of border pixels that must match the background color. */
export const BORDER_MATCH_MIN = 0.6;

/** Pixels with alpha below this are ignored when measuring the logo's extent. */
export const EXTENT_ALPHA_MIN = 8;

/** Share of pixels with alpha < 250 for the image to count as "already transparent". */
export const EXISTING_ALPHA_MIN_SHARE = 0.01;

/** Assumed splash background and the minimum WCAG contrast ratio against it. */
export const SPLASH_BG_RGB: readonly [number, number, number] = [255, 255, 255];
export const MIN_CONTRAST = 1.5;
