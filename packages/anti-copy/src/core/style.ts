import type { Feature, ResolvedOptions } from "./types";
import { eventElement, isEditable, isExcluded } from "./utils";

const STYLE_ATTR = "yukino-anti-copy";

const EDITABLE_SELECTORS = [
  "input",
  "textarea",
  "[contenteditable='']",
  "[contenteditable='true' i]",
  "[contenteditable='plaintext-only' i]",
];

function validSelectors(doc: Document, selectors: string[]): string[] {
  return selectors.filter((selector) => {
    try {
      doc.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  });
}

function buildCss(doc: Document, excludeSelectors: string[]): string {
  const allowed = validSelectors(doc, [
    ...EDITABLE_SELECTORS,
    ...excludeSelectors,
  ]);
  const allowRules = allowed.map((s) => `:is(${s}), :is(${s}) *`).join(",\n");
  return [
    "body { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none; }",
    `${allowRules} { -webkit-user-select: text !important; user-select: text !important; }`,
  ].join("\n");
}

export function createStyleFeature(options: ResolvedOptions): Feature {
  const doc = options.target;
  const listenTarget: EventTarget = doc.defaultView ?? doc;
  let style: HTMLStyleElement | null = null;

  const selectstartHandler = (e: Event) => {
    const el = eventElement(e);
    if (isEditable(el)) return;
    if (isExcluded(el, options.excludeSelectors)) return;
    e.preventDefault();
    options.onViolation?.({ type: "selection", originalEvent: e });
  };

  return {
    attach() {
      if (!style) {
        style = doc.createElement("style");
        style.setAttribute(STYLE_ATTR, "");
        style.textContent = buildCss(doc, options.excludeSelectors);
        doc.head.appendChild(style);
      }
      if (options.mode !== "replace") {
        listenTarget.addEventListener("selectstart", selectstartHandler, true);
      }
    },
    detach() {
      style?.remove();
      style = null;
      listenTarget.removeEventListener("selectstart", selectstartHandler, true);
    },
  };
}
