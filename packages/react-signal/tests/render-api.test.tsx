import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, unmount } from "../src/jsx/reconcile";
import { signal } from "../src/reactive";
import { useSignal, useEffect } from "../src/hooks";
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

describe("render()", () => {
  it("takes ownership of the container (static content cleared)", () => {
    host.innerHTML = "<span>placeholder</span>";
    render(<p>owned</p>, host);
    expect(stripAnchors(host.innerHTML)).toBe("<p>owned</p>");
  });

  it("re-render diffs in place — same element patched, not replaced", () => {
    render(<p class="a">one</p>, host);
    const el = host.querySelector("p")!;
    render(<p class="b">two</p>, host);
    expect(host.querySelector("p")).toBe(el);
    expect(el.className).toBe("b");
    expect(el.textContent).toBe("two");
  });

  it("re-render keeps component instances (state survives) and pushes new props", () => {
    function Counter(props: { label: string }) {
      const count = useSignal(0);
      return (
        <button onClick={() => count.value++}>
          {props.label}:{count.value}
        </button>
      );
    }
    render(<Counter label="v1" />, host);
    const btn = host.querySelector("button")!;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(btn.textContent).toBe("v1:1");

    render(<Counter label="v2" />, host);
    expect(host.querySelector("button")).toBe(btn);
    expect(btn.textContent).toBe("v2:1");
  });

  it("re-render with a different component unmounts the old one", () => {
    const cleanup = vi.fn();
    function A() {
      useEffect(() => cleanup);
      return <p>A</p>;
    }
    function B() {
      return <p>B</p>;
    }
    render(<A />, host);
    render(<B />, host);
    expect(stripAnchors(host.innerHTML)).toBe("<p>B</p>");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("signal children at the root stay live without re-calling render", () => {
    const msg = signal("hi");
    render(<p>{msg}</p>, host);
    expect(host.querySelector("p")!.textContent).toBe("hi");
    msg.value = "bye";
    expect(host.querySelector("p")!.textContent).toBe("bye");
  });

  it("render(null) empties the tree but keeps the root alive", () => {
    render(<p>content</p>, host);
    render(null, host);
    expect(stripAnchors(host.innerHTML)).toBe("");
    render(<p>back</p>, host);
    expect(stripAnchors(host.innerHTML)).toBe("<p>back</p>");
  });
});

describe("unmount()", () => {
  it("returns true when a tree was mounted, false otherwise", () => {
    expect(unmount(host)).toBe(false);
    render(<p>x</p>, host);
    expect(unmount(host)).toBe(true);
    expect(unmount(host)).toBe(false);
  });

  it("clears the DOM and runs all cleanups", () => {
    const cleanup = vi.fn();
    function App() {
      useEffect(() => cleanup);
      return <p>x</p>;
    }
    render(<App />, host);
    unmount(host);
    expect(host.innerHTML).toBe("");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("stops root reactivity (signal children detach)", () => {
    const msg = signal("a");
    render(<p>{msg}</p>, host);
    unmount(host);
    msg.value = "b";
    expect(host.innerHTML).toBe("");
  });

  it("supports a fresh mount on the same container after unmount", () => {
    function Counter() {
      const count = useSignal(0);
      return <button onClick={() => count.value++}>{count.value}</button>;
    }
    render(<Counter />, host);
    host
      .querySelector("button")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(host.querySelector("button")!.textContent).toBe("1");
    unmount(host);
    render(<Counter />, host);
    expect(host.querySelector("button")!.textContent).toBe("0");
  });
});
