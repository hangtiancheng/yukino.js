export function stripAnchors(html: string): string {
  return html.replace(/<!---->/g, "");
}
