import { beforeEach, describe, expect, it, vi } from "vitest";
import { html, render } from "lit";
import { jsx } from "../src/jsx-runtime";
import { spread } from "../src/directives/spread";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  return () => {
    container.remove();
  };
});

describe("spread directive cleanup", () => {
  it("removes listeners, attributes and properties dropped between renders", () => {
    const first = vi.fn();
    render(
      jsx("div", { id: "same", onClick: first, "data-x": "1" }) as never,
      container,
    );
    const el = container.firstElementChild as HTMLElement;
    el.dispatchEvent(new Event("click"));
    expect(first).toHaveBeenCalledTimes(1);

    render(jsx("div", { id: "same" }) as never, container);
    expect(container.firstElementChild).toBe(el);

    el.dispatchEvent(new Event("click"));
    expect(
      first,
      "stale listener should have been removed",
    ).toHaveBeenCalledTimes(1);
    expect(el.hasAttribute("data-x")).toBe(false);
  });

  it("swaps event handlers when they change between renders", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(jsx("div", { id: "same", onClick: first }) as never, container);
    render(jsx("div", { id: "same", onClick: second }) as never, container);
    (container.firstElementChild as HTMLElement).dispatchEvent(
      new Event("click"),
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("treats nullish values as omitted without mutating spread data", () => {
    const view = (data: Record<string, unknown>) =>
      html`<input ${spread(data)} />`;
    const defaultMaxLength = document.createElement("input").maxLength;
    const initial = {
      ".maxLength": undefined,
      "@input": undefined,
      "data-x": undefined,
    };

    render(view(initial), container);
    const input = container.querySelector("input")!;
    expect(input.maxLength).toBe(defaultMaxLength);
    expect(input.hasAttribute("maxlength")).toBe(false);
    expect(input.hasAttribute("data-x")).toBe(false);

    const handler = vi.fn();
    const active = {
      ".maxLength": 5,
      "@input": handler,
      "data-x": "1",
    };
    render(view(active), container);
    input.dispatchEvent(new Event("input"));
    expect(handler).toHaveBeenCalledOnce();
    expect(input.maxLength).toBe(5);
    expect(input.getAttribute("data-x")).toBe("1");

    render(
      view({ ".maxLength": null, "@input": null, "data-x": null }),
      container,
    );
    input.dispatchEvent(new Event("input"));
    expect(handler).toHaveBeenCalledOnce();
    // Nullish counts as omitted: the dropped property is reset like any
    // removed prop (undefined through the IDL long setter coerces to 0).
    expect(input.maxLength).toBe(0);
    expect(input.hasAttribute("data-x")).toBe(false);
    expect(active).toEqual({
      ".maxLength": 5,
      "@input": handler,
      "data-x": "1",
    });
  });
});

// Regression: lit-jsx renders every tag through one shared html template, so
// when {loading && spinner} flips to {!loading && content}, lit-html treats it
// as a same-template update and REUSES the spinner's DOM node for the content
// div. Dropped property-class props must be reset on the reused node instead
// of leaking across logically different elements.
describe("spread directive property cleanup on reused elements", () => {
  function app(loading: boolean) {
    // Exactly what <div>{loading && spinner}{!loading && content}</div>
    // compiles to: parseChildren filters the `false` slots, so both renders
    // commit a 1-item children array into the same child part.
    return jsx("div", {
      children: [
        loading && jsx("div", { class: "spinner", children: "Loading" }),
        !loading && jsx("div", { children: "Content" }),
      ],
    });
  }

  it("clears class when the prop disappears on the reused node", () => {
    render(app(true) as never, container);
    const spinnerEl = container.firstElementChild!.firstElementChild!;
    expect(spinnerEl.className).toBe("spinner");
    expect(spinnerEl.textContent).toBe("Loading");

    render(app(false) as never, container);
    const contentEl = container.firstElementChild!.firstElementChild!;
    expect(contentEl, "lit-html reuses the same-tag node").toBe(spinnerEl);
    expect(contentEl.textContent).toBe("Content");
    expect(contentEl.className).toBe("");
    expect(contentEl.hasAttribute("class")).toBe(false);
  });

  it("removes expando custom props entirely when they disappear", () => {
    render(
      jsx("div", { children: [jsx("div", { foo: "bar" })] }) as never,
      container,
    );
    const el1 = container.firstElementChild!
      .firstElementChild as HTMLElement & { foo?: unknown };
    expect(el1.foo).toBe("bar");

    render(jsx("div", { children: [jsx("div", {})] }) as never, container);
    const el2 = container.firstElementChild!
      .firstElementChild as HTMLElement & { foo?: unknown };
    expect(el2).toBe(el1);
    expect(el2.foo).toBeUndefined();
    expect("foo" in el2).toBe(false);
  });

  it("clears string IDL props to '' instead of the string 'undefined'", () => {
    render(
      jsx("div", { children: [jsx("input", { value: "secret" })] }) as never,
      container,
    );
    render(jsx("div", { children: [jsx("input", {})] }) as never, container);
    const input = container.firstElementChild!
      .firstElementChild as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("resets non-string IDL props to undefined", () => {
    render(
      jsx("div", { children: [jsx("input", { maxLength: 5 })] }) as never,
      container,
    );
    render(jsx("div", { children: [jsx("input", {})] }) as never, container);
    const input = container.firstElementChild!
      .firstElementChild as HTMLInputElement;
    // undefined through the IDL long setter coerces to 0 — the same value
    // lit-html's own `.prop=${nothing}` binding produces.
    expect(input.maxLength).toBe(0);
  });

  it("clears object props when the key disappears from raw spread data", () => {
    const view = (data: Record<string, unknown>) =>
      html`<div ${spread(data)}></div>`;
    render(view({ ".config": { a: 1 } }), container);
    const el = container.firstElementChild as HTMLElement & {
      config?: unknown;
    };
    expect(el.config).toEqual({ a: 1 });

    render(view({}), container);
    expect(el.config).toBeUndefined();
  });

  it("boolean props stay cleared via attribute removal plus property reset", () => {
    render(
      jsx("div", { children: [jsx("input", { disabled: true })] }) as never,
      container,
    );
    const el1 = container.firstElementChild!
      .firstElementChild as HTMLInputElement;
    expect(el1.disabled).toBe(true);

    render(jsx("div", { children: [jsx("input", {})] }) as never, container);
    const el2 = container.firstElementChild!
      .firstElementChild as HTMLInputElement;
    expect(el2).toBe(el1);
    expect(el2.hasAttribute("disabled")).toBe(false);
    expect(el2.disabled).toBe(false);
  });
});
