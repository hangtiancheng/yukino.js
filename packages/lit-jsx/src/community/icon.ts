export function icon(svg: string, className?: string): string {
  let out = svg.replace(/<!--[\s\S]*?-->\s*/g, "");
  out = out
    .replace(/\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (className) {
    out = setSvgAttribute(out, "class", `lucide ${className}`);
  }
  return out;
}

export interface IconProps {
  className?: string;
  strokeWidth?: number;
}

export function iconWith(svg: string, props: IconProps): string {
  let out = icon(svg, props.className);
  if (props.strokeWidth !== undefined) {
    out = setSvgAttribute(out, "stroke-width", String(props.strokeWidth));
  }
  return out;
}

function setSvgAttribute(svg: string, name: string, value: string): string {
  // Restrict changes to the root opening tag; child attributes are unrelated.
  return svg.replace(/<svg(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/i, (tag) => {
    const escaped = value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const attribute = `${name}="${escaped}"`;
    let replaced = false;
    const updated = tag.replace(
      /(\s+)([^\s=/>]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+)/g,
      (match, space: string, attributeName: string) => {
        if (attributeName.toLowerCase() !== name) return match;
        replaced = true;
        return `${space}${attribute}`;
      },
    );
    return replaced
      ? updated
      : tag.replace(/\/?>$/, (end) => ` ${attribute}${end}`);
  });
}
