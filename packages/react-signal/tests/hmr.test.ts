import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hotSwapByComponent } from "../src/hmr";
import { raw, createVNode, type Component } from "../src/jsx/vnode";
import {
  injectComponentHmrSnippet,
  isYukinoComponentSource,
} from "../src/hmr-inject";
import { useSignal } from "../src/hooks";
import { render, unmount } from "../src/jsx/reconcile";

/** Component factory: label distinguishes versions; count state via useSignal. */
function makeCounter(label: string): Component {
  return function Counter() {
    const count = useSignal(0);
    return raw(`<div class="${label}">count=${count.value}</div>`);
  };
}

let host: HTMLElement;

describe("HMR", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    unmount(host);
    host.remove();
  });

  // ============================================================
  // hotSwapByComponent
  // ============================================================
  describe("hotSwapByComponent", () => {
    it("swaps live instances in place, preserving useSignal state", () => {
      let captured: { value: number } | undefined;
      const V1: Component = function Counter() {
        const count = useSignal(0);
        captured = count;
        return raw(`<div class="old">count=${count.value}</div>`);
      };
      render(createVNode(V1, {}), host);
      captured!.value = 42;
      expect(host.querySelector(".old")!.textContent).toBe("count=42");

      const V2 = makeCounter("new");
      const swapped = hotSwapByComponent(V1, V2);
      expect(swapped).toBe(true);

      // Same instance, same signal slot — the new code renders count=42.
      expect(host.querySelector(".old")).toBeNull();
      expect(host.querySelector(".new")!.textContent).toBe("count=42");
    });

    it("keeps the swapped instance reactive", () => {
      let captured: { value: number } | undefined;
      const V1: Component = function Counter() {
        const count = useSignal(0);
        captured = count;
        return raw(`<div class="old">count=${count.value}</div>`);
      };
      render(createVNode(V1, {}), host);

      hotSwapByComponent(V1, makeCounter("new"));
      captured!.value = 7; // the preserved signal still drives renders
      expect(host.querySelector(".new")!.textContent).toBe("count=7");
    });

    it("survives root re-renders with the STALE import (alias matching)", () => {
      const V1 = makeCounter("old");
      render(createVNode(V1, {}), host);
      const V2 = makeCounter("new");
      hotSwapByComponent(V1, V2);
      expect(host.querySelector(".new")).not.toBeNull();
      const domBefore = host.querySelector(".new")!;

      // The caller still holds V1 (stale import) — canonical matching must
      // keep the same instance instead of remounting.
      render(createVNode(V1, {}), host);
      expect(host.querySelector(".new")).toBe(domBefore);
    });

    it("no-ops for identical or non-function arguments", () => {
      const V = makeCounter("same");
      render(createVNode(V, {}), host);
      expect(hotSwapByComponent(V, V)).toBe(false);
      expect(hotSwapByComponent(undefined, V)).toBe(false);
      expect(hotSwapByComponent({ not: "fn" }, V)).toBe(false);
      expect(host.querySelector(".same")).not.toBeNull();
    });

    it("returns false when the old fn has no live instances", () => {
      const A = makeCounter("a");
      const B = makeCounter("b");
      expect(hotSwapByComponent(A, B)).toBe(false);
    });
  });

  // ============================================================
  // hmr-inject — snippet generation
  // ============================================================
  describe("hmr-inject", () => {
    it("detects component module sources via a line-leading export default", () => {
      expect(isYukinoComponentSource("export default function Home() {}")).toBe(
        true,
      );
      expect(isYukinoComponentSource("const x = 1;\nexport default x;")).toBe(
        true,
      );
      expect(
        isYukinoComponentSource('import { x } from "./y";\nconst a = 1;'),
      ).toBe(false);
    });

    it("wraps export default and injects component HMR (vite)", () => {
      const src = `import { useSignal } from "@yukino.js/react-signal";\nexport default function Home() { return null; }`;
      const result = injectComponentHmrSnippet(src, "vite");
      expect(result).toContain("const __yukino_component__ =");
      expect(result).toContain("export default __yukino_component__;");
      expect(result).toContain("import.meta.hot");
      expect(result).toContain("hotSwapByComponent");
    });

    it("guards the snippet with typeof function checks (non-component exports no-op)", () => {
      const src = "export default { just: 'config' };";
      const result = injectComponentHmrSnippet(src, "vite");
      // The transform applies (broad gate), but the runtime guard is present.
      expect(result).toContain('typeof oldComponent === "function"');
      expect(result).toContain('typeof newComponent === "function"');
    });

    it("returns source unchanged when there is no export default", () => {
      const src = "export const v = () => null;";
      expect(injectComponentHmrSnippet(src, "vite")).toBe(src);
    });

    it("uses import.meta.webpackHot for webpack", () => {
      const src = "export default function V() { return null; }";
      const webpack = injectComponentHmrSnippet(src, "webpack");
      expect(webpack).toContain("import.meta.webpackHot");
      expect(webpack).not.toContain("import.meta.hot.accept");
    });

    it("keeps `as`-cast default exports syntactically intact", () => {
      const src = "export default ((() => null)) as unknown;";
      const result = injectComponentHmrSnippet(src, "vite");
      expect(result).toContain(
        "const __yukino_component__ = ((() => null)) as unknown;",
      );
      expect(result).toContain("export default __yukino_component__;");
      expect(result).not.toMatch(/__yukino_component__;\s*as /);
    });

    it("injects despite apostrophes in JSX text", () => {
      const src = [
        `export default function Note() {`,
        `  return <p>It's here — don't worry</p>;`,
        `}`,
      ].join("\n");
      const result = injectComponentHmrSnippet(src, "vite");
      // Named declarations keep their module-scope binding.
      expect(result).toContain("function Note() {");
      expect(result).toContain("const __yukino_component__ = Note;");
      expect(result).toContain("hotSwapByComponent");
    });

    it("is idempotent — re-running the transform is a no-op", () => {
      const src = "export default function V() { return null; }";
      const once = injectComponentHmrSnippet(src, "vite");
      expect(injectComponentHmrSnippet(once, "vite")).toBe(once);
    });

    it("skips export default inside comments", () => {
      const src = ["// export default oldStuff;", "const v = () => null;"].join(
        "\n",
      );
      expect(injectComponentHmrSnippet(src, "vite")).toBe(src);
    });
  });
});
