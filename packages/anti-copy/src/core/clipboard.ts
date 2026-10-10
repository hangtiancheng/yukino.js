import type { Feature, ResolvedOptions } from "./types";
import {
  escapeHtml,
  eventElement,
  isEditable,
  isExcluded,
  isSelectionExcluded,
} from "./utils";

export function createClipboardFeature(options: ResolvedOptions): Feature {
  const doc = options.target;
  const listenTarget: EventTarget = doc.defaultView ?? doc;

  const clipboardHandler = (e: Event) => {
    const event = e as ClipboardEvent;
    const el = eventElement(event);
    if (isEditable(el)) return;
    const exempt =
      isSelectionExcluded(doc, options.excludeSelectors) ??
      isExcluded(el, options.excludeSelectors);
    if (exempt) return;

    if (options.mode === "replace" && event.clipboardData) {
      const selection = doc.defaultView?.getSelection()?.toString() ?? "";
      const text =
        typeof options.replaceText === "function"
          ? options.replaceText(selection)
          : options.replaceText;
      event.clipboardData.setData("text/plain", text);
      event.clipboardData.setData("text/html", escapeHtml(text));
    }
    event.preventDefault();
    options.onViolation?.({
      type: event.type === "cut" ? "cut" : "copy",
      originalEvent: event,
    });
  };

  const dragHandler = (e: Event) => {
    const el = eventElement(e);
    if (isEditable(el)) return;
    if (isExcluded(el, options.excludeSelectors)) return;
    e.preventDefault();
    options.onViolation?.({ type: "drag", originalEvent: e });
  };

  return {
    attach() {
      listenTarget.addEventListener("copy", clipboardHandler, true);
      listenTarget.addEventListener("cut", clipboardHandler, true);
      listenTarget.addEventListener("dragstart", dragHandler, true);
    },
    detach() {
      listenTarget.removeEventListener("copy", clipboardHandler, true);
      listenTarget.removeEventListener("cut", clipboardHandler, true);
      listenTarget.removeEventListener("dragstart", dragHandler, true);
    },
  };
}
