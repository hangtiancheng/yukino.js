import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { literal } from "lit/static-html.js";
import { jsx } from "../src/jsx-runtime";
import { assignElements, resetElements } from "../src/core/create-element";

let container: HTMLElement;

beforeEach(() => {
  resetElements();
  container = document.createElement("div");
  document.body.appendChild(container);
  return () => {
    container.remove();
  };
});

describe("element registry overrides", () => {
  it("accepts plain-string tag overrides", () => {
    assignElements({ button: "my-button" });
    render(jsx("button", { children: "go" }) as never, container);
    expect(container.querySelector("my-button")).toBeTruthy();
    expect(container.textContent).toContain("go");
  });

  it("accepts StaticValue (literal) tag overrides", () => {
    assignElements({ button: literal`my-lit-button` });
    render(jsx("button", { children: "go" }) as never, container);
    expect(container.querySelector("my-lit-button")).toBeTruthy();
  });

  it("can override the default fallback tag", () => {
    assignElements({ default: "section" });
    render(jsx("completely-unknown-tag", {}) as never, container);
    expect(container.querySelector("section")).toBeTruthy();
  });

  it("preserves children when a restricted tag maps to a regular tag", () => {
    assignElements({ textarea: "div" });
    render(jsx("textarea", { children: "kept" }) as never, container);
    expect(container.querySelector("div")?.textContent).toBe("kept");
  });

  it("omits child expressions when an override maps to textarea", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      assignElements({ div: "textarea" });
      render(
        jsx("div", { children: "unsupported", value: "v" }) as never,
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

  it("renders entries from the generated HTML tag registry", () => {
    for (const tag of ["article", "input", "details", "video"]) {
      render(jsx(tag, {}) as never, container);
      expect(container.firstElementChild?.localName).toBe(tag);
    }
  });

  it("resetElements restores the default mapping", () => {
    assignElements({ button: "my-button" });
    resetElements();
    render(jsx("button", {}) as never, container);
    expect(container.querySelector("button")).toBeTruthy();
    expect(container.querySelector("my-button")).toBeNull();
  });
});
