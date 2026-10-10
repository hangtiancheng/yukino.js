import type { Feature, ResolvedOptions } from "./types";
import { eventElement, isEditable, isExcluded } from "./utils";

const COPY_KEYS = new Set(["c", "x", "a"]);
const EXPORT_KEYS = new Set(["s", "p"]);
const DEVTOOLS_KEYS = new Set(["i", "j", "c"]);
const VIEW_SOURCE_KEYS = new Set(["u"]);

function matchKey(e: KeyboardEvent, keys: Set<string>): string | null {
  const key = e.key.toLowerCase();
  if (keys.has(key)) return key;
  if (e.code && e.code.startsWith("Key") && e.code.length === 4) {
    const code = e.code.slice(3).toLowerCase();
    if (keys.has(code)) return code;
  }
  return null;
}

function devtoolsShortcut(e: KeyboardEvent): string | null {
  if (e.key === "F12" || e.code === "F12") return "F12";
  const key = matchKey(e, DEVTOOLS_KEYS);
  if (key && ((e.ctrlKey && e.shiftKey) || (e.metaKey && e.altKey))) {
    return `${e.metaKey ? "Cmd+Opt" : "Ctrl+Shift"}+${key.toUpperCase()}`;
  }
  if (!e.shiftKey && matchKey(e, VIEW_SOURCE_KEYS)) {
    if (e.ctrlKey && !e.altKey) return "Ctrl+U";
    if (e.metaKey && e.altKey) return "Cmd+Opt+U";
  }
  return null;
}

export function createKeyboardFeature(options: ResolvedOptions): Feature {
  const doc = options.target;
  const listenTarget: EventTarget = doc.defaultView ?? doc;

  const handler = (e: Event) => {
    const event = e as KeyboardEvent;

    const shortcut = devtoolsShortcut(event);
    if (shortcut) {
      event.preventDefault();
      options.onViolation?.({
        type: "keyboard",
        originalEvent: event,
        key: shortcut,
      });
      return;
    }

    if (event.altKey) return;

    if (!(event.ctrlKey || event.metaKey)) return;
    const copyKey = matchKey(event, COPY_KEYS);
    const isInsertCopy =
      event.ctrlKey && !event.shiftKey && event.key === "Insert";
    const exportKey = options.print ? matchKey(event, EXPORT_KEYS) : null;
    if (!copyKey && !isInsertCopy && !exportKey) return;

    if (!exportKey) {
      const el = eventElement(event);
      if (isEditable(el)) return;
      if (isExcluded(el, options.excludeSelectors)) return;
      if (options.mode === "replace" && (copyKey === "c" || isInsertCopy)) {
        return;
      }
    }

    event.preventDefault();
    const label = isInsertCopy
      ? "Insert"
      : (exportKey ?? copyKey ?? "").toUpperCase();
    options.onViolation?.({
      type: "keyboard",
      originalEvent: event,
      key: `${event.metaKey ? "Cmd" : "Ctrl"}+${label}`,
    });
  };

  return {
    attach() {
      listenTarget.addEventListener("keydown", handler, true);
    },
    detach() {
      listenTarget.removeEventListener("keydown", handler, true);
    },
  };
}
