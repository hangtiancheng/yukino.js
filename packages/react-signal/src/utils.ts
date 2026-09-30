/**
 * Yukino framework internal utility functions.
 *
 * Deliberately tiny: errors are never swallowed (no try-catch wrappers).
 */

/** Safe hasOwnProperty check */
export function hasOwnProperty<T extends object>(
  owner: T | undefined | null,
  prop: PropertyKey,
): boolean {
  return owner != null && Object.prototype.hasOwnProperty.call(owner, prop);
}

// ============================================================
// Dev warnings (deduped — render paths run every pass)
// ============================================================

const warnedMessages = new Set<string>();

/** Warn once per unique message (render-path safe). */
export function devWarn(message: string): void {
  if (warnedMessages.has(message)) return;
  warnedMessages.add(message);
  // eslint-disable-next-line no-console
  console.warn(`[yukino-react-signal] ${message}`);
}
