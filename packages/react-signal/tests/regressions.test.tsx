/**
 * Regression tests for the 2026-08 code-review fixes:
 * - store: read-only getState() proxy, untracked setState updater
 * - hooks: onCleanup slot disposal across HMR swaps, hook-count growth
 *   warning, shrink slot disposal
 * - hmr-inject: named default declarations keep their module-scope binding
 * - bundler integrations: production builds skip HMR injection
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, unmount } from "../src/jsx/reconcile";
import { signal, effect } from "../src/reactive";
import { useSignal, useSignalEffect, onCleanup } from "../src/hooks";
import { createStore } from "../src/store";
import { hotSwapByComponent } from "../src/hmr";
import { injectComponentHmrSnippet } from "../src/hmr-inject";
import { yukinoReactSignalPlugin as vitePlugin } from "../src/vite";
import {
  yukinoReactSignalLoader as webpackLoader,
  YukinoReactSignalPlugin as WebpackPlugin,
} from "../src/webpack";

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  unmount(host);
  host.remove();
});

// ============================================================
// Store — read-only state proxy
// ============================================================

describe("store — getState() is read-only", () => {
  it("throws on direct writes instead of desyncing the mirror", () => {
    const store = createStore<{ count: number }>(() => ({ count: 0 }));
    expect(() => {
      (store.getState() as { count: number }).count = 5;
    }).toThrow(/read-only/);
    expect(() => {
      delete (store.getState() as { count?: number }).count;
    }).toThrow(/read-only/);

    // State stays consistent — a later legitimate write still notifies.
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState({ count: 5 });
    expect(store.getState().count).toBe(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("store — setState(updater) is untracked", () => {
  it("does not subscribe an enclosing effect to the keys the updater reads", () => {
    const store = createStore<{ a: number; b: number }>(() => ({ a: 0, b: 0 }));
    let runs = 0;
    effect(() => {
      runs++;
      if (runs === 1) {
        store.setState((prev) => ({ b: prev.a + 1 }));
      }
    });
    expect(runs).toBe(1);
    expect(store.getState().b).toBe(1);
    store.setState({ a: 10 });
    expect(runs).toBe(1); // updater read of `a` must not have subscribed
  });
});

// ============================================================
// Hooks — onCleanup across HMR swaps
// ============================================================

describe("onCleanup — HMR swap semantics", () => {
  it("runs the old callback once at swap and the new one once at unmount", () => {
    const cleanOld = vi.fn();
    const cleanNew = vi.fn();
    function VOld() {
      onCleanup(cleanOld);
      return <p>old</p>;
    }
    function VNew() {
      onCleanup(cleanNew);
      return <p>new</p>;
    }
    render(<VOld />, host);
    hotSwapByComponent(VOld, VNew);
    expect(cleanOld).toHaveBeenCalledTimes(1); // slot disposed at swap
    expect(cleanNew).not.toHaveBeenCalled();
    unmount(host);
    expect(cleanOld).toHaveBeenCalledTimes(1); // no duplicate at unmount
    expect(cleanNew).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Hooks — rules-of-hooks count checks
// ============================================================

describe("hook count changes", () => {
  it("warns when a render uses MORE hooks than the previous one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flag = signal(false);
    function GrowingHooks() {
      useSignal(0);
      if (flag.value) useSignal(1);
      return <p>{String(flag.value)}</p>;
    }
    render(<GrowingHooks />, host);
    flag.value = true;
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("different number of hooks"),
    );
    warn.mockRestore();
  });

  it("disposes truncated trailing slots on shrink", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flag = signal(true);
    const source = signal(0);
    const seen: number[] = [];
    function ShrinkingHooks() {
      useSignal(0);
      if (flag.value) {
        useSignalEffect(() => {
          seen.push(source.value);
        });
      }
      return <p>{String(flag.value)}</p>;
    }
    render(<ShrinkingHooks />, host);
    expect(seen).toEqual([0]);
    flag.value = false; // shrink — the effect slot must be disposed
    source.value = 1;
    expect(seen).toEqual([0]);
    warn.mockRestore();
  });
});

// ============================================================
// hmr-inject — named default declarations
// ============================================================

describe("hmr-inject — named declarations keep their binding", () => {
  it("preserves `export default function Name(){}` in module scope", () => {
    const src = [
      `export default function App() { return null; }`,
      `export const routes = [{ path: "/", component: App }];`,
    ].join("\n");
    const out = injectComponentHmrSnippet(src, "vite");
    expect(out).toContain("function App() { return null; }");
    expect(out).not.toContain("const __yukino_component__ = function");
    expect(out).toContain("const __yukino_component__ = App;");
    expect(out).toContain("export default __yukino_component__;");
  });

  it("preserves `export default class Name {}` in module scope", () => {
    const src = `export default class Store {}\nconst s = new Store();\nvoid s;\n`;
    const out = injectComponentHmrSnippet(src, "webpack");
    expect(out).toContain("class Store {}");
    expect(out).toContain("const __yukino_component__ = Store;");
  });

  it("still const-wraps anonymous default functions", () => {
    const src = "export default function () { return null; }";
    const out = injectComponentHmrSnippet(src, "vite");
    expect(out).toContain(
      "const __yukino_component__ = function () { return null; }",
    );
  });
});

// ============================================================
// Bundler integrations — production builds skip injection
// ============================================================

interface CallableVitePlugin {
  configResolved(config: { command: string }): void;
  transform(code: string, id: string): { code: string; map: null } | undefined;
}

describe("bundler integrations — production gating", () => {
  const src = "export default function V() { return null; }";

  it("vite plugin transforms in serve mode but not in build mode", () => {
    const serve = vitePlugin() as unknown as CallableVitePlugin;
    serve.configResolved({ command: "serve" });
    expect(serve.transform(src, "/app/view.tsx")?.code).toContain(
      "__yukino_component__",
    );

    const build = vitePlugin() as unknown as CallableVitePlugin;
    build.configResolved({ command: "build" });
    expect(build.transform(src, "/app/view.tsx")).toBeUndefined();
  });

  it("webpack loader passes production sources through", () => {
    expect(webpackLoader.call({ mode: "production" }, src)).toBe(src);
    expect(webpackLoader.call({ mode: "development" }, src)).toContain(
      "__yukino_component__",
    );
  });

  it("webpack plugin skips the rule in production mode", () => {
    const compiler = {
      options: { mode: "production", module: { rules: [] as unknown[] } },
    };
    new WebpackPlugin().apply(compiler);
    expect(compiler.options.module.rules.length).toBe(0);
  });
});
