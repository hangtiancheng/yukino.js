import { describe, expect, it } from "vitest";
import { getNativeEventName } from "../src/utils/event-utils";

describe("event name mapping", () => {
  it("maps React-style names to native DOM event names", () => {
    expect(getNativeEventName("onClick")).toBe("click");
    expect(getNativeEventName("onDoubleClick")).toBe("dblclick");
    expect(getNativeEventName("onKeyDown")).toBe("keydown");
    expect(getNativeEventName("onPointerDown")).toBe("pointerdown");
  });

  it("covers the full modern DOM event surface", () => {
    const expected: Record<string, string> = {
      onWheel: "wheel",
      onTouchEnd: "touchend",
      onTouchStart: "touchstart",
      onTouchMove: "touchmove",
      onTouchCancel: "touchcancel",
      onInvalid: "invalid",
      onToggle: "toggle",
      onBeforeInput: "beforeinput",
      onAnimationStart: "animationstart",
      onAnimationIteration: "animationiteration",
      onAnimationEnd: "animationend",
      onAnimationCancel: "animationcancel",
      onTransitionStart: "transitionstart",
      onTransitionEnd: "transitionend",
      onTransitionCancel: "transitioncancel",
      onCompositionStart: "compositionstart",
      onCompositionUpdate: "compositionupdate",
      onCompositionEnd: "compositionend",
    };
    for (const [jsxName, native] of Object.entries(expected)) {
      expect(getNativeEventName(jsxName), jsxName).toBe(native);
    }
  });

  it("derives names for events that are not in any explicit map", () => {
    // Newer DOM events work without extending the file.
    expect(getNativeEventName("onScrollEnd")).toBe("scrollend");
    expect(getNativeEventName("onPointerRawUpdate")).toBe("pointerrawupdate");
  });

  it("returns undefined for non-event props", () => {
    // The `on` + capital-letter guard keeps lookalike props from binding
    // bogus listeners (e.g. `once` must not bind an event named "ce").
    expect(getNativeEventName("only")).toBeUndefined();
    expect(getNativeEventName("once")).toBeUndefined();
    expect(getNativeEventName("on")).toBeUndefined();
    expect(getNativeEventName("className")).toBeUndefined();
  });
});
