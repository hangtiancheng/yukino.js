export const SVG_NS = "http://www.w3.org/2000/svg";

export const MATH_NS = "http://www.w3.org/1998/Math/MathML";

export function strSafe(v: unknown): string {
  return String(v == null ? "" : v);
}
