/**
 * Component props semantics: real object identity pass-through, Signal props
 * staying wrapped, proxy spread, camelCase keys, deep composition, and
 * component-vs-element prop handling (class/style are ordinary props on
 * components — there is no host element).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, unmount } from "../src/jsx/reconcile";
import type { Component } from "../src/jsx/vnode";
import { signal, Signal } from "../src/reactive";
import { useSignal } from "../src/hooks";
import { stripAnchors } from "./helpers";

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

describe("props — identity & shapes", () => {
  it("passes objects/arrays/functions by REFERENCE (no serialization)", () => {
    const config = { deep: { nested: true } };
    const rows = [1, 2, 3];
    const helper = (): number => 42;
    let received: Record<string, unknown> | undefined;

    function Child(props: {
      config: object;
      rows: number[];
      helper: () => number;
    }) {
      received = {
        config: props.config,
        rows: props.rows,
        helper: props.helper,
      };
      return <p>child</p>;
    }
    render(<Child config={config} rows={rows} helper={helper} />, host);

    expect(received!["config"]).toBe(config); // same reference
    expect(received!["rows"]).toBe(rows);
    expect(received!["helper"]).toBe(helper);
  });

  it("keeps Signal props WRAPPED so the child can subscribe directly", () => {
    const count = signal(1);
    let receivedSignal: unknown;
    function Child(props: { count: Signal<number> }) {
      receivedSignal = props.count;
      return <p>{props.count.value}</p>;
    }
    render(<Child count={count} />, host);
    expect(receivedSignal).toBe(count);
    expect(host.querySelector("p")!.textContent).toBe("1");
    count.value = 5; // direct subscription — child re-renders, parent-free
    expect(host.querySelector("p")!.textContent).toBe("5");
  });

  it("preserves camelCase prop keys exactly", () => {
    function Child(props: { userName: string; maxRetryCount: number }) {
      return (
        <p>
          {props.userName}:{props.maxRetryCount}
        </p>
      );
    }
    render(<Child userName="ada" maxRetryCount={3} />, host);
    expect(host.querySelector("p")!.textContent).toBe("ada:3");
  });

  it("supports spreading the props proxy into a snapshot", () => {
    let snapshot: Record<string, unknown> | undefined;
    function Child(props: { a: number; b: string }) {
      snapshot = { ...props };
      return <p>x</p>;
    }
    render(<Child a={1} b="two" />, host);
    expect(snapshot).toEqual({ a: 1, b: "two" });
  });

  it("never delivers the vnode `key` as a prop", () => {
    let sawKey: unknown = "unset";
    function Child(props: Record<string, unknown>) {
      sawKey = props["key"];
      return <p>x</p>;
    }
    render(<Child key="k1" data-x="1" />, host);
    expect(sawKey).toBeUndefined();
  });

  it("class/style on a COMPONENT are ordinary props (no host element)", () => {
    let received: Record<string, unknown> | undefined;
    function Child(props: { class?: string; style?: string }) {
      received = { class: props.class, style: props.style };
      return <p class={props.class}>styled by child</p>;
    }
    render(<Child class="from-parent" style="color:red" />, host);
    expect(received).toEqual({ class: "from-parent", style: "color:red" });
    // The child decides where they land:
    expect(host.querySelector("p")!.getAttribute("class")).toBe("from-parent");
    // No auto-generated wrapper carries them:
    expect(host.querySelector("div")).toBeNull();
  });
});

describe("props — reactive updates", () => {
  it("pushes updates through per-key signals (fine-grained)", () => {
    const a = signal("a1");
    const b = signal("b1");
    const readsA: string[] = [];
    function Child(props: { a: string; b: string }) {
      readsA.push(props.a);
      return <p>{props.a}</p>; // reads only `a`
    }
    function Parent() {
      return <Child a={a.value} b={b.value} />;
    }
    render(<Parent />, host);
    expect(readsA).toEqual(["a1"]);

    b.value = "b2"; // parent re-renders; child's read key unchanged
    expect(readsA).toEqual(["a1"]);

    a.value = "a2";
    expect(readsA).toEqual(["a1", "a2"]);
    expect(host.querySelector("p")!.textContent).toBe("a2");
  });

  it("same-value prop pushes are no-ops (=== comparison)", () => {
    const tick = signal(0);
    const stable = { fixed: true };
    let childRenders = 0;
    function Child(props: { cfg: object }) {
      childRenders++;
      return <p>{String(props.cfg !== null)}</p>;
    }
    function Parent() {
      tick.value;
      return <Child cfg={stable} />;
    }
    render(<Parent />, host);
    expect(childRenders).toBe(1);
    tick.value++; // parent re-renders, same cfg reference pushed
    expect(childRenders).toBe(1);
  });

  it("new inline object identities re-render children that read them (React-like)", () => {
    const tick = signal(0);
    let childRenders = 0;
    function Child(props: { cfg: { n: number } }) {
      childRenders++;
      return <p>{props.cfg.n}</p>;
    }
    function Parent() {
      tick.value;
      return <Child cfg={{ n: 1 }} />; // fresh identity every parent render
    }
    render(<Parent />, host);
    expect(childRenders).toBe(1);
    tick.value++;
    expect(childRenders).toBe(2);
  });
});

describe("composition", () => {
  it("renders deep component trees hostlessly", () => {
    function Leaf(props: { n: number }) {
      return <b>{props.n}</b>;
    }
    function Branch(props: { base: number }) {
      return (
        <>
          <Leaf n={props.base} />
          <Leaf n={props.base + 1} />
        </>
      );
    }
    function Root() {
      return (
        <main>
          <Branch base={10} />
        </main>
      );
    }
    render(<Root />, host);
    const main = host.querySelector("main")!;
    expect(stripAnchors(main.innerHTML)).toBe("<b>10</b><b>11</b>");
    // All <b> are direct children of <main> — zero wrappers.
    expect(main.querySelectorAll(":scope > b")).toHaveLength(2);
  });

  it("switching between different components at a position remounts", () => {
    const mode = signal<"a" | "b">("a");
    function A() {
      const n = useSignal(0);
      return <button onClick={() => n.value++}>A:{n.value}</button>;
    }
    function B() {
      return <p>B</p>;
    }
    function App() {
      return <div>{mode.value === "a" ? <A /> : <B />}</div>;
    }
    render(<App />, host);
    click(host.querySelector("button"));
    expect(host.querySelector("button")!.textContent).toBe("A:1");

    mode.value = "b";
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("p")!.textContent).toBe("B");

    mode.value = "a"; // fresh A — state reset (different instance)
    expect(host.querySelector("button")!.textContent).toBe("A:0");
  });

  it("a component returning a bare string renders TEXT", () => {
    const Words: Component = () => "just text";
    render(
      <div>
        <Words />
      </div>,
      host,
    );
    expect(host.querySelector("div")!.textContent).toBe("just text");
  });

  it("children re-render when the parent passes fresh children", () => {
    const label = signal("one");
    function Wrap(props: { children?: unknown }) {
      return <section>{props.children as never}</section>;
    }
    function App() {
      return (
        <Wrap>
          <i>{label.value}</i>
        </Wrap>
      );
    }
    render(<App />, host);
    expect(host.querySelector("i")!.textContent).toBe("one");
    label.value = "two";
    expect(host.querySelector("i")!.textContent).toBe("two");
  });

  it("callback props compose across levels (grandchild → root)", () => {
    const seen = vi.fn();
    function GrandChild(props: { onPing: (n: number) => void }) {
      return <button onClick={() => props.onPing(3)}>ping</button>;
    }
    function Child(props: { onPing: (n: number) => void }) {
      return <GrandChild onPing={(n) => props.onPing(n * 2)} />;
    }
    function Root() {
      return <Child onPing={seen} />;
    }
    render(<Root />, host);
    click(host.querySelector("button"));
    expect(seen).toHaveBeenCalledExactlyOnceWith(6);
  });
});
