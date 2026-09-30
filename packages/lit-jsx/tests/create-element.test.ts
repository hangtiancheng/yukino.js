import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { jsx } from "../src/jsx-runtime";
import { createRef } from "../src/directives";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  return () => {
    container.remove();
  };
});

describe("createElement prop semantics", () => {
  it("renders basic tags with text children", () => {
    render(jsx("div", { children: "hello" }) as never, container);
    expect(container.querySelector("div")?.textContent).toBe("hello");
  });

  it("renders nested elements", () => {
    render(
      jsx("div", { children: jsx("span", { children: "in" }) }) as never,
      container,
    );
    expect(container.querySelector("div span")?.textContent).toBe("in");
  });

  it("flattens array children and skips null/false", () => {
    render(
      jsx("div", { children: ["a", null, false, "b"] }) as never,
      container,
    );
    expect(container.querySelector("div")?.textContent).toBe("ab");
  });

  it("maps class and className to the className property", () => {
    render(jsx("div", { class: "a" }) as never, container);
    expect((container.firstElementChild as HTMLElement).className).toBe("a");
    render(jsx("div", { className: "b" }) as never, container);
    expect((container.firstElementChild as HTMLElement).className).toBe("b");
  });

  it("binds onXxx props as event listeners on primitives", () => {
    const onClick = vi.fn();
    render(jsx("div", { onClick }) as never, container);
    (container.firstElementChild as HTMLElement).dispatchEvent(
      new Event("click"),
    );
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("maps wheel/touchend/invalid/composition/toggle/animationstart/transitionstart/beforeinput events", () => {
    const handler = vi.fn();
    render(
      jsx("div", {
        onWheel: handler,
        onTouchEnd: handler,
        onInvalid: handler,
        onCompositionStart: handler,
        onCompositionUpdate: handler,
        onCompositionEnd: handler,
        onToggle: handler,
        onAnimationStart: handler,
        onTransitionStart: handler,
        onBeforeInput: handler,
      }) as never,
      container,
    );
    const el = container.firstElementChild as HTMLElement;
    for (const type of [
      "wheel",
      "touchend",
      "invalid",
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "toggle",
      "animationstart",
      "transitionstart",
      "beforeinput",
    ]) {
      handler.mockClear();
      el.dispatchEvent(new Event(type));
      expect(handler, `expected a ${type} listener`).toHaveBeenCalledOnce();
    }
  });

  it("renders hyphenated props as attributes", () => {
    render(
      jsx("div", { "data-x": "1", "aria-label": "hi" }) as never,
      container,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("data-x")).toBe("1");
    expect(el.getAttribute("aria-label")).toBe("hi");
  });

  it("applies boolean props as boolean attributes and properties", () => {
    render(jsx("input", { disabled: true }) as never, container);
    const on = container.querySelector("input")!;
    expect(on.disabled).toBe(true);
    expect(on.hasAttribute("disabled")).toBe(true);
    render(jsx("input", { disabled: false }) as never, container);
    const off = container.querySelector("input")!;
    expect(off.disabled).toBe(false);
    expect(off.hasAttribute("disabled")).toBe(false);
  });

  it("assigns scalar props as properties (value, src, ...)", () => {
    render(jsx("input", { value: "abc" }) as never, container);
    expect((container.querySelector("input") as HTMLInputElement).value).toBe(
      "abc",
    );
  });

  it("omits nullish primitive props and event handlers", () => {
    const defaultMaxLength = document.createElement("input").maxLength;

    render(
      jsx("input", { maxLength: undefined, onInput: undefined }) as never,
      container,
    );
    const input = container.querySelector("input")!;
    expect(input.maxLength).toBe(defaultMaxLength);
    expect(input.hasAttribute("maxlength")).toBe(false);
    expect(() => input.dispatchEvent(new Event("input"))).not.toThrow();

    render(
      jsx("input", { maxLength: null, onInput: null }) as never,
      container,
    );
    expect(container.querySelector("input")).toBe(input);
    expect(input.maxLength).toBe(defaultMaxLength);
    expect(input.hasAttribute("maxlength")).toBe(false);
    expect(() => input.dispatchEvent(new Event("input"))).not.toThrow();
  });

  it("applies style objects via styleMap", () => {
    render(
      jsx("div", {
        style: { backgroundColor: "red", paddingTop: "4px" },
      }) as never,
      container,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.backgroundColor).toBe("red");
    expect(el.style.paddingTop).toBe("4px");
  });

  it("supports object refs and callback refs", () => {
    const ref = createRef<HTMLElement>();
    render(jsx("div", { ref }) as never, container);
    expect(ref.value).toBe(container.firstElementChild);

    let captured: unknown;
    render(
      jsx("span", { ref: (node: unknown) => (captured = node) }) as never,
      container,
    );
    expect(captured).toBe(container.querySelector("span"));
  });

  it("does not leak the key prop onto the DOM element", () => {
    render(jsx("div", { key: "k1", id: "x" }) as never, container);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("key")).toBeNull();
    expect((el as { key?: unknown }).key).toBeUndefined();
  });

  it("falls back to a div for unknown, unregistered tags", () => {
    render(jsx("not-registered-tag", {}) as never, container);
    expect(container.querySelector("not-registered-tag")).toBeNull();
    expect(container.querySelector("div")).toBeTruthy();
  });
});

describe("createElement content-restricted tags", () => {
  it("renders textarea without a child expression (no lit warning)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(jsx("textarea", { value: "abc" }) as never, container);
      expect(
        (container.querySelector("textarea") as HTMLTextAreaElement).value,
      ).toBe("abc");
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("textarea"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("drops textarea children instead of warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        jsx("textarea", { children: "unsupported", value: "v" }) as never,
        container,
      );
      expect(
        (container.querySelector("textarea") as HTMLTextAreaElement).value,
      ).toBe("v");
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("textarea"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("renders template without a child expression (no throw)", () => {
    expect(() => render(jsx("template", {}) as never, container)).not.toThrow();
    expect(container.querySelector("template")).toBeTruthy();
  });
});
