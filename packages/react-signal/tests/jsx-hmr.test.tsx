/**
 * JSX-level HMR behavior: hot-swapping components mounted as JSX tags —
 * state preservation, handler freshness, effect re-runs, and nested
 * parent/child swaps with stale imports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hotSwapByComponent } from "../src/hmr";
import { render, unmount } from "../src/jsx/reconcile";
import { signal } from "../src/reactive";
import { useSignal, useEffect } from "../src/hooks";
import type { Component } from "../src/jsx/vnode";

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  unmount(host);
  host.remove();
});

const click = (el: Element | null): void => {
  el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

describe("JSX HMR", () => {
  it("preserves useSignal state and swaps rendered JSX", () => {
    const CounterV1: Component = function Counter() {
      const count = useSignal(0);
      return (
        <button class="v1" onClick={() => count.value++}>
          v1:{count.value}
        </button>
      );
    };
    render(<CounterV1 />, host);
    click(host.querySelector("button"));
    click(host.querySelector("button"));
    expect(host.querySelector("button.v1")!.textContent).toBe("v1:2");

    const CounterV2: Component = function Counter() {
      const count = useSignal(0);
      return (
        <button class="v2" onClick={() => (count.value += 10)}>
          v2:{count.value}
        </button>
      );
    };
    hotSwapByComponent(CounterV1, CounterV2);

    // New JSX, preserved state.
    const btn = host.querySelector("button")!;
    expect(btn.className).toBe("v2");
    expect(btn.textContent).toBe("v2:2");

    // The new closure (step +10) is live.
    click(btn);
    expect(btn.textContent).toBe("v2:12");
  });

  it("swaps a CHILD component while the parent keeps its stale import", () => {
    const badge = (label: string): Component =>
      function Badge(props: { text: string }) {
        return (
          <em class={label}>
            {label}:{props.text}
          </em>
        );
      };
    const BadgeV1 = badge("b1");
    const text = signal("hello");
    function Parent() {
      return (
        <div>
          <BadgeV1 text={text.value} />
        </div>
      );
    }
    render(<Parent />, host);
    expect(host.querySelector("em.b1")!.textContent).toBe("b1:hello");

    const BadgeV2 = badge("b2");
    hotSwapByComponent(BadgeV1, BadgeV2);
    expect(host.querySelector("em.b2")!.textContent).toBe("b2:hello");
    const em = host.querySelector("em.b2")!;

    // Parent re-render still references BadgeV1 (stale import) — the alias
    // map must match the live instance and just push props, not remount.
    text.value = "world";
    expect(host.querySelector("em.b2")).toBe(em);
    expect(em.textContent).toBe("b2:world");
  });

  it("re-runs mount effects with the NEW closure after a swap", () => {
    const log: string[] = [];
    const V1: Component = function Fx() {
      useEffect(() => {
        log.push("v1-run");
        return () => log.push("v1-clean");
      });
      return <p>v1</p>;
    };
    render(<V1 />, host);
    expect(log).toEqual(["v1-run"]);

    const V2: Component = function Fx() {
      useEffect(() => {
        log.push("v2-run");
        return () => log.push("v2-clean");
      });
      return <p>v2</p>;
    };
    hotSwapByComponent(V1, V2);
    // Old effect cleaned up, new effect ran against the swapped DOM.
    expect(log).toEqual(["v1-run", "v1-clean", "v2-run"]);
    expect(host.querySelector("p")!.textContent).toBe("v2");

    unmount(host);
    expect(log).toEqual(["v1-run", "v1-clean", "v2-run", "v2-clean"]);
  });

  it("swaps ALL live instances of a component", () => {
    const V1: Component = function Tag() {
      return <i class="v1">x</i>;
    };
    render(
      <div>
        <V1 />
        <V1 />
        <V1 />
      </div>,
      host,
    );
    expect(host.querySelectorAll("i.v1")).toHaveLength(3);

    const V2: Component = function Tag() {
      return <i class="v2">x</i>;
    };
    hotSwapByComponent(V1, V2);
    expect(host.querySelectorAll("i.v1")).toHaveLength(0);
    expect(host.querySelectorAll("i.v2")).toHaveLength(3);
  });

  it("chained swaps (v1 → v2 → v3) keep matching stale imports", () => {
    const make = (label: string): Component =>
      function Chained() {
        const count = useSignal(0);
        return (
          <button class={label} onClick={() => count.value++}>
            {label}:{count.value}
          </button>
        );
      };
    const V1 = make("v1");
    const V2 = make("v2");
    const V3 = make("v3");

    render(<V1 />, host);
    click(host.querySelector("button"));
    hotSwapByComponent(V1, V2);
    hotSwapByComponent(V2, V3);
    expect(host.querySelector("button")!.className).toBe("v3");
    expect(host.querySelector("button")!.textContent).toBe("v3:1");

    // Root re-render with the ORIGINAL import — alias chain resolves to v3.
    const btn = host.querySelector("button")!;
    render(<V1 />, host);
    expect(host.querySelector("button")).toBe(btn);
    expect(btn.textContent).toBe("v3:1");
  });

  it("does not resurrect unmounted instances", () => {
    const V1: Component = function Gone() {
      return <p>v1</p>;
    };
    render(<V1 />, host);
    unmount(host);

    const V2: Component = function Gone() {
      return <p>v2</p>;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(hotSwapByComponent(V1, V2)).toBe(false); // no live instances
    expect(host.innerHTML).toBe("");
    spy.mockRestore();
  });
});
