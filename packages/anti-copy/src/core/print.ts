import type { Feature, ResolvedOptions } from "./types";

const PRINT_STYLE_ATTR = "yukino-anti-print";

export function createPrintFeature(options: ResolvedOptions): Feature {
  const doc = options.target;
  const view = doc.defaultView;
  let style: HTMLStyleElement | null = null;

  const handler = () => {
    options.onViolation?.({ type: "print" });
  };

  return {
    attach() {
      if (!style) {
        style = doc.createElement("style");
        style.setAttribute(PRINT_STYLE_ATTR, "");
        style.textContent =
          "@media print { body { display: none !important; } }";
        doc.head.appendChild(style);
      }
      view?.addEventListener("beforeprint", handler);
    },
    detach() {
      style?.remove();
      style = null;
      view?.removeEventListener("beforeprint", handler);
    },
  };
}
