/**
 * VNode reconciler unit tests — element/text/attr/event/keyed/raw/namespace
 * mechanics through the public `render()` root API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, unmount } from "../src/jsx/reconcile";
import { raw } from "../src/jsx/vnode";
import { signal } from "../src/reactive";

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  host.id = "reconcile-host";
  document.body.appendChild(host);
});

afterEach(() => {
  unmount(host);
  host.remove();
});

describe("reconcile — text & children", () => {
  it("renders text children as real text nodes (no HTML escaping needed)", () => {
    render(<p>{'a<b & c "quoted"'}</p>, host);
    expect(host.querySelector("p")!.textContent).toBe('a<b & c "quoted"');
    // The dangerous characters are text data, not markup.
    expect(host.querySelectorAll("*")).toHaveLength(1);
  });

  it("renders numbers, skips null/boolean, flattens arrays", () => {
    render(<div>{[0, null, false, "x", [1, 2], undefined, true]}</div>, host);
    expect(host.querySelector("div")!.textContent).toBe("0x12");
  });

  it("updates text in place without replacing the node", () => {
    render(<p>one</p>, host);
    const textNode = host.querySelector("p")!.firstChild!;
    render(<p>two</p>, host);
    expect(host.querySelector("p")!.firstChild).toBe(textNode);
    expect(textNode.nodeValue).toBe("two");
  });

  it("supports multi-root (Fragment) content", () => {
    render(
      <>
        <header data-role="h">H</header>
        <footer data-role="f">F</footer>
      </>,
      host,
    );
    expect(host.children).toHaveLength(2);
    expect(host.children[0].getAttribute("data-role")).toBe("h");
    expect(host.children[1].getAttribute("data-role")).toBe("f");
  });

  it("mounts function tags as component instances (no wrapper element)", () => {
    const Badge = (props: { label: string }) => (
      <em class="badge">{props.label}</em>
    );
    render(<Badge label="new" />, host);
    const em = host.querySelector("em.badge")!;
    expect(em.textContent).toBe("new");
    expect(em.parentElement).toBe(host); // hostless — direct child

    render(<Badge label="updated" />, host); // prop push, same instance
    expect(host.querySelector("em.badge")).toBe(em);
    expect(em.textContent).toBe("updated");
  });

  it("clears pre-existing static host content on the first render", () => {
    host.innerHTML = "<span>placeholder</span>";
    render(<p>real</p>, host);
    expect(host.querySelector("span")).toBeNull();
    expect(host.textContent).toBe("real");
  });

  it("switching node kind at a position replaces the node", () => {
    render(<div>{"text"}</div>, host);
    const container = host.querySelector("div")!;
    expect(container.firstChild!.nodeType).toBe(3);
    render(<div>{<b>bold</b>}</div>, host);
    expect(container.firstElementChild!.tagName).toBe("B");
    render(<div>{"text again"}</div>, host);
    expect(container.firstChild!.nodeType).toBe(3);
  });
});

describe("reconcile — attributes", () => {
  it("sets, updates, and removes attributes", () => {
    render(<div data-a="1" data-b="x" />, host);
    const el = host.firstElementChild!;
    expect(el.getAttribute("data-a")).toBe("1");
    expect(el.getAttribute("data-b")).toBe("x");

    render(<div data-a="2" />, host);
    expect(host.firstElementChild).toBe(el); // patched in place
    expect(el.getAttribute("data-a")).toBe("2");
    expect(el.hasAttribute("data-b")).toBe(false);
  });

  it("boolean true → empty attribute; false/null → removed", () => {
    render(<input disabled={true} data-x={false} data-y={null} />, host);
    const el = host.firstElementChild!;
    expect(el.hasAttribute("disabled")).toBe(true);
    expect(el.getAttribute("disabled")).toBe("");
    expect(el.hasAttribute("data-x")).toBe(false);
    expect(el.hasAttribute("data-y")).toBe(false);
    render(<input disabled={false} />, host);
    expect(el.hasAttribute("disabled")).toBe(false);
  });

  it("merges class and className; supports arrays and truthy-key maps", () => {
    render(
      <div
        class={["a", false && "b", "c"]}
        className={{ on: true, off: false }}
      />,
      host,
    );
    expect(host.firstElementChild!.getAttribute("class")).toBe("a c on");
    render(<div />, host);
    expect(host.firstElementChild!.hasAttribute("class")).toBe(false);
  });

  it("serializes style objects (camelCase → kebab, custom props pass through)", () => {
    render(<div style={{ fontSize: "12px", "--x": "1", margin: 0 }} />, host);
    expect(host.firstElementChild!.getAttribute("style")).toBe(
      "font-size:12px;--x:1;margin:0",
    );
  });

  it("unwraps Signal attribute values and updates reactively (root effect)", () => {
    const title = signal("hello");
    render(<p title={title} />, host);
    expect(host.querySelector("p")!.getAttribute("title")).toBe("hello");
    title.value = "world"; // no render() call — the root effect re-runs
    expect(host.querySelector("p")!.getAttribute("title")).toBe("world");
  });

  it("unwraps Signal children and updates reactively", () => {
    const label = signal("first");
    render(<p>{label}</p>, host);
    expect(host.querySelector("p")!.textContent).toBe("first");
    label.value = "second";
    expect(host.querySelector("p")!.textContent).toBe("second");
  });

  it("skips object/function attribute values with a dev warning", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<div data-obj={{ a: 1 }} />, host);
    expect(host.firstElementChild!.hasAttribute("data-obj")).toBe(false);
    spy.mockRestore();
  });

  it("rejects native lowercase inline handlers (onclick) as an XSS guard", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // @ts-expect-error — native lowercase inline handlers are intentionally untyped
    render(<button onclick="alert(1)" />, host);
    expect(host.firstElementChild!.hasAttribute("onclick")).toBe(false);
    spy.mockRestore();
  });

  it("skips invalid attribute names (injection guard)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const props: Record<string, unknown> = { 'x" onmouseover="hack()': "v" };
    render(<div {...props} />, host);
    expect(host.firstElementChild!.attributes).toHaveLength(0);
    spy.mockRestore();
  });

  it("syncs input value as a DOM property and re-asserts it over user edits", () => {
    render(<input value="a" />, host);
    const input = host.querySelector("input")!;
    expect(input.value).toBe("a");
    input.value = "user-typed";
    render(<input value="a" />, host); // template value wins
    expect(input.value).toBe("a");
  });
});

describe("reconcile — events", () => {
  it("dispatches to per-node listeners and swaps closures per render", () => {
    const seen: number[] = [];
    let current = 1;
    render(<button onClick={() => seen.push(current)}>go</button>, host);
    const btn = host.querySelector("button")!;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual([1]);

    current = 42;
    render(<button onClick={() => seen.push(current)}>go</button>, host);
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual([1, 42]);
  });

  it("adds exactly one native listener per (node, type) across renders", () => {
    render(<button onClick={() => 1}>x</button>, host);
    const btn = host.querySelector("button")!;
    const addSpy = vi.spyOn(btn, "addEventListener");
    render(<button onClick={() => 2}>x</button>, host);
    render(<button onClick={() => 3}>x</button>, host);
    expect(addSpy).not.toHaveBeenCalled(); // binding reused, only .current swapped
    addSpy.mockRestore();
  });

  it("parks the listener when the handler prop is removed", () => {
    const fn = vi.fn();
    render(<button onClick={fn}>x</button>, host);
    const btn = host.querySelector("button")!;
    render(<button>x</button>, host);
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(fn).not.toHaveBeenCalled();
  });

  it("exposes the original hit element via native e.target", () => {
    let seenTarget: EventTarget | null | undefined;
    render(
      <div onClick={(e) => (seenTarget = e.target)}>
        <span data-role="inner">hit me</span>
      </div>,
      host,
    );
    const inner = host.querySelector("[data-role='inner']")!;
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seenTarget).toBe(inner);
  });
});

describe("reconcile — keyed diff", () => {
  const items = (order: string[]) => (
    <ul>
      {order.map((t) => (
        <li key={t} data-tag={t}>
          {t}
        </li>
      ))}
    </ul>
  );

  it("reorders keyed siblings without recreating nodes", () => {
    render(items(["a", "b", "c"]), host);
    const before = Array.from(host.querySelectorAll("li"));
    (before[1] as HTMLElement & { __marker?: number }).__marker = 7;

    render(items(["c", "b", "a"]), host);
    const after = Array.from(host.querySelectorAll("li"));
    expect(after.map((li) => li.textContent)).toEqual(["c", "b", "a"]);
    expect((after[1] as HTMLElement & { __marker?: number }).__marker).toBe(7);
    expect(after[1]).toBe(before[1]);
  });

  it("keys do NOT leak into the DOM as ids (React semantics)", () => {
    render(items(["a"]), host);
    expect(host.querySelector("li")!.hasAttribute("id")).toBe(false);
    expect(document.getElementById("a")).toBeNull();
  });

  it("removes and inserts keyed children", () => {
    render(items(["a", "b", "c"]), host);
    render(items(["a", "c", "d"]), host);
    expect(
      Array.from(host.querySelectorAll("li")).map((li) => li.textContent),
    ).toEqual(["a", "c", "d"]);
  });

  it("matches unkeyed same-type nodes positionally", () => {
    render(
      <div>
        <p>one</p>
        <p>two</p>
      </div>,
      host,
    );
    const first = host.querySelectorAll("p")[0];
    render(
      <div>
        <p>uno</p>
        <p>dos</p>
      </div>,
      host,
    );
    expect(host.querySelectorAll("p")[0]).toBe(first);
    expect(first.textContent).toBe("uno");
  });

  it("replaces a node when the element type changes", () => {
    render(<div>{[<i>x</i>]}</div>, host);
    render(<div>{[<b>x</b>]}</div>, host);
    const container = host.querySelector("div")!;
    expect(container.querySelector("i")).toBeNull();
    expect(container.querySelector("b")).not.toBeNull();
  });
});

describe("reconcile — raw HTML", () => {
  it("renders trusted raw HTML", () => {
    render(<div>{raw("<b>bold</b> & <i>italic</i>")}</div>, host);
    const container = host.querySelector("div")!;
    expect(container.querySelector("b")!.textContent).toBe("bold");
    expect(container.querySelector("i")!.textContent).toBe("italic");
  });

  it("keeps raw nodes when the html string is unchanged", () => {
    const html = "<b>same</b>";
    render(<div>{raw(html)}</div>, host);
    const b = host.querySelector("b")!;
    render(<div>{raw(html)}</div>, host);
    expect(host.querySelector("b")).toBe(b);
  });

  it("replaces raw nodes when the html string changes", () => {
    render(<div>{raw("<b>old</b>")}</div>, host);
    render(<div>{raw("<em>new</em>")}</div>, host);
    const container = host.querySelector("div")!;
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("em")!.textContent).toBe("new");
  });

  it("a plain string at the root renders as TEXT (React semantics)", () => {
    render("<p>not html</p>", host);
    expect(host.querySelector("p")).toBeNull();
    expect(host.textContent).toBe("<p>not html</p>");
  });
});

describe("reconcile — namespaces", () => {
  it("creates svg elements in the SVG namespace", () => {
    render(
      <svg viewBox="0 0 10 10">
        <circle cx="1" cy="1" r="1" />
      </svg>,
      host,
    );
    const svg = host.querySelector("svg")!;
    const circle = host.querySelector("circle")!;
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(circle.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  it("foreignObject children return to the HTML namespace", () => {
    render(
      <svg>
        <foreignObject>
          <div data-role="html-island" />
        </foreignObject>
      </svg>,
      host,
    );
    expect(host.querySelector("[data-role='html-island']")!.namespaceURI).toBe(
      "http://www.w3.org/1999/xhtml",
    );
  });
});

describe("reconcile — refs", () => {
  it("calls function refs with the element after commit and null on removal", () => {
    const calls: (Element | null)[] = [];
    render(<div>{[<p key="p" ref={(el) => calls.push(el)} />]}</div>, host);
    expect(calls).toHaveLength(1);
    expect((calls[0] as Element).tagName).toBe("P");
    expect(calls[0]!.isConnected).toBe(true); // ref fires post-insert

    render(<div>{[]}</div>, host);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBeNull();
  });

  it("fills { current } refs and clears them on unmount", () => {
    const ref: { current: HTMLInputElement | null } = { current: null };
    render(<input ref={ref} />, host);
    expect(ref.current).toBe(host.querySelector("input"));
    unmount(host);
    expect(ref.current).toBeNull();
  });

  it("swapping the ref prop releases the old ref", () => {
    const a: { current: HTMLParagraphElement | null } = { current: null };
    const b: { current: HTMLParagraphElement | null } = { current: null };
    render(<p ref={a} />, host);
    expect(a.current).not.toBeNull();
    render(<p ref={b} />, host);
    expect(a.current).toBeNull();
    expect(b.current).toBe(host.querySelector("p"));
  });
});
