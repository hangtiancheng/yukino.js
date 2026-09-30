import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsx } from "../src/jsx-runtime";
import { createRoot } from "../src/core/create-root";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  return () => {
    container.remove();
  };
});

describe("createRoot", () => {
  it("renders and efficiently updates the container", () => {
    const root = createRoot(container);
    root.render(jsx("div", { children: "v1" }) as never);
    expect(container.textContent).toContain("v1");
    root.render(jsx("div", { children: "v2" }) as never);
    expect(container.textContent).toContain("v2");
    expect(container.textContent).not.toContain("v1");
  });

  it("returns the rendered element", () => {
    const root = createRoot(container);
    const res = jsx("div", { children: "x" });
    expect(root.render(res as never)).toBe(res);
  });

  it("warns and reuses the existing root for duplicate createRoot calls", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = createRoot(container);
    const second = createRoot(container);
    expect(second).toBe(first);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("unmount clears the container and renders afterwards throw", () => {
    const root = createRoot(container);
    root.render(jsx("div", { children: "x" }) as never);
    root.unmount();
    expect(container.firstElementChild).toBeNull();
    expect(() => root.render(jsx("div", {}) as never)).toThrow(/unmounted/i);
  });
});
