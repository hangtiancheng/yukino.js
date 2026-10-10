export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

const ELEMENT_NODE = 1;

function toElement(target: EventTarget | null): Element | null {
  if (!target || typeof (target as Node).nodeType !== "number") return null;
  const node = target as Node;
  if (node.nodeType === ELEMENT_NODE) return node as Element;
  if (node.parentElement) return node.parentElement;
  const parent = node.parentNode;
  const host = parent && (parent as ShadowRoot).host;
  return host ?? null;
}

function shadowHost(el: Element): Element | null {
  const root = el.getRootNode?.();
  const host = root && (root as ShadowRoot).host;
  return host && host !== el ? host : null;
}

export function eventElement(event: Event): Element | null {
  const path = event.composedPath?.();
  return toElement(path && path.length > 0 ? path[0] : event.target);
}

export function isExcluded(
  target: EventTarget | null,
  selectors: string[],
): boolean {
  let el = toElement(target);
  while (el) {
    for (const selector of selectors) {
      try {
        if (el.closest(selector) !== null) return true;
      } catch {}
    }
    el = shadowHost(el);
  }
  return false;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);
const EDITABLE_VALUES = new Set(["", "true", "plaintext-only"]);

export function isEditable(target: EventTarget | null): boolean {
  let el = toElement(target);
  while (el) {
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const type = (el as HTMLInputElement).type?.toLowerCase() ?? "text";
      if (!NON_TEXT_INPUT_TYPES.has(type)) return true;
    }
    const attr = el.getAttribute("contenteditable");
    if (attr !== null && EDITABLE_VALUES.has(attr.toLowerCase())) return true;
    el = el.parentElement ?? shadowHost(el);
  }
  return false;
}

export function isSelectionExcluded(
  doc: Document,
  selectors: string[],
): boolean | null {
  if (selectors.length === 0) return null;
  const selection = doc.defaultView?.getSelection?.() ?? null;
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    if (!isExcluded(range.commonAncestorContainer, selectors)) return false;
  }
  return true;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
