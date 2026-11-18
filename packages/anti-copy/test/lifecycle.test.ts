import { afterEach, describe, expect, it, vi } from "vitest";
import { createAntiCopy } from "@/index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function dispatchCopy(): Event {
  const event = new Event("copy", { bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
}

describe("lifecycle", () => {
  it("enable is idempotent (single style tag, listener registered once)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const instance = createAntiCopy();
    instance.enable();
    const callsAfterFirst = addSpy.mock.calls.length;
    instance.enable();
    expect(addSpy.mock.calls.length).toBe(callsAfterFirst);
    expect(
      document.head.querySelectorAll("style[yukino-anti-copy]").length,
    ).toBe(1);
    instance.destroy();
    addSpy.mockRestore();
  });

  it("tracks the lifecycle even when every feature is disabled", () => {
    const instance = createAntiCopy({
      copy: false,
      keyboard: false,
      contextmenu: false,
      selectStyle: false,
      print: false,
    });
    instance.enable();
    expect(instance.isEnabled()).toBe(true);
    instance.disable();
    expect(instance.isEnabled()).toBe(false);
    instance.enable();
    instance.destroy();
    expect(instance.isEnabled()).toBe(false);
  });

  it("disable removes protection and injected styles", () => {
    const instance = createAntiCopy();
    instance.enable();
    instance.disable();
    expect(document.head.querySelector("style[yukino-anti-copy]")).toBeNull();
    expect(document.head.querySelector("style[yukino-anti-print]")).toBeNull();
    const event = dispatchCopy();
    expect(event.defaultPrevented).toBe(false);
    expect(instance.isEnabled()).toBe(false);
  });

  it("destroy retires the instance; enable becomes a no-op", () => {
    const instance = createAntiCopy();
    instance.enable();
    instance.destroy();
    instance.enable();
    expect(instance.isEnabled()).toBe(false);
    expect(dispatchCopy().defaultPrevented).toBe(false);
  });

  it("update after destroy is a no-op", () => {
    const onViolation = vi.fn();
    const instance = createAntiCopy({ selectStyle: false });
    instance.enable();
    instance.destroy();
    instance.update({ onViolation });
    expect(instance.isEnabled()).toBe(false);
    dispatchCopy();
    expect(onViolation).not.toHaveBeenCalled();
  });

  it("update re-applies protection with merged options", () => {
    const onViolation = vi.fn();
    const instance = createAntiCopy({ selectStyle: false });
    instance.enable();
    instance.update({ onViolation });
    expect(instance.isEnabled()).toBe(true);
    dispatchCopy();
    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({ type: "copy" }),
    );
    instance.destroy();
  });

  it("update keeps the disabled state", () => {
    const instance = createAntiCopy({ selectStyle: false });
    instance.update({ mode: "replace" });
    expect(instance.isEnabled()).toBe(false);
    expect(dispatchCopy().defaultPrevented).toBe(false);
    instance.destroy();
  });

  it("rolls back partially-attached features when enable fails", () => {
    const fakeDoc = {
      defaultView: null,
      head: document.head,
      createElement: (tag: string) => document.createElement(tag),
      querySelector: (selector: string) => document.querySelector(selector),
      addEventListener: () => {
        throw new Error("attach failed");
      },
      removeEventListener: () => {},
    } as unknown as Document;

    const instance = createAntiCopy({
      target: fakeDoc,
      copy: false,
      keyboard: false,
      contextmenu: false,
      print: false,
    });
    expect(() => instance.enable()).toThrow("attach failed");
    expect(instance.isEnabled()).toBe(false);
    expect(document.head.querySelector("style[yukino-anti-copy]")).toBeNull();
    instance.destroy();
  });

  it.each([undefined, null])(
    "rethrows the first detach error even when it is %s",
    (failure) => {
      const instance = createAntiCopy({
        selectStyle: false,
        copy: false,
        print: false,
      });
      instance.enable();
      const remove = window.removeEventListener.bind(window);
      let calls = 0;
      const spy = vi
        .spyOn(window, "removeEventListener")
        .mockImplementation((...args) => {
          remove(...args);
          calls += 1;
          if (calls === 1) throw failure;
          if (calls === 2) throw new Error("later error");
        });
      let caught = false;
      try {
        instance.disable();
      } catch (error) {
        caught = true;
        expect(error).toBe(failure);
      }
      expect(caught).toBe(true);
      expect(calls).toBe(2);
      expect(instance.isEnabled()).toBe(false);
      spy.mockRestore();
      instance.destroy();
    },
  );

  it("allows cleanup to be retried after a detach failure", () => {
    const instance = createAntiCopy({
      selectStyle: false,
      keyboard: false,
      contextmenu: false,
      print: false,
    });
    instance.enable();
    const spy = vi
      .spyOn(window, "removeEventListener")
      .mockImplementationOnce(() => {
        throw new Error("cleanup failed");
      });
    expect(() => instance.disable()).toThrow("cleanup failed");
    expect(instance.isEnabled()).toBe(false);
    expect(dispatchCopy().defaultPrevented).toBe(true);
    spy.mockRestore();
    instance.destroy();
    expect(dispatchCopy().defaultPrevented).toBe(false);
  });

  it("keeps failed enable rollback resources available for cleanup", () => {
    const instance = createAntiCopy({
      selectStyle: false,
      keyboard: false,
      contextmenu: false,
      print: false,
    });
    const add = window.addEventListener.bind(window);
    const addSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((...args) => {
        if (args[0] === "cut") throw new Error("attach failed");
        add(...args);
      });
    const removeSpy = vi
      .spyOn(window, "removeEventListener")
      .mockImplementationOnce(() => {
        throw new Error("cleanup failed");
      });
    expect(() => instance.enable()).toThrow("attach failed");
    expect(instance.isEnabled()).toBe(false);
    addSpy.mockRestore();
    removeSpy.mockRestore();
    expect(dispatchCopy().defaultPrevented).toBe(true);
    instance.destroy();
    expect(dispatchCopy().defaultPrevented).toBe(false);
  });

  it("restores existing protection when an update cannot attach to its target", () => {
    const instance = createAntiCopy({ selectStyle: false, print: false });
    instance.enable();
    const target = {
      defaultView: null,
      addEventListener() {
        throw new Error("new target failed");
      },
      removeEventListener() {},
    } as unknown as Document;
    try {
      expect(() => instance.update({ target })).toThrow("new target failed");
      expect(instance.isEnabled()).toBe(true);
      expect(dispatchCopy().defaultPrevented).toBe(true);
      instance.update({ contextmenu: false });
      expect(dispatchCopy().defaultPrevented).toBe(true);
    } finally {
      instance.destroy();
    }
  });

  it("snapshots mutable option values on creation and update", () => {
    const selectors = [".allowed"];
    const instance = createAntiCopy({
      selectStyle: false,
      excludeSelectors: selectors,
    });
    document.body.classList.add("allowed");
    try {
      selectors.length = 0;
      instance.enable();
      expect(dispatchCopy().defaultPrevented).toBe(false);
      const next = [".other"];
      instance.update({ excludeSelectors: next });
      next.push(".allowed");
      expect(dispatchCopy().defaultPrevented).toBe(true);
      instance.update({ print: false });
      expect(dispatchCopy().defaultPrevented).toBe(true);
    } finally {
      instance.destroy();
      document.body.classList.remove("allowed");
    }
  });

  it("returns an inert no-op instance outside the browser", () => {
    vi.stubGlobal("document", undefined);
    const instance = createAntiCopy();
    expect(() => {
      instance.enable();
      instance.update({ mode: "replace" });
      instance.disable();
      instance.destroy();
    }).not.toThrow();
    expect(instance.isEnabled()).toBe(false);
  });
});
