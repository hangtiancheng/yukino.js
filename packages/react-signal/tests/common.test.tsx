import { strSafe } from "../src/common";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, unmount } from "../src/jsx/reconcile";
import { signal } from "../src/reactive";
import { useSignal } from "../src/hooks";
import { getInstances } from "../src/component";
import { canonicalComponent } from "../src/component-registry";
import { hotSwapByComponent } from "../src/hmr";
import { matchPath } from "../src/router";
import { jsx } from "../src/jsx-runtime";

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  unmount(host);
  host.remove();
  vi.restoreAllMocks();
});

describe("common", () => {
  describe("strSafe", () => {
    it("returns '' for null", () => {
      expect(strSafe(null)).toBe("");
    });
    it("returns '' for undefined", () => {
      expect(strSafe(undefined)).toBe("");
    });
    it("converts number to string", () => {
      expect(strSafe(42)).toBe("42");
    });
    it("converts boolean true to 'true'", () => {
      expect(strSafe(true)).toBe("true");
    });
    it("converts boolean false to 'false'", () => {
      expect(strSafe(false)).toBe("false");
    });
    it("returns string as-is", () => {
      expect(strSafe("hello")).toBe("hello");
    });
    it("converts 0 to '0'", () => {
      expect(strSafe(0)).toBe("0");
    });
    it("converts empty string to empty string", () => {
      expect(strSafe("")).toBe("");
    });
    it("converts object to string via toString", () => {
      expect(strSafe({ toString: () => "custom" })).toBe("custom");
    });
  });
});

describe("reconciler — ARIA/enumerated booleans serialize as strings", () => {
  it('serializes aria-* booleans as "true"/"false" instead of ""/removal', () => {
    render(<div aria-hidden={false} aria-expanded={true} />, host);
    const div = host.querySelector("div")!;
    expect(div.getAttribute("aria-hidden")).toBe("false");
    expect(div.getAttribute("aria-expanded")).toBe("true");

    render(<div />, host);
    expect(host.querySelector("div")!.hasAttribute("aria-hidden")).toBe(false);
  });

  it('serializes draggable/spellcheck booleans ("" is invalid for draggable)', () => {
    render(<span draggable={true} spellcheck={false} />, host);
    const span = host.querySelector("span")!;
    expect(span.getAttribute("draggable")).toBe("true");
    expect(span.getAttribute("spellcheck")).toBe("false");
  });

  it("keeps plain boolean-attribute semantics for everything else", () => {
    render(<button disabled={false} />, host);
    expect(host.querySelector("button")!.hasAttribute("disabled")).toBe(false);
    render(<button disabled={true} />, host);
    expect(host.querySelector("button")!.getAttribute("disabled")).toBe("");
  });
});

describe("reconciler — capture-phase props are rejected loudly", () => {
  it("warns and skips onClickCapture (would register a bogus event type)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const calls: string[] = [];
    render(
      jsx("section", {
        onClickCapture: () => calls.push("capture"),
        onClick: () => calls.push("click"),
      }),
      host,
    );
    host
      .querySelector("section")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls).toEqual(["click"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("onClickCapture"),
    );
  });

  it("still wires the real gotpointercapture/lostpointercapture events", () => {
    const calls: string[] = [];
    render(jsx("em", { onGotPointerCapture: () => calls.push("got") }), host);
    host.querySelector("em")!.dispatchEvent(new Event("gotpointercapture"));
    expect(calls).toEqual(["got"]);
  });
});

describe("reconciler — duplicate keys warn", () => {
  it("dev-warns when two siblings share a key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<ul>{[<li key="dup">a</li>, <li key="dup">b</li>]}</ul>, host);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate key "dup"'),
    );
  });
});

describe("render — container stays retryable after a first-render throw", () => {
  it("re-render succeeds once the component stops throwing", () => {
    let boom = true;
    function Fussy() {
      if (boom) throw new Error("mount-fail");
      return <p>recovered</p>;
    }
    expect(() => render(<Fussy />, host)).toThrow("mount-fail");
    boom = false;
    render(<Fussy />, host);
    expect(host.querySelector("p")!.textContent).toBe("recovered");
  });
});

describe("props proxy — `in` / Object.keys are reactive to key changes", () => {
  it("re-renders a child that checks `in` when a prop key appears", () => {
    const on = signal(false);
    function Child(props: Record<string, unknown>) {
      return <p>{String("x" in props)}</p>;
    }
    function Parent() {
      return on.value ? <Child x={1} /> : <Child />;
    }
    render(<Parent />, host);
    expect(host.querySelector("p")!.textContent).toBe("false");
    on.value = true;
    expect(host.querySelector("p")!.textContent).toBe("true");
  });

  it("re-renders a child that spreads props when a key is removed", () => {
    const on = signal(true);
    function Child(props: Record<string, unknown>) {
      return <p>{Object.keys(props).sort().join(",")}</p>;
    }
    function Parent() {
      return on.value ? <Child a={1} b={2} /> : <Child a={1} />;
    }
    render(<Parent />, host);
    expect(host.querySelector("p")!.textContent).toBe("a,b");
    on.value = false;
    expect(host.querySelector("p")!.textContent).toBe("a");
  });

  it("does not double-render children on mount (untracked keysVersion bump)", () => {
    let childRenders = 0;
    function Child(props: { cfg: { n: number } }) {
      childRenders++;
      return <p>{props.cfg.n}</p>;
    }
    function Parent() {
      return <Child cfg={{ n: 1 }} />;
    }
    render(<Parent />, host);
    expect(childRenders).toBe(1);
  });
});

describe("matchPath — splat must be the last segment", () => {
  it("rejects mid-pattern splats instead of silently ignoring the tail", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(matchPath("/a/*/b", "/a/x/b")).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"*" is only allowed'),
    );
  });

  it("still captures trailing splats", () => {
    expect(matchPath("/files/*", "/files/a/b")).toEqual({ "*": "a/b" });
  });
});

describe("HMR — edit-revert ping-pong stays consistent", () => {
  it("resolves every version to the latest after A→B→A", () => {
    function A() {
      const n = useSignal(5);
      return <i>{`A${n.value}`}</i>;
    }
    function B() {
      const n = useSignal(5);
      return <i>{`B${n.value}`}</i>;
    }
    const tick = signal(0);
    function Parent() {
      tick.value;
      return <A />;
    }
    render(<Parent />, host);
    expect(host.querySelector("i")!.textContent).toBe("A5");

    hotSwapByComponent(A, B);
    expect(host.querySelector("i")!.textContent).toBe("B5");
    hotSwapByComponent(B, A);
    expect(host.querySelector("i")!.textContent).toBe("A5");

    expect(canonicalComponent(A)).toBe(A);
    expect(canonicalComponent(B)).toBe(A);

    const inst = Array.from(getInstances(A))[0]!;
    tick.value++;
    expect(host.querySelector("i")!.textContent).toBe("A5");
    expect(Array.from(getInstances(A))[0]).toBe(inst);
  });
});

describe("HMR — swap to a version with fewer hooks drops trailing keep slots", () => {
  it("shrinks the hook array on the post-swap render", () => {
    function V1() {
      const a = useSignal(1);
      const b = useSignal(2);
      return <i>{a.value + b.value}</i>;
    }
    function V2() {
      const a = useSignal(9);
      return <b>{a.value}</b>;
    }
    function Parent() {
      return <V1 />;
    }
    render(<Parent />, host);
    expect(host.querySelector("i")!.textContent).toBe("3");

    hotSwapByComponent(V1, V2);
    expect(host.querySelector("b")!.textContent).toBe("1");

    const inst = Array.from(getInstances(V2))[0]!;
    expect(inst.hooks.length).toBe(1);
  });
});
