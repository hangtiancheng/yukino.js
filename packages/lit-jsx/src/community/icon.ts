export function icon(svg: string, className?: string): string {
  let out = svg.replace(/<!--[^>]*-->\s*/g, "");
  out = out
    .replace(/\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (className) {
    out = out.replace(
      /class="lucide[^"]*"/,
      (_match) => `class="lucide ${className}"`,
    );
    if (!/class="lucide/.test(out)) {
      out = out.replace("<svg", `<svg class="lucide ${className}"`);
    }
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
    out = out.replace(
      /stroke-width="[^"]*"/,
      `stroke-width="${props.strokeWidth}"`,
    );
  }
  return out;
}
