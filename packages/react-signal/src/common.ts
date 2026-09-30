/**
 * Yukino framework shared constants and helpers (rendering).
 */

/** SVG namespace */
export const SVG_NS = "http://www.w3.org/2000/svg";

/** MathML namespace */
export const MATH_NS = "http://www.w3.org/1998/Math/MathML";

/**
 * Null-safe `String(v)` — `null` / `undefined` become `""`.
 */
export function strSafe(v: unknown): string {
  return String(v == null ? "" : v);
}
