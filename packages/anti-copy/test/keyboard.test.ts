import { afterEach, describe, expect, it, vi } from "vitest";
import { createAntiCopy, type AntiCopyInstance } from "@/index";

let instance: AntiCopyInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

function fireKey(
  init: KeyboardEventInit,
  target: EventTarget = document.body,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("keyboard", () => {
  it("blocks Ctrl+C and Cmd+C in block mode", () => {
    instance = createAntiCopy({ selectStyle: false });
    instance.enable();
    expect(fireKey({ key: "c", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(fireKey({ key: "c", metaKey: true }).defaultPrevented).toBe(true);
    expect(fireKey({ key: "a", ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it("uses the physical key so non-Latin layouts cannot bypass", () => {
    instance = createAntiCopy({ selectStyle: false });
    instance.enable();
    expect(
      fireKey({ key: "с", code: "KeyC", ctrlKey: true }).defaultPrevented,
    ).toBe(true);
    expect(
      fireKey({ key: "Dead", code: "KeyI", metaKey: true, altKey: true })
        .defaultPrevented,
    ).toBe(true);
  });

  it("matches e.key too, so remapped Latin layouts cannot bypass either", () => {
    instance = createAntiCopy({ selectStyle: false });
    instance.enable();
    expect(
      fireKey({ key: "a", code: "KeyQ", ctrlKey: true }).defaultPrevented,
    ).toBe(true);
    expect(
      fireKey({ key: "i", code: "KeyG", ctrlKey: true, shiftKey: true })
        .defaultPrevented,
    ).toBe(true);
  });

  it("lets Ctrl+C and Ctrl+Insert through in replace mode so the copy event fires", () => {
    instance = createAntiCopy({ mode: "replace" });
    instance.enable();
    expect(fireKey({ key: "c", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(fireKey({ key: "Insert", ctrlKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(fireKey({ key: "x", ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it("blocks Ctrl+Insert in block mode", () => {
    instance = createAntiCopy({ selectStyle: false });
    instance.enable();
    expect(fireKey({ key: "Insert", ctrlKey: true }).defaultPrevented).toBe(
      true,
    );
  });

  it.each(["block", "replace"] as const)(
    "blocks Shift+Delete independently of clipboard interception in %s mode",
    (mode) => {
      const onViolation = vi.fn();
      instance = createAntiCopy({
        mode,
        copy: false,
        selectStyle: false,
        onViolation,
      });
      instance.enable();
      expect(fireKey({ key: "Delete", shiftKey: true }).defaultPrevented).toBe(
        true,
      );
      expect(fireKey({ code: "Delete", shiftKey: true }).defaultPrevented).toBe(
        true,
      );
      expect(fireKey({ key: "Delete" }).defaultPrevented).toBe(false);
      expect(onViolation).toHaveBeenCalledWith(
        expect.objectContaining({ key: "Shift+Delete" }),
      );
      document.body.innerHTML = "<input>";
      expect(
        fireKey(
          { key: "Delete", shiftKey: true },
          document.querySelector("input")!,
        ).defaultPrevented,
      ).toBe(false);
    },
  );

  it("matches the physical Insert key for copy shortcuts", () => {
    instance = createAntiCopy({ selectStyle: false });
    instance.enable();
    expect(fireKey({ code: "Insert", ctrlKey: true }).defaultPrevented).toBe(
      true,
    );
    instance.update({ mode: "replace" });
    expect(fireKey({ code: "Insert", ctrlKey: true }).defaultPrevented).toBe(
      false,
    );
  });

  it("blocks DevTools shortcuts and reports the combo", () => {
    const onViolation = vi.fn();
    instance = createAntiCopy({ selectStyle: false, onViolation });
    instance.enable();
    expect(fireKey({ key: "F12" }).defaultPrevented).toBe(true);
    expect(
      fireKey({ key: "I", ctrlKey: true, shiftKey: true }).defaultPrevented,
    ).toBe(true);
    expect(fireKey({ key: "u", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({ type: "keyboard", key: "Ctrl+Shift+I" }),
    );
  });

  it("blocks the macOS view-source shortcut Cmd+Opt+U", () => {
    const onViolation = vi.fn();
    instance = createAntiCopy({ selectStyle: false, onViolation });
    instance.enable();
    expect(
      fireKey({ key: "u", metaKey: true, altKey: true }).defaultPrevented,
    ).toBe(true);
    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({ type: "keyboard", key: "Cmd+Opt+U" }),
    );
  });

  it("blocks Ctrl+S and Ctrl+P even inside editable controls", () => {
    document.body.innerHTML = "<input id='i' />";
    instance = createAntiCopy({ selectStyle: false });
    instance.enable();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const input = document.getElementById("i")!;
    expect(fireKey({ key: "s", ctrlKey: true }, input).defaultPrevented).toBe(
      true,
    );
    expect(fireKey({ key: "p", ctrlKey: true }, input).defaultPrevented).toBe(
      true,
    );
  });

  it("lets AltGr (Ctrl+Alt) combos through so European layouts can type", () => {
    document.body.innerHTML = "<input id='i' />";
    const onViolation = vi.fn();
    instance = createAntiCopy({ selectStyle: false, onViolation });
    instance.enable();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const input = document.getElementById("i")!;
    expect(
      fireKey({ key: "ś", code: "KeyS", ctrlKey: true, altKey: true }, input)
        .defaultPrevented,
    ).toBe(false);
    expect(
      fireKey({ key: "ć", code: "KeyC", ctrlKey: true, altKey: true })
        .defaultPrevented,
    ).toBe(false);
    expect(onViolation).not.toHaveBeenCalled();
  });

  it("does not block Ctrl+P/Ctrl+S when print protection is off", () => {
    instance = createAntiCopy({ selectStyle: false, print: false });
    instance.enable();
    expect(fireKey({ key: "p", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(fireKey({ key: "s", ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("allows Ctrl+A inside editable controls", () => {
    document.body.innerHTML = "<input id='i' />";
    instance = createAntiCopy({ selectStyle: false });
    instance.enable();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const input = document.getElementById("i")!;
    expect(fireKey({ key: "a", ctrlKey: true }, input).defaultPrevented).toBe(
      false,
    );
  });

  it("uses the whole selection for copy exclusions before the clipboard event", () => {
    document.body.innerHTML = '<p class="allowed">allowed</p><p>protected</p>';
    instance = createAntiCopy({
      selectStyle: false,
      excludeSelectors: [".allowed"],
    });
    instance.enable();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".allowed")!);
    window.getSelection()?.addRange(range);
    expect(fireKey({ key: "c", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(fireKey({ key: "Insert", ctrlKey: true }).defaultPrevented).toBe(
      false,
    );
    range.selectNodeContents(document.body);
    expect(
      fireKey({ key: "c", ctrlKey: true }, document.querySelector(".allowed")!)
        .defaultPrevented,
    ).toBe(true);
    // Select-all remains scoped to the focused element, not the previous selection.
    expect(fireKey({ key: "a", ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it("ignores plain keys without modifiers", () => {
    instance = createAntiCopy({ selectStyle: false });
    instance.enable();
    expect(fireKey({ key: "c" }).defaultPrevented).toBe(false);
  });
});
