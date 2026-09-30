/** Shared test helpers. */

/**
 * Strip the reconciler's component/root end-anchor comments (`<!---->`) from
 * an innerHTML snapshot so assertions compare visible markup only.
 */
export function stripAnchors(html: string): string {
  return html.replace(/<!---->/g, "");
}
