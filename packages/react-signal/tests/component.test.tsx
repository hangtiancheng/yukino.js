/**
 * Function-component runtime tests: hostless instances, per-render body
 * re-runs, hook slots (useSignal/useRef/useComputed/useEffect(mount-only)/
 * useSignalEffect/onCleanup), fine-grained props, callback props, children,
 * anchor-slice invariants, and teardown order.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, unmount } from "../src/jsx/reconcile";
import { raw, type JSXNode } from "../src/jsx/vnode";
import { signal } from "../src/reactive";
import {
  useSignal,
  useRef,
  useComputed,
  useEffect,
  useSignalEffect,
  onCleanup,
} from "../src/hooks";
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

describe("component — hostless mounting", () => {
  it("mounts a function component without any wrapper element", () => {
    function Hello() {
      return <p>hello</p>;
    }
    render(<Hello />, host);
    expect(stripAnchors(host.innerHTML)).toBe("<p>hello</p>");
    // No wrapper div — the <p> is a DIRECT child of the container.
    expect(host.querySelector("p")!.parentElement).toBe(host);
  });

  it("supports fragment/multi-root and empty output (anchor-only)", () => {
    function Multi() {
      return (
        <>
          <i>a</i>
          <i>b</i>
        </>
      );
    }
    function Empty() {
      return null;
    }
    render(
      <div>
        <Multi />
        <Empty />
      </div>,
      host,
    );
    expect(stripAnchors(host.innerHTML)).toBe("<div><i>a</i><i>b</i></div>");
  });

  it("renders components as valid list/table children (no host div)", () => {
    function Row(props: { label: string }) {
      return <li>{props.label}</li>;
    }
    render(
      <ul>
        <Row label="a" />
        <Row label="b" />
      </ul>,
      host,
    );
    const ul = host.querySelector("ul")!;
    expect(ul.children).toHaveLength(2);
    expect(ul.children[0].tagName).toBe("LI");
    expect(stripAnchors(ul.innerHTML)).toBe("<li>a</li><li>b</li>");
  });

  it("propagates SVG namespace into a component slice", () => {
    function Dot() {
      return <circle r="4" />;
    }
    render(
      <svg viewBox="0 0 10 10">
        <Dot />
      </svg>,
      host,
    );
    const circle = host.querySelector("circle")!;
    expect(circle.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  it("renders raw() output inside a component slice", () => {
    function Content() {
      return <article>{raw("<b>bold</b> text")}</article>;
    }
    render(<Content />, host);
    expect(host.querySelector("article")!.innerHTML).toBe("<b>bold</b> text");
  });
});

describe("component — state & re-render", () => {
  it("re-runs the body per render; useSignal state survives", () => {
    let renders = 0;
    function Counter() {
      renders++;
      const count = useSignal(0);
      return <button onClick={() => count.value++}>{count.value}</button>;
    }
    render(<Counter />, host);
    const btn = host.querySelector("button")!;
    expect(btn.textContent).toBe("0");
    expect(renders).toBe(1);
    click(btn);
    expect(btn.textContent).toBe("1");
    expect(renders).toBe(2);
    click(btn);
    expect(btn.textContent).toBe("2");
    expect(renders).toBe(3);
  });

  it("multi-signal writes in one handler render once (batch)", () => {
    let renders = 0;
    function Two() {
      renders++;
      const a = useSignal(0);
      const b = useSignal(0);
      return (
        <button
          onClick={() => {
            a.value++;
            b.value++;
          }}
        >
          {a.value}-{b.value}
        </button>
      );
    }
    render(<Two />, host);
    expect(renders).toBe(1);
    click(host.querySelector("button"));
    expect(renders).toBe(2);
    expect(host.querySelector("button")!.textContent).toBe("1-1");
  });

  it("module-level signals subscribe the reading component only", () => {
    const shared = signal("a");
    let parentRenders = 0;
    let childRenders = 0;
    function Child() {
      childRenders++;
      return <em>{shared.value}</em>;
    }
    function Parent() {
      parentRenders++;
      return (
        <div>
          <Child />
        </div>
      );
    }
    render(<Parent />, host);
    expect(parentRenders).toBe(1);
    expect(childRenders).toBe(1);
    shared.value = "b";
    expect(host.querySelector("em")!.textContent).toBe("b");
    expect(childRenders).toBe(2);
    expect(parentRenders).toBe(1); // parent untouched
  });
});

describe("component — props", () => {
  it("subscribes per prop key: child re-renders only when a READ key changes", () => {
    const label = signal("first");
    const other = signal(1);
    let childRenders = 0;
    function Child(props: { label: string; other: number }) {
      childRenders++;
      return <span>{props.label}</span>;
    }
    function Parent() {
      return <Child label={label.value} other={other.value} />;
    }
    render(<Parent />, host);
    expect(childRenders).toBe(1);
    expect(host.querySelector("span")!.textContent).toBe("first");

    label.value = "second"; // parent re-renders, pushes changed prop
    expect(host.querySelector("span")!.textContent).toBe("second");
    expect(childRenders).toBe(2);

    other.value = 2; // parent re-renders, but child never read `other`... it did (props destructure? no — reads props.label only)
    expect(childRenders).toBe(2);
  });

  it("keeps instance state across parent-driven prop updates (no remount)", () => {
    const step = signal(1);
    function Counter(props: { step: number }) {
      const count = useSignal(0);
      return (
        <button onClick={() => (count.value += props.step)}>
          {count.value}
        </button>
      );
    }
    function App() {
      return <Counter step={step.value} />;
    }
    render(<App />, host);
    click(host.querySelector("button"));
    expect(host.querySelector("button")!.textContent).toBe("1");
    step.value = 10; // prop update — same instance
    click(host.querySelector("button"));
    expect(host.querySelector("button")!.textContent).toBe("11");
  });

  it("removes props absent in the next render (undefined — React semantics)", () => {
    const withTitle = signal(true);
    function Child(props: { title?: string }) {
      return <p>{props.title ?? "none"}</p>;
    }
    function Parent() {
      return withTitle.value ? <Child title="yes" /> : <Child />;
    }
    render(<Parent />, host);
    expect(host.querySelector("p")!.textContent).toBe("yes");
    withTitle.value = false;
    expect(host.querySelector("p")!.textContent).toBe("none");
  });

  it("delivers children through props.children", () => {
    function Panel(props: { title: string; children?: JSXNode }) {
      return (
        <section>
          <h1>{props.title}</h1>
          <div class="body">{props.children}</div>
        </section>
      );
    }
    render(
      <Panel title="T">
        <b>inner</b>
        {"text"}
      </Panel>,
      host,
    );
    expect(host.querySelector("h1")!.textContent).toBe("T");
    expect(stripAnchors(host.querySelector(".body")!.innerHTML)).toBe(
      "<b>inner</b>text",
    );
  });

  it("calls callback props directly (child→parent, no emitter)", () => {
    const onPick = vi.fn();
    function Item(props: {
      id: number;
      onPick: (data: { id: number }) => void;
    }) {
      return (
        <button onClick={() => props.onPick({ id: props.id })}>pick</button>
      );
    }
    function App() {
      return <Item id={7} onPick={onPick} />;
    }
    render(<App />, host);
    click(host.querySelector("button"));
    expect(onPick).toHaveBeenCalledExactlyOnceWith({ id: 7 });
  });

  it("keeps callback props fresh across parent re-renders (proxy read at call time)", () => {
    const seen: number[] = [];
    const gen = signal(1);
    function Child(props: { onGo: () => void }) {
      return <button onClick={() => props.onGo()}>go</button>;
    }
    function Parent() {
      const current = gen.value;
      return <Child onGo={() => seen.push(current)} />;
    }
    render(<Parent />, host);
    click(host.querySelector("button"));
    gen.value = 2;
    click(host.querySelector("button"));
    expect(seen).toEqual([1, 2]);
  });
});

describe("component — keyed lists & ordering", () => {
  function Sticky(props: { id: string }) {
    const clicks = useSignal(0);
    return (
      <li data-id={props.id} onClick={() => clicks.value++}>
        {props.id}:{clicks.value}
      </li>
    );
  }

  it("preserves component state across keyed reorders", () => {
    const order = signal(["a", "b", "c"]);
    function App() {
      return (
        <ul>
          {order.value.map((id) => (
            <Sticky key={id} id={id} />
          ))}
        </ul>
      );
    }
    render(<App />, host);
    const li = (id: string) => host.querySelector(`li[data-id="${id}"]`)!;
    click(li("a"));
    click(li("a"));
    click(li("c"));
    expect(li("a").textContent).toBe("a:2");
    expect(li("c").textContent).toBe("c:1");

    order.value = ["c", "a", "b"]; // reorder — atomic range moves
    const ids = Array.from(host.querySelectorAll("li")).map((el) =>
      el.getAttribute("data-id"),
    );
    expect(ids).toEqual(["c", "a", "b"]);
    expect(li("a").textContent).toBe("a:2"); // state survived the move
    expect(li("c").textContent).toBe("c:1");
  });

  it("keeps sibling order stable when a component's slice grows", () => {
    const count = signal(1);
    function Items() {
      return (
        <>
          {Array.from({ length: count.value }, (_, i) => (
            <i key={`x${i}`}>{i}</i>
          ))}
        </>
      );
    }
    render(
      <div>
        <b>start</b>
        <Items />
        <b>end</b>
      </div>,
      host,
    );
    const div = host.querySelector("div")!;
    expect(stripAnchors(div.innerHTML)).toBe("<b>start</b><i>0</i><b>end</b>");
    count.value = 3;
    expect(stripAnchors(div.innerHTML)).toBe(
      "<b>start</b><i>0</i><i>1</i><i>2</i><b>end</b>",
    );
    count.value = 0;
    expect(stripAnchors(div.innerHTML)).toBe("<b>start</b><b>end</b>");
  });

  it("unmounts a conditional component and cleans it up", () => {
    const show = signal(true);
    const cleanup = vi.fn();
    function Temp() {
      useEffect(() => cleanup);
      return <p>temp</p>;
    }
    function App() {
      return <div>{show.value && <Temp />}</div>;
    }
    render(<App />, host);
    expect(host.querySelector("p")).not.toBeNull();
    show.value = false;
    expect(host.querySelector("p")).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("hooks — useEffect (mount-only) semantics", () => {
  it("runs once after mount; cleanup on unmount", () => {
    const run = vi.fn();
    const cleanup = vi.fn();
    const tick = signal(0);
    function App() {
      tick.value; // subscribe → re-render on bump
      useEffect(() => {
        run();
        return cleanup;
      });
      return <p>{tick.value}</p>;
    }
    render(<App />, host);
    expect(run).toHaveBeenCalledTimes(1);
    tick.value++;
    tick.value++;
    expect(run).toHaveBeenCalledTimes(1); // mount-only
    expect(cleanup).not.toHaveBeenCalled();
    unmount(host);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-run on re-renders (mount-only — use useSignalEffect for reactivity)", () => {
    const run = vi.fn();
    const tick = signal(0);
    function App() {
      tick.value;
      useEffect(() => {
        run();
      });
      return <p>x</p>;
    }
    render(<App />, host);
    tick.value++;
    tick.value++;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("data-driven side effects go through useSignalEffect (cleanup between runs)", () => {
    const dep = signal("a");
    const calls: string[] = [];
    function App() {
      useSignalEffect(() => {
        const v = dep.value; // tracked
        calls.push(`run:${v}`);
        return () => calls.push(`clean:${v}`);
      });
      return <p>{dep.value}</p>;
    }
    render(<App />, host);
    dep.value = "b";
    dep.value = "b"; // same value — no notification
    expect(calls).toEqual(["run:a", "clean:a", "run:b"]);
    unmount(host);
    expect(calls).toEqual(["run:a", "clean:a", "run:b", "clean:b"]);
  });

  it("runs AFTER the DOM commit (element is queryable)", () => {
    let textAtEffect: string | null = null;
    function App() {
      useEffect(() => {
        textAtEffect = host.querySelector("p")?.textContent ?? null;
      });
      return <p>ready</p>;
    }
    render(<App />, host);
    expect(textAtEffect).toBe("ready");
  });
});

describe("hooks — refs / memo / computed / cleanup", () => {
  it("useRef is stable across renders and wires element refs", () => {
    const tick = signal(0);
    const cells: Array<{ current: Element | null }> = [];
    function App() {
      tick.value;
      const el = useRef<HTMLParagraphElement>();
      cells.push(el);
      useEffect(() => {
        el.current!.textContent = "via-ref";
      });
      return <p ref={el}>initial</p>;
    }
    render(<App />, host);
    expect(host.querySelector("p")!.textContent).toBe("via-ref");
    tick.value++;
    expect(cells[0]).toBe(cells[1]); // same cell every render
    unmount(host);
    expect(cells[0].current).toBeNull(); // nulled on teardown
  });

  it("useComputed memoizes: unrelated re-renders do not recompute", () => {
    const compute = vi.fn((n: number) => n * 2);
    const dep = signal(1);
    const tick = signal(0);
    function App() {
      tick.value;
      const doubled = useComputed(() => compute(dep.value));
      return <p>{doubled.value}</p>;
    }
    render(<App />, host);
    expect(compute).toHaveBeenCalledTimes(1);
    tick.value++; // unrelated re-render — computed is cached
    expect(compute).toHaveBeenCalledTimes(1);
    dep.value = 5;
    expect(compute).toHaveBeenCalledTimes(2);
    expect(host.querySelector("p")!.textContent).toBe("10");
  });

  it("useComputed derives reactively without a deps array", () => {
    function App() {
      const count = useSignal(2);
      const squared = useComputed(() => count.value * count.value);
      return <button onClick={() => count.value++}>{squared.value}</button>;
    }
    render(<App />, host);
    expect(host.querySelector("button")!.textContent).toBe("4");
    click(host.querySelector("button"));
    expect(host.querySelector("button")!.textContent).toBe("9");
  });

  it("useSignalEffect is created once, re-runs reactively, disposed on unmount", () => {
    const source = signal(0);
    const seen: number[] = [];
    const tick = signal(0);
    function App() {
      tick.value;
      useSignalEffect(() => {
        seen.push(source.value);
      });
      return <p>x</p>;
    }
    render(<App />, host);
    expect(seen).toEqual([0]);
    tick.value++; // re-render must NOT recreate the effect
    expect(seen).toEqual([0]);
    source.value = 1;
    expect(seen).toEqual([0, 1]);
    unmount(host);
    source.value = 2; // disposed — no run
    expect(seen).toEqual([0, 1]);
  });

  it("onCleanup registers exactly once despite re-renders", () => {
    const clean = vi.fn();
    const tick = signal(0);
    function App() {
      tick.value;
      onCleanup(clean);
      return <p>x</p>;
    }
    render(<App />, host);
    tick.value++;
    tick.value++;
    unmount(host);
    expect(clean).toHaveBeenCalledTimes(1);
  });

  it("warns when hook count changes between renders", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flag = signal(true);
    function Bad() {
      if (flag.value) useSignal(1);
      useSignal(2);
      return <p>{String(flag.value)}</p>;
    }
    render(<Bad />, host);
    flag.value = false;
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("different number of hooks"),
    );
    warn.mockRestore();
  });
});

describe("teardown order", () => {
  it("runs child cleanups before parent cleanups (React order)", () => {
    const order: string[] = [];
    function Child() {
      useEffect(() => () => order.push("child"));
      return <i>c</i>;
    }
    function Parent() {
      useEffect(() => () => order.push("parent"));
      return (
        <div>
          <Child />
        </div>
      );
    }
    render(<Parent />, host);
    unmount(host);
    expect(order).toEqual(["child", "parent"]);
  });

  it("nested component DOM ranges are removed atomically with the parent", () => {
    const show = signal(true);
    function Inner() {
      return <em>inner</em>;
    }
    function Outer() {
      return (
        <>
          <b>outer</b>
          <Inner />
        </>
      );
    }
    function App() {
      return <div>{show.value && <Outer />}</div>;
    }
    render(<App />, host);
    expect(host.querySelector("em")).not.toBeNull();
    show.value = false;
    const div = host.querySelector("div")!;
    expect(stripAnchors(div.innerHTML)).toBe("");
  });
});
